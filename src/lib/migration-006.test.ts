/**
 * 마이그레이션 006 — notices + notice_categories (SPEC-NOTICE-001 M6)
 *
 * REQ-NOTICE-017 / REQ-NOTICE-018 / AC-NOTICE-001 / AC-NOTICE-002
 *
 * notice_categories: 4종 고정 시드(일반/긴급/주차/시설).
 * notices: ERD 준거 스키마 + 인덱스 + FK.
 *
 * 멱등성(REQ-NOTICE-017 구현 계약): migration 006 재실행 시
 *   - CREATE TABLE IF NOT EXISTS 로 테이블 재생성 에러 없음
 *   - name UNIQUE + ON CONFLICT (name) DO NOTHING 으로 시드 중복 삽입 없음
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestPool,
  dropAllAuthTables,
  applySql,
  readMigration,
  assertColumnsExist,
  indexExists,
} from './migration-test-helpers';

// @MX:NOTE: [AUTO] NOTICE 소유 — notice_categories 는 4종 고정 시드 (SPEC-NOTICE-001 M6)
const pool = createTestPool();

beforeAll(async () => {
  // helper 는 NOTICE 테이블을 모르므로 로컬 DROP 먼저 (역의존성 순: notices → notice_categories)
  await pool.query('DROP TABLE IF EXISTS notices CASCADE');
  await pool.query('DROP TABLE IF EXISTS notice_categories CASCADE');
  // AUTH 도메인 테이블 정리 후 001→006 순차 적용
  await dropAllAuthTables(pool);
  await applySql(pool, readMigration('001_init_users_buildings_units_roles.sql'));
  await applySql(pool, readMigration('002_revoked_refresh_tokens.sql'));
  await applySql(pool, readMigration('003_login_attempts.sql'));
  await applySql(pool, readMigration('004_suggestions_minimal.sql'));
  await applySql(pool, readMigration('005_managed_building_unify.sql'));
  await applySql(pool, readMigration('006_notices.sql'));
});

afterAll(async () => {
  await pool.end();
});

describe('마이그레이션 006 — notice_categories 시드 (SPEC-NOTICE-001 M6, REQ-NOTICE-017)', () => {
  // AC-NOTICE-001: 4종 카테고리 시드 존재
  it('notice_categories 4종 시드 행이 존재한다 (일반/긴급/주차/시설)', async () => {
    const res = await pool.query<{ name: string }>(
      'SELECT name FROM notice_categories ORDER BY sort_order',
    );
    expect(res.rowCount).toBe(4);
    const names = res.rows.map((r) => r.name);
    expect(names).toEqual(['일반', '긴급', '주차', '시설']);
  });

  it('notice_categories 컬럼이 올바른 타입으로 존재한다', async () => {
    await assertColumnsExist(pool, [
      { table: 'notice_categories', column: 'id', dataType: 'uuid', isNullable: false },
      { table: 'notice_categories', column: 'name', dataType: 'character varying', isNullable: false },
      { table: 'notice_categories', column: 'sort_order', dataType: 'integer', isNullable: false },
    ]);
  });
});

describe('마이그레이션 006 — notices 테이블 스키마 (SPEC-NOTICE-001 M6, REQ-NOTICE-018)', () => {
  // AC-NOTICE-002: notices 컬럼 스키마
  it('notices 컬럼이 ERD 준거 타입으로 존재한다', async () => {
    await assertColumnsExist(pool, [
      { table: 'notices', column: 'id', dataType: 'uuid', isNullable: false },
      { table: 'notices', column: 'author_id', dataType: 'uuid', isNullable: false },
      { table: 'notices', column: 'category_id', dataType: 'uuid', isNullable: false },
      { table: 'notices', column: 'title', dataType: 'character varying', isNullable: false },
      { table: 'notices', column: 'content', dataType: 'text', isNullable: false },
      { table: 'notices', column: 'is_pinned', dataType: 'boolean', isNullable: false },
      { table: 'notices', column: 'created_at', dataType: 'timestamp with time zone' },
      { table: 'notices', column: 'updated_at', dataType: 'timestamp with time zone' },
    ]);
  });

  it('notices.category_id 인덱스 존재', async () => {
    expect(await indexExists(pool, 'idx_notices_category_id')).toBe(true);
  });

  it('notices.is_pinned 인덱스 존재 (NOTICE-06 전방 호환)', async () => {
    expect(await indexExists(pool, 'idx_notices_is_pinned')).toBe(true);
  });

  it('notices.created_at DESC 인덱스 존재 (최신순 정렬, REQ-NOTICE-011)', async () => {
    expect(await indexExists(pool, 'idx_notices_created_at_desc')).toBe(true);
  });

  it('notices.author_id → users FK 존재', async () => {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema='public' AND tc.table_name='notices'
         AND tc.constraint_type='FOREIGN KEY'
         AND kcu.column_name='author_id' AND ccu.table_name='users'`,
    );
    expect((res.rowCount ?? 0) > 0).toBe(true);
  });

  it('notices.category_id → notice_categories FK 존재', async () => {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema='public' AND tc.table_name='notices'
         AND tc.constraint_type='FOREIGN KEY'
         AND kcu.column_name='category_id' AND ccu.table_name='notice_categories'`,
    );
    expect((res.rowCount ?? 0) > 0).toBe(true);
  });

  it('is_pinned 기본값이 false 이다 (NOTICE-06 전방 호환, 디폴트 false)', async () => {
    const res = await pool.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name='notices' AND column_name='is_pinned'`,
    );
    expect(String((res.rows[0] as { column_default: string }).column_default)).toMatch(/false/);
  });
});

describe('마이그레이션 006 — 멱등성 (REQ-NOTICE-017 구현 계약)', () => {
  it('재적용 시 에러 없음', async () => {
    await expect(
      applySql(pool, readMigration('006_notices.sql')),
    ).resolves.toBeUndefined();
  });

  it('재적용 후에도 notice_categories 시드는 4행으로 중복 없음 (name UNIQUE + ON CONFLICT)', async () => {
    await applySql(pool, readMigration('006_notices.sql'));
    const res = await pool.query('SELECT COUNT(*)::int AS n FROM notice_categories');
    expect((res.rows[0] as { n: number }).n).toBe(4);
  });
});
