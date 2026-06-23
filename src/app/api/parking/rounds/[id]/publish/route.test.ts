/**
 * PUT /api/parking/rounds/[id]/publish 통합 테스트 — 결과 공개 (SPEC-PARKING-001 M5, PARKING-05).
 *
 * REQ-PK-020 (ADMIN 공개 → 200, ASSIGNED→PUBLISHED), REQ-PK-021 (ASSIGNED 외 409),
 * REQ-PK-022 (비-ADMIN 403).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from '../../../../../../lib/db';
import { runSeed } from '../../../../../../../scripts/seed';
import { createTestPool, applySql, readMigration } from '../../../../../../lib/migration-test-helpers';
import { hashPassword, signAccessToken } from '../../../../../../lib/auth';

const BASE = (id: string) => `http://localhost/api/parking/rounds/${id}/publish`;
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

async function seedUser(email: string, role: string): Promise<{ id: string }> {
  const res = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at)
     VALUES ($1, $2, (SELECT id FROM roles WHERE code=$3), 'email', 'ACTIVE', now())
     RETURNING id`,
    [email, hashPassword(PASSWORD), role],
  );
  return { id: res.rows[0].id };
}

async function createRound(status: string): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO parking_rounds (name, application_start, application_end, slot_pool, seed_value, status)
     VALUES ('공개 테스트', now(), now() + interval '7 days',
             $1::jsonb, 'cHVibGlzaC1zZWVk', $2)
     RETURNING id`,
    [JSON.stringify(Array.from({ length: 38 }, (_, i) => `P${i + 1}`)), status],
  );
  return res.rows[0].id;
}

function req(roundId: string, at: string | null): Request {
  const headers: Record<string, string> = {};
  if (at) headers.authorization = `Bearer ${at}`;
  return new Request(BASE(roundId), { method: 'PUT', headers });
}

async function publish(roundId: string, at: string | null): Promise<Response> {
  const mod = await import('./route');
  return mod.PUT(req(roundId, at), { params: Promise.resolve({ id: roundId }) });
}

beforeAll(async () => {
  await ensureSchemaAndSeed();
});
beforeEach(async () => {
  await query('DELETE FROM parking_assignments');
  await query('DELETE FROM parking_rounds');
  await query('DELETE FROM users');
});
afterAll(async () => {
  await query('DELETE FROM parking_assignments');
  await query('DELETE FROM parking_rounds');
  await query('DELETE FROM users');
  await pool.end();
});

describe('PUT /publish — 결과 공개 (M5)', () => {
  it('REQ-PK-020: ADMIN 공개 → 200 + is_published true + status PUBLISHED', async () => {
    const admin = await seedUser('admin@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const roundId = await createRound('ASSIGNED');
    const res = await publish(roundId, at);
    expect(res.status).toBe(200);
    const row = await query<{ status: string; is_published: boolean }>(
      'SELECT status, is_published FROM parking_rounds WHERE id=$1',
      [roundId],
    );
    expect(row.rows[0].status).toBe('PUBLISHED');
    expect(row.rows[0].is_published).toBe(true);
  });

  it('REQ-PK-021: OPEN 상태 공개 → 409', async () => {
    const admin = await seedUser('admin2@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const roundId = await createRound('OPEN');
    const res = await publish(roundId, at);
    expect(res.status).toBe(409);
  });

  it('REQ-PK-021: 이미 PUBLISHED → 409', async () => {
    const admin = await seedUser('admin3@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const roundId = await createRound('PUBLISHED');
    const res = await publish(roundId, at);
    expect(res.status).toBe(409);
  });

  it('REQ-PK-022: CHAIR 공개 → 403', async () => {
    const chair = await seedUser('chair@example.com', 'CHAIR');
    const at = signAccessToken({ sub: chair.id, role: 'CHAIR', verified: true });
    const roundId = await createRound('ASSIGNED');
    const res = await publish(roundId, at);
    expect(res.status).toBe(403);
  });

  it('REQ-PK-022: RESIDENT 공개 → 403', async () => {
    const u = await seedUser('r@example.com', 'RESIDENT');
    const at = signAccessToken({ sub: u.id, role: 'RESIDENT', verified: true });
    const roundId = await createRound('ASSIGNED');
    const res = await publish(roundId, at);
    expect(res.status).toBe(403);
  });

  it('미인증 → 401', async () => {
    const roundId = await createRound('ASSIGNED');
    const res = await publish(roundId, null);
    expect(res.status).toBe(401);
  });

  it('미존재 회차 → 404', async () => {
    const admin = await seedUser('admin4@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await publish('00000000-0000-0000-0000-000000000000', at);
    expect(res.status).toBe(404);
  });
});
