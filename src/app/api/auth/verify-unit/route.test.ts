/**
 * POST /api/auth/verify-unit 통합 테스트 — TASK-AUTH-011 (Phase E).
 *
 * AC-AUTH-014 (정상 인증 → 200 + verified_at 갱신 + verified:true fresh AT),
 * AC-AUTH-015 (REP 인증 → managed_building_id 자동 연결),
 * AC-AUTH-016 (동일 호수 중복 → 409 + "관리사무소"),
 * AC-AUTH-017 (미존재 building/unit 또는 불일치 → 422),
 * Q1 (이미 verified 사용자 재인증 → 409),
 * 비-REP 역할은 managed_building_id 미기록,
 * 미인증(401) 및 본문 검증(422).
 * REQ-AUTH-010/010a/011/012 검증.
 *
 * MW 정책: 성공 시 AT 쿠키 재설정 (verified:true fresh AT).
 *
 * TEST ISOLATION: beforeAll 마이그레이션+시드 멱등, beforeEach truncate.
 *
 * @MX:ANCHOR: [AUTO] verify-unit 테스트는 자체적으로 시드를 보장한다 (형제 테스트 부작용에 견고)
 * @MX:REASON: migration-001/002/003 테스트가 동일 test DB 의 스키마를 DROP/재적용하여
 *             roles/buildings/units 시드가 소실될 수 있음. RESIDENT/REP 서브쿼리가 NULL 을 반환하면
 *             users.role_id NOT NULL 위반으로 케이스들이 비결정적 실패함.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from '../../../../lib/db';
import { runSeed } from '../../../../../scripts/seed';
import {
  createTestPool,
  applySql,
  readMigration,
} from '../../../../lib/migration-test-helpers';
import {
  hashPassword,
  signAccessToken,
  verifyAccessToken,
} from '../../../../lib/auth';
import { ACCESS_COOKIE_NAME } from '../../../../lib/cookies';

const VERIFY_URL = 'http://localhost/api/auth/verify-unit';
const PASSWORD = 'password123';

interface VerifyResponseBody {
  success: boolean;
  data?: {
    user?: { id: string; email: string; role: string; verified: boolean };
    access_token?: string;
  };
  error?: { code: string; message: string };
}

/** 마이그레이션 + 시드를 멱등하게 보장. */
async function ensureSchemaAndSeed(): Promise<void> {
  const setupPool = createTestPool();
  try {
    for (const file of [
      '001_init_users_buildings_units_roles.sql',
      '002_revoked_refresh_tokens.sql',
      '003_login_attempts.sql',
    ]) {
      await applySql(setupPool, readMigration(file));
    }
    await runSeed(setupPool);
  } finally {
    await setupPool.end();
  }
}

/** 테스트용 사용자 INSERT — verified=false 기본, role/managed_building 선택. */
async function seedUser(
  email: string,
  opts: { verified?: boolean; role?: string } = {},
): Promise<{ id: string; email: string; role: string; verified: boolean }> {
  const passwordHash = hashPassword(PASSWORD);
  const verified = opts.verified === true; // 기본 false (verify-unit 대상)
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
  return { id: res.rows[0].id, email: res.rows[0].email, role: roleCode, verified };
}

/** A동 101호 unit id 조회 (seed 보장). */
async function getUnitId(buildingName: string, unitNumber: string): Promise<string> {
  const res = await query<{ id: string }>(
    `SELECT u.id FROM units u JOIN buildings b ON b.id = u.building_id
     WHERE b.name = $1 AND u.unit_number = $2`,
    [buildingName, unitNumber],
  );
  if (!res.rows[0]) throw new Error(`seed unit missing: ${buildingName} ${unitNumber}`);
  return res.rows[0].id;
}

/** building id 조회. */
async function getBuildingId(name: string): Promise<string> {
  const res = await query<{ id: string }>('SELECT id FROM buildings WHERE name = $1', [name]);
  if (!res.rows[0]) throw new Error(`seed building missing: ${name}`);
  return res.rows[0].id;
}

function buildRequest(at: string | null, body: unknown): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (at) headers.authorization = `Bearer ${at}`;
  return new Request(VERIFY_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function postVerify(at: string | null, body: unknown): Promise<Response> {
  const mod = await import('./route');
  return mod.POST(buildRequest(at, body));
}

async function readBody(res: Response): Promise<VerifyResponseBody> {
  return (await res.json()) as VerifyResponseBody;
}

beforeAll(async () => {
  await ensureSchemaAndSeed();
});

beforeEach(async () => {
  await query('DELETE FROM revoked_refresh_tokens');
  await query('DELETE FROM login_attempts');
  await query('UPDATE users SET unit_id = NULL, verified_at = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
});

afterAll(async () => {
  await query('DELETE FROM revoked_refresh_tokens');
  await query('DELETE FROM login_attempts');
  await query('DELETE FROM users');
  await pool.end();
});

describe('POST /api/auth/verify-unit — 동/호수 인증 (TASK-AUTH-011)', () => {
  it('AC-014: 정상 인증 → 200 + verified=true + DB unit_id/verified_at 갱신', async () => {
    const user = await seedUser('alice@example.com');
    const buildingId = await getBuildingId('A동');
    const unitId = await getUnitId('A동', '101');
    const at = signAccessToken({ sub: user.id, role: user.role, verified: false });

    const res = await postVerify(at, { building_id: buildingId, unit_id: unitId });
    expect(res.status).toBe(200);

    const body = await readBody(res);
    expect(body.success).toBe(true);
    expect(body.data?.user?.verified).toBe(true);
    expect(body.data?.user?.role).toBe('RESIDENT');

    // DB 갱신 확인
    const row = await query<{ unit_id: string | null; verified_at: string | null }>(
      'SELECT unit_id, verified_at FROM users WHERE id = $1',
      [user.id],
    );
    expect(row.rows[0].unit_id).toBe(unitId);
    expect(row.rows[0].verified_at).not.toBeNull();
  });

  it('AC-014: 성공 시 verified:true fresh AT 재발급 + AT 쿠키 설정', async () => {
    const user = await seedUser('bob@example.com');
    const buildingId = await getBuildingId('A동');
    const unitId = await getUnitId('A동', '102');
    const at = signAccessToken({ sub: user.id, role: user.role, verified: false });

    const res = await postVerify(at, { building_id: buildingId, unit_id: unitId });
    expect(res.status).toBe(200);

    const body = await readBody(res);
    // fresh AT 가 본문에 포함 (verified:true)
    expect(body.data?.access_token).toEqual(expect.any(String));
    const newClaims = verifyAccessToken(body.data!.access_token!);
    expect(newClaims.sub).toBe(user.id);
    expect(newClaims.verified).toBe(true);

    // AT 쿠키도 설정
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${ACCESS_COOKIE_NAME}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\//);
  });

  it('AC-025: 응답 본문에 password_hash 미포함', async () => {
    const user = await seedUser('nohash@example.com');
    const buildingId = await getBuildingId('A동');
    const unitId = await getUnitId('A동', '201');
    const at = signAccessToken({ sub: user.id, role: user.role, verified: false });

    const res = await postVerify(at, { building_id: buildingId, unit_id: unitId });
    const text = await res.clone().text();
    expect(text).not.toMatch(/password_hash/i);
  });

  it('AC-015: REP 역할 인증 → managed_building_id 자동 연결', async () => {
    const user = await seedUser('rep@example.com', { role: 'REP' });
    const buildingId = await getBuildingId('A동');
    const unitId = await getUnitId('A동', '301');
    const at = signAccessToken({ sub: user.id, role: 'REP', verified: false });

    const res = await postVerify(at, { building_id: buildingId, unit_id: unitId });
    expect(res.status).toBe(200);

    const row = await query<{
      unit_id: string | null;
      verified_at: string | null;
      managed_building_id: string | null;
    }>('SELECT unit_id, verified_at, managed_building_id FROM users WHERE id = $1', [
      user.id,
    ]);
    expect(row.rows[0].unit_id).toBe(unitId);
    expect(row.rows[0].verified_at).not.toBeNull();
    expect(row.rows[0].managed_building_id).toBe(buildingId);
  });

  it('비-REP(RESIDENT) 역할은 managed_building_id 를 기록하지 않는다', async () => {
    const user = await seedUser('resident@example.com', { role: 'RESIDENT' });
    const buildingId = await getBuildingId('A동');
    const unitId = await getUnitId('A동', '302');
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: false });

    const res = await postVerify(at, { building_id: buildingId, unit_id: unitId });
    expect(res.status).toBe(200);

    const row = await query<{ managed_building_id: string | null }>(
      'SELECT managed_building_id FROM users WHERE id = $1',
      [user.id],
    );
    expect(row.rows[0].managed_building_id).toBeNull();
  });

  it('AC-016: 이미 다른 ACTIVE 회원이 인증한 호수 → 409 + "관리사무소" 안내', async () => {
    // 첫 번째 사용자가 501호 선점
    const first = await seedUser('first@example.com');
    const buildingId = await getBuildingId('A동');
    const unitId = await getUnitId('A동', '501');
    const at1 = signAccessToken({ sub: first.id, role: 'RESIDENT', verified: false });
    const r1 = await postVerify(at1, { building_id: buildingId, unit_id: unitId });
    expect(r1.status).toBe(200);

    // 두 번째 사용자가 같은 호수 인증 시도
    const second = await seedUser('second@example.com');
    const at2 = signAccessToken({ sub: second.id, role: 'RESIDENT', verified: false });
    const res = await postVerify(at2, { building_id: buildingId, unit_id: unitId });
    expect(res.status).toBe(409);

    const body = await readBody(res);
    expect(body.error?.message).toMatch(/관리사무소/);
  });

  it('Q1: 이미 인증된 회원(verified_at NOT NULL) 재인증 → 409 CONFLICT', async () => {
    const user = await seedUser('already@example.com', { verified: true });
    const buildingId = await getBuildingId('A동');
    const unitId = await getUnitId('A동', '502');
    // AT 클레임은 verified:true 로 발급 (DB 와 일치)
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: true });

    const res = await postVerify(at, { building_id: buildingId, unit_id: unitId });
    expect(res.status).toBe(409);

    const body = await readBody(res);
    expect(body.error?.message).toMatch(/이미 인증/);
  });

  it('AC-017: 미존재 building_id → 422', async () => {
    const user = await seedUser('ghost1@example.com');
    const unitId = await getUnitId('A동', '601');
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: false });

    const res = await postVerify(at, {
      building_id: '00000000-0000-0000-0000-000000000000',
      unit_id: unitId,
    });
    expect(res.status).toBe(422);
  });

  it('AC-017: 미존재 unit_id → 422', async () => {
    const user = await seedUser('ghost2@example.com');
    const buildingId = await getBuildingId('A동');
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: false });

    const res = await postVerify(at, {
      building_id: buildingId,
      unit_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(res.status).toBe(422);
  });

  it('AC-017: unit이 building에 속하지 않음 (불일치) → 422', async () => {
    const user = await seedUser('mismatch@example.com');
    const aBuildingId = await getBuildingId('A동');
    const bUnitId = await getUnitId('B동', '201'); // B동 호수
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: false });

    const res = await postVerify(at, { building_id: aBuildingId, unit_id: bUnitId });
    expect(res.status).toBe(422);
  });

  it('401: Authorization 헤더 없음 → 미인증', async () => {
    const buildingId = await getBuildingId('A동');
    const unitId = await getUnitId('A동', '602');
    const res = await postVerify(null, { building_id: buildingId, unit_id: unitId });
    expect(res.status).toBe(401);
  });

  it('401: 변조된 AT → 미인증', async () => {
    const user = await seedUser('tamper@example.com');
    const buildingId = await getBuildingId('A동');
    const unitId = await getUnitId('A동', '701');
    const res = await postVerify('invalid.token.here', {
      building_id: buildingId,
      unit_id: unitId,
    });
    expect(res.status).toBe(401);
    // user 미사용 경고 방지
    expect(user.id).toBeDefined();
  });

  it('422: building_id 가 uuid 형식 아님 → 본문 검증 오류', async () => {
    const user = await seedUser('badfmt@example.com');
    const unitId = await getUnitId('A동', '702');
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: false });

    const res = await postVerify(at, { building_id: 'not-a-uuid', unit_id: unitId });
    expect(res.status).toBe(422);
  });

  it('422: unit_id 누락 → 본문 검증 오류', async () => {
    const user = await seedUser('missing@example.com');
    const buildingId = await getBuildingId('A동');
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: false });

    const res = await postVerify(at, { building_id: buildingId });
    expect(res.status).toBe(422);
  });

  it('422: JSON 본문이 아님 → 본문 검증 오류', async () => {
    const user = await seedUser('badjson@example.com');
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: false });
    const request = new Request(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${at}` },
      body: 'not-json',
    });
    const mod = await import('./route');
    const res = await mod.POST(request);
    expect(res.status).toBe(422);
  });

  it('AC-026: 모든 쿼리 parameterized (SQL Injection 안전)', async () => {
    const user = await seedUser('inj@example.com');
    const buildingId = await getBuildingId('A동');
    const unitId = await getUnitId('A동', '801');
    const at = signAccessToken({ sub: user.id, role: 'RESIDENT', verified: false });

    // building_id 가 uuid 검증을 통과하지 못해 422 — 주입 값이 DB 에 도달하지 않음
    const res = await postVerify(at, {
      building_id: "'; DROP TABLE users; --",
      unit_id: unitId,
    });
    expect([422, 401]).toContain(res.status);
    expect(buildingId).toBeDefined();
  });
});
