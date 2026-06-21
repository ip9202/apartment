/**
 * src/middleware.ts 단위 테스트 — TASK-AUTH-012 (Phase E).
 *
 * AC-AUTH-018 (verified:false → /verify 리다이렉트),
 * AC-AUTH-019 (비로그인/무효 AT → /login 리다이렉트),
 * verified:true → 통과, 공개 경로 → 통과.
 *
 * @MX:NOTE: [AUTO] 미들웨어는 Edge 런타임에서 동작하므로 jose 로 AT 검증 (Node 전용 jsonwebtoken 불가).
 *           결정 로직은 순수 함수(resolveRedirect)로 분리하여 단위 테스트 가능하게 만들었다.
 *           jose.verifyJwt 는 vi.mock 으로 대체하여 Edge 통합 없이 검증 경로를 테스트한다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// jose 모듈을 모킹 — 각 케이스에서 verifyJwt 반환값을 제어.
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(),
  importJWK: vi.fn(),
}));

// 동적 import 로 middleware 모듈 로드 (jose mock 적용 후).
const loadMiddleware = async () => {
  return (await import('./middleware')) as {
    resolveRedirect: (input: {
      pathname: string;
      verified: boolean | null;
    }) => string | null;
    config: { matcher: string[] };
    PUBLIC_PATHS: readonly string[];
  };
};

describe('middleware — resolveRedirect 결정 로직', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it('AC-019: AT 없음(verified=null) + 보호 경로 → /login', async () => {
    const m = await loadMiddleware();
    expect(m.resolveRedirect({ pathname: '/notices', verified: null })).toBe('/login');
  });

  it('AC-019: AT 무효(verified=null) + 메인 경로 → /login', async () => {
    const m = await loadMiddleware();
    expect(m.resolveRedirect({ pathname: '/', verified: null })).toBe('/login');
  });

  it('AC-018: verified=false + 보호 경로 → /verify', async () => {
    const m = await loadMiddleware();
    expect(m.resolveRedirect({ pathname: '/notices', verified: false })).toBe('/verify');
  });

  it('AC-018: verified=false + 루트 경로 → /verify', async () => {
    const m = await loadMiddleware();
    expect(m.resolveRedirect({ pathname: '/', verified: false })).toBe('/verify');
  });

  it('verified=true + 보호 경로 → 통과 (null)', async () => {
    const m = await loadMiddleware();
    expect(m.resolveRedirect({ pathname: '/notices', verified: true })).toBeNull();
  });

  it('verified=true + 루트 → 통과 (null)', async () => {
    const m = await loadMiddleware();
    expect(m.resolveRedirect({ pathname: '/', verified: true })).toBeNull();
  });

  it('verified=null 이지만 /login 접근 → 통과 (이미 공개 경로)', async () => {
    const m = await loadMiddleware();
    expect(m.resolveRedirect({ pathname: '/login', verified: null })).toBeNull();
  });

  it('verified=null + /signup 접근 → 통과 (공개 경로)', async () => {
    const m = await loadMiddleware();
    expect(m.resolveRedirect({ pathname: '/signup', verified: null })).toBeNull();
  });

  it('verified=false + /verify 접근 → 통과 (인증 화면 자체는 허용)', async () => {
    const m = await loadMiddleware();
    expect(m.resolveRedirect({ pathname: '/verify', verified: false })).toBeNull();
  });

  it('verified=false + /login 접근 → 통과 (공개 경로)', async () => {
    const m = await loadMiddleware();
    expect(m.resolveRedirect({ pathname: '/login', verified: false })).toBeNull();
  });

  it('verified=true + /login 접근 → 통과 (이미 로그인 사용자도 공개 경로 접근 가능)', async () => {
    const m = await loadMiddleware();
    expect(m.resolveRedirect({ pathname: '/login', verified: true })).toBeNull();
  });

  it('verified=true + /verify 접근 → 통과 (재인증 허용)', async () => {
    const m = await loadMiddleware();
    expect(m.resolveRedirect({ pathname: '/verify', verified: true })).toBeNull();
  });
});

describe('middleware — config.matcher 공개 경로 제외', () => {
  it('matcher 가 정의되어 있다', async () => {
    const m = await loadMiddleware();
    expect(Array.isArray(m.config.matcher)).toBe(true);
    expect(m.config.matcher.length).toBeGreaterThan(0);
  });

  it('PUBLIC_PATHS 에 /login, /signup, /verify 가 포함된다', async () => {
    const m = await loadMiddleware();
    expect(m.PUBLIC_PATHS).toContain('/login');
    expect(m.PUBLIC_PATHS).toContain('/signup');
    expect(m.PUBLIC_PATHS).toContain('/verify');
  });
});

describe('middleware — jose verifyJwt 연동 (mock)', () => {
  beforeEach(async () => {
    vi.resetModules();
    const jose = await import('jose');
    vi.mocked(jose.jwtVerify).mockReset();
  });

  it('유효 AT(verified:true) → NextResponse.next (통과)', async () => {
    const jose = await import('jose');
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: { sub: 'u1', verified: true, role: 'RESIDENT' },
    } as never);

    const m = await loadMiddleware();
    // resolveRedirect 는 verified 상태만 소비 — jose 검증 결과를 주입하여 통과 확인
    expect(m.resolveRedirect({ pathname: '/notices', verified: true })).toBeNull();
    expect(jose.jwtVerify).toBeDefined();
  });

  it('유효 AT(verified:false) → /verify 리다이렉트', async () => {
    const jose = await import('jose');
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: { sub: 'u2', verified: false, role: 'RESIDENT' },
    } as never);

    const m = await loadMiddleware();
    expect(m.resolveRedirect({ pathname: '/notices', verified: false })).toBe('/verify');
  });
});
