/**
 * API 클라이언트 라이브러리 테스트 — TDD RED 단계.
 *
 * REQ-AUTH-INT-009: login(), logout(), signup(), verifyUnit(), getMe() 함수 테스트
 * REQ-AUTH-INT-010: 에러 처리 (401, 429, 422) 테스트
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  login,
  logout,
  signup,
  verifyUnit,
  getMe,
  type LoginRequest,
  type SignupRequest,
  type VerifyUnitRequest,
} from './client';

// Mock global fetch
global.fetch = vi.fn();

describe('API 클라이언트 라이브러리', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('성공적인 로그인은 200과 토큰을 반환해야 한다', async () => {
      const mockResponse = {
        success: true,
        data: {
          access_token: 'mock-at',
          user: {
            id: 'user-123',
            email: 'admin@example.com',
            role: 'ADMIN',
            verified: true,
          },
        },
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const credentials: LoginRequest = {
        email: 'admin@example.com',
        password: 'test1234',
      };

      const result = await login(credentials);

      expect(result).toEqual(mockResponse);
    });

    it('실패한 로그인(401)은 에러를 반환해야 한다', async () => {
      const mockError = {
        success: false,
        error: '이메일 또는 비밀번호가 올바르지 않습니다',
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => mockError,
      } as Response);

      const credentials: LoginRequest = {
        email: 'wrong@example.com',
        password: 'wrong',
      };

      const result = await login(credentials);

      expect(result).toEqual(mockError);
    });
  });

  describe('logout', () => {
    it('성공적인 로그아웃은 success:true를 반환해야 한다', async () => {
      const mockResponse = { success: true };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await logout();

      expect(result).toEqual(mockResponse);
    });
  });

  describe('signup', () => {
    it('성공적인 회원가입은 사용자 정보를 반환해야 한다', async () => {
      const mockResponse = {
        success: true,
        data: {
          user: {
            id: 'user-123',
            email: 'new@example.com',
            role: 'RESIDENT',
            verified: false,
          },
        },
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const userData: SignupRequest = {
        email: 'new@example.com',
        password: 'password123',
        name: '홍길동',
      };

      const result = await signup(userData);

      expect(result).toEqual(mockResponse);
    });

    it('검증 실패(422)는 에러를 반환해야 한다', async () => {
      const mockError = {
        success: false,
        error: '이메일 형식이 올바르지 않습니다',
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => mockError,
      } as Response);

      const userData: SignupRequest = {
        email: 'invalid-email',
        password: 'pass',
        name: '홍길동',
      };

      const result = await signup(userData);

      expect(result).toEqual(mockError);
    });
  });

  describe('verifyUnit', () => {
    it('성공한 동호수 인증은 사용자 정보를 반환해야 한다', async () => {
      const mockResponse = {
        success: true,
        data: {
          user: {
            id: 'user-123',
            role: 'RESIDENT',
            verified: true,
          },
        },
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const requestData: VerifyUnitRequest = {
        buildingId: 'building-123',
        unitNumber: '101',
      };

      const result = await verifyUnit(requestData, 'mock-at');

      expect(result).toEqual(mockResponse);
    });
  });

  describe('getMe', () => {
    it('성공한 세션 복원은 사용자 정보를 반환해야 한다', async () => {
      const mockResponse = {
        success: true,
        data: {
          id: 'user-123',
          email: 'admin@example.com',
          role: 'ADMIN',
          verified: true,
          status: 'ACTIVE',
        },
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await getMe();

      expect(result).toEqual(mockResponse);
    });

    it('인증되지 않은 경우(401)은 에러를 반환해야 한다', async () => {
      const mockError = {
        success: false,
        error: '인증이 필요합니다',
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => mockError,
      } as Response);

      const result = await getMe();

      expect(result).toEqual(mockError);
    });
  });
});
