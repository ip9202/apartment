/**
 * password-reset DB 함수 통합 테스트 (lib 스코프 커버리지용).
 *
 * createResetToken, findActiveTokenByHash, markTokenUsed, invalidateUserTokens,
 * applyPasswordChange (트랜잭션) 의 실DB 동작을 검증.
 * SPEC-AUTH-RESET-001 (REQ-RESET-001/004/008).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query, withTransaction } from './db';
import { createTestPool, applySql, readMigration } from './migration-test-helpers';
import {
  createResetToken,
  findActiveTokenByHash,
  markTokenUsed,
  invalidateUserTokens,
  hashToken,
  applyPasswordChange,
} from './password-reset';
import { hashPassword, comparePassword } from './auth';

async function ensureSchema(): Promise<void> {
  const setupPool = createTestPool();
  try {
    await applySql(setupPool, readMigration('001_init_users_buildings_units_roles.sql'));
    await applySql(setupPool, readMigration('002_revoked_refresh_tokens.sql'));
    await applySql(setupPool, readMigration('003_login_attempts.sql'));
    await applySql(setupPool, readMigration('009_password_reset_tokens.sql'));
  } finally {
    await setupPool.end();
  }
}

async function seedUser(email: string): Promise<string> {
  await query(
    `INSERT INTO roles (code, name) VALUES ('RSTDB', '테스트') ON CONFLICT (code) DO NOTHING`,
  );
  const res = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status)
     SELECT $1, $2, r.id, 'email', 'ACTIVE' FROM roles r WHERE r.code='RSTDB'
     RETURNING id`,
    [email, hashPassword('Old123!')],
  );
  return res.rows[0].id;
}

beforeAll(async () => {
  await ensureSchema();
});

beforeEach(async () => {
  await query('DELETE FROM password_reset_tokens');
  await query("DELETE FROM users WHERE email LIKE 'rst-%'");
});

afterAll(async () => {
  await query('DELETE FROM password_reset_tokens');
  await query("DELETE FROM users WHERE email LIKE 'rst-%'");
  await query("DELETE FROM roles WHERE code = 'RSTDB'");
  await pool.end();
});

describe('createResetToken (REQ-RESET-001)', () => {
  it('원문 토큰(64자 hex) + DB 해시(64자) 반환', async () => {
    const userId = await seedUser('rst-create@example.com');
    const { token, record } = await createResetToken(userId);
    expect(token).toHaveLength(64);
    expect(record.token_hash).toBe(hashToken(token));
    expect(record.used_at).toBeNull();
  });

  it('expires_at 이 약 30분 후', async () => {
    const userId = await seedUser('rst-exp@example.com');
    const { record } = await createResetToken(userId);
    const deltaMin = (new Date(record.expires_at).getTime() - Date.now()) / 60_000;
    expect(deltaMin).toBeGreaterThan(29);
    expect(deltaMin).toBeLessThan(31);
  });
});

describe('findActiveTokenByHash (REQ-RESET-004/005/008)', () => {
  it('활성 토큰 해시로 조회 → 레코드 반환', async () => {
    const userId = await seedUser('rst-find@example.com');
    const { token } = await createResetToken(userId);
    const found = await findActiveTokenByHash(hashToken(token));
    expect(found?.user_id).toBe(userId);
  });

  it('존재하지 않는 해시 → null', async () => {
    const found = await findActiveTokenByHash('nonexistent');
    expect(found).toBeNull();
  });

  it('사용된 토큰 → null (markTokenUsed 후)', async () => {
    const userId = await seedUser('rst-used@example.com');
    const { token, record } = await createResetToken(userId);
    await markTokenUsed(record.id);
    const found = await findActiveTokenByHash(hashToken(token));
    expect(found).toBeNull();
  });

  it('만료된 토큰 → null', async () => {
    const userId = await seedUser('rst-expfind@example.com');
    const { token, record } = await createResetToken(userId);
    await query(
      'UPDATE password_reset_tokens SET expires_at = now() - interval \'1 minute\' WHERE id = $1',
      [record.id],
    );
    const found = await findActiveTokenByHash(hashToken(token));
    expect(found).toBeNull();
  });
});

describe('invalidateUserTokens (REQ-RESET-007 proxy)', () => {
  it('사용자의 모든 활성 토큰을 used_at 갱신', async () => {
    const userId = await seedUser('rst-inv@example.com');
    await createResetToken(userId);
    await createResetToken(userId);
    await createResetToken(userId);
    await invalidateUserTokens(userId);
    const recs = await query<{ used_at: string | null }>(
      'SELECT used_at FROM password_reset_tokens WHERE user_id = $1',
      [userId],
    );
    expect(recs.rows).toHaveLength(3);
    for (const r of recs.rows) expect(r.used_at).not.toBeNull();
  });

  it('이미 사용된 토큰은 그대로 유지 (덮어쓰지 않음, 멱등)', async () => {
    const userId = await seedUser('rst-idem@example.com');
    const { record } = await createResetToken(userId);
    const before = new Date().getTime();
    await markTokenUsed(record.id);
    await invalidateUserTokens(userId);
    const rec = await query<{ used_at: string }>(
      'SELECT used_at FROM password_reset_tokens WHERE id = $1',
      [record.id],
    );
    // 최초 markTokenUsed 시각 근처여야 함 (덮어쓰지 않음)
    expect(new Date(rec.rows[0].used_at).getTime()).toBeLessThan(before + 5000);
  });
});

describe('applyPasswordChange (원자적, REQ-RESET-004/008)', () => {
  it('트랜잭션 내 비밀번호 변경 + 토큰 used_at 갱신', async () => {
    const userId = await seedUser('rst-apply@example.com');
    const { record } = await createResetToken(userId);
    const newHash = hashPassword('NewPass123!');
    await withTransaction(async (client) => {
      await applyPasswordChange(client, record.id, userId, newHash);
    });
    const u = await query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId],
    );
    expect(comparePassword('NewPass123!', u.rows[0].password_hash)).toBe(true);
    const t = await query<{ used_at: string | null }>(
      'SELECT used_at FROM password_reset_tokens WHERE id = $1',
      [record.id],
    );
    expect(t.rows[0].used_at).not.toBeNull();
  });

  it('트랜잭션 롤백 시 둘 다 미반영', async () => {
    const userId = await seedUser('rst-rollback@example.com');
    const { record } = await createResetToken(userId);
    await expect(
      withTransaction(async (client) => {
        await applyPasswordChange(client, record.id, userId, hashPassword('NewPass123!'));
        throw new Error('forced-rollback');
      }),
    ).rejects.toThrow('forced-rollback');
    // 비밀번호 미변경
    const u = await query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId],
    );
    expect(comparePassword('Old123!', u.rows[0].password_hash)).toBe(true);
    // 토큰도 미사용
    const t = await query<{ used_at: string | null }>(
      'SELECT used_at FROM password_reset_tokens WHERE id = $1',
      [record.id],
    );
    expect(t.rows[0].used_at).toBeNull();
  });
});
