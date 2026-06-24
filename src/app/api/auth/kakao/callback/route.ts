/**
 * GET /api/auth/kakao/callback — 카카오 OAuth 콜백 처리 (SPEC-AUTH-KAKAO-001 T-008).
 *
 * 처리 순서:
 *   1. state 쿠키 + URL state 파라미터 검증 (CSRF, AC-KAKAO-004/005)
 *   2. 카카오 토큰 교환 (exchangeKakaoToken) — 카카오 토큰은 1회 사용 후 메모리 폐기
 *   3. 카카오 사용자 정보 조회 (fetchKakaoUser) — 이메일 누락 시 로그인 리다이렉트
 *   4. 계정 연결/가입 (upsertKakaoAccount) — 409/403 시 로그인 리다이렉트
 *   5. AT/RT 발급 + httpOnly 쿠키 설정 (기존 auth/cookies 재사용)
 *   6. verified 여부에 따라 / 또는 /verify 리다이렉트
 *   7. state 쿠키 즉시 폐기 (Max-Age=0, 1회성 보장)
 *
 * @MX:ANCHOR: [AUTO] 카카오 콜백 진입점 — 외부 시스템(카카오) 통합 경계. state 검증 실패 시 전체 플로우 중단.
 * @MX:REASON: 외부 OAuth 콜백은 CSRF/재생 공격 표면. state 검증 누락 시 인가 코드 탈취 공격 가능.
 *
 * @MX:WARN: [AUTO] state 검증 로직은 CSRF 방어 핵심 — 검증 우회/완화 금지.
 * @MX:REASON: state 불일치/누락 시 토큰 교환을 진행하면 공격자가 인가 코드로 세션 발급 가능.
 *
 * @MX:NOTE: [AUTO] 카카오 액세스 토큰은 exchangeKakaoToken 결과 변수로만 존재하며 fetchKakaoUser
 *           호출 후 스코프를 벗어나 가비지컬렉션 대상이 된다. DB/쿠키/로그에 저장하지 않는다 (REQ-KAKAO-013).
 */

import { NextResponse } from 'next/server';
import {
  exchangeKakaoToken,
  fetchKakaoUser,
  KakaoEmailMissingError,
} from '../../../../../lib/kakao';
import {
  upsertKakaoAccount,
  KakaoConflictError,
  KakaoInactiveError,
} from '../../../../../lib/kakao-account';
import { signAccessToken, signRefreshToken } from '../../../../../lib/auth';
import { buildAccessCookie, buildRefreshCookie } from '../../../../../lib/cookies';

export const runtime = 'nodejs';

/** Cookie 헤더에서 지정한 이름의 쿠키값을 추출. 없으면 null. */
function parseCookie(cookieHeader: string, name: string): string | null {
  const prefix = `${name}=`;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return null;
}

/** state 쿠키를 즉시 삭제하는 Set-Cookie 값 (1회성 보장). */
function clearStateCookie(): string {
  return 'state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
}

/** 검증 실패 응답 (400). */
function badRequest(message: string): Response {
  return NextResponse.json(
    { success: false, error: { code: 'INVALID_STATE', message } },
    { status: 400 },
  );
}

/**
 * 로그인 화면으로 리다이렉트 + 안내 메시지(state 쿠키 폐기 포함).
 * 절대 URL 은 incoming request 의 호스트에서 파생 — dev 와 prod(Railway HTTPS) 모두 정확.
 */
function redirectToLogin(requestUrl: string, reason: string): Response {
  const url = new URL('/login', requestUrl);
  url.searchParams.set('error', 'kakao');
  url.searchParams.set('reason', reason);
  const res = NextResponse.redirect(url, { status: 302 });
  res.headers.append('set-cookie', clearStateCookie());
  return res;
}

export async function GET(request: Request): Promise<Response> {
  // 1. state 검증 (AC-KAKAO-004/005) — Cookie 헤더에서 state 쿠키 추출
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookieState = parseCookie(cookieHeader, 'state');
  const url = new URL(request.url);
  const queryState = url.searchParams.get('state');
  const code = url.searchParams.get('code');

  if (!cookieState || !queryState || cookieState !== queryState) {
    return badRequest('잘못된 접근입니다');
  }

  if (!code) {
    return badRequest('잘못된 접근입니다');
  }

  // 2. 토큰 교환 — 카카오 토큰은 즉시 사용 후 폐기 (REQ-KAKAO-013)
  let kakaoAccessToken: string;
  try {
    kakaoAccessToken = await exchangeKakaoToken(code);
  } catch {
    return redirectToLogin(request.url, '카카오 로그인을 다시 시도해 주세요');
  }

  // 3. 사용자 정보 조회
  let providerId: string;
  let email: string;
  try {
    const userInfo = await fetchKakaoUser(kakaoAccessToken);
    providerId = userInfo.providerId;
    email = userInfo.email;
  } catch (err) {
    if (err instanceof KakaoEmailMissingError) {
      return redirectToLogin(request.url, '이메일 제공 동의가 필요합니다');
    }
    return redirectToLogin(request.url, '카카오 로그인을 일시적으로 사용할 수 없습니다');
  } finally {
    // 카카오 토큰을 즉시 참조 해제 — 가비지컬렉션 유도 (REQ-KAKAO-013)
    kakaoAccessToken = '';
  }

  // 4. 계정 연결/가입
  let userRow: { id: string; email: string; role: string; verifiedAt: string | null; status: string };
  try {
    const result = await upsertKakaoAccount(email, providerId);
    userRow = result.user;
  } catch (err) {
    if (err instanceof KakaoConflictError) {
      return redirectToLogin(request.url, '이미 다른 계정에 연결된 카카오 계정입니다');
    }
    if (err instanceof KakaoInactiveError) {
      return redirectToLogin(request.url, '관리사무소에 문의하세요');
    }
    return redirectToLogin(request.url, '카카오 로그인 중 오류가 발생했습니다');
  }

  // 5. AT/RT 발급 + 쿠키 설정 (기존 정책 재사용)
  const verified = userRow.verifiedAt !== null;
  const accessToken = signAccessToken({ sub: userRow.id, role: userRow.role, verified });
  const refreshToken = signRefreshToken({ sub: userRow.id });

  // 6. 리다이렉트 대상 — verified 여부에 따라 / 또는 /verify.
  // 절대 URL 은 incoming request 호스트에서 파생 — dev/prodd 모두 동작.
  const redirectTarget = new URL(verified ? '/' : '/verify', request.url);
  const res = NextResponse.redirect(redirectTarget, { status: 302 });
  res.headers.append('set-cookie', buildAccessCookie(accessToken));
  res.headers.append('set-cookie', buildRefreshCookie(refreshToken));
  // 7. state 쿠키 폐기 (1회성)
  res.headers.append('set-cookie', clearStateCookie());
  return res;
}
