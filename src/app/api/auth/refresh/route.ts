/**
 * POST /api/auth/refresh — 토큰 갱신 (TASK-AUTH-010, Phase D).
 *
 * 처리 순서:
 *   1. Cookie 에서 RT 추출 (REFRESH_COOKIE_NAME = 'rt') → 없음 → 401
 *   2. verifyRefreshToken(rt) → 만료/서명불일치 → 401 (AC-013, 변조 RT)
 *   3. token_hash 계산 (SHA-256 hex — logout/route.ts 와 동일 알고리즘 필수)
 *   4. 블랙리스트 조회 (revoked_refresh_tokens.token_hash) → hit → 401 (AC-012)
 *   5. RT.sub 로 사용자 조회 → role/verified 확보 → signAccessToken → 200 (AC-011)
 *
 * Q3 정책 (RT 재사용 허용): 성공적 갱신 후 RT 를 블랙리스트에 등록하지 않는다.
 * 38 세대 규모에서 단순 정책이며, 회전(rotating) 미도입 — 낮은 리스크.
 *
 * @MX:WARN: [AUTO] 토큰 검증·블랙리스트 조회 로직은 인증 보안 핵심 — 우회 시 탈취 RT 로 세션 영속
 * @MX:REASON: verifyRefreshToken 실패를 401 로 처리하지 않거나 블랙리스트 조회를 생략하면
 *             만료/변조/폐기된 RT 로도 갱신이 성공하여 세션 탈취가 지속된다.
 *             token_hash 알고리즘은 logout/route.ts 의 sha256 hex 와 반드시 일치해야
 *             (REQ-AUTH-007/009 일관성) — 불일치 시 logout 이 등록한 row 가 refresh 에서 누락된다.
 *
 * @MX:NOTE: [AUTO] Q3 결정 — RT 재사용 허용. 하나의 RT 로 여러 번 갱신 가능 (회전 없음).
 *           38 세대 규모에서 단순 정책 채택, 강제 탈퇴(REQ-AUTH-014) 시에만 일괄 블랙리스트 등록.
 *
 * @MX:NOTE: [AUTO] 강제 탈퇴 후 RT 무효화 (AC-021) — 활성 RT 는 저장되지 않으므로(블랙리스트만 보관),
 *           사용자 status='ACTIVE' 조회로 탈퇴(INACTIVE) 후 갱신을 401 로 차단한다.
 *           deactivate/route.ts 는 RT 를 별도 블랙리스트에 등록하지 않고 본 조회에 의존한다.
 */

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import type { JwtPayload } from 'jsonwebtoken';
import { query } from '../../../../lib/db';
import {
  signAccessToken,
  verifyRefreshToken,
} from '../../../../lib/auth';
import { REFRESH_COOKIE_NAME, buildAccessCookie } from '../../../../lib/cookies';

/** RT 문자열의 SHA-256 hex 해시. logout/route.ts 의 sha256 과 동일 알고리즘 (REQ 일관성). */
function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** 블랙리스트에 해당 해시가 등록되어 있는지 조회 (parameterized, AC-026). */
async function isTokenRevoked(tokenHash: string): Promise<boolean> {
  const res = await query(
    'SELECT 1 FROM revoked_refresh_tokens WHERE token_hash = $1',
    [tokenHash],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function POST(request: Request): Promise<Response> {
  // 1. Cookie 에서 RT 추출
  const cookieHeader = request.headers.get('cookie') ?? '';
  const rtValue = extractCookie(cookieHeader, REFRESH_COOKIE_NAME);
  if (!rtValue) {
    return unauthorized();
  }

  // 2. RT 검증 — 만료/서명불일치 모두 401 (AC-013)
  let claims: JwtPayload;
  try {
    claims = verifyRefreshToken(rtValue);
  } catch {
    return unauthorized();
  }

  // 3. token_hash 계산 (logout 과 동일 알고리즘)
  const tokenHash = sha256(rtValue);

  // 4. 블랙리스트 조회 → hit 시 401 (AC-012)
  if (await isTokenRevoked(tokenHash)) {
    return unauthorized();
  }

  // 5. RT.sub 로 사용자 조회 — 새 AT 의 role/verified 확보
  const userId = typeof claims.sub === 'string' ? claims.sub : null;
  if (!userId) {
    return unauthorized();
  }
  const userRes = await query<{ role: string; verified_at: string | null }>(
    `SELECT r.code AS role, u.verified_at
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.status = 'ACTIVE'`,
    [userId],
  );
  const user = userRes.rows[0];
  if (!user) {
    // 사용자가 삭제/탈퇴(INACTIVE) 된 경우 — 재발급 거부
    return unauthorized();
  }

  // 6. 새 AT 발급 — signAccessToken 이 매 호출마다 새 jti 생성 (AC-011 jti 상이)
  const accessToken = signAccessToken({
    sub: userId,
    role: user.role,
    verified: user.verified_at !== null,
  });

  // Q3: RT 를 블랙리스트에 등록하지 않는다 (재사용 허용).
  // MW 정책: 새 AT 를 본문 + AT 쿠키(Edge 미들웨어용)로 동시 전송.
  const res = NextResponse.json(
    { success: true, data: { access_token: accessToken } },
    { status: 200 },
  );
  res.headers.append('set-cookie', buildAccessCookie(accessToken));
  return res;
}

/** 401 미인증 응답 (RT 없음/만료/변조/블랙리스트/사용자 없음 공통). */
function unauthorized(): Response {
  return NextResponse.json(
    {
      success: false,
      error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다' },
    },
    { status: 401 },
  );
}

/** Cookie 헤더에서 지정한 이름의 값을 추출. 없으면 null. (logout/route.ts 와 동일 구현) */
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
