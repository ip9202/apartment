/**
 * POST /api/auth/users/[id]/deactivate 통합 테스트 — TASK-AUTH-013 (Phase F, 강제 탈퇴).
 *
 * AC-AUTH-020 (ADMIN 강제 탈퇴 → 200 + 원자적 처리: status=INACTIVE, 건의 아카이브,
 *             role=RESIDENT, unit_id/verified_at NULL, ADR-005 unit_id 보존),
 * AC-AUTH-021 (탈퇴된 회원 RT 사용 → 401),
 * AC-AUTH-022 (ADMIN 자체 탈퇴 → 403),
 * AC-AUTH-023 (ADMIN 아닌 호출자 → 403),
 * AC-AUTH-024 (트랜잭션 중간 실패 → ROLLBACK + 부분 적용 방지),
 * Q2 (이미 INACTIVE 재탈퇴 → 200 idempotent),
 * 404 (미존재 target).
 *
 * TEST ISOLATION: beforeAll 마이그레이션(001~004)+시드 멱등, beforeEach truncate.
 *
 * @MX:ANCHOR: [AUTO] deactivate 테스트는 자체적으로 스키마/시드를 보장한다 (형제 테스트 부작용에 견고)
 * @MX:REASON: migration-001~004 테스트가 동일 test DB 의 스키마를 DROP/재적용하여
 *             roles/buildings/units 시드가 소실될 수 있음. RESIDENT/ADMIN 서브쿼리가 NULL 을 반환하면
 *             users.role_id NOT NULL 위반으로 케이스들이 비결정적 실패함.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from '../../../../../../lib/db';
import { runSeed } from '../../../../../../../scripts/seed';
import {
  createTestPool,
  applySql,
  readMigration,
} from '../../../../../../lib/migration-test-helpers';
import {
  hashPassword,
  signAccessToken,
  signRefreshToken,
} from '../../../../../../lib/auth';
import { REFRESH_COOKIE_NAME } from '../../../../../../lib/cookies';

const BASE_URL = 'http://localhost/api/auth/users';
const PASSWORD = 'password123';

interface DeactivateResponseBody {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

/** 마이그레이션 001~004 + 시드를 멱등하게 보장. */
async function ensureSchemaAndSeed(): Promise<void> {
  const setupPool = createTestPool();
  try {
    for (const file of [
      '001_init_users_buildings_units_roles.sql',
      '002_revoked_refresh_tokens.sql',
      '003_login_attempts.sql',
      '004_suggestions_minimal.sql',
    ]) {
      await applySql(setupPool, readMigration(file));
    }
    await runSeed(setupPool);
  } finally {
    await setupPool.end();
  }
}

/** 테스트용 사용자 INSERT — role/verified/unit 선택. */
async function seedUser(
  email: string,
  opts: { verified?: boolean; role?: string; unit?: boolean; status?: string } = {},
): Promise<{ id: string; email: string; role: string; verified: boolean }> {
  const passwordHash = hashPassword(PASSWORD);
  const verified = opts.verified === true;
  const roleCode = opts.role ?? 'RESIDENT';
  const status = opts.status ?? 'ACTIVE';

  let unitId: string | null = null;
  if (opts.unit === true) {
    // A동 101호 부여 (존재 보장)
    const u = await query<{ id: string }>(
      `SELECT u.id FROM units u JOIN buildings b ON b.id = u.building_id
       WHERE b.name = 'A동' AND u.unit_number = '101'`,
    );
    unitId = u.rows[0]?.id ?? null;
  }

  const res = await query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id, managed_building_id)
     VALUES (
       $1, $2,
       (SELECT id FROM roles WHERE code = $3),
       'email', $4,
       CASE WHEN $5 THEN now() ELSE NULL END,
       $6, NULL
     )
     RETURNING id, email`,
    [email, passwordHash, roleCode, status, verified, unitId],
  );
  return { id: res.rows[0].id, email: res.rows[0].email, role: roleCode, verified };
}

/** 사용자가 작성한 건의 INSERT (최소 스키마). */
async function seedSuggestion(
  authorId: string,
  unitId: string,
  opts: { archived?: boolean; authorLabel?: string } = {},
): Promise<{ id: string }> {
  const res = await query<{ id: string }>(
    `INSERT INTO suggestions (author_id, author_label, archived, unit_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [authorId, opts.authorLabel ?? '입주민', opts.archived === true, unitId],
  );
  return { id: res.rows[0].id };
}

/** A동 unit_id 조회. */
async function getUnitId(buildingName: string, unitNumber: string): Promise<string> {
  const res = await query<{ id: string }>(
    `SELECT u.id FROM units u JOIN buildings b ON b.id = u.building_id
     WHERE b.name = $1 AND u.unit_number = $2`,
    [buildingName, unitNumber],
  );
  if (!res.rows[0]) throw new Error(`seed unit missing: ${buildingName} ${unitNumber}`);
  return res.rows[0].id;
}

function buildDeactivateRequest(
  targetId: string,
  at: string | null,
  cookies: Record<string, string> = {},
): Request {
  const headers: Record<string, string> = {};
  if (at) headers.authorization = `Bearer ${at}`;
  const cookieParts = Object.entries(cookies).map(([k, v]) => `${k}=${v}`);
  if (cookieParts.length > 0) headers.cookie = cookieParts.join('; ');
  return new Request(`${BASE_URL}/${targetId}/deactivate`, { method: 'POST', headers });
}

async function postDeactivate(
  targetId: string,
  at: string | null,
  cookies: Record<string, string> = {},
): Promise<Response> {
  const mod = await import('./route');
  const params = Promise.resolve({ id: targetId });
  return mod.POST(buildDeactivateRequest(targetId, at, cookies), { params });
}

async function readBody(res: Response): Promise<DeactivateResponseBody> {
  return (await res.json()) as DeactivateResponseBody;
}

beforeAll(async () => {
  await ensureSchemaAndSeed();
});

beforeEach(async () => {
  await query('DELETE FROM suggestions');
  await query('DELETE FROM revoked_refresh_tokens');
  await query('DELETE FROM login_attempts');
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
});

afterAll(async () => {
  await query('DELETE FROM suggestions');
  await query('DELETE FROM revoked_refresh_tokens');
  await query('DELETE FROM login_attempts');
  await query('DELETE FROM users');
  await pool.end();
});

describe('POST /api/auth/users/[id]/deactivate — 강제 탈퇴 (TASK-AUTH-013)', () => {
  it('AC-020: ADMIN 이 RESIDENT 강제 탈퇴 → 200 + status=INACTIVE + role=RESIDENT + unit_id/verified_at NULL', async () => {
    const admin = await seedUser('admin1@example.com', { role: 'ADMIN' });
    const target = await seedUser('target1@example.com', { verified: true, unit: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await postDeactivate(target.id, at);
    expect(res.status).toBe(200);

    const row = await query<{
      status: string;
      role: string;
      unit_id: string | null;
      verified_at: string | null;
    }>(
      `SELECT u.status, r.code AS role, u.unit_id, u.verified_at
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
      [target.id],
    );
    expect(row.rows[0].status).toBe('INACTIVE');
    expect(row.rows[0].role).toBe('RESIDENT');
    expect(row.rows[0].unit_id).toBeNull();
    expect(row.rows[0].verified_at).toBeNull();
  });

  it('AC-020: 대상이 작성한 건의 → author_id=NULL, author_label="전 입주민", archived=true, unit_id 보존 (ADR-005)', async () => {
    const admin = await seedUser('admin2@example.com', { role: 'ADMIN' });
    const target = await seedUser('target2@example.com', { verified: true, unit: true });
    const unitId = await getUnitId('A동', '101');
    const sug = await seedSuggestion(target.id, unitId);
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await postDeactivate(target.id, at);
    expect(res.status).toBe(200);

    const sugRow = await query<{
      author_id: string | null;
      author_label: string;
      archived: boolean;
      unit_id: string;
    }>('SELECT author_id, author_label, archived, unit_id FROM suggestions WHERE id = $1', [
      sug.id,
    ]);
    expect(sugRow.rows[0].author_id).toBeNull();
    expect(sugRow.rows[0].author_label).toBe('전 입주민');
    expect(sugRow.rows[0].archived).toBe(true);
    // ADR-005: unit_id 는 보존 (변경 없음)
    expect(sugRow.rows[0].unit_id).toBe(unitId);
  });

  it('AC-020: 빈 suggestions 테이블에 대한 UPDATE 도 no-op 로 200', async () => {
    const admin = await seedUser('admin3@example.com', { role: 'ADMIN' });
    const target = await seedUser('target3@example.com', { verified: false });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await postDeactivate(target.id, at);
    expect(res.status).toBe(200);
  });

  it('AC-022: ADMIN 자체 탈퇴 시도 → 403 (ADMIN 미변경)', async () => {
    const admin = await seedUser('self@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await postDeactivate(admin.id, at);
    expect(res.status).toBe(403);

    const row = await query<{ status: string }>('SELECT status FROM users WHERE id = $1', [
      admin.id,
    ]);
    expect(row.rows[0].status).toBe('ACTIVE');
  });

  it('AC-023: RESIDENT 호출자 → 403', async () => {
    const caller = await seedUser('resident@example.com', { role: 'RESIDENT', verified: true });
    const target = await seedUser('victim@example.com', { verified: true });
    const at = signAccessToken({ sub: caller.id, role: 'RESIDENT', verified: true });

    const res = await postDeactivate(target.id, at);
    expect(res.status).toBe(403);

    const body = await readBody(res);
    expect(body.error?.code).toBe('FORBIDDEN');
  });

  it('AC-023: REP 호출자 → 403 (ADMIN 전용)', async () => {
    const caller = await seedUser('rep@example.com', { role: 'REP', verified: true });
    const target = await seedUser('victim2@example.com', { verified: true });
    const at = signAccessToken({ sub: caller.id, role: 'REP', verified: true });

    const res = await postDeactivate(target.id, at);
    expect(res.status).toBe(403);
  });

  it('401: Authorization 헤더 없음 → 미인증', async () => {
    const target = await seedUser('notarget@example.com', { verified: true });
    const res = await postDeactivate(target.id, null);
    expect(res.status).toBe(401);
  });

  it('401: 변조된 AT → 미인증', async () => {
    const target = await seedUser('tamper@example.com', { verified: true });
    const res = await postDeactivate(target.id, 'invalid.token.here');
    expect(res.status).toBe(401);
  });

  it('404: 미존재 target id → Not Found', async () => {
    const admin = await seedUser('admin404@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await postDeactivate('00000000-0000-0000-0000-000000000000', at);
    expect(res.status).toBe(404);
  });

  it('Q2: 이미 INACTIVE 회원 재탈퇴 → 200 idempotent (2회 호출 동일 결과)', async () => {
    const admin = await seedUser('adminq2@example.com', { role: 'ADMIN', verified: true });
    const target = await seedUser('inactive@example.com', {
      verified: true,
      unit: true,
      status: 'INACTIVE',
    });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const r1 = await postDeactivate(target.id, at);
    expect(r1.status).toBe(200);

    const r2 = await postDeactivate(target.id, at);
    expect(r2.status).toBe(200);

    // 여전히 INACTIVE
    const row = await query<{ status: string }>('SELECT status FROM users WHERE id = $1', [
      target.id,
    ]);
    expect(row.rows[0].status).toBe('INACTIVE');
  });

  it('AC-021: 탈퇴 후 target 의 유효서명 RT 로 refresh → 401 (status check)', async () => {
    const admin = await seedUser('adminrt@example.com', { role: 'ADMIN', verified: true });
    const target = await seedUser('rtuser@example.com', { verified: true, unit: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    // target 의 RT 발급 (탈퇴 전 — 유효 서명/만료)
    const rt = signRefreshToken({ sub: target.id });

    // 탈퇴 실행
    const res = await postDeactivate(target.id, at);
    expect(res.status).toBe(200);

    // RT 로 refresh 시도 → status=INACTIVE 로 인해 401
    const refreshMod = await import('../../../refresh/route');
    const refreshReq = new Request('http://localhost/api/auth/refresh', {
      method: 'POST',
      headers: { cookie: `${REFRESH_COOKIE_NAME}=${rt}` },
    });
    const refreshRes = await refreshMod.POST(refreshReq);
    expect(refreshRes.status).toBe(401);
  });

  it('AC-024: 트랜잭션 중간 실패 → ROLLBACK (users 부분 적용 방지)', async () => {
    const admin = await seedUser('admintx@example.com', { role: 'ADMIN', verified: true });
    const target = await seedUser('txtarget@example.com', { verified: true, unit: true });
    const unitId = await getUnitId('A동', '101');
    await seedSuggestion(target.id, unitId);
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    // suggestions 테이블을 강제 DROP 하여 UPDATE 단계에서 에러 유발 →
    // withTransaction 이 ROLLBACK 후 throw, route 가 500 응답해야 한다.
    // 단, route 가 별도 풀을 쓰므로, 사전에 테이블을 존재하지 않게 만들면 UPDATE 가 실패한다.
    // 단순화: dropAllAuthTables 대신 suggestions 만 RENAME 하여 쿼리 실패 유도.
    await query('ALTER TABLE suggestions RENAME TO suggestions_bak');

    try {
      const res = await postDeactivate(target.id, at);
      expect(res.status).toBe(500);

      // ROLLBACK 검증: users.status 는 여전히 ACTIVE (step a 부분 적용 없음)
      const userRow = await query<{ status: string; verified_at: string | null }>(
        'SELECT status, verified_at FROM users WHERE id = $1',
        [target.id],
      );
      expect(userRow.rows[0].status).toBe('ACTIVE');
      expect(userRow.rows[0].verified_at).not.toBeNull();
    } finally {
      // 원복 — 다른 테스트 격리 보장
      await query('ALTER TABLE suggestions_bak RENAME TO suggestions');
    }
  });

  it('AC-026: id 가 parameterized (SQL Injection 안전)', async () => {
    const admin = await seedUser('admininj@example.com', { role: 'ADMIN', verified: true });
    const target = await seedUser('injtarget@example.com', { verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    // SQL 주입 페이로드가 id path param 으로 전달되어도 DB 무변조
    const res = await postDeactivate("'; DROP TABLE users; --", at);
    // pg 는 id 를 text 로 받아 UUID cast 실패 또는 0행 → 404 또는 500
    expect([404, 400, 422, 500]).toContain(res.status);

    // users 테이블 존재 확인
    const probe = await query<{ ok: number }>('SELECT 1::int AS ok FROM users LIMIT 1');
    expect(probe).toBeDefined();
    // target 은 미탈퇴 상태 유지
    const t = await query<{ status: string }>('SELECT status FROM users WHERE id = $1', [
      target.id,
    ]);
    expect(t.rows[0].status).toBe('ACTIVE');
  });
});
