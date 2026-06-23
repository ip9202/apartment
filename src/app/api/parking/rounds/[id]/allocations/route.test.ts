/**
 * GET /api/parking/rounds/[id]/allocations 통합 테스트 — 결과 열람 (SPEC-PARKING-001 M6, PARKING-06).
 *
 * REQ-PK-023 (역할별 가시성), REQ-PK-024 (미공개 정보은닉), REQ-PK-025 (미인증 401).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from '../../../../../../lib/db';
import { runSeed } from '../../../../../../../scripts/seed';
import { createTestPool, applySql, readMigration } from '../../../../../../lib/migration-test-helpers';
import { hashPassword, signAccessToken } from '../../../../../../lib/auth';

const BASE = (id: string) => `http://localhost/api/parking/rounds/${id}/allocations`;
const PASSWORD = 'password123';

async function ensureSchemaAndSeed(): Promise<void> {
  const setupPool = createTestPool();
  try {
    for (const file of [
      '001_init_users_buildings_units_roles.sql',
      '002_revoked_refresh_tokens.sql',
      '003_login_attempts.sql',
      '004_suggestions_minimal.sql',
      '005_managed_building_unify.sql',
      '006_notices.sql',
      '007_suggestions_expand.sql',
      '008_parking.sql',
    ]) {
      await applySql(setupPool, readMigration(file));
    }
    await runSeed(setupPool);
  } finally {
    await setupPool.end();
  }
}

async function getUnitId(b: string, n: string): Promise<string> {
  const res = await query<{ id: string }>(
    `SELECT u.id FROM units u JOIN buildings b ON b.id = u.building_id WHERE b.name=$1 AND u.unit_number=$2`,
    [b, n],
  );
  return res.rows[0].id;
}

async function getBuildingId(name: string): Promise<string> {
  const res = await query<{ id: string }>('SELECT id FROM buildings WHERE name=$1', [name]);
  return res.rows[0].id;
}

async function seedUser(
  email: string,
  opts: { role?: string; unitId?: string | null; managedBuildingId?: string | null } = {},
): Promise<{ id: string; role: string }> {
  const res = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id, managed_building_id)
     VALUES ($1, $2, (SELECT id FROM roles WHERE code=$3), 'email', 'ACTIVE', now(), $4, $5)
     RETURNING id`,
    [
      email,
      hashPassword(PASSWORD),
      opts.role ?? 'RESIDENT',
      opts.unitId ?? null,
      opts.managedBuildingId ?? null,
    ],
  );
  return { id: res.rows[0].id, role: opts.role ?? 'RESIDENT' };
}

async function createRound(status: string, isPublished: boolean): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO parking_rounds (name, application_start, application_end, slot_pool, seed_value, status, is_published)
     VALUES ('열람 테스트', now(), now() + interval '7 days',
             $1::jsonb, 'YWxsb2Mtc2VlZA==', $2, $3)
     RETURNING id`,
    [JSON.stringify(Array.from({ length: 38 }, (_, i) => `P${i + 1}`)), status, isPublished],
  );
  return res.rows[0].id;
}

async function addAssignment(roundId: string, unitId: string, slot: string): Promise<void> {
  await query(
    `INSERT INTO parking_assignments (round_id, unit_id, assigned_slot, assignment_source)
     VALUES ($1, $2, $3, 'AUTO')`,
    [roundId, unitId, slot],
  );
}

function req(roundId: string, at: string | null): Request {
  const headers: Record<string, string> = {};
  if (at) headers.authorization = `Bearer ${at}`;
  return new Request(BASE(roundId), { method: 'GET', headers });
}

async function getAllocations(roundId: string, at: string | null): Promise<Response> {
  const mod = await import('./route');
  return mod.GET(req(roundId, at), { params: Promise.resolve({ id: roundId }) });
}

beforeAll(async () => {
  await ensureSchemaAndSeed();
});
beforeEach(async () => {
  await query('DELETE FROM parking_assignments');
  await query('DELETE FROM parking_rounds');
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
});
afterAll(async () => {
  await query('DELETE FROM parking_assignments');
  await query('DELETE FROM parking_rounds');
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
  await pool.end();
});

describe('GET /allocations — 공개 회차 역할별 가시성 (REQ-PK-023-a)', () => {
  it('RESIDENT 는 본인 unit 만 (공개)', async () => {
    const myUnit = await getUnitId('A동', '101');
    const otherUnit = await getUnitId('A동', '102');
    const me = await seedUser('r1@example.com', { role: 'RESIDENT', unitId: myUnit });
    const at = signAccessToken({ sub: me.id, role: 'RESIDENT', verified: true });
    const roundId = await createRound('PUBLISHED', true);
    await addAssignment(roundId, myUnit, 'P1');
    await addAssignment(roundId, otherUnit, 'P2');

    const res = await getAllocations(roundId, at);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { unit_id: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].unit_id).toBe(myUnit);
  });

  it('REP 는 담당동 building 만 (공개)', async () => {
    const bA = await getBuildingId('A동');
    const aUnit = await getUnitId('A동', '101');
    const bUnit = await getUnitId('B동', '201');
    const rep = await seedUser('rep@example.com', { role: 'REP', managedBuildingId: bA });
    const at = signAccessToken({ sub: rep.id, role: 'REP', verified: true });
    const roundId = await createRound('PUBLISHED', true);
    await addAssignment(roundId, aUnit, 'P1');
    await addAssignment(roundId, bUnit, 'P2');

    const res = await getAllocations(roundId, at);
    const body = (await res.json()) as { data: { unit_id: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].unit_id).toBe(aUnit);
  });

  it('ADMIN 은 전체 (공개)', async () => {
    const u1 = await getUnitId('A동', '101');
    const u2 = await getUnitId('B동', '201');
    const admin = await seedUser('admin@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const roundId = await createRound('PUBLISHED', true);
    await addAssignment(roundId, u1, 'P1');
    await addAssignment(roundId, u2, 'P2');

    const res = await getAllocations(roundId, at);
    const body = (await res.json()) as { data: { unit_id: string }[] };
    expect(body.data).toHaveLength(2);
  });

  it('CHAIR 는 전체 (공개)', async () => {
    const u1 = await getUnitId('A동', '101');
    const chair = await seedUser('chair@example.com', { role: 'CHAIR' });
    const at = signAccessToken({ sub: chair.id, role: 'CHAIR', verified: true });
    const roundId = await createRound('PUBLISHED', true);
    await addAssignment(roundId, u1, 'P1');

    const res = await getAllocations(roundId, at);
    const body = (await res.json()) as { data: { unit_id: string }[] };
    expect(body.data).toHaveLength(1);
  });
});

describe('GET /allocations — 미공개 회차 정보은닉 (REQ-PK-023-b, REQ-PK-024)', () => {
  it('RESIDENT 미공개 시 본인만 (타인 존재 누출 금지)', async () => {
    const myUnit = await getUnitId('A동', '101');
    const otherUnit = await getUnitId('A동', '102');
    const me = await seedUser('r2@example.com', { role: 'RESIDENT', unitId: myUnit });
    const at = signAccessToken({ sub: me.id, role: 'RESIDENT', verified: true });
    const roundId = await createRound('ASSIGNED', false);
    await addAssignment(roundId, myUnit, 'P1');
    await addAssignment(roundId, otherUnit, 'P2');

    const res = await getAllocations(roundId, at);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it('RESIDENT 미공개 + 본인 assignment 없으면 빈 목록 (정보은닉, 200)', async () => {
    const otherUnit = await getUnitId('A동', '101');
    const myUnit = await getUnitId('A동', '102');
    const me = await seedUser('r3@example.com', { role: 'RESIDENT', unitId: myUnit });
    const at = signAccessToken({ sub: me.id, role: 'RESIDENT', verified: true });
    const roundId = await createRound('ASSIGNED', false);
    await addAssignment(roundId, otherUnit, 'P1');

    const res = await getAllocations(roundId, at);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('REP 미공개 시 본인만 (담당동 特权 없음)', async () => {
    const bA = await getBuildingId('A동');
    const myUnit = await getUnitId('A동', '101');
    const otherAUnit = await getUnitId('A동', '102');
    const rep = await seedUser('rep2@example.com', { role: 'REP', managedBuildingId: bA, unitId: myUnit });
    const at = signAccessToken({ sub: rep.id, role: 'REP', verified: true });
    const roundId = await createRound('ASSIGNED', false);
    await addAssignment(roundId, myUnit, 'P1');
    await addAssignment(roundId, otherAUnit, 'P2');

    const res = await getAllocations(roundId, at);
    const body = (await res.json()) as { data: { unit_id: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].unit_id).toBe(myUnit);
  });

  it('ADMIN 미공개 시 전체 (관리 목적)', async () => {
    const u1 = await getUnitId('A동', '101');
    const u2 = await getUnitId('A동', '102');
    const admin = await seedUser('admin2@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const roundId = await createRound('ASSIGNED', false);
    await addAssignment(roundId, u1, 'P1');
    await addAssignment(roundId, u2, 'P2');

    const res = await getAllocations(roundId, at);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(2);
  });
});

describe('GET /allocations — 인증/엣지', () => {
  it('REQ-PK-025: 미인증 → 401', async () => {
    const roundId = await createRound('PUBLISHED', true);
    const res = await getAllocations(roundId, null);
    expect(res.status).toBe(401);
  });

  it('미존재 회차 → 404', async () => {
    const admin = await seedUser('admin3@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await getAllocations('00000000-0000-0000-0000-000000000000', at);
    expect(res.status).toBe(404);
  });

  it('배정 0건 회차 → 200 + 빈 목록', async () => {
    const admin = await seedUser('admin4@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const roundId = await createRound('OPEN', false);
    const res = await getAllocations(roundId, at);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});
