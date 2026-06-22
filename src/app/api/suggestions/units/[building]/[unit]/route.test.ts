/**
 * GET /api/suggestions/units/[building]/[unit] 통합 테스트 — SPEC-SUGGEST-001 M8a (호수별 건의 이력).
 *
 * AC-SUGGEST-042 (ADMIN 호수별 이력 → 200, 아카이브 포함, 시간순),
 * AC-SUGGEST-043 (CHAIR → 200),
 * AC-SUGGEST-044 (미존재 building/unit → 404),
 * AC-SUGGEST-045 (미인증 → 401),
 * AC-SUGGEST-046 (비-ADMIN/비-CHAIR → 403).
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

const BASE_URL = 'http://localhost/api/suggestions/units';
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

async function getCategoryId(name: string): Promise<string> {
  const res = await query<{ id: string }>('SELECT id FROM suggestion_categories WHERE name = $1', [name]);
  return res.rows[0].id;
}

async function seedUser(email: string, role = 'RESIDENT', unitId: string | null = null): Promise<{ id: string }> {
  const passwordHash = hashPassword(PASSWORD);
  const res = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id)
     VALUES ($1, $2, (SELECT id FROM roles WHERE code = $3), 'email', 'ACTIVE', now(), $4)
     RETURNING id`,
    [email, passwordHash, role, unitId],
  );
  return { id: res.rows[0].id };
}

interface UnitParams {
  params: Promise<{ building: string; unit: string }>;
}

async function getHistory(at: string | null, buildingId: string, unitNumber: string): Promise<Response> {
  const mod = await import('./route');
  const headers: Record<string, string> = {};
  if (at) headers.authorization = `Bearer ${at}`;
  const req = new Request(`${BASE_URL}/${buildingId}/${unitNumber}`, { method: 'GET', headers });
  return mod.GET(req, {
    params: Promise.resolve({ building: buildingId, unit: unitNumber }),
  } as UnitParams);
}

beforeAll(async () => {
  await ensureSchemaAndSeed();
});

beforeEach(async () => {
  await query('DELETE FROM suggestion_replies');
  await query('DELETE FROM suggestions');
  await query('UPDATE users SET unit_id = NULL');
  await query('DELETE FROM users');
});

afterAll(async () => {
  await query('DELETE FROM suggestion_replies');
  await query('DELETE FROM suggestions');
  await query('UPDATE users SET unit_id = NULL');
  await query('DELETE FROM users');
  await pool.end();
});

describe('GET /api/suggestions/units/[building]/[unit] — ADMIN/CHAIR 호수별 이력 (M8a, REQ-SUGGEST-035~037b)', () => {
  it('AC-042: ADMIN 호수별 이력 → 200 + 아카이브 포함 + created_at ASC 시간순', async () => {
    const aBuilding = await getBuildingId('A동');
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('au@example.com', 'RESIDENT', a101);

    // 3개 행: 2개 일반 + 1개 아카이브
    const t0 = await query<{ id: string }>(
      `INSERT INTO suggestions (author_id, author_label, unit_id, category_id, title, content, is_public, status, archived, created_at)
       VALUES ($1, '입주민', $2, $3, 'T0', 'C0', true, '접수', false, now() - interval '3 hour')
       RETURNING id`,
      [author.id, a101, categoryId],
    );
    const t1 = await query<{ id: string }>(
      `INSERT INTO suggestions (author_id, author_label, unit_id, category_id, title, content, is_public, status, archived, created_at)
       VALUES ($1, '입주민', $2, $3, 'T1', 'C1', true, '완료', false, now() - interval '2 hour')
       RETURNING id`,
      [author.id, a101, categoryId],
    );
    const t2 = await query<{ id: string }>(
      `INSERT INTO suggestions (author_id, author_label, unit_id, category_id, title, content, is_public, status, archived, archived_at, created_at)
       VALUES ($1, '전 입주민', $2, $3, 'T2', 'C2', false, '접수', true, now(), now() - interval '1 hour')
       RETURNING id`,
      [author.id, a101, categoryId],
    );

    const admin = await seedUser('admin@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await getHistory(at, aBuilding, '101');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        suggestions: Array<{ id: string; title: string; archived: boolean; archived_at: string | null }>;
        total: number;
        building: string;
        unit: string;
      };
    };
    expect(body.data.total).toBe(3);
    expect(body.data.building).toBe('A동');
    expect(body.data.unit).toBe('101');
    // 시간순 (ASC): T0 → T1 → T2
    const titles = body.data.suggestions.map((s) => s.title);
    expect(titles).toEqual(['T0', 'T1', 'T2']);
    // 아카이브 포함
    const archivedRow = body.data.suggestions.find((s) => s.id === t2.rows[0].id);
    expect(archivedRow?.archived).toBe(true);
    expect(archivedRow?.archived_at).not.toBeNull();
    void t0; void t1;
  });

  it('AC-043: CHAIR 호수별 이력 → 200 (ADMIN/CHAIR 허용)', async () => {
    const aBuilding = await getBuildingId('A동');
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('au2@example.com', 'RESIDENT', a101);
    await query(
      `INSERT INTO suggestions (author_id, author_label, unit_id, category_id, title, content, is_public, status, archived)
       VALUES ($1, '입주민', $2, $3, 'X', 'Y', true, '접수', false)`,
      [author.id, a101, categoryId],
    );

    const chair = await seedUser('chair@example.com', 'CHAIR');
    const at = signAccessToken({ sub: chair.id, role: 'CHAIR', verified: true });

    const res = await getHistory(at, aBuilding, '101');
    expect(res.status).toBe(200);
  });

  it('AC-044: 미존재 building → 404', async () => {
    const admin = await seedUser('admin2@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await getHistory(at, '00000000-0000-0000-0000-000000000000', '101');
    expect(res.status).toBe(404);
  });

  it('AC-044b: 미존재 unit_number → 404', async () => {
    const aBuilding = await getBuildingId('A동');
    const admin = await seedUser('admin3@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await getHistory(at, aBuilding, '999');
    expect(res.status).toBe(404);
  });

  it('AC-045: 미인증 → 401', async () => {
    const aBuilding = await getBuildingId('A동');
    const res = await getHistory(null, aBuilding, '101');
    expect(res.status).toBe(401);
  });

  it('AC-046: 비-ADMIN/비-CHAIR(RESIDENT) → 403', async () => {
    const aBuilding = await getBuildingId('A동');
    const resident = await seedUser('r@example.com', 'RESIDENT');
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });

    const res = await getHistory(at, aBuilding, '101');
    expect(res.status).toBe(403);
  });

  it('AC-046b: REP → 403 (ADMIN/CHAIR 만 허용)', async () => {
    const aBuilding = await getBuildingId('A동');
    const rep = await seedUser('rep@example.com', 'REP');
    const at = signAccessToken({ sub: rep.id, role: 'REP', verified: true });

    const res = await getHistory(at, aBuilding, '101');
    expect(res.status).toBe(403);
  });

  it('EC: building UUID 오류 → 400', async () => {
    const admin = await seedUser('admin4@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await getHistory(at, 'not-a-uuid', '101');
    expect(res.status).toBe(400);
  });
});
