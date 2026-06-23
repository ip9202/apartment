/**
 * 비밀번호 재설정 토큰 프리미티브 — SPEC-AUTH-RESET-001 (AUTH-05).
 *
 * 설계 결정 (SPEC-AUTH-RESET-001 §4, §6.1):
 * - 토큰 난수: crypto.randomBytes(32) — 256비트 엔트로피, 예측 불가 (REQ-RESET-001)
 * - 토큰 저장: SHA-256 해시만 DB 저장, 원문 미보관 (DB 유출 시 직접 공격 방어)
 * - 토큰 만료: 30분 고정 (과도한 만료 창 금지, 보안 6.1)
 * - 일회용: used_at 갱신으로 재사용 차단 (REQ-RESET-008)
 *
 * DB 쓰기/읽기(createResetToken, findActiveTokenByHash, markTokenUsed,
 * invalidateUserTokens)는 본 모듈에서 노출하며, API route 가 호출한다.
 *
 * @MX:NOTE: [AUTO] PRD AUTH-05, SPEC-AUTH-001 Exclusion #2 구현. bcrypt 해시 로직은
 *           auth.ts 를 재사용하여 비밀번호 정책 일관성 유지.
 */

import { randomBytes, createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, withTransaction } from './db';

/** 난수 토큰 길이(바이트) — 32 = 256비트 엔트로피 (REQ-RESET-001). */
export const TOKEN_BYTES = 32;
/** 토큰 만료(분) — 30분 고정 (보안 6.1, 과도한 창 금지). */
export const TOKEN_TTL_MINUTES = 30;

/** password_reset_tokens 행 구조. */
export interface ResetTokenRecord {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

/**
 * 난수 재설정 토큰 생성 (hex 인코딩).
 *
 * @MX:WARN: [AUTO] Math.random 등 예측 가능한 생성기 사용 금지 — crypto.randomBytes 필수
 * @MX:REASON: 예측 가능한 토큰은 공격자가 재설정 링크를 추측해 계정을 탈취할 수 있음
 */
export function generateResetToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * 토큰 원문을 SHA-256 해시(hex)로 변환.
 *
 * @MX:WARN: [AUTO] 원문 토큰은 절대 DB에 저장하지 않는다 — 해시만 저장 (보안 6.1)
 * @MX:REASON: DB 유출 시 원문 토큰이 있으면 즉시 재설정 링크로 악용 가능
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** now + TTL 만료 시각(ISO) 계산 — 토큰 생성 시 expires_at 에 사용. */
export function computeExpiryFromNow(now: number = Date.now()): string {
  return new Date(now + TOKEN_TTL_MINUTES * 60_000).toISOString();
}

/**
 * DB 레코드가 현재 사용 가능한 토큰인지 판별 (미만료 + 미사용).
 *
 * @MX:WARN: [AUTO] 만료/사용 검증을 건너뛰면 토큰 재사용·만료 우회 공격 허용
 * @MX:REASON: 공격자가 만료된/이미 쓴 토큰으로 비밀번호를 변경할 수 있게 됨
 */
export function isTokenRecordUsable(rec: ResetTokenRecord, now: number = Date.now()): boolean {
  if (rec.used_at !== null) return false;
  return new Date(rec.expires_at).getTime() > now;
}

/**
 * 새 토큰 레코드를 DB 에 INSERT.
 * 원문 토큰은 반환하고 DB 에는 해시만 저장한다.
 */
export async function createResetToken(
  userId: string,
): Promise<{ token: string; record: ResetTokenRecord }> {
  const token = generateResetToken();
  const tokenHash = hashToken(token);
  const res = await query<ResetTokenRecord>(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)
     RETURNING id, user_id, token_hash, expires_at, used_at, created_at`,
    [randomUUID(), userId, tokenHash, String(TOKEN_TTL_MINUTES)],
  );
  return { token, record: res.rows[0] };
}

/** 주어진 해시의 가장 최근 활성 토큰 레코드를 조회 (used_at IS NULL, expires_at > now). */
export async function findActiveTokenByHash(tokenHash: string): Promise<ResetTokenRecord | null> {
  const res = await query<ResetTokenRecord>(
    `SELECT id, user_id, token_hash, expires_at, used_at, created_at
     FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     LIMIT 1`,
    [tokenHash],
  );
  return res.rows[0] ?? null;
}

/**
 * 토큰 레코드를 사용 처리(used_at 갱신).
 *
 * @MX:WARN: [AUTO] used_at 미갱신 시 동일 토큰 재사용 공격 허용 (REQ-RESET-008)
 * @MX:REASON: 일회용 보장의 핵심 — 갱신 누락은 토큰 도용 재사용으로 직결
 */
export async function markTokenUsed(tokenId: string): Promise<void> {
  await query(
    'UPDATE password_reset_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL',
    [tokenId],
  );
}

/**
 * 사용자의 모든 활성 토큰을 일괄 무효화 (used_at 갱신).
 * 비밀번호 변경 성공 후 미사용 토큰이 남지 않도록 정리.
 */
export async function invalidateUserTokens(userId: string): Promise<void> {
  await query(
    'UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
    [userId],
  );
}

/**
 * 트랜잭션 내에서 비밀번호 변경 + 토큰 사용 처리를 원자적으로 수행.
 * 트랜잭션을 직접 제어해야 하는 confirm route 용 헬퍼.
 *
 * @MX:WARN: [AUTO] 비밀번호 변경과 토큰 무효화는 원자적이어야 함 — 부분 성공 시 보안 홀
 * @MX:REASON: 비밀번호만 바뀌고 토큰이 살아있거나, 그 반대면 인증 상태가 불일치하여 위험
 */
export async function applyPasswordChange(
  client: PoolClient,
  tokenId: string,
  userId: string,
  newPasswordHash: string,
): Promise<void> {
  await client.query(
    'UPDATE users SET password_hash = $1 WHERE id = $2',
    [newPasswordHash, userId],
  );
  await client.query(
    'UPDATE password_reset_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL',
    [tokenId],
  );
}

/** withTransaction 재노출 — confirm route 가 단일 트랜잭션 묶음으로 사용. */
export { withTransaction };
