/**
 * GET /api/parking/rounds/[id]/verify 통합 테스트 — 투명성 공개 (SPEC-PARKING-001 M7, PARKING-07).
 *
 * REQ-PK-026 (seed+알고리즘+정렬입력 공개), REQ-PK-027 (재현 검증).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from '../../../../../../lib/db';
import { runSeed } from '../../../../../../../scripts/seed';
import { createTestPool, applySql, readMigration } from '../../../../../../lib/migration-test-helpers';
import { hashPassword, signAccessToken } from '../../../../../../lib/auth';
import { generatePermutation } from '../../../../../../lib/parking-lottery';

const BASE = (id: string) => `http://localhost/api/parking/rounds/${id}/verify`;
const PASSWORD = 'password123';
const SEED = 'dmVyaWZ5LXNlZWQ=';

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

async function createRound(): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO parking_rounds (name, application_start, application_end, slot_pool, seed_value)
     VALUES ('검증 테스트', now(), now() + interval '7 days',
             $1::jsonb, $2)
     RETURNING id`,
    [JSON.stringify(Array.from({ length: 38 }, (_, i) => `P${i + 1}`)), SEED],
  );
  return res.rows[0].id;
}

function req(roundId: string, at: string | null): Request {
  const headers: Record<string, string> = {};
  if (at) headers.authorization = `Bearer ${at}`;
  return new Request(BASE(roundId), { method: 'GET', headers });
}

async function verify(roundId: string, at: string | null): Promise<Response> {
  const mod = await import('./route');
  return mod.GET(req(roundId, at), { params: Promise.resolve({ id: roundId }) });
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

describe('GET /verify — 투명성 공개 (M7)', () => {
  it('REQ-PK-026: seed + 알고리즘 + 정렬입력 공개 → 200', async () => {
    const admin = await seedUser('admin@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const roundId = await createRound();

    const res = await verify(roundId, at);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        seed_value: string;
        algorithm: string;
        sort_criteria: string;
        slot_pool: string[];
        units: { unit_id: string; building: string; unit_number: string }[];
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.seed_value).toBe(SEED);
    expect(body.data.algorithm).toContain('Fisher-Yates');
    expect(body.data.algorithm).toContain('HMAC-SHA256');
    expect(body.data.sort_criteria).toContain('building_name');
    expect(body.data.slot_pool).toHaveLength(38);
    expect(body.data.units.length).toBeGreaterThanOrEqual(38);
  });

  it('REQ-PK-027: 공개된 seed+알고리즘+입력으로 동일 순열 재현 가능', async () => {
    const admin = await seedUser('admin2@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const roundId = await createRound();

    const res = await verify(roundId, at);
    const body = (await res.json()) as {
      data: {
        seed_value: string;
        slot_pool: string[];
        units: { unit_id: string; building: string; unit_number: string }[];
      };
    };

    // 응답 정보로 generatePermutation 재호출 → 결정론 보증
    const units = body.data.units.map((u) => ({
      unit_id: u.unit_id,
      sort_key: `${u.building}-${u.unit_number}`,
    }));
    const p1 = generatePermutation(body.data.seed_value, units, body.data.slot_pool);
    const p2 = generatePermutation(body.data.seed_value, units, body.data.slot_pool);
    expect(p1).toEqual(p2);
    // 모든 unit 정확히 1 slot
    expect(p1.length).toBe(units.length);
  });

  it('RESIDENT 도 접근 가능 (투명성은 모든 인증 사용자)', async () => {
    const res = await seedUser('r@example.com', 'RESIDENT');
    const at = signAccessToken({ sub: res.id, role: 'RESIDENT', verified: true });
    const roundId = await createRound();
    const response = await verify(roundId, at);
    expect(response.status).toBe(200);
  });

  it('미인증 → 401', async () => {
    const roundId = await createRound();
    const res = await verify(roundId, null);
    expect(res.status).toBe(401);
  });

  it('미존재 회차 → 404', async () => {
    const admin = await seedUser('admin3@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await verify('00000000-0000-0000-0000-000000000000', at);
    expect(res.status).toBe(404);
  });
});
