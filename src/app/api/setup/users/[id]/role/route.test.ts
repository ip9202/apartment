/**
 * PUT /api/setup/users/[id]/role 통합 테스트 — SPEC-SETUP-001 Phase D (M3 직책 부여/회수).
 *
 * AC-SETUP-010 (RESIDENT→REP 부여 + managed_building_id 갱신 200),
 * AC-SETUP-011 (회장 부여 시 기존 회장 원자 회수),
 * AC-SETUP-012 (REP 부여 managed_building_id 누락 → 422),
 * AC-SETUP-013 (CHAIR 의 ADMIN 부여 → 403),
 * AC-SETUP-014 (직책 회수 → RESIDENT, managed_building_id NULL),
 * AC-SETUP-015a (미인증 → 401),
 * AC-SETUP-015b (비-ADMIN/비-CHAIR → 403),
 * EC-SETUP-004 (회장 부여 동시성 — 단일성 보장),
 * EC-SETUP-005 (CHAIR 의 REP 부여 허용).
 *
 * 요청 본문(SPEC-SETUP-001 REQ-009): { role: <code>, managed_building_id?: <uuid> }.
 * 응답 200: { success: true, data: { id, role, managed_building_id } }.
 *
 * TEST ISOLATION: beforeAll 마이그레이션(001~005)+시드 멱등, beforeEach truncate + 기본 A/B동 재시드.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from '../../../../../../lib/db';
import { runSeed } from '../../../../../../../scripts/seed';
import {
  createTestPool,
  applySql,
  readMigration,
} from '../../../../../../lib/migration-test-helpers';
import { hashPassword, signAccessToken } from '../../../../../../lib/auth';

const BASE_URL = 'http://localhost/api/setup/users';
const PASSWORD = 'password123';

/** 마이그레이션 001~005 + 시드 멱등 보장. */
async function ensureSchemaAndSeed(): Promise<void> {
  const setupPool = createTestPool();
  try {
    for (const file of [
      '001_init_users_buildings_units_roles.sql',
      '002_revoked_refresh_tokens.sql',
      '003_login_attempts.sql',
      '004_suggestions_minimal.sql',
      '005_managed_building_unify.sql',
    ]) {
      await applySql(setupPool, readMigration(file));
    }
    await runSeed(setupPool);
  } finally {
    await setupPool.end();
  }
}

async function reseedBaseBuildings(): Promise<void> {
  await runSeed(pool);
}

/** 테스트용 사용자 INSERT — role 선택. */
async function seedUser(
  email: string,
  opts: { role?: string; managedBuildingId?: string | null } = {},
): Promise<{ id: string; email: string; role: string }> {
  const passwordHash = hashPassword(PASSWORD);
  const roleCode = opts.role ?? 'RESIDENT';
  const mb = opts.managedBuildingId ?? null;

  const res = await query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id, managed_building_id)
     VALUES (
       $1, $2,
       (SELECT id FROM roles WHERE code = $3),
       'email', 'ACTIVE', now(),
       NULL, $4
     )
     RETURNING id, email`,
    [email, passwordHash, roleCode, mb],
  );
  return { id: res.rows[0].id, email: res.rows[0].email, role: roleCode };
}

async function buildingIdByName(name: string): Promise<string> {
  const r = await query<{ id: string }>('SELECT id FROM buildings WHERE name = $1', [name]);
  if (!r.rows[0]) throw new Error(`building missing: ${name}`);
  return r.rows[0].id;
}

/** 사용자의 현재 role_code + managed_building_id 조회. */
async function fetchUserRole(userId: string): Promise<{ role: string; managed_building_id: string | null }> {
  const r = await query<{ role: string; managed_building_id: string | null }>(
    `SELECT r.code AS role, u.managed_building_id
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [userId],
  );
  if (!r.rows[0]) throw new Error(`user missing: ${userId}`);
  return r.rows[0];
}

/** 현재 CHAIR 역할 사용자 수 조회. */
async function countChairs(): Promise<number> {
  const r = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.code = 'CHAIR' AND u.status = 'ACTIVE'`,
  );
  return Number(r.rows[0]?.count ?? 0);
}

/** PUT /api/setup/users/[id]/role 호출 헬퍼. */
async function putRole(
  targetUserId: string,
  body: unknown,
  at: string | null,
): Promise<Response> {
  const mod = await import('./route');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (at) headers.authorization = `Bearer ${at}`;
  const req = new Request(`${BASE_URL}/${targetUserId}/role`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  return mod.PUT(req, { params: Promise.resolve({ id: targetUserId }) });
}

beforeAll(async () => {
  await ensureSchemaAndSeed();
});

beforeEach(async () => {
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
  await query('DELETE FROM units');
  await query('DELETE FROM buildings');
  await reseedBaseBuildings();
});

afterAll(async () => {
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
  await query('DELETE FROM units');
  await query('DELETE FROM buildings');
  await pool.end();
});

describe('PUT /api/setup/users/[id]/role — 직책 부여/회수 (M3, REQ-SETUP-009~013)', () => {
  it('AC-010: ADMIN 이 RESIDENT→REP 부여 시 users.role_id 와 managed_building_id 갱신 + 200', async () => {
    const admin = await seedUser('admin@test.com', { role: 'ADMIN' });
    const target = await seedUser('target@test.com', { role: 'RESIDENT' });
    const buildingA = await buildingIdByName('A동');

    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await putRole(target.id, { role: 'REP', managed_building_id: buildingA }, at);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: { id: target.id, role: 'REP', managed_building_id: buildingA },
    });

    const after = await fetchUserRole(target.id);
    expect(after.role).toBe('REP');
    expect(after.managed_building_id).toBe(buildingA);
  });

  it('AC-011: 회장 부여 시 기존 회장 원자 회수 (이전 CHAIR → RESIDENT, managed_building_id NULL)', async () => {
    const admin = await seedUser('admin@test.com', { role: 'ADMIN' });
    const buildingA = await buildingIdByName('A동');
    const oldChair = await seedUser('old-chair@test.com', {
      role: 'CHAIR',
      managedBuildingId: buildingA,
    });
    const newChair = await seedUser('new-chair@test.com', { role: 'RESIDENT' });

    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await putRole(newChair.id, { role: 'CHAIR' }, at);

    expect(res.status).toBe(200);

    const oldAfter = await fetchUserRole(oldChair.id);
    expect(oldAfter.role).toBe('RESIDENT');
    expect(oldAfter.managed_building_id).toBeNull();

    const newAfter = await fetchUserRole(newChair.id);
    expect(newAfter.role).toBe('CHAIR');

    expect(await countChairs()).toBe(1);
  });

  it('AC-012: REP 부여 시 managed_building_id 누락 → 422 (users 미변경)', async () => {
    const admin = await seedUser('admin@test.com', { role: 'ADMIN' });
    const target = await seedUser('target@test.com', { role: 'RESIDENT' });

    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await putRole(target.id, { role: 'REP' }, at);

    expect(res.status).toBe(422);
    const after = await fetchUserRole(target.id);
    expect(after.role).toBe('RESIDENT');
  });

  it('AC-013: CHAIR 호출자가 ADMIN 부여 시도 → 403 (users 미변경)', async () => {
    const buildingA = await buildingIdByName('A동');
    const chair = await seedUser('chair@test.com', {
      role: 'CHAIR',
      managedBuildingId: buildingA,
    });
    const target = await seedUser('target@test.com', { role: 'RESIDENT' });

    const at = signAccessToken({ sub: chair.id, role: 'CHAIR', verified: true });
    const res = await putRole(target.id, { role: 'ADMIN' }, at);

    expect(res.status).toBe(403);
    const after = await fetchUserRole(target.id);
    expect(after.role).toBe('RESIDENT');
  });

  it('AC-014: REP 회수 → RESIDENT, managed_building_id NULL + 200', async () => {
    const admin = await seedUser('admin@test.com', { role: 'ADMIN' });
    const buildingA = await buildingIdByName('A동');
    const target = await seedUser('target@test.com', {
      role: 'REP',
      managedBuildingId: buildingA,
    });

    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await putRole(target.id, { role: 'RESIDENT' }, at);

    expect(res.status).toBe(200);
    const after = await fetchUserRole(target.id);
    expect(after.role).toBe('RESIDENT');
    expect(after.managed_building_id).toBeNull();
  });

  it('AC-015a: 미인증 → 401', async () => {
    const target = await seedUser('target@test.com', { role: 'RESIDENT' });

    const res = await putRole(target.id, { role: 'AUDITOR' }, null);

    expect(res.status).toBe(401);
  });

  it('AC-015b: REP 호출자(비-ADMIN/비-CHAIR) → 403', async () => {
    const buildingA = await buildingIdByName('A동');
    const rep = await seedUser('rep@test.com', {
      role: 'REP',
      managedBuildingId: buildingA,
    });
    const target = await seedUser('target@test.com', { role: 'RESIDENT' });

    const at = signAccessToken({ sub: rep.id, role: 'REP', verified: true });
    const res = await putRole(target.id, { role: 'AUDITOR' }, at);

    expect(res.status).toBe(403);
  });

  it('EC-004: 회장 부여 동시성 — 두 요청 동시 실행 후 CHAIR 정확히 1명', async () => {
    const admin = await seedUser('admin@test.com', { role: 'ADMIN' });
    const targetA = await seedUser('a@test.com', { role: 'RESIDENT' });
    const targetB = await seedUser('b@test.com', { role: 'RESIDENT' });

    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    // 동일 커넥션 풀에서의 Promise.all — 직렬화되더라도 post-state 불변(CHAIR 1명)이 핵심.
    const [resA, resB] = await Promise.all([
      putRole(targetA.id, { role: 'CHAIR' }, at),
      putRole(targetB.id, { role: 'CHAIR' }, at),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(await countChairs()).toBe(1);
  });

  it('EC-005: CHAIR 호출자의 REP 부여는 허용 → 200', async () => {
    const buildingA = await buildingIdByName('A동');
    const chair = await seedUser('chair@test.com', {
      role: 'CHAIR',
      managedBuildingId: buildingA,
    });
    const target = await seedUser('target@test.com', { role: 'RESIDENT' });

    const at = signAccessToken({ sub: chair.id, role: 'CHAIR', verified: true });
    const res = await putRole(target.id, { role: 'REP', managed_building_id: buildingA }, at);

    expect(res.status).toBe(200);
    const after = await fetchUserRole(target.id);
    expect(after.role).toBe('REP');
    expect(after.managed_building_id).toBe(buildingA);
  });

  it('EC-005b: CHAIR 호출자의 AUDITOR 부여도 허용 → 200', async () => {
    const buildingA = await buildingIdByName('A동');
    const chair = await seedUser('chair@test.com', {
      role: 'CHAIR',
      managedBuildingId: buildingA,
    });
    const target = await seedUser('target@test.com', { role: 'RESIDENT' });

    const at = signAccessToken({ sub: chair.id, role: 'CHAIR', verified: true });
    const res = await putRole(target.id, { role: 'AUDITOR' }, at);

    expect(res.status).toBe(200);
    const after = await fetchUserRole(target.id);
    expect(after.role).toBe('AUDITOR');
  });

  it('REQ-007a: path UUID 형식 오류 → 400', async () => {
    const admin = await seedUser('admin@test.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await putRole('not-a-uuid', { role: 'AUDITOR' }, at);

    expect(res.status).toBe(400);
  });

  it('REQ-011 추가: REP 부여 시 managed_building_id 가 잘못된 UUID → 422', async () => {
    const admin = await seedUser('admin@test.com', { role: 'ADMIN' });
    const target = await seedUser('target@test.com', { role: 'RESIDENT' });

    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await putRole(target.id, { role: 'REP', managed_building_id: 'not-a-uuid' }, at);

    expect(res.status).toBe(422);
  });

  it('REQ-009: 미존재 target user_id → 404', async () => {
    const admin = await seedUser('admin@test.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const phantom = '00000000-0000-4000-8000-000000000000';

    const res = await putRole(phantom, { role: 'AUDITOR' }, at);

    expect(res.status).toBe(404);
  });

  it('REQ-009: REP 부여 시 managed_building_id 가 미존재 building → 422', async () => {
    const admin = await seedUser('admin@test.com', { role: 'ADMIN' });
    const target = await seedUser('target@test.com', { role: 'RESIDENT' });

    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await putRole(
      target.id,
      { role: 'REP', managed_building_id: '00000000-0000-4000-8000-000000000000' },
      at,
    );

    expect(res.status).toBe(422);
  });

  it('REQ-009: 잘못된 role 코드 → 422', async () => {
    const admin = await seedUser('admin@test.com', { role: 'ADMIN' });
    const target = await seedUser('target@test.com', { role: 'RESIDENT' });

    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await putRole(target.id, { role: 'SUPERUSER' }, at);

    expect(res.status).toBe(422);
  });
});
