/**
 * rate-limit.ts 통합 테스트 — TASK-AUTH-007 (REQ-AUTH-006).
 *
 * AC-AUTH-008 (5회 실패 → 잠금), AC-AUTH-009 (잠금 해제 후 failed_count 초기화).
 * DB 기반 영속화 검증. 각 케이스 beforeEach 에서 login_attempts truncate.
 *
 * TEST ISOLATION: beforeAll 에서 마이그레이션 001/002/003 + 시드를 멱등 적용하여
 * 형제 마이그레이션 테스트의 스키마 teardown 에 영향받지 않는다 (signup.test.ts 동일 패턴).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from './db';
import { runSeed } from '../../scripts/seed';
import {
  createTestPool,
  applySql,
  readMigration,
} from './migration-test-helpers';
import {
  recordFailedAttempt,
  isLocked,
  resetAttempts,
  getLockStatus,
  MAX_FAILED_ATTEMPTS,
  LOCK_DURATION_MINUTES,
} from './rate-limit';

async function ensureSchemaAndSeed(): Promise<void> {
  const setupPool = createTestPool();
  try {
    for (const file of [
      '001_init_users_buildings_units_roles.sql',
      '002_revoked_refresh_tokens.sql',
      '003_login_attempts.sql',
    ]) {
      await applySql(setupPool, readMigration(file));
    }
    await runSeed(setupPool);
  } finally {
    await setupPool.end();
  }
}

beforeAll(async () => {
  await ensureSchemaAndSeed();
});

beforeEach(async () => {
  await query('DELETE FROM login_attempts');
});

afterAll(async () => {
  await query('DELETE FROM login_attempts');
  await pool.end();
});

describe('rate-limit — DB 기반 로그인 시도 추적', () => {
  it('상수: MAX_FAILED_ATTEMPTS=5, LOCK_DURATION_MINUTES=10', () => {
    expect(MAX_FAILED_ATTEMPTS).toBe(5);
    expect(LOCK_DURATION_MINUTES).toBe(10);
  });

  it('recordFailedAttempt: 첫 실패 → failed_count=1, locked_until IS NULL', async () => {
    await recordFailedAttempt('a@example.com');
    const status = await getLockStatus('a@example.com');
    expect(status.failed_count).toBe(1);
    expect(status.locked_until).toBeNull();
  });

  it('recordFailedAttempt: 연속 호출 → failed_count 누적 증가', async () => {
    for (let i = 1; i <= 4; i++) {
      await recordFailedAttempt('b@example.com');
      const status = await getLockStatus('b@example.com');
      expect(status.failed_count).toBe(i);
      expect(status.locked_until).toBeNull();
    }
  });

  it('recordFailedAttempt: 5번째 실패 → failed_count=5 + locked_until 설정', async () => {
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt('c@example.com');
    }
    const status = await getLockStatus('c@example.com');
    expect(status.failed_count).toBe(5);
    expect(status.locked_until).not.toBeNull();
  });

  it('recordFailedAttempt: 5번째 실패 시 locked_until ≈ now + 10분 (±30초 허용)', async () => {
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt('d@example.com');
    }
    const status = await getLockStatus('d@example.com');
    expect(status.locked_until).not.toBeNull();
    const locked = new Date(status.locked_until as string).getTime();
    const expectedMin = Date.now() + (LOCK_DURATION_MINUTES * 60 - 30) * 1000;
    const expectedMax = Date.now() + (LOCK_DURATION_MINUTES * 60 + 30) * 1000;
    expect(locked).toBeGreaterThanOrEqual(expectedMin);
    expect(locked).toBeLessThanOrEqual(expectedMax);
  });

  it('isLocked: locked_until 미래 → true', async () => {
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt('e@example.com');
    }
    expect(await isLocked('e@example.com')).toBe(true);
  });

  it('isLocked: 잠금 없음(row 미존재) → false', async () => {
    expect(await isLocked('never@example.com')).toBe(false);
  });

  it('isLocked: failed_count 1~4 (locked_until NULL) → false', async () => {
    await recordFailedAttempt('f@example.com');
    expect(await isLocked('f@example.com')).toBe(false);
  });

  it('isLocked: locked_until 과거 (잠금 만료) → false', async () => {
    await recordFailedAttempt('g@example.com');
    // 직접 locked_until 을 과거로 설정하여 만료 시뮬레이션
    await query(
      `UPDATE login_attempts SET locked_until = now() - interval '1 minute' WHERE email = $1`,
      ['g@example.com'],
    );
    expect(await isLocked('g@example.com')).toBe(false);
  });

  it('resetAttempts: 성공 시도 후 failed_count=0 + locked_until=NULL', async () => {
    for (let i = 0; i < 3; i++) {
      await recordFailedAttempt('h@example.com');
    }
    await resetAttempts('h@example.com');
    const status = await getLockStatus('h@example.com');
    expect(status.failed_count).toBe(0);
    expect(status.locked_until).toBeNull();
  });

  it('resetAttempts: 잠금 상태에서 호출 → 잠금 해제', async () => {
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt('i@example.com');
    }
    expect(await isLocked('i@example.com')).toBe(true);
    await resetAttempts('i@example.com');
    expect(await isLocked('i@example.com')).toBe(false);
  });

  it('resetAttempts: row 미존재 시에도 에러 없이 동작', async () => {
    await expect(resetAttempts('nonexistent@example.com')).resolves.not.toThrow();
  });

  it('getLockStatus: row 미존재 → {failed_count:0, locked_until:null}', async () => {
    const status = await getLockStatus('absent@example.com');
    expect(status).toEqual({ failed_count: 0, locked_until: null });
  });

  it('이메일 파라미터화: 서로 다른 이메일은 독립적으로 추적된다', async () => {
    await recordFailedAttempt('x@example.com');
    await recordFailedAttempt('x@example.com');
    await recordFailedAttempt('y@example.com');

    const sx = await getLockStatus('x@example.com');
    const sy = await getLockStatus('y@example.com');
    expect(sx.failed_count).toBe(2);
    expect(sy.failed_count).toBe(1);
  });

  it('AC-026: SQL Injection 페이로드 이메일 → 파라미터화되어 DB 무변조', async () => {
    const payload = "inj@example.com' OR '1'='1";
    await recordFailedAttempt(payload);
    const status = await getLockStatus(payload);
    expect(status.failed_count).toBe(1);

    // 전체 login_attempts row 수가 1이어야 함 (주입으로 인한 폭주 없음)
    const all = await query('SELECT COUNT(*)::int AS n FROM login_attempts');
    expect(all.rows[0].n).toBe(1);
  });
});
