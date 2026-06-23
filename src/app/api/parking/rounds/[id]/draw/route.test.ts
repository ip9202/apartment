/**
 * POST/DELETE /api/parking/rounds/[id]/draw 통합 테스트 — 추첨/취소 (SPEC-PARKING-001 M2/M3).
 *
 * REQ-PK-006~014: 추첨(자리 확정) + 취소/반납.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from '../../../../../../lib/db';
import { runSeed } from '../../../../../../../scripts/seed';
import { createTestPool, applySql, readMigration } from '../../../../../../lib/migration-test-helpers';
import { hashPassword, signAccessToken } from '../../../../../../lib/auth';

const BASE = (id: string) => `http://localhost/api/parking/rounds/${id}/draw`;
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
     VALUES ('추첨 테스트', now(), now() + interval '7 days',
             $1::jsonb, 'dGVzdC1zZWVkLTE2Ynl0ZXM=')
     RETURNING id`,
    [JSON.stringify(Array.from({ length: 38 }, (_, i) => `P${i + 1}`))],
  );
  return res.rows[0].id;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

function req(method: string, roundId: string, at: string | null): Request {
  const headers: Record<string, string> = {};
  if (at) headers.authorization = `Bearer ${at}`;
  return new Request(BASE(roundId), { method, headers });
}

function ctx(roundId: string): RouteParams {
  return { params: Promise.resolve({ id: roundId }) };
}

async function postDraw(roundId: string, at: string | null): Promise<Response> {
  const mod = await import('./route');
  return mod.POST(req('POST', roundId, at), ctx(roundId));
}

async function deleteDraw(roundId: string, at: string | null): Promise<Response> {
  const mod = await import('./route');
  return mod.DELETE(req('DELETE', roundId, at), ctx(roundId));
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

describe('POST /draw — 추첨(자리 확정) (M2)', () => {
  it('REQ-PK-006: RESIDENT 추첨 → 200 + 본인 slot 확정 (DRAW, drawn_at, drawn_by)', async () => {
    const unitId = await getUnitId('A동', '101');
    const user = await seedUser('r1@example.com', { role: 'RESIDENT', unitId });
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: true });
    const roundId = await createOpenRound();

    const mod = await import('./route');
    const res = await postDraw(roundId, at);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { assigned_slot: string } };
    expect(body.success).toBe(true);
    expect(body.data.assigned_slot).toBeTruthy();

    const row = await query<{
      assigned_slot: string;
      assignment_source: string;
      drawn_by: string;
      drawn_at: string;
    }>(
      'SELECT assigned_slot, assignment_source, drawn_by, drawn_at FROM parking_assignments WHERE round_id = $1 AND unit_id = $2',
      [roundId, unitId],
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].assignment_source).toBe('DRAW');
    expect(row.rows[0].drawn_by).toBe(user.id);
    expect(row.rows[0].drawn_at).toBeTruthy();
  });

  it('REQ-PK-027: 동일 seed → 동일 slot (재현성) — 두 세대 추첨 후 자리 고정', async () => {
    const u1 = await getUnitId('A동', '101');
    const u2 = await getUnitId('A동', '102');
    const r1 = await seedUser('r2@example.com', { role: 'RESIDENT', unitId: u1 });
    const r2 = await seedUser('r3@example.com', { role: 'RESIDENT', unitId: u2 });
    const at1 = signAccessToken({ sub: r1.id, role: 'RESIDENT', verified: true });
    const at2 = signAccessToken({ sub: r2.id, role: 'RESIDENT', verified: true });
    const roundId = await createOpenRound();

    const mod = await import('./route');
    await postDraw(roundId, at1);
    await postDraw(roundId, at2);

    // 두 번째 회차(동일 seed) 생성 후 동일 세대 추첨 → 동일 slot
    const roundId2 = await createOpenRound();
    const r1b = await postDraw(roundId2, at1);
    const b1 = (await r1b.json()) as { data: { assigned_slot: string } };
    const r2b = await postDraw(roundId2, at2);
    const b2 = (await r2b.json()) as { data: { assigned_slot: string } };

    const orig1 = await query<{ assigned_slot: string }>(
      'SELECT assigned_slot FROM parking_assignments WHERE round_id = $1 AND unit_id = $2',
      [roundId, u1],
    );
    const orig2 = await query<{ assigned_slot: string }>(
      'SELECT assigned_slot FROM parking_assignments WHERE round_id = $1 AND unit_id = $2',
      [roundId, u2],
    );
    expect(b1.data.assigned_slot).toBe(orig1.rows[0].assigned_slot);
    expect(b2.data.assigned_slot).toBe(orig2.rows[0].assigned_slot);
  });

  it('REQ-PK-007: 세대당 1회 — 두 번째 추첨 409 (동일 unit_id 가구원)', async () => {
    const unitId = await getUnitId('A동', '101');
    const u1 = await seedUser('fam1@example.com', { role: 'RESIDENT', unitId });
    const u2 = await seedUser('fam2@example.com', { role: 'RESIDENT', unitId });
    const at1 = signAccessToken({ sub: u1.id, role: 'RESIDENT', verified: true });
    const at2 = signAccessToken({ sub: u2.id, role: 'RESIDENT', verified: true });
    const roundId = await createOpenRound();

    const mod = await import('./route');
    const r1 = await postDraw(roundId, at1);
    expect(r1.status).toBe(200);
    const r2 = await postDraw(roundId, at2);
    expect(r2.status).toBe(409);
  });

  it('REQ-PK-008: OPEN 외 상태 추첨 → 409', async () => {
    const unitId = await getUnitId('A동', '101');
    const user = await seedUser('r4@example.com', { role: 'RESIDENT', unitId });
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: true });
    const roundId = await createOpenRound();
    await query(`UPDATE parking_rounds SET status = 'ASSIGNED' WHERE id = $1`, [roundId]);

    const mod = await import('./route');
    const res = await postDraw(roundId, at);
    expect(res.status).toBe(409);
  });

  it('REQ-PK-009: unit_id NULL 사용자 추첨 → 403', async () => {
    const user = await seedUser('nouunit@example.com', { role: 'RESIDENT', unitId: null });
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: true });
    const roundId = await createOpenRound();

    const mod = await import('./route');
    const res = await postDraw(roundId, at);
    expect(res.status).toBe(403);
  });

  it('REQ-PK-010: 미인증 → 401', async () => {
    const roundId = await createOpenRound();
    const mod = await import('./route');
    const res = await postDraw(roundId, null);
    expect(res.status).toBe(401);
  });

  it('UUID 아닌 round id → 400', async () => {
    const user = await seedUser('r5@example.com', { role: 'RESIDENT', unitId: await getUnitId('A동', '101') });
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: true });
    const mod = await import('./route');
    const res = await postDraw('not-a-uuid', at);
    expect(res.status).toBe(400);
  });

  it('미존재 회차 → 404', async () => {
    const user = await seedUser('r6@example.com', { role: 'RESIDENT', unitId: await getUnitId('A동', '101') });
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: true });
    const mod = await import('./route');
    const res = await postDraw('00000000-0000-0000-0000-000000000000', at);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /draw — 추첨 취소/반납 (M3)', () => {
  it('REQ-PK-011: 본인 DRAW 취소 → 200 + 행 삭제', async () => {
    const unitId = await getUnitId('A동', '101');
    const user = await seedUser('c1@example.com', { role: 'RESIDENT', unitId });
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: true });
    const roundId = await createOpenRound();

    const mod = await import('./route');
    await postDraw(roundId, at);
    const res = await deleteDraw(roundId, at);
    expect(res.status).toBe(200);

    const row = await query(
      'SELECT 1 FROM parking_assignments WHERE round_id = $1 AND unit_id = $2',
      [roundId, unitId],
    );
    expect(row.rowCount).toBe(0);
  });

  it('REQ-PK-011: 취소 후 재추첨 가능 → 200', async () => {
    const unitId = await getUnitId('A동', '101');
    const user = await seedUser('c2@example.com', { role: 'RESIDENT', unitId });
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: true });
    const roundId = await createOpenRound();

    const mod = await import('./route');
    await postDraw(roundId, at);
    await deleteDraw(roundId, at);
    const res = await postDraw(roundId, at);
    expect(res.status).toBe(200);
  });

  it('REQ-PK-012: OPEN 외 상태 취소 → 409', async () => {
    const unitId = await getUnitId('A동', '101');
    const user = await seedUser('c3@example.com', { role: 'RESIDENT', unitId });
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: true });
    const roundId = await createOpenRound();
    const mod = await import('./route');
    await postDraw(roundId, at);
    await query(`UPDATE parking_rounds SET status = 'ASSIGNED' WHERE id = $1`, [roundId]);
    const res = await deleteDraw(roundId, at);
    expect(res.status).toBe(409);
  });

  it('REQ-PK-013: AUTO 배정 기록 취소 → 403 (본인 DRAW 만 취소 가능)', async () => {
    const unitId = await getUnitId('A동', '101');
    const user = await seedUser('c4@example.com', { role: 'RESIDENT', unitId });
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: true });
    const roundId = await createOpenRound();
    // AUTO 배정 기록 직접 삽입 (자동배정 실행 결과 시뮬레이션)
    await query(
      `INSERT INTO parking_assignments (round_id, unit_id, assigned_slot, assignment_source)
       VALUES ($1, $2, 'PA', 'AUTO')`,
      [roundId, unitId],
    );
    const res = await deleteDraw(roundId, at);
    expect(res.status).toBe(403);
  });

  it('REQ-PK-014: 미존재 assignment 취소 → 404', async () => {
    const unitId = await getUnitId('A동', '101');
    const user = await seedUser('c6@example.com', { role: 'RESIDENT', unitId });
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: true });
    const roundId = await createOpenRound();
    const mod = await import('./route');
    const res = await deleteDraw(roundId, at);
    expect(res.status).toBe(404);
  });

  it('DELETE 미인증 → 401', async () => {
    const roundId = await createOpenRound();
    const mod = await import('./route');
    const res = await deleteDraw(roundId, null);
    expect(res.status).toBe(401);
  });
});
