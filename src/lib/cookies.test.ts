import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildRefreshCookie,
  clearRefreshCookie,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_MAX_AGE,
  buildAccessCookie,
  clearAccessCookie,
  ACCESS_COOKIE_NAME,
  ACCESS_COOKIE_MAX_AGE,
} from './cookies';

afterEach(() => {
  // vi.stubEnv 로 설정한 NODE_ENV 를 모두 원복.
  vi.unstubAllEnvs();
});

describe('cookies.ts — Refresh Token 쿠키 헤더 (AC-AUTH-029)', () => {
  describe('buildRefreshCookie — 개발 환경 (NODE_ENV !== production)', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'development');
    });

    it('토큰값이 rt=<token> 형태로 포함된다', () => {
      const header = buildRefreshCookie('abc123');
      expect(header).toContain('rt=abc123');
    });

    it('HttpOnly 속성이 포함된다', () => {
      expect(buildRefreshCookie('t')).toContain('HttpOnly');
    });

    it('SameSite=Strict 속성이 포함된다 (CSRF 방어)', () => {
      expect(buildRefreshCookie('t')).toContain('SameSite=Strict');
    });

    it('Path=/api/auth 속성이 포함된다', () => {
      expect(buildRefreshCookie('t')).toContain('Path=/api/auth');
    });

    it('Max-Age=604800 (7일) 속성이 포함된다', () => {
      expect(buildRefreshCookie('t')).toContain('Max-Age=604800');
    });

    it('개발 환경에서는 Secure 속성이 포함되지 않는다 (FALSIFIABLE)', () => {
      const header = buildRefreshCookie('t');
      expect(header).not.toMatch(/Secure/i);
    });
  });

  describe('buildRefreshCookie — 프로덕션 환경 (NODE_ENV === production)', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
    });

    it('Secure 속성이 포함된다 (FALSIFIABLE — prod 전용)', () => {
      const header = buildRefreshCookie('t');
      expect(header).toMatch(/Secure/i);
    });

    it('나머지 속성도 모두 포함된다', () => {
      const header = buildRefreshCookie('t');
      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Strict');
      expect(header).toContain('Path=/api/auth');
      expect(header).toContain('Max-Age=604800');
    });
  });

  describe('clearRefreshCookie', () => {
    it('빈 토큰 + Max-Age=0 으로 쿠키를 만료시킨다', () => {
      vi.stubEnv('NODE_ENV', 'development');
      const header = clearRefreshCookie();
      expect(header).toContain('rt=');
      expect(header).toContain('Max-Age=0');
      expect(header).toContain('Path=/api/auth');
    });

    it('프로덕션 환경에서는 Secure 속성이 포함된다', () => {
      vi.stubEnv('NODE_ENV', 'production');
      const header = clearRefreshCookie();
      expect(header).toMatch(/Secure/i);
    });
  });

  describe('상수 노출', () => {
    it('REFRESH_COOKIE_NAME === "rt"', () => {
      expect(REFRESH_COOKIE_NAME).toBe('rt');
    });
    it('REFRESH_COOKIE_MAX_AGE === 604800 (7일)', () => {
      expect(REFRESH_COOKIE_MAX_AGE).toBe(604800);
    });
  });
});

/**
 * Access Token 쿠키 (REQ-AUTH-013, TASK-AUTH-012).
 *
 * @MX:NOTE: [AUTO] AT 쿠키는 Edge 미들웨어가 페이지 라우트에서 AT 를 읽기 위해 도입.
 *           RT 와 달리 Path=/ (모든 라우트), Max-Age=900 (AT TTL 15분 일치).
 *           Bearer 헤더는 API 클라이언트용, 쿠키는 브라우저 페이지 네비게이션용 — 이중 전송.
 */
describe('cookies.ts — Access Token 쿠키 (REQ-AUTH-013, Edge 미들웨어용)', () => {
  describe('buildAccessCookie — 개발 환경', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'development');
    });

    it('토큰값이 at=<token> 형태로 포함된다', () => {
      expect(buildAccessCookie('atTok')).toContain('at=atTok');
    });

    it('HttpOnly 속성이 포함된다 (XSS 방어)', () => {
      expect(buildAccessCookie('t')).toContain('HttpOnly');
    });

    it('SameSite=Strict 속성이 포함된다 (CSRF 방어)', () => {
      expect(buildAccessCookie('t')).toContain('SameSite=Strict');
    });

    it('Path=/ 속성이 포함된다 (모든 라우트 — 미들웨어 접근)', () => {
      expect(buildAccessCookie('t')).toContain('Path=/');
      // Path=/api/auth 로 제한되지 않아야 함 (페이지 라우트 포함)
      expect(buildAccessCookie('t')).not.toContain('Path=/api/auth');
    });

    it('Max-Age=900 (15분, AT TTL 일치) 속성이 포함된다', () => {
      expect(buildAccessCookie('t')).toContain('Max-Age=900');
    });

    it('개발 환경에서는 Secure 속성이 포함되지 않는다 (FALSIFIABLE)', () => {
      expect(buildAccessCookie('t')).not.toMatch(/Secure/i);
    });
  });

  describe('buildAccessCookie — 프로덕션 환경', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
    });

    it('Secure 속성이 포함된다 (FALSIFIABLE)', () => {
      expect(buildAccessCookie('t')).toMatch(/Secure/i);
    });
  });

  describe('clearAccessCookie', () => {
    it('빈 토큰 + Max-Age=0 으로 쿠키를 만료시킨다', () => {
      vi.stubEnv('NODE_ENV', 'development');
      const header = clearAccessCookie();
      expect(header).toContain('at=');
      expect(header).toContain('Max-Age=0');
    });

    it('프로덕션 환경에서는 Secure 속성이 포함된다', () => {
      vi.stubEnv('NODE_ENV', 'production');
      expect(clearAccessCookie()).toMatch(/Secure/i);
    });
  });

  describe('AT 상수 노출', () => {
    it('ACCESS_COOKIE_NAME === "at"', () => {
      expect(ACCESS_COOKIE_NAME).toBe('at');
    });
    it('ACCESS_COOKIE_MAX_AGE === 900 (15분)', () => {
      expect(ACCESS_COOKIE_MAX_AGE).toBe(900);
    });
  });
});
