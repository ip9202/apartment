/**
 * GET /api/auth/me 엔드포인트 테스트 — TDD RED-GREEN-REFACTOR 완료.
 *
 * REQ-AUTH-INT-001: AT 쿠키 유효 → 200 OK + 사용자 정보
 * REQ-AUTH-INT-002: AT 쿠키 없음/만료/무효 → 401
 * REQ-AUTH-INT-003: middleware.ts와 동일한 검증 로직
 *
 * @MX:NOTE: [AUTO] 단위 테스트로 순수 함수 검증 — Next.js 래퍼는 route.ts에서 별도 처리.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignJWT } from 'jose';
import {
  extractJwtPayload,
  extractUserId,
  fetchUserById,
  handleGetMe,
} from './auth';
import { query } from '../db';

// JWT Payload 타입
type JWTPayload = {
  sub: string;
  role: string;
  verified: boolean;
  [key: string]: unknown;
};

// Mock dependencies
vi.mock('../db', () => ({
  query: vi.fn(),
}));

// 유효한 JWT 생성 헬퍼
async function createValidToken(payload: JWTPayload): Promise<string> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret);
  return token;
}

// 만료된 JWT 생성 헬퍼
async function createExpiredToken(payload: JWTPayload): Promise<string> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const now = Math.floor(Date.now() / 1000); // 초 단위
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now - 3600) // 1시간 전
    .setExpirationTime(now - 60) // 1분 전 만료 (초 단위)
    .sign(secret);
  return token;
}

describe('GET /api/auth/me - 세션 복원 엔드포인트', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractJwtPayload - JWT 검증', () => {
    it('AT 쿠키가 없으면 null을 반환해야 한다', async () => {
      const result = await extractJwtPayload(undefined);
      expect(result).toBeNull();
    });

    it('빈 문자열이면 null을 반환해야 한다', async () => {
      const result = await extractJwtPayload('');
      expect(result).toBeNull();
    });

    it('만료된 토큰이면 null을 반환해야 한다', async () => {
      const expiredToken = await createExpiredToken({
        sub: 'user-123',
        role: 'ADMIN',
        verified: true,
      });
      const result = await extractJwtPayload(expiredToken);
      expect(result).toBeNull();
    });

    it('잘못된 형식이면 null을 반환해야 한다', async () => {
      const invalidToken = 'not-a-jwt';
      const result = await extractJwtPayload(invalidToken);
      expect(result).toBeNull();
    });
  });

  describe('extractUserId - 사용자 ID 추출', () => {
    it('페이로드에서 sub 클레임을 추출해야 한다', () => {
      const mockPayload = {
        payload: { sub: 'user-123', role: 'ADMIN', verified: true },
        protectedHeader: { alg: 'HS256' },
      } as { payload: JWTPayload; protectedHeader: { alg: string } };

      const userId = extractUserId(mockPayload);
      expect(userId).toBe('user-123');
    });
  });

  describe('fetchUserById - 사용자 조회', () => {
    it('사용자를 찾으면 사용자 정보를 반환해야 한다', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'RESIDENT',
        verified: true,
        status: 'ACTIVE',
      };

      vi.mocked(query).mockResolvedValue({
        rows: [mockUser],
      } as never);

      const result = await fetchUserById('user-123');
      expect(result).toEqual(mockUser);
    });

    it('사용자를 찾지 못하면 null을 반환해야 한다', async () => {
      vi.mocked(query).mockResolvedValue({
        rows: [],
      } as never);

      const result = await fetchUserById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('handleGetMe - 메인 핸들러', () => {
    it('쿠키가 없으면 401을 반환해야 한다', async () => {
      const request = new Request('http://localhost:3000/api/auth/me', {
        headers: {},
      });

      const response = await handleGetMe(request);
      expect(response.status).toBe(401);

      const body = await response.json();
      expect(body).toEqual({
        success: false,
        error: '인증이 필요합니다',
      });
    });

    it('유효한 AT 쿠키가 있으면 200과 사용자 정보를 반환해야 한다', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'admin@example.com',
        role: 'ADMIN',
        verified: true,
        status: 'ACTIVE',
      };

      vi.mocked(query).mockResolvedValue({
        rows: [mockUser],
      } as never);

      // 실제 유효한 JWT 토큰 생성
      const validToken = await createValidToken({
        sub: 'user-123',
        role: 'ADMIN',
        verified: true,
      });

      const request = new Request('http://localhost:3000/api/auth/me', {
        headers: {
          cookie: `at=${validToken}`,
        },
      });

      const response = await handleGetMe(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toEqual({
        success: true,
        data: {
          id: 'user-123',
          email: 'admin@example.com',
          role: 'ADMIN',
          verified: true,
          status: 'ACTIVE',
        },
      });
    });
  });
});
