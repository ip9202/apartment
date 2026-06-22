/**
 * GET/POST /api/setup/buildings 통합 테스트 — SPEC-SETUP-001 Phase B (M1 동 관리 + M6 공개 조회).
 *
 * AC-SETUP-001 (ADMIN 동 추가 → 201 + buildings 행 생성),
 * AC-SETUP-002 (동명 중복 → 409),
 * AC-SETUP-004 (비-ADMIN 동 추가 → 403),
 * AC-SETUP-024 (GET buildings 비인증 → 200, 동/호수만 반환),
 * EC-SETUP-001 (name 길이 초과 → 422),
 * EC-SETUP-006 (GET buildings 비인증 허용),
 * EC-SETUP-007 (POST buildings 비인증 → 401).
 *
 * TEST ISOLATION: beforeAll 마이그레이션(001~005)+시드 멱등, beforeEach truncate + 기본 A/B동 재시드.
 *
 * @MX:ANCHOR: [AUTO] buildings 컬렉션 테스트는 자체 스키마/시드 보장 — 형제 테스트 부작용에 견고
 * @MX:REASON: AUTH migration 테스트가 동일 test DB 스키마를 DROP/재적용하여 시드가 소실될 수 있음.
 *             RESIDENT/ADMIN 서브쿼리가 NULL 이면 users.role_id NOT NULL 위반으로 비결정적 실패.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from '../../../../lib/db';
import { runSeed } from '../../../../../scripts/seed';
import {
  createTestPool,
  applySql,
  readMigration,
} from '../../../../lib/migration-test-helpers';
import { hashPassword, signAccessToken } from '../../../../lib/auth';

const BASE_URL = 'http://localhost/api/setup/buildings';
const PASSWORD = 'password123';

/** 마이그레이션 001~005 + 시드를 멱등하게 보장. */
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

/** 테스트용 사용자 INSERT — role/verified 선택. */
async function seedUser(
  email: string,
  opts: { verified?: boolean; role?: string } = {},
): Promise<{ id: string; email: string; role: string }> {
  const passwordHash = hashPassword(PASSWORD);
  const verified = opts.verified === true;
  const roleCode = opts.role ?? 'RESIDENT';

  const res = await query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id, managed_building_id)
     VALUES (
       $1, $2,
       (SELECT id FROM roles WHERE code = $3),
       'email', 'ACTIVE',
       CASE WHEN $4 THEN now() ELSE NULL END,
       NULL, NULL
     )
     RETURNING id, email`,
    [email, passwordHash, roleCode, verified],
  );
  return { id: res.rows[0].id, email: res.rows[0].email, role: roleCode };
}

/** 기본 A동/B동 + 시드 호수 재구성 (beforeEach 격리). */
async function reseedBaseBuildings(): Promise<void> {
  // 시드는 ON CONFLICT DO NOTHING 이므로, truncate 후 재실행하여 A/B동 + 호수 복원.
  await runSeed(pool);
}

function buildJsonRequest(
  method: string,
  body: unknown,
  at: string | null,
): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (at) headers.authorization = `Bearer ${at}`;
  return new Request(BASE_URL, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function buildGetRequest(at: string | null): Request {
  const headers: Record<string, string> = {};
  if (at) headers.authorization = `Bearer ${at}`;
  return new Request(BASE_URL, { method: 'GET', headers });
}

async function postBuilding(
  body: unknown,
  at: string | null,
): Promise<Response> {
  const mod = await import('./route');
  return mod.POST(buildJsonRequest('POST', body, at));
}

async function getBuildings(at: string | null): Promise<Response> {
  const mod = await import('./route');
  return mod.GET(buildGetRequest(at));
}

beforeAll(async () => {
  await ensureSchemaAndSeed();
});

beforeEach(async () => {
  // buildings/units/users 역의존성 순으로 정리 (suggestions 는 본 Phase 범위外여도 정리 안전)
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

describe('GET /api/setup/buildings — 공개 동/호수 조회 (M6, REQ-SETUP-020)', () => {
  it('AC-024 / EC-006: 비인증 GET → 200 (공개 허용)', async () => {
    const res = await getBuildings(null);
    expect(res.status).toBe(200);
  });

  it('AC-024: 응답은 buildings 배열 — 각 { id, name, units: [{ id, unit_number }] } 형태', async () => {
    const res = await getBuildings(null);
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown;
    expect(Array.isArray(body)).toBe(true);
    const arr = body as Array<{
      id: string;
      name: string;
      units: Array<{ id: string; unit_number: string }>;
    }>;
    expect(arr.length).toBeGreaterThanOrEqual(1);
    for (const b of arr) {
      expect(typeof b.id).toBe('string');
      expect(typeof b.name).toBe('string');
      expect(Array.isArray(b.units)).toBe(true);
    }
    // A동 시드 호수(101 등)가 노출되는지 확인
    const adong = arr.find((b) => b.name === 'A동');
    expect(adong).toBeDefined();
    expect(adong!.units.length).toBeGreaterThan(0);
  });

  it('AC-024 / privacy: 응답에 회원 데이터(email/password_hash/role) 절대 미포함', async () => {
    // 사용자 1명 시드 후 GET — 응답 본문에 회원 정보가 누출되지 않아야 함
    await seedUser('privacy@example.com', { role: 'RESIDENT', verified: true });

    const res = await getBuildings(null);
    const text = await res.clone().text();
    expect(text).not.toContain('privacy@example.com');
    expect(text.toLowerCase()).not.toContain('password_hash');
    expect(text.toLowerCase()).not.toContain('email');
    expect(text.toLowerCase()).not.toContain('role');
  });
});

describe('POST /api/setup/buildings — ADMIN 동 추가 (M1, REQ-SETUP-001/002/004)', () => {
  it('AC-001: ADMIN 동 추가 → 201 + { id, name, created_at } + buildings 행 생성', async () => {
    const admin = await seedUser('admin1@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await postBuilding({ name: 'C동' }, at);
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      id: string;
      name: string;
      created_at: string;
    };
    expect(body.name).toBe('C동');
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.created_at).toBeDefined();

    const row = await query<{ name: string }>(
      'SELECT name FROM buildings WHERE id = $1',
      [body.id],
    );
    expect(row.rows[0].name).toBe('C동');
  });

  it('AC-002: 동명 중복 → 409 (UNIQUE 제약)', async () => {
    const admin = await seedUser('admin2@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    // A동은 시드에 이미 존재
    const res = await postBuilding({ name: 'A동' }, at);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');
  });

  it('AC-004: RESIDENT 동 추가 → 403 FORBIDDEN', async () => {
    const resident = await seedUser('resident1@example.com', {
      role: 'RESIDENT',
      verified: true,
    });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });

    const res = await postBuilding({ name: 'D동' }, at);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');

    // D동은 생성되지 않아야 함
    const row = await query<{ name: string }>(
      'SELECT name FROM buildings WHERE name = $1',
      ['D동'],
    );
    expect(row.rowCount).toBe(0);
  });

  it('EC-007: 비인증 POST (AT 없음) → 401', async () => {
    const res = await postBuilding({ name: 'E동' }, null);
    expect(res.status).toBe(401);
  });

  it('401: 변조된 AT → 401', async () => {
    const res = await postBuilding({ name: 'F동' }, 'invalid.token.here');
    expect(res.status).toBe(401);
  });

  it('EC-001: name 길이 > 20 → 422 (VARCHAR(20) 제약)', async () => {
    const admin = await seedUser('admin3@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await postBuilding({ name: '가'.repeat(21) }, at);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('422: name 누락/빈 문자열 → 422', async () => {
    const admin = await seedUser('admin4@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await postBuilding({}, at);
    expect(res.status).toBe(422);
  });

  it('422: name 이 문자열이 아님 → 422', async () => {
    const admin = await seedUser('admin5@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await postBuilding({ name: 12345 }, at);
    expect(res.status).toBe(422);
  });
});
