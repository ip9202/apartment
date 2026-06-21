import { describe, it, expect } from 'vitest';
import { loadEnv, env } from './env';

describe('env (부트 검증)', () => {
  describe('env (실제 환경에서 로드된 상수)', () => {
    it('DATABASE_URL 이 존재한다', () => {
      expect(typeof env.DATABASE_URL).toBe('string');
      expect(env.DATABASE_URL.length).toBeGreaterThan(0);
    });

    it('JWT_SECRET 이 32자 이상이다 (AC: 핵심 제약)', () => {
      expect(env.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
    });

    it('JWT_REFRESH_SECRET 이 32자 이상이다', () => {
      expect(env.JWT_REFRESH_SECRET.length).toBeGreaterThanOrEqual(32);
    });

    it('JWT_SECRET 과 JWT_REFRESH_SECRET 이 상이하다 (AC: 핵심 제약)', () => {
      expect(env.JWT_SECRET).not.toBe(env.JWT_REFRESH_SECRET);
    });
  });

  describe('loadEnv (fail-fast 검증 함수)', () => {
    it('JWT_SECRET 이 32자 미만이면 throw 한다', () => {
      expect(() =>
        loadEnv({
          DATABASE_URL: 'postgresql://u@h/d',
          JWT_SECRET: 'too-short',
          JWT_REFRESH_SECRET: 'a'.repeat(40),
          NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        }),
      ).toThrow(/JWT_SECRET/i);
    });

    it('JWT_REFRESH_SECRET 이 32자 미만이면 throw 한다', () => {
      expect(() =>
        loadEnv({
          DATABASE_URL: 'postgresql://u@h/d',
          JWT_SECRET: 'a'.repeat(40),
          JWT_REFRESH_SECRET: 'short',
          NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        }),
      ).toThrow(/JWT_REFRESH_SECRET/i);
    });

    it('JWT_SECRET === JWT_REFRESH_SECRET 이면 throw 한다', () => {
      const same = 'x'.repeat(40);
      expect(() =>
        loadEnv({
          DATABASE_URL: 'postgresql://u@h/d',
          JWT_SECRET: same,
          JWT_REFRESH_SECRET: same,
          NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        }),
      ).toThrow(/distinct|상이|different/i);
    });

    it('DATABASE_URL 이 누락되면 throw 한다', () => {
      expect(() =>
        loadEnv({
          JWT_SECRET: 'a'.repeat(40),
          JWT_REFRESH_SECRET: 'b'.repeat(40),
          NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        }),
      ).toThrow(/DATABASE_URL/i);
    });

    it('유효한 환경이면 검증된 객체를 반환한다', () => {
      const result = loadEnv({
        DATABASE_URL: 'postgresql://u@h/d',
        TEST_DATABASE_URL: 'postgresql://u@h/d_test',
        JWT_SECRET: 'a'.repeat(40),
        JWT_REFRESH_SECRET: 'b'.repeat(40),
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      });
      expect(result.DATABASE_URL).toBe('postgresql://u@h/d');
      expect(result.JWT_SECRET.length).toBe(40);
    });
  });
});
