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
  await dropAllAuthTables(pool);
  await applySql(pool, readMigration('001_init_users_buildings_units_roles.sql'));
});

afterAll(async () => {
  await pool.end();
});

describe('마이그레이션 001 — buildings', () => {
  it('테이블이 존재한다', async () => {
    expect(await tableExists(pool, 'buildings')).toBe(true);
  });

  it('필수 컬럼이 올바른 타입으로 존재한다', async () => {
    await assertColumnsExist(pool, [
      { table: 'buildings', column: 'id', dataType: 'uuid', isNullable: false },
      { table: 'buildings', column: 'name', dataType: 'character varying', isNullable: false },
      { table: 'buildings', column: 'created_at', dataType: 'timestamp with time zone' },
    ]);
  });

  it('id 기본값이 gen_random_uuid() 이다', async () => {
    const res = await pool.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name='buildings' AND column_name='id'`,
    );
    expect(String((res.rows[0] as { column_default: string }).column_default)).toContain('gen_random_uuid');
  });

  it('name UNIQUE 제약이 존재한다', async () => {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints
       WHERE table_name='buildings' AND constraint_type='UNIQUE'`,
    );
    expect((res.rowCount ?? 0)).toBeGreaterThan(0);
  });
});

describe('마이그레이션 001 — units', () => {
  it('테이블이 존재한다', async () => {
    expect(await tableExists(pool, 'units')).toBe(true);
  });

  it('필수 컬럼이 존재한다', async () => {
    await assertColumnsExist(pool, [
      { table: 'units', column: 'id', dataType: 'uuid', isNullable: false },
      { table: 'units', column: 'building_id', dataType: 'uuid', isNullable: false },
      { table: 'units', column: 'unit_number', dataType: 'character varying', isNullable: false },
    ]);
  });

  it('building_id → buildings.id FK 가 존재한다', async () => {
    expect(await foreignKeyExists(pool, 'units_building_id_fkey')).toBe(true);
  });

  it('(building_id, unit_number) UNIQUE 제약이 존재한다', async () => {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints
       WHERE table_name='units' AND constraint_type='UNIQUE'`,
    );
    expect((res.rowCount ?? 0)).toBeGreaterThan(0);
  });
});

describe('마이그레이션 001 — roles', () => {
  it('테이블이 존재한다', async () => {
    expect(await tableExists(pool, 'roles')).toBe(true);
  });

  it('필수 컬럼이 존재한다', async () => {
    await assertColumnsExist(pool, [
      { table: 'roles', column: 'id', dataType: 'uuid', isNullable: false },
      { table: 'roles', column: 'code', dataType: 'character varying', isNullable: false },
      { table: 'roles', column: 'name', dataType: 'character varying', isNullable: false },
      { table: 'roles', column: 'sort_order', dataType: 'integer' },
    ]);
  });

  it('code UNIQUE 제약이 존재한다', async () => {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints
       WHERE table_name='roles' AND constraint_type='UNIQUE'`,
    );
    expect((res.rowCount ?? 0)).toBeGreaterThan(0);
  });
});

describe('마이그레이션 001 — users (AUTH 핵심 테이블)', () => {
  it('테이블이 존재한다', async () => {
    expect(await tableExists(pool, 'users')).toBe(true);
  });

  it('필수 컬럼이 올바른 타입으로 존재한다', async () => {
    await assertColumnsExist(pool, [
      { table: 'users', column: 'id', dataType: 'uuid', isNullable: false },
      { table: 'users', column: 'email', dataType: 'character varying', isNullable: false },
      { table: 'users', column: 'password_hash', dataType: 'character varying', isNullable: true },
      { table: 'users', column: 'provider', dataType: 'character varying' },
      { table: 'users', column: 'provider_id', dataType: 'character varying', isNullable: true },
      { table: 'users', column: 'role_id', dataType: 'uuid', isNullable: false },
      { table: 'users', column: 'unit_id', dataType: 'uuid', isNullable: true },
      { table: 'users', column: 'managed_building_id', dataType: 'uuid', isNullable: true },
      { table: 'users', column: 'status', dataType: 'character varying' },
      { table: 'users', column: 'verified_at', dataType: 'timestamp with time zone', isNullable: true },
      { table: 'users', column: 'created_at', dataType: 'timestamp with time zone' },
      { table: 'users', column: 'updated_at', dataType: 'timestamp with time zone' },
    ]);
  });

  it('email UNIQUE 제약이 존재한다', async () => {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints
       WHERE table_name='users' AND constraint_type='UNIQUE'`,
    );
    expect((res.rowCount ?? 0)).toBeGreaterThan(0);
  });

  it('role_id → roles.id FK 가 존재한다', async () => {
    expect(await foreignKeyExists(pool, 'users_role_id_fkey')).toBe(true);
  });

  it('unit_id → units.id FK 가 존재한다', async () => {
    expect(await foreignKeyExists(pool, 'users_unit_id_fkey')).toBe(true);
  });

  it('users.managed_building_id → buildings.id FK 가 존재한다 (MAJOR-2, REP 위임용)', async () => {
    // @MX:NOTE: [AUTO] users.managed_building_id 는 SETUP SPEC 소유 후보 — AUTH 추가 컬럼, REP 동대표 권한 위임 기반
    expect(await foreignKeyExists(pool, 'users_managed_building_id_fkey')).toBe(true);
  });

  it('provider 기본값이 email 이다', async () => {
    const res = await pool.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name='users' AND column_name='provider'`,
    );
    expect(String((res.rows[0] as { column_default: string }).column_default)).toContain('email');
  });

  it('status 기본값이 ACTIVE 이다', async () => {
    const res = await pool.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name='users' AND column_name='status'`,
    );
    expect(String((res.rows[0] as { column_default: string }).column_default)).toContain('ACTIVE');
  });
});

describe('마이그레이션 001 — 인덱스', () => {
  it('users(email) 인덱스 존재', async () => {
    // UNIQUE 제약이 자동 인덱스를 만들지만 명시적 인덱스도 허용
    const res = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE tablename='users' AND indexname LIKE '%email%'`,
    );
    expect((res.rowCount ?? 0)).toBeGreaterThan(0);
  });

  it('users(unit_id) 인덱스 존재', async () => {
    expect(await indexExists(pool, 'idx_users_unit_id')).toBe(true);
  });

  it('users(role_id) 인덱스 존재', async () => {
    expect(await indexExists(pool, 'idx_users_role_id')).toBe(true);
  });
});

describe('마이그레이션 001 — 멱등성 (IF NOT EXISTS)', () => {
  it('동일 SQL 재적용 시 에러 없이 통과한다', async () => {
    await expect(applySql(pool, readMigration('001_init_users_buildings_units_roles.sql'))).resolves.toBeUndefined();
  });
});
