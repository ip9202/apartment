/**
 * 인증 프리미티브 — JWT 발급/검증 + bcrypt 해시.
 *
 * 설계 결정 (ADR-003, SPEC-AUTH-001):
 * - Access Token: HS256, 만료 15분(900초), 응답 본문 전송
 * - Refresh Token: HS256, 만료 7일(604800초), httpOnly 쿠키 전송
 * - 각 토큰은 고유 jti 를 포함하여 블랙리스트 식별에 사용
 * - 비밀번호는 bcrypt salt rounds 12 로 해시 (평문 저장 금지, REQ-AUTH-002)
 *
 * @MX:WARN: [AUTO] JWT 시크릿/비밀번호 해시 처리는 인증 보안의 핵심 — 오작동 시 토큰 위조·비밀번호 유출
 * @MX:REASON: 시크릿 누출 또는 salt rounds 미달 시 공격자가 토큰 위조/비밀번호 역추론 가능
 */

import jwt, { type JwtPayload } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { env } from './env';

/** Access Token TTL (초) — 15분. AC-AUTH-027. */
export const ACCESS_TTL_SECONDS = 900;
/** Refresh Token TTL (초) — 7일. AC-AUTH-028. */
export const REFRESH_TTL_SECONDS = 604800;
/** bcrypt salt rounds — SPEC-AUTH-001 핵심 제약 (REQ-AUTH-002). */
export const BCRYPT_SALT_ROUNDS = 12;

export interface AccessTokenClaims {
  sub: string;
  role: string;
  verified: boolean;
}

export interface RefreshTokenClaims {
  sub: string;
}

// ---------------------------------------------------------------------------
// JWT 발급
// ---------------------------------------------------------------------------

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(
    { ...claims, jti: randomUUID() },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: ACCESS_TTL_SECONDS },
  );
}

export function signRefreshToken(claims: RefreshTokenClaims): string {
  return jwt.sign(
    { sub: claims.sub, jti: randomUUID() },
    env.JWT_REFRESH_SECRET,
    { algorithm: 'HS256', expiresIn: REFRESH_TTL_SECONDS },
  );
}

// ---------------------------------------------------------------------------
// JWT 검증
// ---------------------------------------------------------------------------

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
}

// ---------------------------------------------------------------------------
// bcrypt
// ---------------------------------------------------------------------------

/** 평문 비밀번호를 bcrypt(salt rounds 12) 해시로 변환. */
export function hashPassword(plaintext: string): string {
  return bcrypt.hashSync(plaintext, BCRYPT_SALT_ROUNDS);
}

/** 평문과 bcrypt 해시를 비교. 일치하면 true, 아니면 false. */
export function comparePassword(plaintext: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(plaintext, hash);
  } catch {
    return false;
  }
}
