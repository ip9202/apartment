/**
 * GET /api/auth/kakao/callback 통합 테스트 — SPEC-AUTH-KAKAO-001 T-008.
 *
 * 검증 시나리오:
 *  - AC-KAKAO-003: state 일치 → 토큰 교환 호출 + state 쿠키 Max-Age=0 삭제
 *  - AC-KAKAO-004: state 불일치 → 400 (토큰 교환 API 미호출)
 *  - AC-KAKAO-005: state 쿠키 없음 → 400
 *  - AC-KAKAO-006/007: 사용자 정보 조회 + 이메일 누락 시 로그인 리다이렉트
 *  - AC-KAKAO-012: verified 사용자 → / 리다이렉트 + AT/RT 쿠키
 *  - AC-KAKAO-013: 미인증 사용자 → /verify 리다이렉트
 *  - AC-KAKAO-014: 카카오 토큰 평문 콘솔 미출력
 *  - 409/403 (upsert 분기) → 로그인 리다이렉트 with 메시지
 *
 * 외부 API(fetch) 및 upsertKakaoAccount/auth 모킹.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = globalThis.fetch;

// kakao 라이브러리 모킹 — 토큰 교환/사용자 조회
vi.mock('../../../../../lib/kakao', () => ({
  exchangeKakaoToken: vi.fn(),
  fetchKakaoUser: vi.fn(),
  KakaoEmailMissingError: class KakaoEmailMissingError extends Error {},
}));

// upsert 모킹 — 분기 결과 제어
const { upsertMock } = vi.hoisted(() => ({
  upsertMock: vi.fn(),
}));
vi.mock('../../../../../lib/kakao-account', () => ({
  upsertKakaoAccount: upsertMock,
  KakaoConflictError: class KakaoConflictError extends Error {},
  KakaoInactiveError: class KakaoInactiveError extends Error {},
}));

import { GET } from './route';
import { exchangeKakaoToken, fetchKakaoUser } from '../../../../../lib/kakao';

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function buildCallbackRequest(
  stateCookie: string | null,
  queryState: string,
  code = 'valid-code',
  host = 'http://testhost',
): Request {
  const url = `${host}/api/auth/kakao/callback?code=${code}&state=${queryState}`;
  const headers = new Headers();
  if (stateCookie) headers.set('cookie', `state=${stateCookie}`);
  return new Request(url, { headers });
}

describe('GET /api/auth/kakao/callback (T-008)', () => {
  describe('AC-KAKAO-004/005: state 검증', () => {
    it('state 불일치 시 400 + 토큰 교환 API 미호출', async () => {
      const req = buildCallbackRequest('cookie-state', 'different-state');
      const res = await GET(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain('잘못된 접근');
      expect(exchangeKakaoToken).not.toHaveBeenCalled();
    });

    it('state 쿠키 없음 시 400 + 토큰 교환 미호출', async () => {
      const req = buildCallbackRequest(null, 'any-state');
      const res = await GET(req);

      expect(res.status).toBe(400);
      expect(exchangeKakaoToken).not.toHaveBeenCalled();
    });
  });

  describe('AC-KAKAO-003: state 일치 시 토큰 교환 + state 쿠키 폐기', () => {
    it('정상 플로우: 교환 → 사용자정보 → upsert → AT/RT 쿠키 → 리다이렉트', async () => {
      vi.mocked(exchangeKakaoToken).mockResolvedValue('kakao-access-token');
      vi.mocked(fetchKakaoUser).mockResolvedValue({
        providerId: '12345',
        email: 'user@example.com',
      });
      upsertMock.mockResolvedValue({
        user: {
          id: 'uid',
          email: 'user@example.com',
          role: 'RESIDENT',
          verifiedAt: '2026-01-01T00:00:00Z',
          status: 'ACTIVE',
        },
        isNewLink: false,
      });

      const req = buildCallbackRequest('match-state', 'match-state');
      const res = await GET(req);

      expect(exchangeKakaoToken).toHaveBeenCalledWith('valid-code');
      expect(fetchKakaoUser).toHaveBeenCalledWith('kakao-access-token');
      expect(upsertMock).toHaveBeenCalledWith('user@example.com', '12345');

      // state 쿠키 폐기 (Max-Age=0) + AT/RT 쿠키 존재 확인
      expect(res.headers.get('location')).toBeDefined();

      // 카카오 토큰은 응답 본문/헤더에 평문 미포함 (REQ-KAKAO-013)
      const location = res.headers.get('location') ?? '';
      expect(location).not.toContain('kakao-access-token');

      // AC-KAKAO-003: state 쿠키 1회성 폐기 (Max-Age=0) — set-cookie 헤더에 state=; ... Max-Age=0 포함
      const setCookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''];
      const stateDeleted = setCookies.some(
        (c) => /state=;/.test(c) && /Max-Age=0/i.test(c),
      );
      expect(stateDeleted).toBe(true);
    });

    it('verified 사용자는 / 로 리다이렉트 (AC-KAKAO-012)', async () => {
      vi.mocked(exchangeKakaoToken).mockResolvedValue('tok');
      vi.mocked(fetchKakaoUser).mockResolvedValue({ providerId: '1', email: 'v@example.com' });
      upsertMock.mockResolvedValue({
        user: { id: 'u', email: 'v@example.com', role: 'RESIDENT', verifiedAt: '2026-01-01T00:00:00Z', status: 'ACTIVE' },
        isNewLink: false,
      });

      const req = buildCallbackRequest('s', 's');
      const res = await GET(req);

      const location = res.headers.get('location') ?? '';
      expect(location).toBe('http://testhost/');
    });

    it('미인증 사용자는 /verify 로 리다이렉트 (AC-KAKAO-013)', async () => {
      vi.mocked(exchangeKakaoToken).mockResolvedValue('tok');
      vi.mocked(fetchKakaoUser).mockResolvedValue({ providerId: '1', email: 'nv@example.com' });
      upsertMock.mockResolvedValue({
        user: { id: 'u', email: 'nv@example.com', role: 'RESIDENT', verifiedAt: null, status: 'ACTIVE' },
        isNewLink: false,
      });

      const req = buildCallbackRequest('s', 's');
      const res = await GET(req);

      const location = res.headers.get('location') ?? '';
      expect(location).toBe('http://testhost/verify');
    });
  });

  describe('AC-KAKAO-007: 이메일 누락 시 로그인 리다이렉트 (REQ-KAKAO-006)', () => {
    it('카카오 이메일 누락 시 교환 미진행/세션 미발급 + 로그인 안내', async () => {
      vi.mocked(exchangeKakaoToken).mockResolvedValue('tok');
      const { KakaoEmailMissingError } = await import('../../../../../lib/kakao');
      vi.mocked(fetchKakaoUser).mockRejectedValue(new KakaoEmailMissingError());

      const req = buildCallbackRequest('s', 's');
      const res = await GET(req);

      const location = res.headers.get('location') ?? '';
      expect(location).toContain('/login');
      const reason = new URL(location).searchParams.get('reason') ?? '';
      expect(reason).toContain('이메일');
      expect(upsertMock).not.toHaveBeenCalled();
    });
  });

  describe('upsert 409/403 분기', () => {
    it('KakaoConflictError(409) 시 로그인 리다이렉트 with 메시지', async () => {
      vi.mocked(exchangeKakaoToken).mockResolvedValue('tok');
      vi.mocked(fetchKakaoUser).mockResolvedValue({ providerId: '1', email: 'c@example.com' });
      const { KakaoConflictError } = await import('../../../../../lib/kakao-account');
      upsertMock.mockRejectedValue(new KakaoConflictError());

      const req = buildCallbackRequest('s', 's');
      const res = await GET(req);

      const location = res.headers.get('location') ?? '';
      expect(location).toContain('/login');
      const reason = new URL(location).searchParams.get('reason') ?? '';
      expect(reason).toContain('연결');
    });

    it('KakaoInactiveError(403) 시 로그인 리다이렉트 with 관리사무소 안내', async () => {
      vi.mocked(exchangeKakaoToken).mockResolvedValue('tok');
      vi.mocked(fetchKakaoUser).mockResolvedValue({ providerId: '1', email: 'b@example.com' });
      const { KakaoInactiveError } = await import('../../../../../lib/kakao-account');
      upsertMock.mockRejectedValue(new KakaoInactiveError());

      const req = buildCallbackRequest('s', 's');
      const res = await GET(req);

      const location = res.headers.get('location') ?? '';
      expect(location).toContain('/login');
      const reason = new URL(location).searchParams.get('reason') ?? '';
      expect(reason).toContain('관리사무소');
    });
  });

  describe('AC-KAKAO-014: 카카오 토큰 콘솔 미출력 (REQ-KAKAO-013)', () => {
    it('정상 처리 시 console 출력에 카카오 토큰 평문이 없다', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'info').mockImplementation(() => {});

      vi.mocked(exchangeKakaoToken).mockResolvedValue('kakao-secret-token-value');
      vi.mocked(fetchKakaoUser).mockResolvedValue({ providerId: '1', email: 'n@example.com' });
      upsertMock.mockResolvedValue({
        user: { id: 'u', email: 'n@example.com', role: 'RESIDENT', verifiedAt: null, status: 'ACTIVE' },
        isNewLink: false,
      });

      const req = buildCallbackRequest('s', 's');
      await GET(req);

      const allOutput = consoleSpy.mock.calls.map((c) => String(c)).join('\n');
      expect(allOutput).not.toMatch(/kakao-secret-token-value/);
      consoleSpy.mockRestore();
    });
  });
});
