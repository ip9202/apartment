/**
 * POST /api/auth/login — AUTH-03 로그인 (TASK-AUTH-008).
 *
 * 처리 순서:
 *   1. JSON 본문 파싱 (파싱 실패 → 422)
 *   2. loginSchema 검증 (형식 → 422)
 *   3. 이메일 소문자 정규화
 *   4. 잠금 상태 검사 (isLocked) → 429 + Retry-After (AC-008)
 *   5. SELECT user by email
 *   6. not-found → recordFailedAttempt + 통일 401 (AC-006, 사용자 열거 방지)
 *   7. comparePassword → 불일치 시 recordFailedAttempt + 통일 401 (AC-006)
 *   8. status=INACTIVE → 401 (강제 탈퇴 회원)
 *   9. 성공: resetAttempts, AT/RT 발급, RT 쿠키, 200 + access_token (AC-005)
 *
 * REQ-AUTH-004 (AT/RT 발급), REQ-AUTH-005 (통일 오류 메시지), REQ-AUTH-006 (5회 잠금).
 *
 * @MX:NOTE: [AUTO] 통일 오류 메시지 "이메일 또는 비밀번호가 올바르지 않습니다" 는
 *           사용자 열거 공격 방어(REQ-AUTH-005)의 핵심 — not-found 와 wrong-password 를 구분하지 않는다.
 *           잠금 정책(5회/10분)은 rate-limit.ts 에 위임하여 DB 영속화로 서버 재시작에도 유지된다.
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../lib/db';
import {
  signAccessToken,
  signRefreshToken,
  comparePassword,
} from '../../../../lib/auth';
import { buildRefreshCookie, buildAccessCookie } from '../../../../lib/cookies';
import { loginSchema } from '../../../../lib/validators';
import {
  isLocked,
  recordFailedAttempt,
  resetAttempts,
  LOCK_DURATION_MINUTES,
} from '../../../../lib/rate-limit';

const UNIFIED_CREDENTIAL_ERROR = '이메일 또는 비밀번호가 올바르지 않습니다';

export async function POST(request: Request): Promise<Response> {
  // 1. 본문 파싱
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return validationError('요청 본문이 올바른 JSON 형식이 아닙니다');
  }

  // 2. zod 검증
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? '유효성 오류');
  }

  // 3. 이메일 정규화 (소문자)
  const email = parsed.data.email.toLowerCase();

  // 4. 잠금 검사 (AC-008) — 잠금 중에는 비밀번호 검증 전에 429
  if (await isLocked(email)) {
    return lockedResponse();
  }

  // 5. 사용자 조회 — parameterized (AC-026)
  const userRes = await query<{
    id: string;
    email: string;
    password_hash: string;
    status: string;
    verified_at: string | null;
    role: string;
  }>(
    `SELECT u.id, u.email, u.password_hash, u.status, u.verified_at,
            r.code AS role
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.email = $1`,
    [email],
  );
  const user = userRes.rows[0];

  // 6. not-found → 실패 기록 + 통일 401
  if (!user) {
    await recordFailedAttempt(email);
    return credentialError();
  }

  // 7. 비밀번호 검증 → 불일치 시 실패 기록 + 통일 401
  if (!user.password_hash || !comparePassword(parsed.data.password, user.password_hash)) {
    await recordFailedAttempt(email);
    return credentialError();
  }

  // 8. INACTIVE 회원 (강제 탈퇴) → 401
  if (user.status === 'INACTIVE') {
    return credentialError();
  }

  // 9. 성공 — 실패 카운트 초기화 (AC-009)
  await resetAttempts(email);

  const verified = user.verified_at !== null;

  // AT/RT 발급 (REQ-AUTH-004)
  const accessToken = signAccessToken({
    sub: user.id,
    role: user.role,
    verified,
  });
  const refreshToken = signRefreshToken({ sub: user.id });

  const responseBody = {
    success: true,
    data: {
      access_token: accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        verified,
      },
    },
  };

  const res = new NextResponse(JSON.stringify(responseBody), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  // AT 쿠키 (Edge 미들웨어용, REQ-AUTH-013) + RT 쿠키를 별도 Set-Cookie 헤더로 설정.
  // Headers.append 로 동일 키를 여러 값으로 추가 — 브라우저가 두 쿠키를 모두 인식한다.
  //
  // @MX:NOTE: [AUTO] AT 쿠키 결정 (REQ-AUTH-013) — Bearer 헤더는 API 클라이언트용, AT 쿠키는
  //           브라우저 페이지 네비게이션용 이중 전송. Edge 미들웨어(src/middleware.ts)가
  //           페이지 라우트에서 AT 쿠키를 읽어 verified 상태를 검사 → 미인증 시 /verify 리다이렉트.
  res.headers.append('set-cookie', buildAccessCookie(accessToken));
  res.headers.append('set-cookie', buildRefreshCookie(refreshToken));
  return res;
}

/** 422 검증 오류 응답 헬퍼. */
function validationError(message: string): Response {
  return NextResponse.json(
    { success: false, error: { code: 'VALIDATION_ERROR', message } },
    { status: 422 },
  );
}

/** 통일된 자격증명 오류 응답 (AC-006, REQ-AUTH-005). */
function credentialError(): Response {
  return NextResponse.json(
    { success: false, error: { code: 'INVALID_CREDENTIALS', message: UNIFIED_CREDENTIAL_ERROR } },
    { status: 401 },
  );
}

/** 잠금 응답 (AC-008) — Retry-After 헤더로 남은 잠금 시간(초) 안내. */
function lockedResponse(): Response {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'TOO_MANY_ATTEMPTS',
        message: `로그인 시도 횟수를 초과했습니다. ${LOCK_DURATION_MINUTES}분 후 다시 시도해주세요`,
      },
    },
    {
      status: 429,
      headers: {
        'retry-after': String(LOCK_DURATION_MINUTES * 60),
      },
    },
  );
}
