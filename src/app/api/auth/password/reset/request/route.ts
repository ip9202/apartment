/**
 * POST /api/auth/password/reset/request — 비밀번호 재설정 요청 (SPEC-AUTH-RESET-001).
 *
 * 처리 순서:
 *   1. 본문 파싱 + resetRequestSchema 검증 (형식 오류 → 422)
 *   2. Rate Limiting (이메일/IP 각각 10분당 3회) → 429 (REQ-RESET-003)
 *   3. 이메일 소문자 정규화
 *   4. SELECT user by email
 *   5. 사용자 미존재 → 동일 성공 응답 반환 (REQ-RESET-002, 사용자 열거 방지)
 *   6. 토큰 생성(crypto.randomBytes 32) + SHA-256 해시 저장 + 30분 만료 (REQ-RESET-001)
 *   7. 이메일 발송 (개발 폴백/SMTP) — 발송 실패해도 응답은 성공(REQ-RESET-002 준수)
 *   8. 200 + 통일 성공 메시지
 *
 * @MX:ANCHOR: [AUTO] AUTH-05 재설정 요청 공개 API 경계 — 외부 노출 엔드포인트
 * @MX:REASON:  인증 없이 호출되는 공개 엔드포인트. 입력 검증/Rate Limit/응답 통일 계약이
 *             위조·열거·폭탄 공격 방어의 핵심이므로 불변.
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../../../lib/db';
import { resetRequestSchema } from '../../../../../../lib/validators';
import { createResetToken } from '../../../../../../lib/password-reset';
import { sendResetEmail, buildResetLink } from '../../../../../../lib/email';
import { resetRateLimiter } from './rate-limiter-instance';
import { env } from '../../../../../../lib/env';

const SUCCESS_MESSAGE = '해당 이메일이 가입되어 있다면 재설정 링크를 발송했습니다';

/**
 * @MX:WARN: [AUTO] 사용자 열거 방지 — 가입 여부에 따라 응답을 분기하지 않는다 (REQ-RESET-002)
 * @MX:REASON: 응답 차이로 계정 존재 여부가 노출되면 공격자가 대량 이메일로 계정 목록 수집 가능
 */
function successResponse(): Response {
  return NextResponse.json(
    { success: true, data: { message: SUCCESS_MESSAGE } },
    { status: 200 },
  );
}

function validationError(message: string): Response {
  return NextResponse.json(
    { success: false, error: { code: 'VALIDATION_ERROR', message } },
    { status: 422 },
  );
}

function tooManyRequests(): Response {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요',
      },
    },
    { status: 429 },
  );
}

function extractIp(request: Request): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? 'unknown';
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(request: Request): Promise<Response> {
  // 1. 본문 파싱
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return validationError('요청 본문이 올바른 JSON 형식이 아닙니다');
  }

  // 2. zod 검증
  const parsed = resetRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? '유효성 오류');
  }

  // 3. Rate Limiting (이메일/IP) — 429 (REQ-RESET-003)
  const ip = extractIp(request);
  if (!resetRateLimiter.tryConsume(parsed.data.email, ip)) {
    return tooManyRequests();
  }

  // 4. 이메일 정규화
  const email = parsed.data.email.toLowerCase();

  // 5. 사용자 조회
  const userRes = await query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1 AND status = $2',
    [email, 'ACTIVE'],
  );
  const user = userRes.rows[0];

  // 6. 미존재 → 동일 성공 응답 (REQ-RESET-002, 열거 방지)
  if (!user) {
    return successResponse();
  }

  // 7. 토큰 생성 + 해시 저장 (REQ-RESET-001)
  const { token } = await createResetToken(user.id);

  // 8. 이메일 발송 — 실패해도 응답은 통일 성공 (REQ-RESET-002 준수, 내부 로깅)
  const resetLink = buildResetLink(env.NEXT_PUBLIC_APP_URL, token);
  try {
    await sendResetEmail({ to: email, resetLink, appUrl: env.NEXT_PUBLIC_APP_URL });
  } catch (err) {
    // 발송 실패는 사용자에게 노출하지 않음 (열거/오정보 방지). 서버 로그만 기록.
    console.error('[reset/request] 이메일 발송 실패:', err instanceof Error ? err.message : String(err));
  }

  return successResponse();
}
