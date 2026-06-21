import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestPool,
  dropAllAuthTables,
  applySql,
  readMigration,
  assertColumnsExist,
  tableExists,
  indexExists,
} from './migration-test-helpers';

const pool = createTestPool();

beforeAll(async () => {
  await dropAllAuthTables(pool);
  await applySql(pool, readMigration('001_init_users_buildings_units_roles.sql'));
  await applySql(pool, readMigration('003_login_attempts.sql'));
});

afterAll(async () => {
  await pool.end();
});

describe('마이그레이션 003 — login_attempts (Rate Limiting 추적)', () => {
  it('테이블이 존재한다', async () => {
    expect(await tableExists(pool, 'login_attempts')).toBe(true);
  });

  it('필수 컬럼이 올바른 타입으로 존재한다', async () => {
    await assertColumnsExist(pool, [
      { table: 'login_attempts', column: 'id', dataType: 'uuid', isNullable: false },
      { table: 'login_attempts', column: 'email', dataType: 'character varying', isNullable: false },
      { table: 'login_attempts', column: 'failed_count', dataType: 'integer', isNullable: false },
      { table: 'login_attempts', column: 'locked_until', dataType: 'timestamp with time zone', isNullable: true },
      { table: 'login_attempts', column: 'last_attempt_at', dataType: 'timestamp with time zone' },
    ]);
  });

  it('failed_count 기본값이 0 이다', async () => {
    const res = await pool.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name='login_attempts' AND column_name='failed_count'`,
    );
    expect(String((res.rows[0] as { column_default: string }).column_default)).toMatch(/0/);
  });

  it('email 인덱스 존재', async () => {
    expect(await indexExists(pool, 'idx_login_attempts_email')).toBe(true);
  });

  it('멱등성 — 재적용 시 에러 없음', async () => {
    await expect(applySql(pool, readMigration('003_login_attempts.sql'))).resolves.toBeUndefined();
  });
});
