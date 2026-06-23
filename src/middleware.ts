/**
 * Next.js 루트 미들웨어 — TASK-AUTH-012 (Phase E).
 *
 * REQ-AUTH-013: 미인증 회원(verified_at=NULL)의 메인 기능 접근 차단 → /verify 리다이렉트.
 * AC-AUTH-018: verified:false + 보호 경로 → /verify.
 * AC-AUTH-019: AT 없음/무효/만료 → /login.
 *
 * Edge 런트임 제약: jsonwebtoken/pg/bcryptjs 사용 불가 → jose 로 AT 검증 (HS256, JWT_SECRET).
 * AT 는 httpOnly 쿠키('at')에서 읽는다 (Bearer 헤더는 페이지 네비게이션에서 신뢰할 수 없음).
 *
 * @MX:ANCHOR: [AUTO] 모든 보호 라우트의 인증 게이트웨이 — fan_in >= 3 (모든 페이지/API 보호 경로)
 * @MX:REASON: 이 게이트를 우회하거나 verified 검사를 누락하면 미인증 회원이 공지/건의/주차에 접근 가능.
 *             resolveRedirect 결정 로직은 순수 함수로 분리하여 단위 테스트로 회귀 방어.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { ACCESS_COOKIE_NAME } from './lib/cookies';

/**
 * 공개 페이지 경로 — 인증 없이 접근 허용.
 * /login, /signup, /verify (인증 화면 자체).
 */
export const PUBLIC_PATHS = ['/login', '/signup', '/verify'] as const;

/**
 * 리다이렉트 결정 로직 (순수 함수 — 단위 테스트 대상).
 *
 * @param pathname 요청 경로
 * @param verified AT 의 verified 클레임 (null = AT 없음/무효, true/false = 검증됨)
 * @returns 리다이렉트 대상 경로 (string) 또는 통과 (null)
 */
export function resolveRedirect(input: {
  pathname: string;
  verified: boolean | null;
}): string | null {
  const { pathname, verified } = input;

  // 공개 경로는 항상 통과
  if (PUBLIC_PATHS.includes(pathname as (typeof PUBLIC_PATHS)[number])) {
    return null;
  }

  // AT 없음/무효/만료 → /login (AC-019)
  if (verified === null) {
    return '/login';
  }

  // 인증됨 + verified:false → /verify (AC-018)
  if (verified === false) {
    return '/verify';
  }

  // 인증됨 + verified:true → 통과
  return null;
}

/** JWT_SECRET 을 Uint8Array 로 로드 (jose HS256 검증용). */
function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('[middleware] JWT_SECRET 이 설정되지 않았습니다');
  }
  return new TextEncoder().encode(secret);
}

/** AT 쿠키에서 verified 클레임 추출. 실패/없음 시 null 반환. */
async function extractVerified(cookieValue: string | undefined): Promise<boolean | null> {
  if (!cookieValue) return null;
  try {
    const { payload } = await jwtVerify(cookieValue, getSecret(), {
      algorithms: ['HS256'],
    });
    return payload.verified === true;
  } catch {
    // 만료/서명불일치/잘못된 형식 — 모두 미인증 처리
    return null;
  }
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // @MX:NOTE: [AUTO] 루트 '/' 는 Claude Design SPA 진입점 — 단일 페이지가 내부 state 로
  //            12개 화면(로그인 포함)을 전환하므로 파일 라우트 /login 이 존재하지 않는다.
  //            루트를 통과시키면 SPA 의 로그인 화면이 인증 진입을 담당한다.
  //            실제 데이터/API 는 matcher + route handler RBAC 로 별도 보호된다.
  if (pathname === '/') {
    return NextResponse.next();
  }

  const atCookie = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  const verified = await extractVerified(atCookie);

  const target = resolveRedirect({ pathname, verified });
  if (target) {
    const url = request.nextUrl.clone();
    url.pathname = target;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

/**
 * matcher — 미들웨어 적용 경로.
 * 공개 API 인증 엔드포인트, Next.js 내부 자산, 파비콘은 제외.
 *
 * @MX:NOTE: [AUTO] SETUP-001 Phase B — /api/setup/buildings 경로 전체를 matcher 예외에서 제외.
 *           Next.js middleware matcher 는 메서드 무관하게 경로 단위로만 매치되므로 GET(공개) 만
 *           예외 처리할 수 없다. 따라서 POST/DELETE 의 RBAC(401/403) 는 route handler 의
 *           requireAdmin 으로 시행한다 (REQ-SETUP-020, EC-006/007).
 */
export const config = {
  matcher: [
    /*
     * /api/auth/* (login/signup/refresh/verify-unit), /api/setup/buildings (공개 GET + 핸들러 내부 RBAC POST/DELETE),
     * /login, /signup, /verify, /_next/*, /favicon.ico 제외한 모든 경로에 매치.
     */
    '/((?!api/auth/login|api/auth/signup|api/auth/refresh|api/auth/verify-unit|api/setup/buildings|login|signup|verify|_next/static|_next/image|favicon.ico).*)',
  ],
};
