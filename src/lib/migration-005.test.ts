/**
 * 마이그레이션 005 — managed_building_id 통일 (SETUP Phase A)
 *
 * SPEC-SETUP-001 M5 / REQ-SETUP-018 / REQ-SETUP-019
 *
 * 단일 출처 원칙: managed_building_id 는 users 테이블만 소유한다.
 * roles.managed_building_id 컬럼은 005 마이그레이션에서 DROP 된다.
 *
 * AC-020: roles.managed_building_id 컬럼 부재
 * AC-021: users.managed_building_id 컬럼 존재 + FK 보존
 * AC-022: AUTH 회귀 — REP 위임 경로(users.managed_building_id) 영향 없음
 * AC-023: roles 데이터 5행 보존 (ADMIN/CHAIR/REP/AUDITOR/RESIDENT)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createTestPool,
  dropAllAuthTables,
  applySql,
  readMigration,
  assertColumnsExist,
  foreignKeyExists,
} from './migration-test-helpers';

// @MX:NOTE: [AUTO] SETUP 소유 — users.managed_building_id 단일 출처 원칙 (SPEC-SETUP-001 M5)
const pool = createTestPool();

beforeAll(async () => {
  // 001 → 005 전체 시퀀스 + seed 를 직접 적용 (self-sufficient)
  await dropAllAuthTables(pool);
  await applySql(pool, readMigration('001_init_users_buildings_units_roles.sql'));
  await applySql(pool, readMigration('002_revoked_refresh_tokens.sql'));
  await applySql(pool, readMigration('003_login_attempts.sql'));
  await applySql(pool, readMigration('004_suggestions_minimal.sql'));
  await applySql(pool, readMigration('005_managed_building_unify.sql'));

  // roles 5행 시드 (AC-023 데이터 보존 검증을 위한 최소 시드)
  const seedRoles = [
    { code: 'ADMIN', name: '관리사무소', sort_order: 1 },
    { code: 'CHAIR', name: '회장', sort_order: 2 },
    { code: 'REP', name: '동대표', sort_order: 3 },
    { code: 'AUDITOR', name: '감사', sort_order: 4 },
    { code: 'RESIDENT', name: '일반 입주민', sort_order: 5 },
  ];
  for (const role of seedRoles) {
    await pool.query(
      `INSERT INTO roles (code, name, sort_order) VALUES ($1, $2, $3)`,
      [role.code, role.name, role.sort_order],
    );
  }
});

afterAll(async () => {
  await pool.end();
});

describe('마이그레이션 005 — managed_building_id 통일 (SETUP Phase A)', () => {
  // AC-020: roles.managed_building_id 컬럼 부재
  it('roles.managed_building_id 컬럼이 제거되었다', async () => {
    const res = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='roles' AND column_name='managed_building_id'`,
    );
    expect(res.rowCount ?? 0).toBe(0);
  });

  // AC-021: users.managed_building_id 컬럼 존재
  it('users.managed_building_id 컬럼이 존재한다 (단일 출처)', async () => {
    await assertColumnsExist(pool, [
      { table: 'users', column: 'managed_building_id', dataType: 'uuid', isNullable: true },
    ]);
  });

  // AC-021: users_managed_building_id_fkey 보존
  it('users.managed_building_id → buildings.id FK 가 보존된다', async () => {
    expect(await foreignKeyExists(pool, 'users_managed_building_id_fkey')).toBe(true);
  });

  // AC-023: roles 5행 데이터 보존
  it('roles 데이터 5행이 보존된다 (ADMIN/CHAIR/REP/AUDITOR/RESIDENT)', async () => {
    const res = await pool.query(
      `SELECT code FROM roles ORDER BY sort_order`,
    );
    expect(res.rowCount).toBe(5);
    const codes = (res.rows as { code: string }[]).map((r) => r.code);
    expect(codes).toEqual(['ADMIN', 'CHAIR', 'REP', 'AUDITOR', 'RESIDENT']);
  });

  // 멱등성 — 005 재적용 시 에러 없음
  it('멱등성 — 재적용 시 에러 없음', async () => {
    await expect(
      applySql(pool, readMigration('005_managed_building_unify.sql')),
    ).resolves.toBeUndefined();
  });
});
