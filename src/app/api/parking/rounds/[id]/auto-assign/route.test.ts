/**
 * POST /api/parking/rounds/[id]/auto-assign 통합 테스트 — 자동배정 (SPEC-PARKING-001 M4).
 *
 * REQ-PK-015 (ADMIN 실행 → 200, OPEN→ASSIGNED), REQ-PK-016 (OPEN 외 409),
 * REQ-PK-017 (동시 실행 직렬화), REQ-PK-019 (비-ADMIN 403).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from '../../../../../../lib/db';
import { runSeed } from '../../../../../../../scripts/seed';
import { createTestPool, applySql, readMigration } from '../../../../../../lib/migration-test-helpers';
import { hashPassword, signAccessToken } from '../../../../../../lib/auth';

const BASE = (id: string) => `http://localhost/api/parking/rounds/${id}/auto-assign`;
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

async function seedUser(
  email: string,
  opts: { role?: string; unitId?: string | null } = {},
): Promise<{ id: string; role: string }> {
  const res = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id)
     VALUES ($1, $2, (SELECT id FROM roles WHERE code = $3), 'email', 'ACTIVE', now(), $4)
     RETURNING id`,
    [email, hashPassword(PASSWORD), opts.role ?? 'RESIDENT', opts.unitId ?? null],
  );
  return { id: res.rows[0].id, role: opts.role ?? 'RESIDENT' };
}

async function createOpenRound(): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO parking_rounds (name, application_start, application_end, slot_pool, seed_value)
     VALUES ('자동배정 테스트', now(), now() + interval '7 days',
             $1::jsonb, 'YXV0by1hc3NpZ24tc2VlZA==')
     RETURNING id`,
    [JSON.stringify(Array.from({ length: 38 }, (_, i) => `P${i + 1}`))],
  );
  return res.rows[0].id;
}

function req(roundId: string, at: string | null): Request {
  const headers: Record<string, string> = {};
  if (at) headers.authorization = `Bearer ${at}`;
  return new Request(BASE(roundId), { method: 'POST', headers });
}

async function autoAssign(roundId: string, at: string | null): Promise<Response> {
  const mod = await import('./route');
  return mod.POST(req(roundId, at), { params: Promise.resolve({ id: roundId }) });
}

beforeAll(async () => {
  await ensureSchemaAndSeed();
});
beforeEach(async () => {
  await query('DELETE FROM parking_assignments');
  await query('DELETE FROM parking_rounds');
  await query('UPDATE users SET unit_id = NULL');
  await query('DELETE FROM users');
});
afterAll(async () => {
  await query('DELETE FROM parking_assignments');
  await query('DELETE FROM parking_rounds');
  await query('UPDATE users SET unit_id = NULL');
  await query('DELETE FROM users');
  await pool.end();
});

describe('POST /auto-assign — 자동배정 실행 (M4)', () => {
  it('REQ-PK-015: ADMIN 실행 → 200 + 미참여 세대 AUTO 배정 + status ASSIGNED 전이', async () => {
    // 일부 세대가 미리 추첨(DRAW) 한 상황
    const drawnUnit = await getUnitId('A동', '101');
    const drawnUser = await seedUser('d1@example.com', { role: 'RESIDENT', unitId: drawnUnit });
    const drawAt = signAccessToken({ sub: drawnUser.id, role: 'RESIDENT', verified: true });
    const roundId = await createOpenRound();
    const drawMod = await import('../draw/route');
    await drawMod.POST(
      new Request(`http://localhost/api/parking/rounds/${roundId}/draw`, {
        method: 'POST',
        headers: { authorization: `Bearer ${drawAt}` },
      }),
      { params: Promise.resolve({ id: roundId }) },
    );

    const admin = await seedUser('admin@example.com', { role: 'ADMIN' });
    const adminAt = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await autoAssign(roundId, adminAt);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { assigned_count: number; unassigned_count: number };
    };
    expect(body.success).toBe(true);
    // 38 세대 - 1 이미 추첨 = 37 미참여 → AUTO 배정
    expect(body.data.assigned_count).toBe(37);
    expect(body.data.unassigned_count).toBe(0);

    // status ASSIGNED 전이
    const row = await query<{ status: string }>('SELECT status FROM parking_rounds WHERE id=$1', [roundId]);
    expect(row.rows[0].status).toBe('ASSIGNED');

    // 기존 DRAW 보존 + 나머지 AUTO
    const autoCount = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM parking_assignments WHERE round_id=$1 AND assignment_source='AUTO'`,
      [roundId],
    );
    expect(autoCount.rows[0].n).toBe(37);
    const drawCount = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM parking_assignments WHERE round_id=$1 AND assignment_source='DRAW'`,
      [roundId],
    );
    expect(drawCount.rows[0].n).toBe(1);
  });

  it('REQ-PK-016: OPEN 외 상태 → 409', async () => {
    const admin = await seedUser('admin2@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const roundId = await createOpenRound();
    await query(`UPDATE parking_rounds SET status='ASSIGNED' WHERE id=$1`, [roundId]);
    const res = await autoAssign(roundId, at);
    expect(res.status).toBe(409);
  });

  it('REQ-PK-017: 이미 ASSIGNED 회차 재실행 → 409 (직렬화/단일 전이)', async () => {
    const admin = await seedUser('admin3@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const roundId = await createOpenRound();
    const r1 = await autoAssign(roundId, at);
    expect(r1.status).toBe(200);
    const r2 = await autoAssign(roundId, at);
    expect(r2.status).toBe(409);
  });

  it('REQ-PK-019: RESIDENT 실행 → 403', async () => {
    const u = await getUnitId('A동', '101');
    const resident = await seedUser('r@example.com', { role: 'RESIDENT', unitId: u });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });
    const roundId = await createOpenRound();
    const res = await autoAssign(roundId, at);
    expect(res.status).toBe(403);
  });

  it('REQ-PK-019: CHAIR 실행 → 403 (ADMIN 전용)', async () => {
    const chair = await seedUser('chair@example.com', { role: 'CHAIR' });
    const at = signAccessToken({ sub: chair.id, role: 'CHAIR', verified: true });
    const roundId = await createOpenRound();
    const res = await autoAssign(roundId, at);
    expect(res.status).toBe(403);
  });

  it('미인증 → 401', async () => {
    const roundId = await createOpenRound();
    const res = await autoAssign(roundId, null);
    expect(res.status).toBe(401);
  });

  it('미존재 회차 → 404', async () => {
    const admin = await seedUser('admin4@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await autoAssign('00000000-0000-0000-0000-000000000000', at);
    expect(res.status).toBe(404);
  });
});
