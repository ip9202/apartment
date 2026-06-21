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
  // 001 + 004 순서 적용 (users/units FK 가 선행되어야 suggestions 가 생성됨)
  await dropAllAuthTables(pool);
  await applySql(pool, readMigration('001_init_users_buildings_units_roles.sql'));
  await applySql(pool, readMigration('004_suggestions_minimal.sql'));
});

afterAll(async () => {
  await pool.end();
});

describe('마이그레이션 004 — suggestions (AUTH 사이드이펙트용 최소 스키마)', () => {
  it('테이블이 존재한다', async () => {
    expect(await tableExists(pool, 'suggestions')).toBe(true);
  });

  it('필수 컬럼이 올바른 타입으로 존재한다', async () => {
    await assertColumnsExist(pool, [
      { table: 'suggestions', column: 'id', dataType: 'uuid', isNullable: false },
      { table: 'suggestions', column: 'author_id', dataType: 'uuid', isNullable: true },
      { table: 'suggestions', column: 'author_label', dataType: 'character varying', isNullable: false },
      { table: 'suggestions', column: 'archived', dataType: 'boolean', isNullable: false },
      { table: 'suggestions', column: 'unit_id', dataType: 'uuid', isNullable: false },
      { table: 'suggestions', column: 'created_at', dataType: 'timestamp with time zone' },
    ]);
  });

  it('author_label 기본값이 입주민 이다', async () => {
    const res = await pool.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name='suggestions' AND column_name='author_label'`,
    );
    expect(String((res.rows[0] as { column_default: string }).column_default)).toMatch(/입주민/);
  });

  it('archived 기본값이 false 이다', async () => {
    const res = await pool.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name='suggestions' AND column_name='archived'`,
    );
    expect(String((res.rows[0] as { column_default: string }).column_default)).toMatch(/false/);
  });

  it('author_id 인덱스 존재 (deactivate WHERE author_id 조회용)', async () => {
    expect(await indexExists(pool, 'idx_suggestions_author_id')).toBe(true);
  });

  it('unit_id 인덱스 존재 (ADR-005 호수 귀속 조회용)', async () => {
    expect(await indexExists(pool, 'idx_suggestions_unit_id')).toBe(true);
  });

  it('author_id → users 외래키 존재', async () => {
    // 외래키 존재 여부를 컬럼→참조테이블 기준으로 단정 (제약명 의존 X)
    const res = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema='public' AND tc.table_name='suggestions'
         AND tc.constraint_type='FOREIGN KEY'
         AND kcu.column_name='author_id' AND ccu.table_name='users'`,
    );
    expect((res.rowCount ?? 0) > 0).toBe(true);
  });

  it('unit_id → units 외래키 존재 (ADR-005 보존)', async () => {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema='public' AND tc.table_name='suggestions'
         AND tc.constraint_type='FOREIGN KEY'
         AND kcu.column_name='unit_id' AND ccu.table_name='units'`,
    );
    expect((res.rowCount ?? 0) > 0).toBe(true);
  });

  it('멱등성 — 재적용 시 에러 없음', async () => {
    await expect(applySql(pool, readMigration('004_suggestions_minimal.sql'))).resolves.toBeUndefined();
  });
});
