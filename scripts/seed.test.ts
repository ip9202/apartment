/**
 * scripts/seed.ts 테스트 — 데모 계정 시딩 (TDD RED 단계).
 *
 * REQ-AUTH-INT-004: 데모 계정 생성 (RESIDENT 1명, ADMIN 1명)
 *           - resident@aitteulak.com / test1234
 *           - admin@aitteulak.com / test1234
 *           - building/unit 연결
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Pool } from 'pg';
import { runSeed } from './seed';
import { comparePassword } from '../src/lib/auth';

// Test database setup
const TEST_DB_URL = process.env.DATABASE_URL || '';

describe('runSeed - 데모 계정 시딩', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL });
  });

  it('데모 계정이 생성되어야 한다', async () => {
    // Given: 시드 실행
    await runSeed(pool);

    // When: 데모 계정 조회
    const result = await pool.query(`
      SELECT u.id, u.email, u.password_hash, u.status, u.unit_id,
             r.code AS role
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.email IN ($1, $2)
    `, ['resident@aitteulak.com', 'admin@aitteulak.com']);

    // Then: 2개의 데모 계정이 존재해야 한다
    expect(result.rows.length).toBeGreaterThanOrEqual(2);

    const residentAccount = result.rows.find((row) => row.email === 'resident@aitteulak.com');
    const adminAccount = result.rows.find((row) => row.email === 'admin@aitteulak.com');

    // And: RESIDENT 계정 검증
    expect(residentAccount).toBeDefined();
    expect(residentAccount?.role).toBe('RESIDENT');
    expect(residentAccount?.status).toBe('ACTIVE');
    expect(residentAccount?.unit_id).not.toBeNull();
    expect(await comparePassword('test1234', residentAccount?.password_hash || '')).toBe(true);

    // And: ADMIN 계정 검증
    expect(adminAccount).toBeDefined();
    expect(adminAccount?.role).toBe('ADMIN');
    expect(adminAccount?.status).toBe('ACTIVE');
    expect(adminAccount?.unit_id).not.toBeNull();
    expect(await comparePassword('test1234', adminAccount?.password_hash || '')).toBe(true);
  });

  it('데모 계정이 building/unit에 할당되어야 한다', async () => {
    // Given: 시드 실행
    await runSeed(pool);

    // When: 데모 계정의 building/unit 조회
    const result = await pool.query(`
      SELECT u.email, b.name AS building_name, un.unit_number
      FROM users u
      JOIN units un ON un.id = u.unit_id
      JOIN buildings b ON b.id = un.building_id
      WHERE u.email IN ($1, $2)
    `, ['resident@aitteulak.com', 'admin@aitteulak.com']);

    // Then: 데모 계정에 building/unit이 할당되어야 한다
    expect(result.rows.length).toBeGreaterThanOrEqual(2);

    const residentAssignment = result.rows.find((row) => row.email === 'resident@aitteulak.com');
    const adminAssignment = result.rows.find((row) => row.email === 'admin@aitteulak.com');

    // And: building/unit이 존재해야 한다
    expect(residentAssignment?.building_name).toBeDefined();
    expect(residentAssignment?.unit_number).toBeDefined();
    expect(adminAssignment?.building_name).toBeDefined();
    expect(adminAssignment?.unit_number).toBeDefined();
  });
});
