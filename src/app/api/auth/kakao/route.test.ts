/**
 * GET /api/auth/kakao 통합 테스트 — SPEC-AUTH-KAKAO-001 T-007.
 *
 * AC-KAKAO-001 (정상 시작: 302 + 카카오 인가 URL + state 쿠키 Max-Age=600),
 * AC-KAKAO-002 (환경변수 누락 시 500 + "카카오 로그인 설정 오류" 안전망),
 * REQ-KAKAO-001 (state 포함 리다이렉트), REQ-KAKAO-002 (환경변수 누락 시 500).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// buildKakaoAuthUrl 모킹 — 정상/에러 시나리오 제어 (AC-KAKAO-002 env-missing 시뮬레이션 포함)
const { buildKakaoAuthUrlMock } = vi.hoisted(() => ({
  buildKakaoAuthUrlMock: vi.fn(),
}));
vi.mock('../../../../lib/kakao', () => ({
  buildKakaoAuthUrl: buildKakaoAuthUrlMock,
}));

import { GET } from './route';

const originalFetch = globalThis.fetch;

/** 정상 kakao 인가 URL 문자열을 생성하는 헬퍼 (mock 반환값). */
function fakeKakaoAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: 'fake-key',
    redirect_uri: 'http://localhost/api/auth/kakao/callback',
    response_type: 'code',
    state,
    scope: 'account_email',
  });
  return `https://kauth.kakao.com/oauth/authorize?${params.toString()}`;
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
  buildKakaoAuthUrlMock.mockReset();
  // 기본: 정상 kakao URL 반환 (전달된 state 를 URL 에 반영)
  buildKakaoAuthUrlMock.mockImplementation((state: string) => fakeKakaoAuthUrl(state));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('GET /api/auth/kakao (T-007, REQ-KAKAO-001/002)', () => {
  it('정상: 302 리다이렉트 + 카카오 인가 URL + state 쿠키(httpOnly, SameSite=Lax, Max-Age=600)', async () => {
    const req = new Request('http://localhost/api/auth/kakao');
    const res = await GET(req);

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('https://kauth.kakao.com/oauth/authorize')).toBe(true);
    expect(location).toContain('client_id=');
    expect(location).toContain('redirect_uri=');
    expect(location).toContain('response_type=code');
    expect(location).toContain('state=');
    expect(location).toContain('scope=account_email');

    // Set-Cookie: state 쿠키 속성 검증 (Max-Age=600, httpOnly, SameSite=Lax)
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/state=/);
    expect(setCookie).toMatch(/Max-Age=600/i);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    // state 쿠키값과 URL state 파라미터가 일치
    const cookieState = /state=([^;]+)/.exec(setCookie)?.[1];
    const urlState = new URL(location).searchParams.get('state');
    expect(cookieState).toBeDefined();
    expect(urlState).toBe(cookieState);
  });

  it('state 는 매 요청마다 다른 난수다 (예측 불가)', async () => {
    const res1 = await GET(new Request('http://localhost/api/auth/kakao'));
    const state1 = new URL(res1.headers.get('location') ?? '').searchParams.get('state');

    const res2 = await GET(new Request('http://localhost/api/auth/kakao'));
    const state2 = new URL(res2.headers.get('location') ?? '').searchParams.get('state');

    expect(state1).toBeDefined();
    expect(state2).toBeDefined();
    expect(state1).not.toBe(state2);
  });

  it('state 쿠키 TTL 이 600초를 초과하지 않는다 (REQ-KAKAO-001)', async () => {
    const req = new Request('http://localhost/api/auth/kakao');
    const res = await GET(req);
    const setCookie = res.headers.get('set-cookie') ?? '';
    const maxAgeMatch = /Max-Age=(\d+)/i.exec(setCookie);
    const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : Infinity;
    expect(maxAge).toBeLessThanOrEqual(600);
  });

  it('AC-KAKAO-002: env 누락(buildKakaoAuthUrl throw) 시 500 + "카카오 로그인 설정 오류" 안전망', async () => {
    // 부트 검증이 우회된 채 env 가 누락된 런타임 시나리오 시뮬레이션
    buildKakaoAuthUrlMock.mockImplementation(() => {
      throw new Error('[env] KAKAO_REST_API_KEY 가 설정되지 않았습니다');
    });

    const req = new Request('http://localhost/api/auth/kakao');
    const res = await GET(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).toContain('카카오 로그인 설정 오류');
  });
});
