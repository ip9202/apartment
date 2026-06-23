/**
 * POST /api/auth/password/reset/confirm — 비밀번호 재설정 확인 (SPEC-AUTH-RESET-001).
 *
 * 처리 순서:
 *   1. 본문 파싱 + resetConfirmSchema 검증 (형식/강도/확인 → 422, REQ-RESET-006)
 *   2. 토큰 SHA-256 해시 → 활성 레코드 조회 (used_at IS NULL, expires_at > now)
 *   3. 미존재/만료/사용됨 → 400 + 만료 메시지 (REQ-RESET-005/008, 비밀번호 미변경)
 *   4. 트랜잭션 내 원자적 처리:
 *      a. users.password_hash 갱신 (bcrypt salt 12)
 *      b. 토큰 used_at 갱신 (일회용, REQ-RESET-008)
 *   5. 세션 무효화 (REQ-RESET-007): 사용자 활성 재설정 토큰 일괄 무효화 +
 *      요청 쿠키의 RT 가 있으면 블랙리스트 등록
 *   6. 200 + 성공 메시지
 *
 * @MX:ANCHOR: [AUTO] AUTH-05 재설정 확인 공개 API 경계 — 토큰 검증/비밀번호 변경/세션 무효화 계약
 * @MX:REASON:  공개 엔드포인트로서 토큰 검증·원자적 변경·일회용 보장이 보안 핵심.
 *             회귀 시 토큰 재사용·만료 우회·부분 변경 공격 허용.
 */

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { query, withTransaction } from '../../../../../../lib/db';
import { resetConfirmSchema } from '../../../../../../lib/validators';
import { hashPassword, verifyRefreshToken, REFRESH_TTL_SECONDS } from '../../../../../../lib/auth';
import {
  hashToken,
  applyPasswordChange,
  invalidateUserTokens,
} from '../../../../../../lib/password-reset';
import { REFRESH_COOKIE_NAME } from '../../../../../../lib/cookies';

const INVALID_TOKEN_MESSAGE = '재설정 링크가 만료되었거나 유효하지 않습니다';

function validationError(message: string): Response {
  return NextResponse.json(
    { success: false, error: { code: 'VALIDATION_ERROR', message } },
    { status: 422 },
  );
}

function invalidTokenError(): Response {
  return NextResponse.json(
    { success: false, error: { code: 'INVALID_TOKEN', message: INVALID_TOKEN_MESSAGE } },
    { status: 400 },
  );
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function extractCookie(cookieHeader: string, name: string): string | null {
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    if (trimmed.slice(0, eqIdx).trim() === name) {
      return trimmed.slice(eqIdx + 1).trim();
    }
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  // 1. 본문 파싱
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return validationError('요청 본문이 올바른 JSON 형식이 아닙니다');
  }

  // 2. zod 검증 (강도 정책 포함)
  const parsed = resetConfirmSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? '유효성 오류');
  }

  // 3. 토큰 해시로 활성 레코드 조회 (REQ-RESET-004/005/008)
  const tokenHash = hashToken(parsed.data.token);
  const tokenRes = await query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     LIMIT 1`,
    [tokenHash],
  );
  const tokenRow = tokenRes.rows[0];
  if (!tokenRow) {
    // 미존재/만료/사용됨 → 400, 비밀번호 미변경 (REQ-RESET-005/008)
    return invalidTokenError();
  }

  // 4. 원자적 비밀번호 변경 + 토큰 사용 처리 (트랜잭션)
  /**
   * @MX:WARN: [AUTO] 비밀번호 변경과 토큰 used_at 갱신은 반드시 원자적 — 부분 성공 시 보안 홀
   * @MX:REASON: 비밀번호만 바뀌고 토큰이 살면 재사용 공격 가능, 반대면 사용자 잠김
   */
  const newPasswordHash = hashPassword(parsed.data.password);
  await withTransaction(async (client) => {
    await applyPasswordChange(client, tokenRow.id, tokenRow.user_id, newPasswordHash);
  });

  // 5. 세션 무효화 (REQ-RESET-007)
  /**
   * @MX:WARN: [AUTO] 비밀번호 변경 후 전체 세션 무효화 — 탈취 세션 지속 접근 차단
   * @MX:REASON: 비밀번호 변경 전 탈취된 RT/재설정 토큰이 유효하면 공격자 접근 지속.
   *             본 구현은 (a) 사용자 활성 재설정 토큰 일괄 무효화 + (b) 요청 RT 쿠키 블랙리스트.
   *             한계: SPEC-AUTH-001 이 발급된 모든 RT 를 추적하지 않으므로, 비-요청 RT 전체
   *             열거 무효화는 불가. 향후 RT 레지스트리 도입 시 보강 (@MX:TODO).
   */
  await invalidateUserTokens(tokenRow.user_id);
  await revokeRequestRefreshToken(request, tokenRow.user_id);

  // 6. 200
  return NextResponse.json(
    { success: true, data: { message: '비밀번호가 재설정되었습니다' } },
    { status: 200 },
  );
}

/** 요청 쿠키의 RT 가 있으면 블랙리스트 등록 (세션 무효화 일환, 에러 무시). */
async function revokeRequestRefreshToken(request: Request, userId: string): Promise<void> {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const rtValue = extractCookie(cookieHeader, REFRESH_COOKIE_NAME);
  if (!rtValue) return;
  try {
    const rtClaims = verifyRefreshToken(rtValue);
    const jti = rtClaims.jti;
    if (!jti) return;
    const rtHash = sha256(rtValue);
    await query(
      `INSERT INTO revoked_refresh_tokens (token_jti, token_hash, user_id, expires_at)
       VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)
       ON CONFLICT (token_jti) DO NOTHING`,
      [jti, rtHash, userId, String(REFRESH_TTL_SECONDS)],
    );
  } catch {
    // verifyRefreshToken 실패(만료/서명불일치) → 이미 무효, 블랙리스트 생략.
  }
}
