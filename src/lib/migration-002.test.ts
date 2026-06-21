import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestPool,
  dropAllAuthTables,
  applySql,
  readMigration,
  assertColumnsExist,
  tableExists,
  indexExists,
  foreignKeyExists,
} from './migration-test-helpers';

const pool = createTestPool();

beforeAll(async () => {
  // 002 는 users 에 FK 를 가지므로 001 선행 적용 필요
  await dropAllAuthTables(pool);
  await applySql(pool, readMigration('001_init_users_buildings_units_roles.sql'));
  await applySql(pool, readMigration('002_revoked_refresh_tokens.sql'));
});

afterAll(async () => {
  await pool.end();
});

describe('마이그레이션 002 — revoked_refresh_tokens (RT 블랙리스트)', () => {
  it('테이블이 존재한다', async () => {
    expect(await tableExists(pool, 'revoked_refresh_tokens')).toBe(true);
  });

  it('필수 컬럼이 올바른 타입으로 존재한다', async () => {
    await assertColumnsExist(pool, [
      { table: 'revoked_refresh_tokens', column: 'id', dataType: 'uuid', isNullable: false },
      { table: 'revoked_refresh_tokens', column: 'token_jti', dataType: 'character varying', isNullable: false },
      { table: 'revoked_refresh_tokens', column: 'token_hash', dataType: 'character varying', isNullable: false },
      { table: 'revoked_refresh_tokens', column: 'user_id', dataType: 'uuid', isNullable: false },
      { table: 'revoked_refresh_tokens', column: 'revoked_at', dataType: 'timestamp with time zone' },
      { table: 'revoked_refresh_tokens', column: 'expires_at', dataType: 'timestamp with time zone', isNullable: false },
    ]);
  });

  it('token_jti UNIQUE 제약이 존재한다', async () => {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints
       WHERE table_name='revoked_refresh_tokens' AND constraint_type='UNIQUE'`,
    );
    expect((res.rowCount ?? 0)).toBeGreaterThan(0);
  });

  it('user_id → users.id FK 가 존재한다', async () => {
    expect(await foreignKeyExists(pool, 'revoked_refresh_tokens_user_id_fkey')).toBe(true);
  });

  it('token_hash 인덱스 존재', async () => {
    expect(await indexExists(pool, 'idx_revoked_refresh_tokens_token_hash')).toBe(true);
  });

  it('user_id 인덱스 존재', async () => {
    expect(await indexExists(pool, 'idx_revoked_refresh_tokens_user_id')).toBe(true);
  });

  it('expires_at 인덱스 존재 (정리 쿼리용)', async () => {
    expect(await indexExists(pool, 'idx_revoked_refresh_tokens_expires_at')).toBe(true);
  });

  it('멱등성 — 재적용 시 에러 없음', async () => {
    await expect(applySql(pool, readMigration('002_revoked_refresh_tokens.sql'))).resolves.toBeUndefined();
  });
});
