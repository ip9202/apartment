/**
 * POST /api/auth/logout — AUTH-03 로그아웃 (TASK-AUTH-009).
 *
 * 처리 순서:
 *   1. Authorization: Bearer <AT> 추출 → 없음/불량 → 401
 *   2. verifyAccessToken → 실패 시 401
 *   3. Cookie 에서 RT 추출
 *      - RT 없음 → 멱등하게 쿠키만 삭제하고 200
 *      - RT 있음 → verifyRefreshToken (에러 무시), jti+hash 추출
 *   4. revoked_refresh_tokens INSERT (ON CONFLICT 멱등, token_jti UNIQUE)
 *   5. RT 쿠키 만료(Max-Age=0), 200
 *
 * REQ-AUTH-007 (RT 블랙리스트 + 쿠키 만료).
 *
 * @MX:WARN: [AUTO] 토큰 폐기 로직은 인증 보안 핵심 — 누락 시 탈취된 RT 가 로그아웃 후에도 유효
 * @MX:REASON: RT 를 블랙리스트에 등록하지 않으면 로그아웃 후에도 refresh 가 성공하여 세션 탈취 지속.
 *             verifyRefreshToken 에러를 무시하는 것은 의도적 — 잘못된 RT 도 멱등하게 처리하기 위함.
 */

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { query } from '../../../../lib/db';
import {
  verifyAccessToken,
  verifyRefreshToken,
  REFRESH_TTL_SECONDS,
} from '../../../../lib/auth';
import { clearRefreshCookie, clearAccessCookie, REFRESH_COOKIE_NAME } from '../../../../lib/cookies';

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export async function POST(request: Request): Promise<Response> {
  // 1. Authorization 헤더에서 AT 추출
  const authHeader = request.headers.get('authorization') ?? '';
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!bearerMatch) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다' } },
      { status: 401 },
    );
  }

  // 2. AT 검증 — 실패 시 401 (서명 불일치, 만료, 잘못된 형식 모두 포함)
  let atClaims: { sub?: string };
  try {
    atClaims = verifyAccessToken(bearerMatch[1]);
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다' } },
      { status: 401 },
    );
  }

  const userId = atClaims.sub;

  // 3. Cookie 에서 RT 추출
  const cookieHeader = request.headers.get('cookie') ?? '';
  const rtValue = extractCookie(cookieHeader, REFRESH_COOKIE_NAME);

  // 4. RT 가 있으면 블랙리스트 등록 (에러 무시 — 잘못된 RT 도 멱등 처리)
  if (rtValue && userId) {
    try {
      const rtClaims = verifyRefreshToken(rtValue);
      const jti = rtClaims.jti;
      const tokenHash = sha256(rtValue);
      if (jti) {
        await query(
          `INSERT INTO revoked_refresh_tokens (token_jti, token_hash, user_id, expires_at)
           VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)
           ON CONFLICT (token_jti) DO NOTHING`,
          [jti, tokenHash, userId, String(REFRESH_TTL_SECONDS)],
        );
      }
    } catch {
      // verifyRefreshToken 실패(만료/서명불일치) → 블랙리스트 등록 생략, 쿠키만 삭제.
    }
  }

  // 5. AT + RT 쿠키 만료 + 200
  const res = new NextResponse(JSON.stringify({ success: true, data: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  res.headers.append('set-cookie', clearAccessCookie());
  res.headers.append('set-cookie', clearRefreshCookie());
  return res;
}

/** Cookie 헤더에서 지정한 이름의 값을 추출. 없으면 null. */
function extractCookie(cookieHeader: string, name: string): string | null {
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (key === name) {
      return trimmed.slice(eqIdx + 1).trim();
    }
  }
  return null;
}
