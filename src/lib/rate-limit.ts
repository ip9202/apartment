/**
 * DB 기반 로그인 시도 추적 (Rate Limiting) — TASK-AUTH-007 (REQ-AUTH-006).
 *
 * 정책 (SPEC-AUTH-001):
 * - MAX_FAILED_ATTEMPTS=5: 동일 이메일 연속 5회 실패 시 잠금
 * - LOCK_DURATION_MINUTES=10: 잠금 지속 시간
 * - DB 영속화: 서버 재시작 후에도 잠금 상태 유지
 * - 성공 시도 → failed_count/locked_until 초기화
 *
 * @MX:WARN: [AUTO] 임계치 오설정 시 브루트포스 공격 허용 또는 정상 사용자 잠금
 * @MX:REASON: MAX_FAILED_ATTEMPTS 가 너무 높으면 무차별 대입이 가능해지고,
 *             너무 낮으면 정상 사용자가 잠금되어 가용성 손상. 5회/10분은 SPEC-AUTH-001 합의값.
 */

import { query } from './db';

/** 연속 실패 허용 횟수 — 초과 시 잠금. */
export const MAX_FAILED_ATTEMPTS = 5;
/** 잠금 지속 시간(분). */
export const LOCK_DURATION_MINUTES = 10;

export interface LockStatus {
  failed_count: number;
  locked_until: string | null;
}

/**
 * 실패 시도 1회 기록.
 * login_attempts.email 은 UNIQUE 가 아닌 단순 인덱스(마이그레이션 003) 이므로
 * ON CONFLICT 를 사용할 수 없다. 대신 단일 UPDATE 문으로 원자적 증가를 수행하고,
 * row 가 없으면(affected rows=0) INSERT 한다.
 *
 * failed_count 가 MAX_FAILED_ATTEMPTS 에 도달하면 locked_until=now()+10분 설정.
 *
 * 주의: 동일 이메일의 기존 locked_until 이 이미 미래인 경우(잠금 중)에도 카운트는 계속 증가한다.
 * 호출자(login route)는 isLocked 를 먼저 검사하여 잠금 중에는 recordFailedAttempt 를
 * 호출하지 않는 플로우를 따른다.
 */
export async function recordFailedAttempt(email: string): Promise<void> {
  const updated = await query(
    `UPDATE login_attempts
       SET failed_count = failed_count + 1,
           last_attempt_at = now(),
           locked_until = CASE
             WHEN failed_count + 1 >= $2 THEN now() + ($3 || ' minutes')::interval
             ELSE locked_until
           END
     WHERE email = $1`,
    [email, MAX_FAILED_ATTEMPTS, String(LOCK_DURATION_MINUTES)],
  );
  if ((updated.rowCount ?? 0) === 0) {
    await query(
      `INSERT INTO login_attempts (email, failed_count, last_attempt_at)
       VALUES ($1, 1, now())`,
      [email],
    );
  }
}

/** email 이 현재 잠금 상태인지 조회 (locked_until > now()). */
export async function isLocked(email: string): Promise<boolean> {
  const res = await query<{ locked_until: string | null }>(
    'SELECT locked_until FROM login_attempts WHERE email = $1',
    [email],
  );
  const row = res.rows[0];
  if (!row || !row.locked_until) return false;
  return new Date(row.locked_until).getTime() > Date.now();
}

/**
 * 성공 시도 후 failed_count/locked_until 초기화.
 * row 가 존재하지 않아도 에러 없이 동작 (idempotent).
 * login_attempts.email 은 UNIQUE 가 아니므로 UPDATE 후 0 rows 면 아무 동작도 하지 않는다
 * (성공한 시도에 대해 굳이 빈 row 를 만들 필요 없음).
 */
export async function resetAttempts(email: string): Promise<void> {
  await query(
    `UPDATE login_attempts
       SET failed_count = 0,
           locked_until = NULL,
           last_attempt_at = now()
     WHERE email = $1`,
    [email],
  );
}

/** email 의 현재 잠금 상태({failed_count, locked_until}) 조회. row 미존재 시 0/NULL. */
export async function getLockStatus(email: string): Promise<LockStatus> {
  const res = await query<{ failed_count: number; locked_until: string | null }>(
    'SELECT failed_count, locked_until FROM login_attempts WHERE email = $1',
    [email],
  );
  const row = res.rows[0];
  if (!row) {
    return { failed_count: 0, locked_until: null };
  }
  return { failed_count: row.failed_count, locked_until: row.locked_until };
}
