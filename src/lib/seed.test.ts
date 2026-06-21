import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import {
  createTestPool,
  dropAllAuthTables,
  applySql,
  readMigration,
} from './migration-test-helpers';
import { runSeed } from '../../scripts/seed';

const pool = createTestPool();

beforeAll(async () => {
  // 시드 테스트는 전체 스키마 + 시드 적용 상태에서 검증
  await dropAllAuthTables(pool);
  await applySql(pool, readMigration('001_init_users_buildings_units_roles.sql'));
  await applySql(pool, readMigration('002_revoked_refresh_tokens.sql'));
  await applySql(pool, readMigration('003_login_attempts.sql'));
  await runSeed(pool);
});

afterAll(async () => {
  await pool.end();
});

describe('scripts/seed.ts — 초기 데이터 (SETUP SPEC 픽스처)', () => {
  it('건물 2개(A동, B동) 가 존재한다', async () => {
    const res = await pool.query(`SELECT name FROM buildings ORDER BY name`);
    const names = res.rows.map((r) => (r as { name: string }).name);
    expect(names).toEqual(['A동', 'B동']);
  });

  it('호수 총 38개 (A동 26 + B동 12) 가 존재한다', async () => {
    const res = await pool.query(`SELECT COUNT(*)::int AS n FROM units`);
    expect((res.rows[0] as { n: number }).n).toBe(38);
  });

  it('A동 호수 26개 (4층 제외) 가 존재한다', async () => {
    const res = await pool.query(
      `SELECT u.unit_number FROM units u
       JOIN buildings b ON b.id = u.building_id
       WHERE b.name = 'A동'
       ORDER BY u.unit_number`,
    );
    const nums = res.rows.map((r) => (r as { unit_number: string }).unit_number);
    expect(nums.length).toBe(26);
    // 4층(4xx) 없음 단정
    expect(nums.every((n) => !n.startsWith('4'))).toBe(true);
    // 대표 호수 포함 단정
    expect(nums).toContain('101');
    expect(nums).toContain('804');
  });

  it('B동 호수 12개 (1층 제외) 가 존재한다', async () => {
    const res = await pool.query(
      `SELECT u.unit_number FROM units u
       JOIN buildings b ON b.id = u.building_id
       WHERE b.name = 'B동'
       ORDER BY u.unit_number`,
    );
    const nums = res.rows.map((r) => (r as { unit_number: string }).unit_number);
    expect(nums.length).toBe(12);
    expect(nums.every((n) => !n.startsWith('1'))).toBe(true);
    expect(nums).toContain('201');
    expect(nums).toContain('802');
  });

  it('역할 5개(ADMIN/CHAIR/REP/AUDITOR/RESIDENT) 가 존재한다', async () => {
    const res = await pool.query(`SELECT code FROM roles ORDER BY code`);
    const codes = res.rows.map((r) => (r as { code: string }).code);
    expect(codes).toEqual(['ADMIN', 'AUDITOR', 'CHAIR', 'REP', 'RESIDENT']);
  });

  it('역할 표시명이 올바르다', async () => {
    const res = await pool.query(`SELECT code, name FROM roles ORDER BY code`);
    const map = Object.fromEntries(res.rows.map((r) => [r.code, r.name]));
    expect(map.ADMIN).toBe('관리사무소');
    expect(map.CHAIR).toBe('회장');
    expect(map.REP).toBe('동대표');
    expect(map.AUDITOR).toBe('감사');
    expect(map.RESIDENT).toBe('일반 입주민');
  });

  it('멱등성 — 시드 재실행 시 행 수 변화 없음 (ON CONFLICT DO NOTHING)', async () => {
    await runSeed(pool);
    const buildings = await pool.query(`SELECT COUNT(*)::int AS n FROM buildings`);
    const units = await pool.query(`SELECT COUNT(*)::int AS n FROM units`);
    const roles = await pool.query(`SELECT COUNT(*)::int AS n FROM roles`);
    expect((buildings.rows[0] as { n: number }).n).toBe(2);
    expect((units.rows[0] as { n: number }).n).toBe(38);
    expect((roles.rows[0] as { n: number }).n).toBe(5);
  });
});
