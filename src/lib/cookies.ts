/**
 * Refresh Token 쿠키 헤더 빌더 (AC-AUTH-029).
 *
 * RT 쿠키 속성 정책 (SPEC-AUTH-001, ADR-003):
 * - HttpOnly: JS 접근 차단 (XSS 방어)
 * - Secure: HTTPS 전용 전송 (프로덕션만)
 * - SameSite=Strict: 크로스사이트 전송 차단 (CSRF 방어)
 * - Path=/api/auth: 인증 엔드포인트로 제한 (트래픽 최소화)
 * - Max-Age=604800: 7일 (RT TTL 과 일치)
 */

export const REFRESH_COOKIE_NAME = 'rt';
export const REFRESH_COOKIE_MAX_AGE = 604800; // 7일 (초)
export const REFRESH_COOKIE_PATH = '/api/auth';

/**
 * Access Token 쿠키 상수 (REQ-AUTH-013, TASK-AUTH-012).
 *
 * @MX:NOTE: [AUTO] AT 쿠키는 Edge 미들웨어(src/middleware.ts)가 페이지 라우트에서
 *           AT 를 읽어 verified 상태를 검사하기 위해 도입했다. Bearer 헤더는 API 클라이언트용,
 *           AT 쿠키는 브라우저 페이지 네비게이션용 — 이중 전송.
 *           Path=/ 로 모든 라우트에 노출되지만 HttpOnly + SameSite=Strict 로 XSS/CSRF 방어.
 */
export const ACCESS_COOKIE_NAME = 'at';
export const ACCESS_COOKIE_MAX_AGE = 900; // 15분 (AT TTL 과 일치)

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * RT 설정용 Set-Cookie 헤더 값을 생성.
 * 개발(NODE_ENV !== 'production') 환경에서는 Secure 속성을 생략하여
 * HTTP 로컬 개발 환경에서 쿠키가 동작하도록 한다.
 */
export function buildRefreshCookie(token: string): string {
  const parts = [
    `${REFRESH_COOKIE_NAME}=${token}`,
    'HttpOnly',
    `SameSite=Strict`,
    `Path=${REFRESH_COOKIE_PATH}`,
    `Max-Age=${REFRESH_COOKIE_MAX_AGE}`,
  ];
  if (isProduction()) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * RT 삭제용 Set-Cookie 헤더 값을 생성 (만료 처리).
 * 빈 값 + Max-Age=0 으로 브라우저가 즉시 쿠키를 폐기하도록 한다.
 */
export function clearRefreshCookie(): string {
  const parts = [
    `${REFRESH_COOKIE_NAME}=`,
    'HttpOnly',
    `Path=${REFRESH_COOKIE_PATH}`,
    'Max-Age=0',
  ];
  if (isProduction()) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * AT 설정용 Set-Cookie 헤더 값을 생성 (REQ-AUTH-013).
 *
 * 속성 정책:
 * - HttpOnly: JS 접근 차단 (XSS 방어)
 * - Secure: HTTPS 전용 전송 (프로덕션만)
 * - SameSite=Strict: 크로스사이트 전송 차단 (CSRF 방어)
 * - Path=/: 모든 라우트 (Edge 미들웨어가 페이지 라우트에서 읽음)
 * - Max-Age=900: 15분 (AT TTL 일치)
 */
export function buildAccessCookie(token: string): string {
  const parts = [
    `${ACCESS_COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${ACCESS_COOKIE_MAX_AGE}`,
  ];
  if (isProduction()) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/** AT 삭제용 Set-Cookie 헤더 값을 생성 (만료 처리). */
export function clearAccessCookie(): string {
  const parts = [
    `${ACCESS_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'Max-Age=0',
  ];
  if (isProduction()) {
    parts.push('Secure');
  }
  return parts.join('; ');
}
