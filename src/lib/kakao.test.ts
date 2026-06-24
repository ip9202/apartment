/**
 * 카카오 OAuth 헬퍼 단위 테스트 — SPEC-AUTH-KAKAO-001 T-002/T-003/T-004.
 *
 * - T-002 buildKakaoAuthUrl(state): 인가 URL 조합 (REQ-KAKAO-001)
 * - T-003 exchangeKakaoToken(code): 토큰 교환, Zod 스키마 검증 (REQ-KAKAO-003, REQ-KAKAO-013)
 * - T-004 fetchKakaoUser(accessToken): 사용자 정보 조회, id 문자열 변환, 이메일 누락 거부
 *   (REQ-KAKAO-005, REQ-KAKAO-006, EC-KAKAO-004 BigInt 방어)
 *
 * 모든 외부 API 호출은 global.fetch 를 vi.fn() 으로 모킹 — 실제 kauth/kapi 호출 금지.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildKakaoAuthUrl,
  exchangeKakaoToken,
  fetchKakaoUser,
  KakaoEmailMissingError,
  KakaoTokenError,
} from './kakao';

// env 모킹 — kakao 변수 고정값 주입
vi.mock('./env', () => ({
  env: {
    KAKAO_REST_API_KEY: 'test-rest-api-key',
    KAKAO_CLIENT_SECRET: 'test-client-secret',
    KAKAO_REDIRECT_URI: 'https://app.example.com/api/auth/kakao/callback',
  },
}));

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('buildKakaoAuthUrl (T-002, REQ-KAKAO-001)', () => {
  it('인가 URL 이 kauth.kakao.com/oauth/authorize 로 시작한다', () => {
    const url = buildKakaoAuthUrl('random-state-123');
    expect(url.startsWith('https://kauth.kakao.com/oauth/authorize')).toBe(true);
  });

  it('client_id, redirect_uri, response_type=code, state, scope=account_email 파라미터 포함', () => {
    const url = buildKakaoAuthUrl('state-abc');
    expect(url).toContain('client_id=test-rest-api-key');
    expect(url).toContain('redirect_uri=');
    expect(url).toContain('response_type=code');
    expect(url).toContain('state=state-abc');
    expect(url).toContain('scope=account_email');
  });

  it('redirect_uri 가 env 값으로 URL 인코딩되어 포함된다', () => {
    const url = buildKakaoAuthUrl('xyz');
    // URL 인코딩된 콜백 URL 포함 확인
    expect(url).toContain(encodeURIComponent('https://app.example.com/api/auth/kakao/callback'));
  });
});

describe('exchangeKakaoToken (T-003, REQ-KAKAO-003/013)', () => {
  it('카카오 토큰 교환 API 에 POST 하고 access_token 을 반환한다', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        token_type: 'bearer',
        access_token: 'kakao-access-token-xyz',
        expires_in: 21599,
        refresh_token: 'kakao-refresh-token-abc',
        refresh_token_expires_in: 5183999,
        scope: 'account_email',
      }),
    } as Response);

    const token = await exchangeKakaoToken('valid-auth-code');

    expect(token).toBe('kakao-access-token-xyz');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://kauth.kakao.com/oauth/token');
    expect(init.method).toBe('POST');
    const body = String(init.body);
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('client_id=test-rest-api-key');
    expect(body).toContain('client_secret=test-client-secret');
    expect(body).toContain('code=valid-auth-code');
    expect(body).toContain('redirect_uri=');
  });

  it('카카오 API 가 에러 응답 시 KakaoTokenError 를 throw 한다', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'invalid_grant',
        error_description: 'authorization code expired',
      }),
    } as Response);

    await expect(exchangeKakaoToken('expired-code')).rejects.toThrow(KakaoTokenError);
  });

  it('응답에 access_token 이 없으면 KakaoTokenError 를 throw 한다 (Zod 검증)', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ token_type: 'bearer' }), // access_token 누락
    } as Response);

    await expect(exchangeKakaoToken('code')).rejects.toThrow(KakaoTokenError);
  });
});

describe('fetchKakaoUser (T-004, REQ-KAKAO-005/006, EC-KAKAO-004)', () => {
  it('kapi.kakao.com/v2/user/me 에 Bearer 토큰으로 요청하여 id 와 email 을 반환한다', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 123456789,
        connected_at: '2026-01-01T00:00:00Z',
        kakao_account: {
          has_email: true,
          email_needs_agreement: false,
          is_email_valid: true,
          is_email_verified: true,
          email: 'user@example.com',
        },
      }),
    } as Response);

    const user = await fetchKakaoUser('kakao-access-token');

    expect(user.providerId).toBe('123456789');
    expect(user.email).toBe('user@example.com');
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://kapi.kakao.com/v2/user/me');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer kakao-access-token' });
  });

  it('카카오 id 가 number 여도 문자열 provider_id 로 변환된다 (EC-KAKAO-004 BigInt 방어)', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 1234567890, // number 타입 — Zod coerce.string() 으로 문자열 변환
        kakao_account: { email: 'big@example.com' },
      }),
    } as Response);

    const user = await fetchKakaoUser('token');
    expect(typeof user.providerId).toBe('string');
    expect(user.providerId).toBe('1234567890');
  });

  it('이메일이 없으면 KakaoEmailMissingError 를 throw 한다 (REQ-KAKAO-006)', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 111,
        kakao_account: { has_email: false, email_needs_agreement: true },
      }),
    } as Response);

    await expect(fetchKakaoUser('token')).rejects.toThrow(KakaoEmailMissingError);
  });

  it('kakao_account 자체가 없으면 KakaoEmailMissingError 를 throw 한다', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: 222 }),
    } as Response);

    await expect(fetchKakaoUser('token')).rejects.toThrow(KakaoEmailMissingError);
  });

  it('카카오 API 가 에러 응답 시 에러를 throw 한다', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ msg: 'invalid token' }),
    } as Response);

    await expect(fetchKakaoUser('bad-token')).rejects.toThrow();
  });
});
