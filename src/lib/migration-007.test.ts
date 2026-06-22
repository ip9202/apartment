/**
 * 마이그레이션 007 — suggestion_categories 시드 + suggestions ALTER + suggestion_replies (SPEC-SUGGEST-001 M8b).
 *
 * REQ-SUGGEST-038 (suggestion_categories 시드 4종),
 * REQ-SUGGEST-039 (suggestions ALTER 컬럼 7종 + 인덱스),
 * REQ-SUGGEST-040 (suggestion_replies 테이블),
 * AC-SUGGEST-046~050 (스키마/시드/FK),
 * AC-SUGGEST-003 (기존 004 데이터 보존).
 *
 * @MX:ANCHOR: [AUTO] SUGGEST 스키마 불변 지점 — migration 007 스키마/시드/FK/ALTER 호환성 회귀 방어
 * @MX:REASON:  본 테스트는 migration 007 ALTER 가 AUTH deactivate UPDATE 와 충돌하지 않음을
 *             단정하는 핵심 회귀 방어선(R1, 최고 위험). 회귀 시 ADR-005 호수 귀속·익명화 정책 붕괴.
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
import type { Pool } from 'pg';

const pool = createTestPool();

beforeAll(async () => {
  // helper 는 SUGGEST 신규 테이블을 모르므로 로컬 DROP (역의존성 순: replies → suggestions → categories)
  await pool.query('DROP TABLE IF EXISTS suggestion_replies CASCADE');
  await pool.query('DROP TABLE IF EXISTS suggestion_categories CASCADE');
  // AUTH 도메인 테이블 정리 (suggestions 포함) 후 001→007 순차 적용
  await dropAllAuthTables(pool);
  // NOTICE 테이블도 006 적용을 위해 정리
  await pool.query('DROP TABLE IF EXISTS notices CASCADE');
  await pool.query('DROP TABLE IF EXISTS notice_categories CASCADE');
  await applySql(pool, readMigration('001_init_users_buildings_units_roles.sql'));
  await applySql(pool, readMigration('002_revoked_refresh_tokens.sql'));
  await applySql(pool, readMigration('003_login_attempts.sql'));
  await applySql(pool, readMigration('004_suggestions_minimal.sql'));
  await applySql(pool, readMigration('005_managed_building_unify.sql'));
  await applySql(pool, readMigration('006_notices.sql'));
  await applySql(pool, readMigration('007_suggestions_expand.sql'));
});

afterAll(async () => {
  await pool.end();
});

describe('마이그레이션 007 — suggestion_categories 시드 (SPEC-SUGGEST-001 M8b, REQ-SUGGEST-038)', () => {
  it('suggestion_categories 4종 시드 행이 존재한다 (시설/주차/소음/기타)', async () => {
    const res = await pool.query<{ name: string }>(
      'SELECT name FROM suggestion_categories ORDER BY sort_order',
    );
    expect(res.rowCount).toBe(4);
    const names = res.rows.map((r) => r.name);
    expect(names).toEqual(['시설', '주차', '소음', '기타']);
  });

  it('suggestion_categories 컬럼이 올바른 타입으로 존재한다', async () => {
    await assertColumnsExist(pool, [
      { table: 'suggestion_categories', column: 'id', dataType: 'uuid', isNullable: false },
      { table: 'suggestion_categories', column: 'name', dataType: 'character varying', isNullable: false },
      { table: 'suggestion_categories', column: 'sort_order', dataType: 'integer', isNullable: false },
    ]);
  });
});

describe('마이그레이션 007 — suggestions ALTER 확장 (SPEC-SUGGEST-001 M8b, REQ-SUGGEST-039)', () => {
  it('suggestions 컬럼 13종 존재 (004 기존 6종 + 007 추가 7종)', async () => {
    await assertColumnsExist(pool, [
      // 004 기존 (AUTH 소유, 보존)
      { table: 'suggestions', column: 'id', dataType: 'uuid', isNullable: false },
      { table: 'suggestions', column: 'author_id', dataType: 'uuid' },
      { table: 'suggestions', column: 'author_label', dataType: 'character varying', isNullable: false },
      { table: 'suggestions', column: 'archived', dataType: 'boolean', isNullable: false },
      { table: 'suggestions', column: 'unit_id', dataType: 'uuid', isNullable: false },
      { table: 'suggestions', column: 'created_at', dataType: 'timestamp with time zone' },
      // 007 추가 (SUGGEST 소유)
      { table: 'suggestions', column: 'category_id', dataType: 'uuid' },
      { table: 'suggestions', column: 'title', dataType: 'character varying', isNullable: false },
      { table: 'suggestions', column: 'content', dataType: 'text', isNullable: false },
      { table: 'suggestions', column: 'is_public', dataType: 'boolean', isNullable: false },
      { table: 'suggestions', column: 'status', dataType: 'character varying', isNullable: false },
      { table: 'suggestions', column: 'updated_at', dataType: 'timestamp with time zone', isNullable: false },
      { table: 'suggestions', column: 'archived_at', dataType: 'timestamp with time zone' },
    ]);
  });

  it('007 신규 인덱스 존재 (category_id, is_public, status, archived)', async () => {
    expect(await indexExists(pool, 'idx_suggestions_category_id')).toBe(true);
    expect(await indexExists(pool, 'idx_suggestions_is_public')).toBe(true);
    expect(await indexExists(pool, 'idx_suggestions_status')).toBe(true);
    expect(await indexExists(pool, 'idx_suggestions_archived')).toBe(true);
  });

  it('004 기존 인덱스 보존 (author_id, unit_id)', async () => {
    expect(await indexExists(pool, 'idx_suggestions_author_id')).toBe(true);
    expect(await indexExists(pool, 'idx_suggestions_unit_id')).toBe(true);
  });

  it('suggestions.category_id → suggestion_categories FK 존재', async () => {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema='public' AND tc.table_name='suggestions'
         AND tc.constraint_type='FOREIGN KEY'
         AND kcu.column_name='category_id' AND ccu.table_name='suggestion_categories'`,
    );
    expect((res.rowCount ?? 0) > 0).toBe(true);
  });
});

describe('마이그레이션 007 — suggestion_replies 테이블 (SPEC-SUGGEST-001 M8b, REQ-SUGGEST-040)', () => {
  it('suggestion_replies 컬럼 6종 존재', async () => {
    await assertColumnsExist(pool, [
      { table: 'suggestion_replies', column: 'id', dataType: 'uuid', isNullable: false },
      { table: 'suggestion_replies', column: 'suggestion_id', dataType: 'uuid', isNullable: false },
      { table: 'suggestion_replies', column: 'author_id', dataType: 'uuid', isNullable: false },
      { table: 'suggestion_replies', column: 'content', dataType: 'text', isNullable: false },
      { table: 'suggestion_replies', column: 'created_at', dataType: 'timestamp with time zone' },
      { table: 'suggestion_replies', column: 'updated_at', dataType: 'timestamp with time zone' },
    ]);
  });

  it('suggestion_replies.suggestion_id 인덱스 존재', async () => {
    expect(await indexExists(pool, 'idx_suggestion_replies_suggestion_id')).toBe(true);
  });

  it('suggestion_replies.suggestion_id → suggestions FK 존재', async () => {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema='public' AND tc.table_name='suggestion_replies'
         AND tc.constraint_type='FOREIGN KEY'
         AND kcu.column_name='suggestion_id' AND ccu.table_name='suggestions'`,
    );
    expect((res.rowCount ?? 0) > 0).toBe(true);
  });

  it('suggestion_replies.author_id → users FK 존재', async () => {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema='public' AND tc.table_name='suggestion_replies'
         AND tc.constraint_type='FOREIGN KEY'
         AND kcu.column_name='author_id' AND ccu.table_name='users'`,
    );
    expect((res.rowCount ?? 0) > 0).toBe(true);
  });
});

describe('마이그레이션 007 — 기존 004 데이터 보존 (AC-SUGGEST-003, ALTER 호환성)', () => {
  // 본 describe 는 beforeAll 이 001→007 이미 적용한 상태를 사용한다.
  // 별도 격리 풀로 004 까지만 적용 → 데이터 INSERT → 005~007 추가 적용 → 보존 단정.
  let isoPool: Pool;

  beforeAll(async () => {
    isoPool = createTestPool();
    // 격리 정리: replies → suggestions → categories + AUTH + NOTICE
    await isoPool.query('DROP TABLE IF EXISTS suggestion_replies CASCADE');
    await isoPool.query('DROP TABLE IF EXISTS suggestion_categories CASCADE');
    await dropAllAuthTables(isoPool);
    await isoPool.query('DROP TABLE IF EXISTS notices CASCADE');
    await isoPool.query('DROP TABLE IF EXISTS notice_categories CASCADE');
    // 001~004 적용 (suggestions 최소 스키마)
    await applySql(isoPool, readMigration('001_init_users_buildings_units_roles.sql'));
    await applySql(isoPool, readMigration('002_revoked_refresh_tokens.sql'));
    await applySql(isoPool, readMigration('003_login_attempts.sql'));
    await applySql(isoPool, readMigration('004_suggestions_minimal.sql'));
  });

  afterAll(async () => {
    await isoPool.end();
  });

  it('004 데이터가 007 ALTER 후에도 기존 컬럼값 보존 + 신규 컬럼 디폴트값 적용', async () => {
    // 0. building + role 행 준비 (001 은 테이블만 생성, 행은 seed.ts 소관 — 테스트 격리 위해 직접 INSERT)
    await isoPool.query(`INSERT INTO buildings (name) VALUES ('A동') ON CONFLICT (name) DO NOTHING`);
    await isoPool.query(
      `INSERT INTO roles (code, name, sort_order) VALUES ('RESIDENT', '일반 입주민', 5) ON CONFLICT (code) DO NOTHING`,
    );
    // 1. user + unit 준비 (suggestions.unit_id NOT NULL, author_id FK)
    const unitRes = await isoPool.query<{ id: string }>(
      `INSERT INTO units (building_id, unit_number)
       SELECT b.id, '999' FROM buildings b WHERE b.name = 'A동'
       ON CONFLICT (building_id, unit_number) DO UPDATE SET unit_number = EXCLUDED.unit_number
       RETURNING id`,
    );
    const unitId = unitRes.rows[0].id;
    const userRes = await isoPool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id)
       VALUES ('preserve-test@example.com', 'x', (SELECT id FROM roles WHERE code='RESIDENT'),
               'email', 'ACTIVE', now(), $1)
       RETURNING id`,
      [unitId],
    );
    const userId = userRes.rows[0].id;

    // 2. 004 스키마로 행 INSERT (title/content/is_public 없는 최소 행)
    const insRes = await isoPool.query<{ id: string }>(
      `INSERT INTO suggestions (author_id, author_label, unit_id)
       VALUES ($1, '입주민', $2) RETURNING id`,
      [userId, unitId],
    );
    const suggestionId = insRes.rows[0].id;

    // 3. 005~007 추가 적용 (ALTER)
    await applySql(isoPool, readMigration('005_managed_building_unify.sql'));
    await applySql(isoPool, readMigration('006_notices.sql'));
    await applySql(isoPool, readMigration('007_suggestions_expand.sql'));

    // 4. 행 잔존 + 기존 컬럼값 보존 + 신규 컬럼 디폴트
    const row = await isoPool.query<{
      id: string;
      author_id: string;
      author_label: string;
      archived: boolean;
      unit_id: string;
      created_at: string;
      category_id: string | null;
      title: string;
      content: string;
      is_public: boolean;
      status: string;
      archived_at: string | null;
    }>(
      `SELECT id, author_id, author_label, archived, unit_id, created_at,
              category_id, title, content, is_public, status, archived_at
       FROM suggestions WHERE id = $1`,
      [suggestionId],
    );
    expect(row.rowCount).toBe(1);
    const r = row.rows[0];
    // 기존 004 컬럼 보존
    expect(r.id).toBe(suggestionId);
    expect(r.author_id).toBe(userId);
    expect(r.author_label).toBe('입주민');
    expect(r.archived).toBe(false);
    expect(r.unit_id).toBe(unitId);
    expect(r.created_at).toBeTruthy();
    // 007 신규 컬럼 디폴트값
    expect(r.category_id).toBeNull();
    expect(r.title).toBe('');
    expect(r.content).toBe('');
    expect(r.is_public).toBe(false);
    expect(r.status).toBe('접수');
    expect(r.archived_at).toBeNull();
  });

  // @MX:WARN: [AUTO] R1 최고 위험 — AUTH deactivate UPDATE 호환성 단정
  // @MX:REASON:  AUTH deactivate route(deactivate/route.ts:131-136)가 007 ALTER 이후에도
  //             동일 UPDATE 로 정상 동작해야. UPDATE 가 신규 NOT NULL 컬럼(title/content/is_public/status)
  //             과 충돌하면 강제 탈퇴 트랜잭션이 실패하고 ADR-005 호수 귀속·익명화 정책이 깨진다.
  it('R1 CRITICAL: AUTH deactivate UPDATE 가 007 ALTER 후에도 정상 동작 (unit_id 보존, 신규 컬럼 간섭 없음)', async () => {
    // 본 테스트는 직전 '보존' 테스트가 007 까지 적용한 상태를 사용.
    // (격리 풀 내 004 행 + 007 ALTER 적용 완료)

    // 대상 author 로 새 행 INSERT (deactivate 대상)
    const unitRes = await isoPool.query<{ id: string }>(
      `SELECT id FROM units WHERE unit_number = '999' LIMIT 1`,
    );
    const unitId = unitRes.rows[0].id;
    const userRes = await isoPool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = 'preserve-test@example.com'`,
    );
    const userId = userRes.rows[0].id;
    const insRes = await isoPool.query<{ id: string }>(
      `INSERT INTO suggestions (author_id, author_label, unit_id)
       VALUES ($1, '입주민', $2) RETURNING id`,
      [userId, unitId],
    );
    const targetSuggestionId = insRes.rows[0].id;

    // AUTH deactivate route 와 동일한 UPDATE 실행 (deactivate/route.ts:131-136)
    await isoPool.query(
      `UPDATE suggestions
       SET author_id = NULL, author_label = '전 입주민', archived = true
       WHERE author_id = $1`,
      [userId],
    );

    // 단정: author_id NULL, author_label '전 입주민', archived true, unit_id 보존, 신규 컬럼 간섭 없음
    const row = await isoPool.query<{
      author_id: string | null;
      author_label: string;
      archived: boolean;
      unit_id: string;
      title: string;
      content: string;
      is_public: boolean;
      status: string;
    }>(
      `SELECT author_id, author_label, archived, unit_id, title, content, is_public, status
       FROM suggestions WHERE id = $1`,
      [targetSuggestionId],
    );
    expect(row.rowCount).toBe(1);
    const r = row.rows[0];
    expect(r.author_id).toBeNull();
    expect(r.author_label).toBe('전 입주민');
    expect(r.archived).toBe(true);
    // ADR-005: unit_id 영구 보존
    expect(r.unit_id).toBe(unitId);
    // 신규 컬럼 간섭 없음 (UPDATE 가 신규 컬럼 건드리지 않음)
    expect(r.title).toBe('');
    expect(r.content).toBe('');
    expect(r.is_public).toBe(false);
    expect(r.status).toBe('접수');
  });
});

describe('마이그레이션 007 — 멱등성 (REQ-SUGGEST-038 구현 계약)', () => {
  it('재적용 시 에러 없음 (ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT EXISTS)', async () => {
    await expect(
      applySql(pool, readMigration('007_suggestions_expand.sql')),
    ).resolves.toBeUndefined();
  });

  it('재적용 후에도 suggestion_categories 시드는 4행으로 중복 없음 (name UNIQUE + ON CONFLICT)', async () => {
    await applySql(pool, readMigration('007_suggestions_expand.sql'));
    const res = await pool.query('SELECT COUNT(*)::int AS n FROM suggestion_categories');
    expect((res.rows[0] as { n: number }).n).toBe(4);
  });
});
