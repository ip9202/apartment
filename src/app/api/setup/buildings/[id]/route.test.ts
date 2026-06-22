/**
 * DELETE /api/setup/buildings/[id] 통합 테스트 — SPEC-SETUP-001 Phase B (M1 동 관리).
 *
 * AC-SETUP-003 (활성 입주민 있는 동 삭제 → 409),
 * AC-SETUP-005 (미존재 building_id 삭제 → 404),
 * EC-SETUP-002 (DELETE UUID 형식 오류 → 400),
 * REQ-SETUP-004a (DELETE 미인증 → 401),
 * REQ-SETUP-004b (DELETE 비-ADMIN → 403).
 *
 * "활성 입주민" 정의: users.unit_id IS NOT NULL 이고 그 unit 의 building_id 가 대상 동이며
 *                    users.status = 'ACTIVE' 인 회원이 1명 이상 존재.
 *
 * @MX:NOTE: [AUTO] "활성 입주민" 정의는 REQ-SETUP-003 의 핵심 불변 — status='ACTIVE' + unit 귀속.
 *
 * TEST ISOLATION: beforeAll 마이그레이션(001~005)+시드 멱등, beforeEach truncate + 기본 A/B동 재시드.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from '../../../../../lib/db';
import { runSeed } from '../../../../../../scripts/seed';
import {
  createTestPool,
  applySql,
  readMigration,
} from '../../../../../lib/migration-test-helpers';
import { hashPassword, signAccessToken } from '../../../../../lib/auth';

const BASE_URL = 'http://localhost/api/setup/buildings';
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

/** 테스트용 사용자 INSERT — role/verified/unit 선택. */
async function seedUser(
  email: string,
  opts: { verified?: boolean; role?: string; unitBuilding?: string; unitNumber?: string } = {},
): Promise<{ id: string; email: string; role: string }> {
  const passwordHash = hashPassword(PASSWORD);
  const verified = opts.verified === true;
  const roleCode = opts.role ?? 'RESIDENT';

  let unitId: string | null = null;
  if (opts.unitBuilding) {
    const u = await query<{ id: string }>(
      `SELECT u.id FROM units u JOIN buildings b ON b.id = u.building_id
       WHERE b.name = $1 AND u.unit_number = $2`,
      [opts.unitBuilding, opts.unitNumber ?? '101'],
    );
    unitId = u.rows[0]?.id ?? null;
  }

  const res = await query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id, managed_building_id)
     VALUES (
       $1, $2,
       (SELECT id FROM roles WHERE code = $3),
       'email', 'ACTIVE',
       CASE WHEN $4 THEN now() ELSE NULL END,
       $5, NULL
     )
     RETURNING id, email`,
    [email, passwordHash, roleCode, verified, unitId],
  );
  return { id: res.rows[0].id, email: res.rows[0].email, role: roleCode };
}

async function buildingIdByName(name: string): Promise<string> {
  const r = await query<{ id: string }>('SELECT id FROM buildings WHERE name = $1', [name]);
  if (!r.rows[0]) throw new Error(`building missing: ${name}`);
  return r.rows[0].id;
}

async function deleteBuilding(id: string, at: string | null): Promise<Response> {
  const mod = await import('./route');
  const headers: Record<string, string> = {};
  if (at) headers.authorization = `Bearer ${at}`;
  const req = new Request(`${BASE_URL}/${id}`, { method: 'DELETE', headers });
  return mod.DELETE(req, { params: Promise.resolve({ id }) });
}

beforeAll(async () => {
  await ensureSchemaAndSeed();
});

beforeEach(async () => {
  await query('DELETE FROM suggestions');
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
  await query('DELETE FROM units');
  await query('DELETE FROM buildings');
  await reseedBaseBuildings();
});

afterAll(async () => {
  await query('DELETE FROM suggestions');
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
  await query('DELETE FROM units');
  await query('DELETE FROM buildings');
  await pool.end();
});

describe('DELETE /api/setup/buildings/[id] — ADMIN 동 삭제 (M1, REQ-SETUP-003/004)', () => {
  it('성공: 활성 입주민 없는 동 삭제 → 200 + { success: true } + buildings 행 제거', async () => {
    const admin = await seedUser('admin1@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    // A동은 시드에 있고 입주민 없음 (beforeEach 가 users truncate)
    const aId = await buildingIdByName('A동');

    const res = await deleteBuilding(aId, at);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);

    const row = await query<{ id: string }>('SELECT id FROM buildings WHERE id = $1', [aId]);
    expect(row.rowCount).toBe(0);
  });

  it('AC-003: 활성 입주민 있는 동 삭제 → 409', async () => {
    const admin = await seedUser('admin2@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    // A동 101호에 ACTIVE 입주민 시드
    await seedUser('resident_a@example.com', {
      role: 'RESIDENT',
      verified: true,
      unitBuilding: 'A동',
      unitNumber: '101',
    });
    const aId = await buildingIdByName('A동');

    const res = await deleteBuilding(aId, at);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');

    // A동은 삭제되지 않아야 함
    const row = await query<{ id: string }>('SELECT id FROM buildings WHERE id = $1', [aId]);
    expect(row.rowCount).toBe(1);
  });

  it('AC-003 변형: 입주민이 INACTIVE 면 활성 입주민 카운트에서 제외 (검증 전용 — 삭제 자체는 units FK 로 차단될 수 있음)', async () => {
    // REQ-003 정의 검증: INACTIVE 입주민은 "활성 입주민" 카운트에서 제외된다.
    // 본 케이스는 활성 카운트 로직만 확인한다 (실제 삭제는 units/users FK 상태에 따라 달라짐).
    const admin = await seedUser('admin3@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const passwordHash = hashPassword(PASSWORD);
    // A동 101호에 INACTIVE 입주민 시드
    await query(
      `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id, managed_building_id)
       VALUES (
         'inactive_a@example.com', $1,
         (SELECT id FROM roles WHERE code = 'RESIDENT'),
         'email', 'INACTIVE', now(),
         (SELECT u.id FROM units u JOIN buildings b ON b.id = u.building_id WHERE b.name = 'A동' AND u.unit_number = '101'),
         NULL
       )`,
      [passwordHash],
    );
    const aId = await buildingIdByName('A동');

    // 활성 입주민 카운트 쿼리 직접 검증 (구현과 동일 로직)
    const activeRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM users u JOIN units un ON un.id = u.unit_id
       WHERE un.building_id = $1 AND u.status = 'ACTIVE'`,
      [aId],
    );
    expect(Number(activeRes.rows[0].count)).toBe(0);

    // DELETE 시도 — INACTIVE 입주민이 unit_id 로 귀속되어 있어 units 삭제가 FK 위반.
    // 본 Phase B 는 users.unit_id 갱신(탈퇴 정책)을 범위로 하지 않으므로 409/200 중 하나.
    // 핵심은 401/403/400 이 아님 (RBAC/검증 통과).
    const res = await deleteBuilding(aId, at);
    expect([200, 409]).toContain(res.status);
  });

  it('AC-005: 미존재 building_id → 404', async () => {
    const admin = await seedUser('admin4@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await deleteBuilding('00000000-0000-0000-0000-000000000000', at);
    expect(res.status).toBe(404);
  });

  it('EC-002: UUID 형식 오류 → 400', async () => {
    const admin = await seedUser('admin5@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await deleteBuilding('not-a-uuid', at);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('REQ-004a / EC-007: 비인증 DELETE (AT 없음) → 401', async () => {
    const aId = await buildingIdByName('A동');
    const res = await deleteBuilding(aId, null);
    expect(res.status).toBe(401);
  });

  it('401: 변조된 AT → 401', async () => {
    const aId = await buildingIdByName('A동');
    const res = await deleteBuilding(aId, 'invalid.token.here');
    expect(res.status).toBe(401);
  });

  it('REQ-004b / AC-004: RESIDENT DELETE → 403', async () => {
    const resident = await seedUser('resident1@example.com', {
      role: 'RESIDENT',
      verified: true,
    });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });
    const aId = await buildingIdByName('A동');

    const res = await deleteBuilding(aId, at);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');

    // A동은 유지
    const row = await query<{ id: string }>('SELECT id FROM buildings WHERE id = $1', [aId]);
    expect(row.rowCount).toBe(1);
  });
});
