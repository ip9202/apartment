/**
 * GET /api/auth/kakao — 카카오 OAuth 인증 시작 엔드포인트 (SPEC-AUTH-KAKAO-001 T-007).
 *
 * 처리:
 *   1. 난수 state 생성 (crypto.randomUUID)
 *   2. state 를 httpOnly + SameSite=Lax + Max-Age=600 쿠키에 저장
 *   3. 카카오 인가 URL(buildKakaoAuthUrl) 로 302 리다이렉트
 *
 * @MX:NOTE: [AUTO] state 쿠키는 CSRF 방어용 1회성 난수. 콜백(/api/auth/kakao/callback) 에서
 *           검증 후 즉시 Max-Age=0 으로 폐기된다. Max-Age=600(10분) 초과 금지 (REQ-KAKAO-001).
 */

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { buildKakaoAuthUrl } from '../../../../lib/kakao';

export const runtime = 'nodejs';

/** state 쿠키 TTL (초) — 10분. REQ-KAKAO-001 핵심 제약. */
const STATE_COOKIE_MAX_AGE = 600;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request?: Request): Promise<Response> {
  try {
    const state = randomUUID();

    const redirectUrl = buildKakaoAuthUrl(state);

    const res = NextResponse.redirect(redirectUrl, { status: 302 });
    res.cookies.set('state', state, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: STATE_COOKIE_MAX_AGE,
      path: '/',
    });
    return res;
  } catch {
    // AC-KAKAO-002: 부트 검증이 우회된 채 환경변수가 누락된 런타임 안전망.
    // 인가 URL 조합 실패 시 사용자에게 안내 메시지와 함께 500 반환.
    return NextResponse.json(
      { success: false, error: { code: 'KAKAO_CONFIG_ERROR', message: '카카오 로그인 설정 오류' } },
      { status: 500 },
    );
  }
}
