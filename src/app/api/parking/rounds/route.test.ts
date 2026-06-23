/**
 * POST /api/parking/rounds 통합 테스트 — 회차 생성 (SPEC-PARKING-001 M1, PARKING-01).
 *
 * REQ-PK-001 (ADMIN/CHAIR 생성 → 201), REQ-PK-002 (기간 역전 422),
 * REQ-PK-003 (자리풀 부족 422), REQ-PK-004 (미인증 401), REQ-PK-005 (비권한 403).
 *
 * TEST ISOLATION: beforeAll 마이그레이션(001~008)+시드 멱등, beforeEach truncate.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from '../../../../lib/db';
import { runSeed } from '../../../../../scripts/seed';
import { createTestPool, applySql, readMigration } from '../../../../lib/migration-test-helpers';
import { hashPassword, signAccessToken } from '../../../../lib/auth';

const BASE_URL = 'http://localhost/api/parking/rounds';
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

async function getUnitId(buildingName: string, unitNumber: string): Promise<string> {
  const res = await query<{ id: string }>(
    `SELECT u.id FROM units u JOIN buildings b ON b.id = u.building_id
     WHERE b.name = $1 AND u.unit_number = $2`,
    [buildingName, unitNumber],
  );
  return res.rows[0].id;
}

async function getBuildingId(name: string): Promise<string> {
  const res = await query<{ id: string }>('SELECT id FROM buildings WHERE name = $1', [name]);
  return res.rows[0].id;
}

async function seedUser(
  email: string,
  opts: { role?: string; unitId?: string | null; managedBuildingId?: string | null } = {},
): Promise<{ id: string; role: string }> {
  const passwordHash = hashPassword(PASSWORD);
  const roleCode = opts.role ?? 'RESIDENT';
  const res = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id, managed_building_id)
     VALUES ($1, $2, (SELECT id FROM roles WHERE code = $3), 'email', 'ACTIVE', now(), $4, $5)
     RETURNING id`,
    [
      email,
      passwordHash,
      roleCode,
      opts.unitId !== undefined ? opts.unitId : null,
      opts.managedBuildingId !== undefined ? opts.managedBuildingId : null,
    ],
  );
  return { id: res.rows[0].id, role: roleCode };
}

function buildJsonRequest(body: unknown, at: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (at) headers.authorization = `Bearer ${at}`;
  return new Request(BASE_URL, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function postRound(body: unknown, at: string | null): Promise<Response> {
  const mod = await import('./route');
  return mod.POST(buildJsonRequest(body, at));
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

const VALID_BODY = {
  name: '2026년 1분기 주차 추첨',
  application_start: '2026-07-01T00:00:00Z',
  application_end: '2026-07-31T23:59:59Z',
  slot_pool: Array.from({ length: 38 }, (_, i) => `P${i + 1}`),
};

describe('POST /api/parking/rounds — 회차 생성 (M1)', () => {
  it('REQ-PK-001: ADMIN 생성 → 201 + DB 행 (status OPEN, is_published false, seed_value 존재)', async () => {
    const admin = await seedUser('admin@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await postRound(VALID_BODY, at);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        id: string;
        name: string;
        status: string;
        is_published: boolean;
        seed_value: string;
        slot_pool: string[];
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.name).toBe(VALID_BODY.name);
    expect(body.data.status).toBe('OPEN');
    expect(body.data.is_published).toBe(false);
    expect(body.data.seed_value).toBeTruthy();
    expect(body.data.slot_pool).toHaveLength(38);

    const row = await query<{ status: string; is_published: boolean; seed_value: string }>(
      'SELECT status, is_published, seed_value FROM parking_rounds WHERE id = $1',
      [body.data.id],
    );
    expect(row.rows[0].status).toBe('OPEN');
    expect(row.rows[0].is_published).toBe(false);
    expect(row.rows[0].seed_value).toBe(body.data.seed_value);
  });

  it('REQ-PK-001: CHAIR 도 생성 가능 → 201', async () => {
    const chair = await seedUser('chair@example.com', { role: 'CHAIR' });
    const at = signAccessToken({ sub: chair.id, role: 'CHAIR', verified: true });
    const res = await postRound(VALID_BODY, at);
    expect(res.status).toBe(201);
  });

  it('REQ-PK-004: 미인증 → 401', async () => {
    const res = await postRound(VALID_BODY, null);
    expect(res.status).toBe(401);
  });

  it('REQ-PK-005: RESIDENT 생성 → 403', async () => {
    const unitId = await getUnitId('A동', '101');
    const resident = await seedUser('r@example.com', { role: 'RESIDENT', unitId });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });
    const res = await postRound(VALID_BODY, at);
    expect(res.status).toBe(403);
  });

  it('REQ-PK-005: REP 생성 → 403', async () => {
    const bId = await getBuildingId('A동');
    const rep = await seedUser('rep@example.com', { role: 'REP', managedBuildingId: bId });
    const at = signAccessToken({ sub: rep.id, role: 'REP', verified: true });
    const res = await postRound(VALID_BODY, at);
    expect(res.status).toBe(403);
  });

  it('REQ-PK-002: application_start >= application_end → 422', async () => {
    const admin = await seedUser('admin2@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await postRound(
      {
        ...VALID_BODY,
        application_start: '2026-07-31T23:59:59Z',
        application_end: '2026-07-01T00:00:00Z',
      },
      at,
    );
    expect(res.status).toBe(422);
  });

  it('REQ-PK-003: 빈 slot_pool → 422', async () => {
    const admin = await seedUser('admin3@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await postRound({ ...VALID_BODY, slot_pool: [] }, at);
    expect(res.status).toBe(422);
  });

  it('REQ-PK-003: slot_pool < 세대수(38) → 422', async () => {
    const admin = await seedUser('admin4@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await postRound({ ...VALID_BODY, slot_pool: ['P1', 'P2'] }, at);
    expect(res.status).toBe(422);
  });

  it('필수 필드 누락(name) → 422', async () => {
    const admin = await seedUser('admin5@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const { name: _name, ...noName } = VALID_BODY;
    const res = await postRound(noName, at);
    expect(res.status).toBe(422);
  });

  it('name 100자 초과 → 422', async () => {
    const admin = await seedUser('admin6@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await postRound({ ...VALID_BODY, name: 'X'.repeat(101) }, at);
    expect(res.status).toBe(422);
  });
});
