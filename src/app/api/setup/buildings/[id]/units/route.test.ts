/**
 * PUT /api/setup/buildings/[id]/units 통합 테스트 — SPEC-SETUP-001 Phase C (M2 호수 일괄 업데이트).
 *
 * AC-SETUP-006 (호수 일괄 업데이트 200),
 * AC-SETUP-007 (삭제 대상 호수 활성 입주민 → 409),
 * AC-SETUP-008 (미존재 building_id → 404),
 * AC-SETUP-009a (미인증 → 401),
 * AC-SETUP-009b (비-ADMIN → 403),
 * EC-SETUP-003 (빈 배열 = 전체 삭제, 활성 입주민 없을 때 허용),
 * REQ-SETUP-007a (UUID 불일치 400 / 중복 unit_number 422 / 길이 초과 422).
 *
 * 요청 본문 형태(SPEC-SETUP-001 REQ-005): { units: string[] } — unit_number 문자열 배열.
 * 응답: 200 { success: true, data: { units: [{ id, unit_number }, ...] } }.
 *
 * @MX:NOTE: [AUTO] "활성 입주민" 정의 — REQ-006: 삭제 대상 unit 에 unit_id 로 귀속된
 *           users.status='ACTIVE' 인 회원이 1명 이상이면 호수 삭제 불가 (Phase B DELETE 와 동일).
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

/** PUT /api/setup/buildings/[id]/units 호출 헬퍼. */
async function putUnits(
  buildingId: string,
  body: unknown,
  at: string | null,
): Promise<Response> {
  const mod = await import('./route');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (at) headers.authorization = `Bearer ${at}`;
  const req = new Request(`${BASE_URL}/${buildingId}/units`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  return mod.PUT(req, { params: Promise.resolve({ id: buildingId }) });
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
  await query('Delete FROM suggestions');
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
  await query('DELETE FROM units');
  await query('DELETE FROM buildings');
  await pool.end();
});

describe('PUT /api/setup/buildings/[id]/units — ADMIN 호수 일괄 업데이트 (M2, REQ-SETUP-005/006/007/008)', () => {
  it('AC-006: ADMIN 호수 일괄 업데이트 → 200 + 갱신된 호수 목록', async () => {
    const admin = await seedUser('admin_units1@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const aId = await buildingIdByName('A동');

    const res = await putUnits(aId, { units: ['101', '102', '201'] }, at);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { units: { id: string; unit_number: string }[] };
    };
    expect(body.success).toBe(true);
    const numbers = body.data.units.map((u) => u.unit_number).sort();
    expect(numbers).toEqual(['101', '102', '201']);
  });

  it('AC-006 diff: 기존 호수 존재 시 추가+삭제 단일 트랜잭션', async () => {
    const admin = await seedUser('admin_units2@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const aId = await buildingIdByName('A동');

    // 1차: 101, 102 추가
    let res = await putUnits(aId, { units: ['101', '102'] }, at);
    expect(res.status).toBe(200);

    // 2차: 102 유지 + 201 추가 (101 삭제)
    res = await putUnits(aId, { units: ['102', '201'] }, at);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { units: { id: string; unit_number: string }[] };
    };
    const numbers = body.data.units.map((u) => u.unit_number).sort();
    expect(numbers).toEqual(['102', '201']);

    // DB 상태 직접 확인
    const rows = await query<{ unit_number: string }>(
      'SELECT unit_number FROM units WHERE building_id = $1 ORDER BY unit_number',
      [aId],
    );
    expect(rows.rows.map((r) => r.unit_number)).toEqual(['102', '201']);
  });

  it('AC-006 멱등: 동일 배열 재호출 시 최종 집합 동일', async () => {
    const admin = await seedUser('admin_units3@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const aId = await buildingIdByName('A동');

    await putUnits(aId, { units: ['101', '102'] }, at);
    const res = await putUnits(aId, { units: ['101', '102'] }, at);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { units: { unit_number: string }[] };
    };
    expect(body.data.units.map((u) => u.unit_number).sort()).toEqual(['101', '102']);
  });

  it('AC-007: 삭제 대상 호수에 활성 입주민 → 409 (트랜잭션 롤백)', async () => {
    const admin = await seedUser('admin_units4@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const aId = await buildingIdByName('A동');

    // 101, 102 세팅 후 101 에 ACTIVE 입주민 귀속
    await putUnits(aId, { units: ['101', '102'] }, at);
    await seedUser('resident_units1@example.com', {
      role: 'RESIDENT',
      verified: true,
      unitBuilding: 'A동',
      unitNumber: '101',
    });

    // 101 을 삭제하려 시도 (활성 입주민 존재)
    const res = await putUnits(aId, { units: ['102'] }, at);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');

    // 롤백 검증: 101, 102 모두 잔존
    const rows = await query<{ unit_number: string }>(
      'SELECT unit_number FROM units WHERE building_id = $1 ORDER BY unit_number',
      [aId],
    );
    expect(rows.rows.map((r) => r.unit_number)).toEqual(['101', '102']);
  });

  it('EC-003: 빈 배열 = 전체 삭제 (활성 입주민 없을 때 허용)', async () => {
    const admin = await seedUser('admin_units5@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const aId = await buildingIdByName('A동');

    // 101, 102 세팅
    await putUnits(aId, { units: ['101', '102'] }, at);

    // 빈 배열 → 전체 삭제
    const res = await putUnits(aId, { units: [] }, at);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { units: { unit_number: string }[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.units).toEqual([]);

    const rows = await query<{ id: string }>(
      'SELECT id FROM units WHERE building_id = $1',
      [aId],
    );
    expect(rows.rowCount).toBe(0);
  });

  it('EC-003 변형: 빈 배열이지만 활성 입주민 있으면 → 409', async () => {
    const admin = await seedUser('admin_units6@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const aId = await buildingIdByName('A동');

    await putUnits(aId, { units: ['101'] }, at);
    await seedUser('resident_units2@example.com', {
      role: 'RESIDENT',
      verified: true,
      unitBuilding: 'A동',
      unitNumber: '101',
    });

    const res = await putUnits(aId, { units: [] }, at);
    expect(res.status).toBe(409);
  });

  it('AC-008: 미존재 building_id → 404', async () => {
    const admin = await seedUser('admin_units7@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await putUnits(
      '00000000-0000-0000-0000-000000000000',
      { units: ['101'] },
      at,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('REQ-007a: UUID 형식 오류 → 400', async () => {
    const admin = await seedUser('admin_units8@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await putUnits('not-a-uuid', { units: ['101'] }, at);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('REQ-007a: 요청 배열 내 중복 unit_number → 422', async () => {
    const admin = await seedUser('admin_units9@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const aId = await buildingIdByName('A동');

    const res = await putUnits(aId, { units: ['101', '101', '102'] }, at);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('REQ-007a: unit_number 10자 초과 → 422', async () => {
    const admin = await seedUser('admin_units10@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const aId = await buildingIdByName('A동');

    const res = await putUnits(aId, { units: ['12345678901'] }, at); // 11자
    expect(res.status).toBe(422);
  });

  it('REQ-007a: unit_number 빈 문자열 → 422', async () => {
    const admin = await seedUser('admin_units11@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const aId = await buildingIdByName('A동');

    const res = await putUnits(aId, { units: [''] }, at);
    expect(res.status).toBe(422);
  });

  it('REQ-007a: units 키 누락 → 422', async () => {
    const admin = await seedUser('admin_units12@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const aId = await buildingIdByName('A동');

    const res = await putUnits(aId, {}, at);
    expect(res.status).toBe(422);
  });

  it('REQ-007a: units 배열 아님 → 422', async () => {
    const admin = await seedUser('admin_units13@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const aId = await buildingIdByName('A동');

    const res = await putUnits(aId, { units: '101' }, at);
    expect(res.status).toBe(422);
  });

  it('AC-009a: 미인증 (AT 없음) → 401', async () => {
    const aId = await buildingIdByName('A동');
    const res = await putUnits(aId, { units: ['101'] }, null);
    expect(res.status).toBe(401);
  });

  it('AC-009a: 변조된 AT → 401', async () => {
    const aId = await buildingIdByName('A동');
    const res = await putUnits(aId, { units: ['101'] }, 'invalid.token.here');
    expect(res.status).toBe(401);
  });

  it('AC-009b: RESIDENT → 403', async () => {
    const resident = await seedUser('resident_units3@example.com', {
      role: 'RESIDENT',
      verified: true,
    });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });
    const aId = await buildingIdByName('A동');

    const res = await putUnits(aId, { units: ['101'] }, at);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('AC-009b: CHAIR → 403 (ADMIN 전용)', async () => {
    const chair = await seedUser('chair_units1@example.com', {
      role: 'CHAIR',
      verified: true,
    });
    const at = signAccessToken({ sub: chair.id, role: 'CHAIR', verified: true });
    const aId = await buildingIdByName('A동');

    const res = await putUnits(aId, { units: ['101'] }, at);
    expect(res.status).toBe(403);
  });
});
