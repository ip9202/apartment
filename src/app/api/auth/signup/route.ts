/**
 * POST /api/auth/signup — AUTH-01 회원가입 (TASK-AUTH-006).
 *
 * 처리 순서:
 *   1. JSON 본문 파싱 (파싱 실패 → 422)
 *   2. signupSchema 검증 (형식/정책/confirm → 422)
 *   3. 이메일 소문자 정규화
 *   4. 중복 검사 (SELECT) — UNIQUE 제약이 race backstop
 *   5. bcrypt 해시 (REQ-AUTH-002)
 *   6. INSERT (role=RESIDENT, verified_at=NULL)
 *   7. 201 + 정제된 사용자 객체 (AC-025: password_hash 절대 미포함)
 *
 * @MX:NOTE: [AUTO] 신규 가입자는 항상 role=RESIDENT, verified=false 로 생성되며
 *           클라이언트는 응답의 verified:false 를 신호로 /verify 화면으로 이동한다 (REQ-AUTH-003).
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import { hashPassword } from '../../../../lib/auth';
import { signupSchema, type SignupResponseUser } from '../../../../lib/validators';

export async function POST(request: Request): Promise<Response> {
  // 1. 본문 파싱
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return validationError('요청 본문이 올바른 JSON 형식이 아닙니다');
  }

  // 2. zod 검증
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? '유효성 오류');
  }

  // 3. 이메일 정규화 (소문자)
  const email = parsed.data.email.toLowerCase();

  // 4. 중복 검사 — parameterized (AC-026)
  const existing = await query(
    'SELECT 1 FROM users WHERE email = $1',
    [email],
  );
  if (existing.rowCount && existing.rowCount > 0) {
    return NextResponse.json(
      { success: false, error: { code: 'CONFLICT', message: '이미 가입된 이메일입니다' } },
      { status: 409 },
    );
  }

  // 5. 비밀번호 해시 (bcrypt salt 12, REQ-AUTH-002)
  const passwordHash = hashPassword(parsed.data.password);

  // 6. INSERT — role_id 서브쿼리로 RESIDENT 고정, verified_at=NULL, unit_id/managed_building_id=NULL
  // @MX:NOTE: [AUTO] role='RESIDENT' 코드는 시드에 보장됨 (SPEC-AUTH-001 §seed). provider 기본 'email'.
  const insertResult = await query<{
    id: string;
  }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id, managed_building_id)
     VALUES ($1, $2, (SELECT id FROM roles WHERE code = 'RESIDENT'), 'email', 'ACTIVE', NULL, NULL, NULL)
     RETURNING id`,
    [email, passwordHash],
  );

  const userId = insertResult.rows[0]?.id;
  if (!userId) {
    // UNIQUE 제약 위반(race) 또는 예외 — 클라이언트 친화적 409로 처리.
    return NextResponse.json(
      { success: false, error: { code: 'CONFLICT', message: '이미 가입된 이메일입니다' } },
      { status: 409 },
    );
  }

  // 7. 정제된 응답 (AC-025: password_hash 미포함)
  const user: SignupResponseUser = {
    id: userId,
    email,
    role: 'RESIDENT',
    verified: false,
  };

  return NextResponse.json({ success: true, data: user }, { status: 201 });
}

/** 422 검증 오류 응답 헬퍼. */
function validationError(message: string): Response {
  return NextResponse.json(
    { success: false, error: { code: 'VALIDATION_ERROR', message } },
    { status: 422 },
  );
}
