/**
 * 마이그레이션 008 — parking_rounds + parking_assignments (SPEC-PARKING-001 M5).
 *
 * REQ-PK-001 (parking_rounds 스키마), parking_assignments 스키마,
 * UNIQUE(round_id, unit_id) 제약, FK, 인덱스를 단정한다.
 *
 * @MX:ANCHOR: [AUTO] PARKING 스키마 불변 지점 — migration 008 스키마/제약/FK/인덱스 회귀 방어
 * @MX:REASON:  parking_rounds.seed_value 불변 + parking_assignments UNIQUE(round_id, unit_id) 는
 *             slot assignment 도메인 핵심 계약. 회귀 시 "세대당 1자리, 탈락자 없음" 정책 붕괴.
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
  // PARKING 신규 테이블 로컬 DROP (역의존성 순: assignments → rounds)
  await pool.query('DROP TABLE IF EXISTS parking_assignments CASCADE');
  await pool.query('DROP TABLE IF EXISTS parking_rounds CASCADE');
  // NOTICE + SUGGEST 테이블 정리
  await pool.query('DROP TABLE IF EXISTS suggestion_replies CASCADE');
  await pool.query('DROP TABLE IF EXISTS suggestion_categories CASCADE');
  await pool.query('DROP TABLE IF EXISTS notices CASCADE');
  await pool.query('DROP TABLE IF EXISTS notice_categories CASCADE');
  // AUTH 도메인 테이블 정리 후 001→008 순차 적용
  await dropAllAuthTables(pool);
  await applySql(pool, readMigration('001_init_users_buildings_units_roles.sql'));
  await applySql(pool, readMigration('002_revoked_refresh_tokens.sql'));
  await applySql(pool, readMigration('003_login_attempts.sql'));
  await applySql(pool, readMigration('004_suggestions_minimal.sql'));
  await applySql(pool, readMigration('005_managed_building_unify.sql'));
  await applySql(pool, readMigration('006_notices.sql'));
  await applySql(pool, readMigration('007_suggestions_expand.sql'));
  await applySql(pool, readMigration('008_parking.sql'));
});

afterAll(async () => {
  await pool.end();
});

describe('마이그레이션 008 — parking_rounds 테이블 (SPEC-PARKING-001, REQ-PK-001)', () => {
  it('parking_rounds 컬럼 9종 존재', async () => {
    await assertColumnsExist(pool, [
      { table: 'parking_rounds', column: 'id', dataType: 'uuid', isNullable: false },
      { table: 'parking_rounds', column: 'name', dataType: 'character varying', isNullable: false },
      { table: 'parking_rounds', column: 'application_start', dataType: 'timestamp with time zone', isNullable: false },
      { table: 'parking_rounds', column: 'application_end', dataType: 'timestamp with time zone', isNullable: false },
      { table: 'parking_rounds', column: 'slot_pool', dataType: 'jsonb', isNullable: false },
      { table: 'parking_rounds', column: 'seed_value', dataType: 'text', isNullable: false },
      { table: 'parking_rounds', column: 'status', dataType: 'character varying', isNullable: false },
      { table: 'parking_rounds', column: 'is_published', dataType: 'boolean', isNullable: false },
      { table: 'parking_rounds', column: 'created_at', dataType: 'timestamp with time zone', isNullable: false },
    ]);
  });

  it('parking_rounds.status 기본값 OPEN', async () => {
    const res = await pool.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='parking_rounds' AND column_name='status'`,
    );
    const def = (res.rows[0] as { column_default: string }).column_default;
    expect(def).toContain('OPEN');
  });

  it('parking_rounds.is_published 기본값 false', async () => {
    const res = await pool.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='parking_rounds' AND column_name='is_published'`,
    );
    const def = (res.rows[0] as { column_default: string }).column_default;
    expect(def).toContain('false');
  });

  it('parking_rounds.name 최대 100자 (varchar(100))', async () => {
    const res = await pool.query(
      `SELECT character_maximum_length FROM information_schema.columns
       WHERE table_schema='public' AND table_name='parking_rounds' AND column_name='name'`,
    );
    expect((res.rows[0] as { character_maximum_length: number }).character_maximum_length).toBe(100);
  });
});

describe('마이그레이션 008 — parking_assignments 테이블', () => {
  it('parking_assignments 컬럼 7종 존재', async () => {
    await assertColumnsExist(pool, [
      { table: 'parking_assignments', column: 'id', dataType: 'uuid', isNullable: false },
      { table: 'parking_assignments', column: 'round_id', dataType: 'uuid', isNullable: false },
      { table: 'parking_assignments', column: 'unit_id', dataType: 'uuid', isNullable: false },
      { table: 'parking_assignments', column: 'assigned_slot', dataType: 'text', isNullable: false },
      { table: 'parking_assignments', column: 'assignment_source', dataType: 'character varying', isNullable: false },
      { table: 'parking_assignments', column: 'drawn_at', dataType: 'timestamp with time zone', isNullable: true },
      { table: 'parking_assignments', column: 'drawn_by', dataType: 'uuid', isNullable: true },
    ]);
  });

  it('idx_parking_assignments_round 인덱스 존재', async () => {
    expect(await indexExists(pool, 'idx_parking_assignments_round')).toBe(true);
  });

  it('parking_assignments.round_id → parking_rounds FK 존재', async () => {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema='public' AND tc.table_name='parking_assignments'
         AND tc.constraint_type='FOREIGN KEY'
         AND kcu.column_name='round_id' AND ccu.table_name='parking_rounds'`,
    );
    expect((res.rowCount ?? 0) > 0).toBe(true);
  });

  it('parking_assignments.unit_id → units FK 존재', async () => {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema='public' AND tc.table_name='parking_assignments'
         AND tc.constraint_type='FOREIGN KEY'
         AND kcu.column_name='unit_id' AND ccu.table_name='units'`,
    );
    expect((res.rowCount ?? 0) > 0).toBe(true);
  });

  it('UNIQUE(round_id, unit_id) 제약 존재 — 세대당 1배정 불변', async () => {
    const res = await pool.query(
      `SELECT tc.constraint_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
       WHERE tc.table_schema='public' AND tc.table_name='parking_assignments'
         AND tc.constraint_type='UNIQUE'`,
    );
    const cols = res.rows.map((r) => (r as { column_name: string }).column_name).sort();
    // round_id, unit_id 둘 다 포함된 UNIQUE 제약이 존재해야 함
    expect(cols).toContain('round_id');
    expect(cols).toContain('unit_id');
  });

  it('UNIQUE(round_id, unit_id) 위반 시 에러 — 동일 세대 2배정 불가', async () => {
    // buildings + unit + round 준비
    await pool.query(`INSERT INTO buildings (name) VALUES ('A동') ON CONFLICT (name) DO NOTHING`);
    const unitRes = await pool.query<{ id: string }>(
      `INSERT INTO units (building_id, unit_number)
       SELECT b.id, 'PK-001' FROM buildings b WHERE b.name='A동'
       ON CONFLICT (building_id, unit_number) DO UPDATE SET unit_number = EXCLUDED.unit_number
       RETURNING id`,
    );
    const unitId = unitRes.rows[0].id;
    const roundRes = await pool.query<{ id: string }>(
      `INSERT INTO parking_rounds (name, application_start, application_end, slot_pool, seed_value)
       VALUES ('테스트회차', now(), now() + interval '1 day', '["A","B"]'::jsonb, 'c29tZXNlZWQ=')
       RETURNING id`,
    );
    const roundId = roundRes.rows[0].id;

    // 첫 INSERT 성공
    await pool.query(
      `INSERT INTO parking_assignments (round_id, unit_id, assigned_slot, assignment_source)
       VALUES ($1, $2, 'A', 'DRAW')`,
      [roundId, unitId],
    );
    // 동일 (round_id, unit_id) 두 번째 INSERT → UNIQUE 위반 에러
    await expect(
      pool.query(
        `INSERT INTO parking_assignments (round_id, unit_id, assigned_slot, assignment_source)
         VALUES ($1, $2, 'B', 'DRAW')`,
        [roundId, unitId],
      ),
    ).rejects.toThrow();

    // 정리
    await pool.query('DELETE FROM parking_assignments WHERE round_id = $1', [roundId]);
    await pool.query('DELETE FROM parking_rounds WHERE id = $1', [roundId]);
    await pool.query('DELETE FROM units WHERE unit_number = $1', ['PK-001']);
  });
});

describe('마이그레이션 008 — 멱등성', () => {
  it('재적용 시 에러 없음 (CREATE TABLE IF NOT EXISTS)', async () => {
    await expect(
      applySql(pool, readMigration('008_parking.sql')),
    ).resolves.toBeUndefined();
  });
});
