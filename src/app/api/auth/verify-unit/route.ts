/**
 * POST /api/auth/verify-unit — 동/호수 인증 (TASK-AUTH-011, Phase E).
 *
 * 처리 순서:
 *   1. Authorization: Bearer <AT> 추출 → 없음/불량 → 401
 *   2. verifyAccessToken → 실패 시 401
 *   3. JSON 본문 파싱 + zod 검증 (building_id/unit_id uuid) → 422
 *   4. 호출자 조회 (role, verified_at, status) → ACTIVE 가 아니면 401
 *   5. Q1: 이미 verified_at NOT NULL → 409 CONFLICT "이미 인증된 회원"
 *   6. REQ-AUTH-010a: unit + building 조인 조회 (존재 + building 소속 검증) → 없으면 422
 *   7. REQ-AUTH-012: 동일 unit_id 에 이미 ACTIVE 회원이 있으면 → 409 "관리사무소 문의"
 *   8. REQ-AUTH-010: UPDATE users SET unit_id, verified_at=now()
 *   9. REQ-AUTH-011: REP 역할 → UPDATE users.managed_building_id (AC-015)
 *  10. MW 정책: verified:true fresh AT 발급 + AT 쿠키 설정 → 200
 *
 * REQ-AUTH-010/010a/011/012, AC-014~017 검증.
 *
 * @MX:NOTE: [AUTO] REP 역할 시 managed_building_id 자동 연결 (REQ-AUTH-011) —
 *           동대표 권한 위임의 근간. 일반 입주민(RESIDENT)에게는 기록하지 않는다.
 *           AC-026: 모든 쿼리는 parameterized ($1, $2, ...) — SQL Injection 방어.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '../../../../lib/db';
import {
  verifyAccessToken,
  signAccessToken,
} from '../../../../lib/auth';
import { buildAccessCookie } from '../../../../lib/cookies';

/** UUID v4 형식 정규식 — zod 4 에서 deprecated 된 z.string().uuid() 대신 사용 (validators.ts idiom 일관). */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** verify-unit 요청 본문 스키마 (research.md §3.5). */
const verifyUnitSchema = z.object({
  building_id: z
    .string()
    .refine((v) => UUID_REGEX.test(v), '올바른 building_id 가 아닙니다'),
  unit_id: z
    .string()
    .refine((v) => UUID_REGEX.test(v), '올바른 unit_id 가 아닙니다'),
});

export async function POST(request: Request): Promise<Response> {
  // 1. AT 추출
  const authHeader = request.headers.get('authorization') ?? '';
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!bearerMatch) {
    return unauthorized();
  }

  // 2. AT 검증 — 실패 시 401
  let atClaims: { sub?: string };
  try {
    atClaims = verifyAccessToken(bearerMatch[1]);
  } catch {
    return unauthorized();
  }
  const callerId = atClaims.sub;
  if (!callerId) {
    return unauthorized();
  }

  // 3. 본문 파싱 + 검증
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return validationError('요청 본문이 올바른 JSON 형식이 아닙니다');
  }
  const parsed = verifyUnitSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? '유효성 오류');
  }
  const { building_id: buildingId, unit_id: requestedUnitId } = parsed.data;

  // 4. 호출자 조회 — ACTIVE 상태 + 현재 verified_at/role/unit_id
  const callerRes = await query<{ role: string; verified_at: string | null }>(
    `SELECT r.code AS role, u.verified_at
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.status = 'ACTIVE'`,
    [callerId],
  );
  const caller = callerRes.rows[0];
  if (!caller) {
    return unauthorized();
  }

  // 5. Q1: 이미 인증된 회원 재인증 → 409
  if (caller.verified_at !== null) {
    return conflictError('이미 인증된 회원입니다');
  }

  // 6. REQ-AUTH-010a: unit 존재 + building 소속 검증 → 없으면 422
  const unitRes = await query<{ id: string }>(
    `SELECT u.id FROM units u
     JOIN buildings b ON b.id = u.building_id
     WHERE u.id = $1 AND b.id = $2`,
    [requestedUnitId, buildingId],
  );
  if (!unitRes.rows[0]) {
    return validationError('존재하지 않는 동/호수 이거나 해당 동에 속하지 않는 호수입니다');
  }
  const unitId = unitRes.rows[0].id;

  // 7. REQ-AUTH-012: 동일 호수에 ACTIVE 회원 존재 → 409 "관리사무소 문의"
  const occupantRes = await query<{ id: string }>(
    `SELECT id FROM users WHERE unit_id = $1 AND status = 'ACTIVE' AND id <> $2`,
    [unitId, callerId],
  );
  if (occupantRes.rows[0]) {
    return conflictError('해당 호수에 이미 등록된 입주민이 있습니다. 관리사무소에 문의하세요.');
  }

  // 8. REQ-AUTH-010: unit_id + verified_at 갱신 (parameterized, AC-026)
  await query(
    `UPDATE users SET unit_id = $1, verified_at = now(), updated_at = now() WHERE id = $2`,
    [unitId, callerId],
  );

  // 9. REQ-AUTH-011: REP 역할 → managed_building_id 자동 연결 (AC-015)
  if (caller.role === 'REP') {
    await query(
      `UPDATE users SET managed_building_id = $1, updated_at = now() WHERE id = $2`,
      [buildingId, callerId],
    );
  }

  // 10. MW 정책: verified:true fresh AT 발급 + AT 쿠키 설정
  const freshAt = signAccessToken({ sub: callerId, role: caller.role, verified: true });

  // 호출자 email 조회 (응답 본문용)
  const emailRes = await query<{ email: string }>('SELECT email FROM users WHERE id = $1', [
    callerId,
  ]);
  const email = emailRes.rows[0]?.email ?? '';

  const responseBody = {
    success: true,
    data: {
      access_token: freshAt,
      user: {
        id: callerId,
        email,
        role: caller.role,
        verified: true,
      },
    },
  };

  return new NextResponse(JSON.stringify(responseBody), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'set-cookie': buildAccessCookie(freshAt),
    },
  });
}

/** 401 미인증 응답. */
function unauthorized(): Response {
  return NextResponse.json(
    { success: false, error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다' } },
    { status: 401 },
  );
}

/** 422 검증 오류 응답. */
function validationError(message: string): Response {
  return NextResponse.json(
    { success: false, error: { code: 'VALIDATION_ERROR', message } },
    { status: 422 },
  );
}

/** 409 CONFLICT 응답. */
function conflictError(message: string): Response {
  return NextResponse.json(
    { success: false, error: { code: 'CONFLICT', message } },
    { status: 409 },
  );
}
