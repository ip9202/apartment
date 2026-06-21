import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
} from './auth';

// AC-AUTH-027/028: 발급된 토큰 디코딩 후 alg=HS256, exp-iat 바운드 단정
function decodeHeaderAndPayload(token: string) {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded) throw new Error('undecodable token');
  return decoded as { header: { alg: string }; payload: { iat?: number; exp?: number; jti?: string } };
}

describe('auth.ts — JWT 발급 (AC-AUTH-027 / AC-AUTH-028)', () => {
  describe('Access Token (signAccessToken)', () => {
    it('header.alg === HS256', () => {
      const token = signAccessToken({ sub: 'user-1', role: 'RESIDENT', verified: false });
      const decoded = decodeHeaderAndPayload(token);
      expect(decoded.header.alg).toBe('HS256');
    });

    it('exp - iat <= 900 (15분, AC-AUTH-027)', () => {
      const token = signAccessToken({ sub: 'user-1', role: 'RESIDENT', verified: false });
      const { payload } = decodeHeaderAndPayload(token);
      expect(payload.exp).toBeDefined();
      expect(payload.iat).toBeDefined();
      const delta = (payload.exp as number) - (payload.iat as number);
      expect(delta).toBeLessThanOrEqual(ACCESS_TTL_SECONDS);
      expect(delta).toBeGreaterThan(0);
    });

    it('jti(고유 ID) 가 포함된다', () => {
      const token = signAccessToken({ sub: 'user-1', role: 'RESIDENT', verified: false });
      const { payload } = decodeHeaderAndPayload(token);
      expect(payload.jti).toBeTruthy();
    });

    it('연속 발급 시 jti 가 매번 상이하다', () => {
      const t1 = signAccessToken({ sub: 'u1', role: 'RESIDENT', verified: false });
      const t2 = signAccessToken({ sub: 'u1', role: 'RESIDENT', verified: false });
      const j1 = decodeHeaderAndPayload(t1).payload.jti;
      const j2 = decodeHeaderAndPayload(t2).payload.jti;
      expect(j1).not.toBe(j2);
    });

    it('CLAIMS(페이로드)에 sub/role/verified 가 전파된다', () => {
      const token = signAccessToken({ sub: 'u-abc', role: 'ADMIN', verified: true });
      const claims = jwt.decode(token) as jwt.JwtPayload;
      expect(claims.sub).toBe('u-abc');
      expect((claims as Record<string, unknown>).role).toBe('ADMIN');
      expect((claims as Record<string, unknown>).verified).toBe(true);
    });
  });

  describe('Refresh Token (signRefreshToken) — AC-AUTH-028', () => {
    it('header.alg === HS256', () => {
      const token = signRefreshToken({ sub: 'user-1' });
      expect(decodeHeaderAndPayload(token).header.alg).toBe('HS256');
    });

    it('exp - iat <= 604800 (7일, AC-AUTH-028)', () => {
      const token = signRefreshToken({ sub: 'user-1' });
      const { payload } = decodeHeaderAndPayload(token);
      const delta = (payload.exp as number) - (payload.iat as number);
      expect(delta).toBeLessThanOrEqual(REFRESH_TTL_SECONDS);
      expect(delta).toBeGreaterThan(0);
    });

    it('jti 가 포함되며 매 호출마다 상이하다', () => {
      const t1 = signRefreshToken({ sub: 'u' });
      const t2 = signRefreshToken({ sub: 'u' });
      expect(decodeHeaderAndPayload(t1).payload.jti).not.toBe(decodeHeaderAndPayload(t2).payload.jti);
    });
  });

  describe('Falsifiability — 규격 위반 토큰은 단정을 통과하지 못한다', () => {
    it('RS256 으로 서명된 토큰은 alg !== HS256 이다 (음성 대조군)', () => {
      // RS256 키는 여기서 보유하지 않으므로, HS512(다른 알고리즘)로 위조하여 alg 단정이 실패함을 증명
      const forged = jwt.sign({ sub: 'x' }, 'a'.repeat(40), { algorithm: 'HS512' });
      const decoded = decodeHeaderAndPayload(forged);
      expect(decoded.header.alg).not.toBe('HS256');
    });

    it('24시간(86400초) 만료 토큰은 exp-iat <= 900 단정에 실패한다', () => {
      const longLived = jwt.sign({ sub: 'x' }, 'a'.repeat(40), { expiresIn: 86400 });
      const { payload } = decodeHeaderAndPayload(longLived);
      const delta = (payload.exp as number) - (payload.iat as number);
      expect(delta).toBeGreaterThan(ACCESS_TTL_SECONDS);
    });
  });
});

describe('auth.ts — JWT 검증 (verifyAccessToken / verifyRefreshToken)', () => {
  it('정상 발급한 AT 는 verifyAccessToken 을 통과한다', () => {
    const token = signAccessToken({ sub: 'u1', role: 'RESIDENT', verified: false });
    const claims = verifyAccessToken(token);
    expect(claims.sub).toBe('u1');
  });

  it('정상 발급한 RT 는 verifyRefreshToken 을 통과한다', () => {
    const token = signRefreshToken({ sub: 'u1' });
    const claims = verifyRefreshToken(token);
    expect(claims.sub).toBe('u1');
  });

  it('만료된 AT 는 검증 거부된다', () => {
    const expired = jwt.sign({ sub: 'u1' }, 'a'.repeat(40), { expiresIn: -1 });
    expect(() => verifyAccessToken(expired)).toThrow();
  });

  it('변조된(서명 불일치) AT 는 검증 거부된다', () => {
    const token = signAccessToken({ sub: 'u1', role: 'RESIDENT', verified: false });
    const tampered = token.slice(0, -4) + 'AAAA';
    expect(() => verifyAccessToken(tampered)).toThrow();
  });

  it('AT 를 RT 검증기에 넣으면 실패한다 (시크릿 분리)', () => {
    const at = signAccessToken({ sub: 'u1', role: 'RESIDENT', verified: false });
    expect(() => verifyRefreshToken(at)).toThrow();
  });
});
