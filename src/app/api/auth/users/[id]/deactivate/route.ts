/**
 * POST /api/auth/users/[id]/deactivate — 강제 탈퇴 (TASK-AUTH-013, Phase F).
 *
 * 처리 순서:
 *   1. Authorization: Bearer <AT> 추출 → 없음/불량 → 401
 *   2. verifyAccessToken → 실패 시 401
 *   3. 호출자 조회 → ACTIVE 가 아니면 401
 *   4. REQ-AUTH-016 / AC-023: caller.role !== 'ADMIN' → 403 FORBIDDEN
 *   5. params.id 파싱 (Next 15: params 는 Promise — await)
 *   6. target 조회 → 없으면 404
 *   7. REQ-AUTH-015 / AC-022: target.id === caller.id (자체 탈퇴) → 403
 *   8. Q2 idempotent: target.status === 'INACTIVE' → 200 (no-op)
 *   9. REQ-AUTH-014 / AC-024 원자적 트랜잭션 (withTransaction, ROLLBACK on failure):
 *        a. UPDATE users SET status='INACTIVE', role_id=RESIDENT, unit_id=NULL, verified_at=NULL, managed_building_id=NULL
 *        b. UPDATE suggestions SET author_id=NULL, author_label='전 입주민', archived=true WHERE author_id=target
 *           (ADR-005: unit_id 는 보존 — 건드리지 않음)
 *  10. 200 { success: true }
 *
 * RT 무효화 (REQ-AUTH-014 단계 5): 활성 RT 는 저장되지 않으므로(블랙리스트만 저장),
 *   refresh/route.ts 가 사용자 status 를 조회하여 INACTIVE 면 401 로 갱신을 거부한다.
 *   본 route 에서는 RT 를 별도로 블랙리스트에 등록하지 않는다 (AC-021 status check 로 무효화).
 *
 * @MX:WARN: [AUTO] 권한 검사(ADMIN 전용) + 트랜잭션 원자성은 강제 탈퇴 무결성의 핵심
 * @MX:REASON: ADMIN 검사를 누락하면 비-ADMIN 이 회원을 탈퇴시킬 수 있고(REQ-AUTH-016 위반),
 *             트랜잭션을 생략하면 users 만 갱신되고 suggestions 가 갱신 안 되는 부분 적용이 발생하여
 *             ADR-005 호수 귀속·익명화 정책이 깨진다. self-check 누락 시 ADMIN 본인 탈퇴로
 *             관리자가 사라져 운영 마비(REQ-AUTH-015 위반).
 *
 * @MX:NOTE: [AUTO] ADR-005 호수 귀속 보존 — suggestions.unit_id 는 deactivate 트랜잭션에서
 *           절대 건드리지 않는다 (author_id 만 NULL 처리). 탈퇴한 입주민의 건의가 해당 호수 귀속으로
 *           남아 향후 입주민/관리사무소가 맥락을 유지한다.
 *
 * @MX:NOTE: [AUTO] RT 무효화 메커니즘 — 활성 RT 는 저장되지 않으므로(블랙리스트만 보관),
 *           refresh/route.ts 의 status='ACTIVE' 조회로 탈퇴 후 갱신을 401 차단한다 (AC-021).
 */

import { NextResponse } from 'next/server';
import { query, withTransaction } from '../../../../../../lib/db';
import { verifyAccessToken } from '../../../../../../lib/auth';
import { removeAttachmentBinary } from '../../../../../../lib/attachments-storage';

/** Next.js 15 동적 라우트 params 타입 (Promise). */
interface DeactivateParams {
  params: Promise<{ id: string }>;
}

/** UUID v4 정규식 (AC-026: path param 형식 검증 — DB 도달 전 차단). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, ctx: DeactivateParams): Promise<Response> {
  // 1. AT 추출
  const authHeader = request.headers.get('authorization') ?? '';
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!bearerMatch) {
    return unauthorized();
  }

  // 2. AT 검증
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

  // 3. 호출자 조회 (role + ACTIVE 검증)
  const callerRes = await query<{ role: string }>(
    `SELECT r.code AS role
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.status = 'ACTIVE'`,
    [callerId],
  );
  const caller = callerRes.rows[0];
  if (!caller) {
    return unauthorized();
  }

  // 4. REQ-AUTH-016 / AC-023: ADMIN 전용 — 아니면 403
  if (caller.role !== 'ADMIN') {
    return forbidden('관리자만 강제 탈퇴를 실행할 수 있습니다');
  }

  // 5. params.id 파싱 (Next 15: await params)
  const { id: targetId } = await ctx.params;

  // 5b. AC-026: id UUID 형식 검증 — SQL 주입/불량 페이로드를 DB 도달 전 차단
  if (!UUID_RE.test(targetId)) {
    return badRequest('올바른 회원 ID 가 아닙니다');
  }

  // 6. target 존재 확인 — 없으면 404
  const targetRes = await query<{ status: string }>(
    'SELECT status FROM users WHERE id = $1',
    [targetId],
  );
  const target = targetRes.rows[0];
  if (!target) {
    return notFound();
  }

  // 7. REQ-AUTH-015 / AC-022: 자체 탈퇴 금지
  if (targetId === callerId) {
    return forbidden('관리자 본인은 강제 탈퇴할 수 없습니다');
  }

  // 8. Q2 idempotent: 이미 INACTIVE → 200 no-op
  if (target.status === 'INACTIVE') {
    return NextResponse.json({ success: true, data: null }, { status: 200 });
  }

  // 9. REQ-AUTH-014 원자적 트랜잭션 (AC-024 ROLLBACK)
  //    a. users 갱신 (status, role 환원, unit/verified/managed 해제)
  //    b. suggestions 아카이브 (ADR-005: unit_id 보존, author_id 만 NULL)
  //    c. REQ-ATT-028: 탈퇴자 업로드 첨부 cascade — DB 행 + storage_path 수집
  let attachmentPaths: string[] = [];
  try {
    attachmentPaths = await withTransaction(async (client) => {
      await client.query(
        `UPDATE users
         SET status = 'INACTIVE',
             role_id = (SELECT id FROM roles WHERE code = 'RESIDENT'),
             unit_id = NULL,
             verified_at = NULL,
             managed_building_id = NULL,
             updated_at = now()
         WHERE id = $1`,
        [targetId],
      );
      // AC-026 parameterized. unit_id 미갱신 (ADR-005 보존).
      await client.query(
        `UPDATE suggestions
         SET author_id = NULL, author_label = '전 입주민', archived = true
         WHERE author_id = $1`,
        [targetId],
      );
      // REQ-ATT-028: 탈퇴자가 업로드한 첨부 — DELETE RETURNING 으로 storage_path 수집+삭제 1쿼리 (W-P2 최적화).
      const delRes = await client.query<{ storage_path: string }>(
        `DELETE FROM attachments WHERE uploader_id = $1 RETURNING storage_path`,
        [targetId],
      );
      return delRes.rows.map((r) => r.storage_path);
    });
  } catch {
    // AC-024: 트랜잭션 실패 → withTransaction 이 ROLLBACK 후 재전파 → 500
    return NextResponse.json(
      {
        success: false,
        error: { code: 'DEACTIVATE_FAILED', message: '강제 탈퇴 처리 중 오류가 발생했습니다' },
      },
      { status: 500 },
    );
  }

  // post-commit best-effort 디스크 정리 (REQ-ATT-028; 실패 시 로그만, 고아 파일은 REQ-ATT-016 모니터링)
  for (const p of attachmentPaths) {
    try {
      removeAttachmentBinary(p);
    } catch (err) {
      console.error(`[attachments] cascade 디스크 제거 실패 (REQ-ATT-028): path=${p}`, err);
    }
  }

  // 10. 200
  return NextResponse.json({ success: true, data: null }, { status: 200 });
}

/** 401 미인증 응답. */
function unauthorized(): Response {
  return NextResponse.json(
    { success: false, error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다' } },
    { status: 401 },
  );
}

/** 403 FORBIDDEN 응답 (RBAC / 자체 탈퇴). */
function forbidden(message: string): Response {
  return NextResponse.json(
    { success: false, error: { code: 'FORBIDDEN', message } },
    { status: 403 },
  );
}

/** 400 Bad Request 응답 (path param 형식 오류). */
function badRequest(message: string): Response {
  return NextResponse.json(
    { success: false, error: { code: 'BAD_REQUEST', message } },
    { status: 400 },
  );
}

/** 404 Not Found 응답. */
function notFound(): Response {
  return NextResponse.json(
    { success: false, error: { code: 'NOT_FOUND', message: '존재하지 않는 회원입니다' } },
    { status: 404 },
  );
}
