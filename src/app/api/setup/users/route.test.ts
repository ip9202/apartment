/**
 * GET /api/setup/users 통합 테스트 — SPEC-SETUP-001 Phase E (M4 회원 목록 조회).
 *
 * AC-SETUP-016 (ADMIN 회원 목록 + building/role/page 필터 → 200),
 * AC-SETUP-017 (응답에 password_hash 절대 미포함),
 * AC-SETUP-018a (미인증 → 401),
 * AC-SETUP-018b (비-ADMIN → 403),
 * AC-SETUP-019 (status 생략 시 ACTIVE 만, ?status=INACTIVE/ALL 지원).
 *
 * TEST ISOLATION: beforeAll 마이그레이션(001~005)+시드 멱등, beforeEach truncate + 재시드.
 *
 * @MX:ANCHOR: [AUTO] users 컬렉션 테스트는 자체 스키마/시드 보장 — 형제 테스트 부작용에 견고
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

const BASE_URL = 'http://localhost/api/setup/users';
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

/**
 * 테스트용 사용자 INSERT — role/unit/status/verified 선택.
 * unit_id 는 building_name + unit_number 로 해석하여 실제 units FK 에 매핑.
 */
async function seedUser(
  email: string,
  opts: {
    role?: string;
    building?: string;
    unit?: string;
    status?: string;
    verified?: boolean;
  } = {},
): Promise<{ id: string; email: string; role: string }> {
  const passwordHash = hashPassword(PASSWORD);
  const roleCode = opts.role ?? 'RESIDENT';
  const status = opts.status ?? 'ACTIVE';
  const verified = opts.verified === true;

  let unitId: string | null = null;
  if (opts.building && opts.unit) {
    const u = await query<{ id: string }>(
      `SELECT u.id FROM units u JOIN buildings b ON b.id = u.building_id
       WHERE b.name = $1 AND u.unit_number = $2`,
      [opts.building, opts.unit],
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
  return { id: res.rows[0].id, email: res.rows[0].email, role: roleCode };
}

function buildGetRequest(
  at: string | null,
  search?: string,
): Request {
  const headers: Record<string, string> = {};
  if (at) headers.authorization = `Bearer ${at}`;
  const url = search ? `${BASE_URL}${search}` : BASE_URL;
  return new Request(url, { method: 'GET', headers });
}

async function getUsers(at: string | null, search?: string): Promise<Response> {
  const mod = await import('./route');
  return mod.GET(buildGetRequest(at, search));
}

beforeAll(async () => {
  await ensureSchemaAndSeed();
});

beforeEach(async () => {
  // buildings/units/users 역의존성 순으로 정리 후 시드 복원
  await query('DELETE FROM suggestions');
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
  await query('DELETE FROM units');
  await query('DELETE FROM buildings');
  await runSeed(pool);
});

afterAll(async () => {
  await query('DELETE FROM suggestions');
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
  await query('DELETE FROM units');
  await query('DELETE FROM buildings');
  await pool.end();
});

describe('GET /api/setup/users — ADMIN 회원 목록 (M4)', () => {
  it('AC-016: ADMIN + building/role/page/limit 필터 → 200 + { data: { users, total, page, limit } }', async () => {
    const admin = await seedUser('admin1@example.com', { role: 'ADMIN', verified: true });
    // A동 RESIDENT 2명, B동 RESIDENT 1명, A동 REP 1명
    await seedUser('a1@example.com', { role: 'RESIDENT', building: 'A동', unit: '101', verified: true });
    await seedUser('a2@example.com', { role: 'RESIDENT', building: 'A동', unit: '102', verified: true });
    await seedUser('b1@example.com', { role: 'RESIDENT', building: 'B동', unit: '201', verified: true });
    await seedUser('rep1@example.com', { role: 'REP', building: 'A동', unit: '201', verified: true });

    // AC-016 예시(?building=A동)는 이해를 위한 산문이며, 실제 파라미터는 UUID (task policy #2).
    // A동 building UUID 를 조회하여 빌딩 필터로 사용.
    const adong = await query<{ id: string }>("SELECT id FROM buildings WHERE name = 'A동'");
    const adongId = adong.rows[0].id;

    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await getUsers(at, `?building=${adongId}&role=RESIDENT&page=1&limit=20`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        users: Array<{ id: string; email: string; role: string }>;
        total: number;
        page: number;
        limit: number;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.users.length).toBe(2);
    expect(body.data.total).toBe(2);
    expect(body.data.page).toBe(1);
    expect(body.data.limit).toBe(20);
    // 모두 A동 RESIDENT
    const emails = body.data.users.map((u) => u.email).sort();
    expect(emails).toEqual(['a1@example.com', 'a2@example.com']);
    // 각 user 객체의 핵심 필드 존재
    for (const u of body.data.users) {
      expect(typeof u.id).toBe('string');
      expect(typeof u.email).toBe('string');
      expect(u.role).toBe('RESIDENT');
    }
  });

  it('AC-016 (pagination): page=2, limit=2 → 올바른 슬라이스 반환', async () => {
    const admin = await seedUser('admin@example.com', { role: 'ADMIN', verified: true });
    // RESIDENT 5명 시드 (created_at 섞임; DESC 정렬)
    for (let i = 1; i <= 5; i++) {
      await seedUser(`p${i}@example.com`, { role: 'RESIDENT', verified: true });
    }
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await getUsers(at, '?role=RESIDENT&page=2&limit=2');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { users: Array<{ email: string }>; total: number; page: number; limit: number };
    };
    expect(body.data.page).toBe(2);
    expect(body.data.limit).toBe(2);
    expect(body.data.total).toBe(5);
    expect(body.data.users.length).toBe(2);
  });

  it('AC-017 / REQ-015: 응답 본문에 password_hash 절대 미포함 (보안 핵심)', async () => {
    const admin = await seedUser('admin@example.com', { role: 'ADMIN', verified: true });
    await seedUser('target@example.com', { role: 'RESIDENT', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await getUsers(at);
    expect(res.status).toBe(200);

    // (1) 직렬화된 전체 본문에 password_hash 문자열 부재
    const text = await res.clone().text();
    expect(text.toLowerCase()).not.toContain('password_hash');
    expect(text.toLowerCase()).not.toContain('passwordhash');

    // (2) 각 user 객체의 키에 password_hash 부재
    const body = (await res.json()) as {
      data: { users: Array<Record<string, unknown>> };
    };
    expect(body.data.users.length).toBeGreaterThan(0);
    for (const u of body.data.users) {
      expect(u).not.toHaveProperty('password_hash');
      expect(u).not.toHaveProperty('passwordHash');
      // 모든 키 검사 (대소문자 무관)
      const keys = Object.keys(u).map((k) => k.toLowerCase());
      expect(keys).not.toContain('password_hash');
      expect(keys).not.toContain('passwordhash');
    }
  });

  it('AC-018a: 미인증 (AT 누락) → 401', async () => {
    const res = await getUsers(null);
    expect(res.status).toBe(401);
  });

  it('AC-018a: AT 변조 → 401', async () => {
    const res = await getUsers('not-a-valid-token');
    expect(res.status).toBe(401);
  });

  it('AC-018b: 비-ADMIN (CHAIR) → 403', async () => {
    const chair = await seedUser('chair@example.com', { role: 'CHAIR', verified: true });
    const at = signAccessToken({ sub: chair.id, role: 'CHAIR', verified: true });
    const res = await getUsers(at);
    expect(res.status).toBe(403);
  });

  it('AC-018b: 비-ADMIN (RESIDENT) → 403', async () => {
    const resident = await seedUser('resident@example.com', { role: 'RESIDENT', verified: true });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });
    const res = await getUsers(at);
    expect(res.status).toBe(403);
  });

  it('AC-019: status 생략 시 ACTIVE 만 반환 (INACTIVE 제외)', async () => {
    const admin = await seedUser('admin@example.com', { role: 'ADMIN', verified: true });
    await seedUser('act1@example.com', { role: 'RESIDENT', status: 'ACTIVE', verified: true });
    await seedUser('act2@example.com', { role: 'RESIDENT', status: 'ACTIVE', verified: true });
    await seedUser('inact1@example.com', { role: 'RESIDENT', status: 'INACTIVE', verified: true });
    await seedUser('inact2@example.com', { role: 'RESIDENT', status: 'INACTIVE', verified: true });

    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await getUsers(at);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: { users: Array<{ email: string }>; total: number };
    };
    // ADMIN 1명 + ACTIVE RESIDENT 2명 = 3. INACTIVE 2명 제외.
    expect(body.data.total).toBe(3);
    const emails = body.data.users.map((u) => u.email);
    expect(emails).not.toContain('inact1@example.com');
    expect(emails).not.toContain('inact2@example.com');
  });

  it('AC-019: ?status=INACTIVE → INACTIVE 만 반환', async () => {
    const admin = await seedUser('admin@example.com', { role: 'ADMIN', verified: true });
    await seedUser('act@example.com', { role: 'RESIDENT', status: 'ACTIVE', verified: true });
    await seedUser('inact1@example.com', { role: 'RESIDENT', status: 'INACTIVE', verified: true });
    await seedUser('inact2@example.com', { role: 'RESIDENT', status: 'INACTIVE', verified: true });

    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await getUsers(at, '?status=INACTIVE');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: { users: Array<{ email: string }>; total: number };
    };
    expect(body.data.total).toBe(2);
    const emails = body.data.users.map((u) => u.email).sort();
    expect(emails).toEqual(['inact1@example.com', 'inact2@example.com']);
  });

  it('AC-019: ?status=ALL → ACTIVE + INACTIVE 모두 반환', async () => {
    const admin = await seedUser('admin@example.com', { role: 'ADMIN', verified: true });
    await seedUser('act@example.com', { role: 'RESIDENT', status: 'ACTIVE', verified: true });
    await seedUser('inact@example.com', { role: 'RESIDENT', status: 'INACTIVE', verified: true });

    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await getUsers(at, '?status=ALL');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: { users: Array<{ email: string }>; total: number };
    };
    // ADMIN(ACTIVE) + act(ACTIVE) + inact(INACTIVE) = 3
    expect(body.data.total).toBe(3);
  });

  it('AC-019: ?status=UNKNOWN → 400 (unknown status 값)', async () => {
    const admin = await seedUser('admin@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await getUsers(at, '?status=UNKNOWN');
    expect(res.status).toBe(400);
  });

  it('EC: building UUID 형식 오류 → 400', async () => {
    const admin = await seedUser('admin@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await getUsers(at, '?building=not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('EC: unknown role 코드 → 400 (fail-fast)', async () => {
    const admin = await seedUser('admin@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await getUsers(at, '?role=SUPERUSER');
    expect(res.status).toBe(400);
  });

  it('EC: page=0 → 400 (유효하지 않은 페이지)', async () => {
    const admin = await seedUser('admin@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await getUsers(at, '?page=0');
    expect(res.status).toBe(400);
  });

  it('EC: limit=abc → 400 (숫자 아님)', async () => {
    const admin = await seedUser('admin@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await getUsers(at, '?limit=abc');
    expect(res.status).toBe(400);
  });

  it('필터 생략 시: 모든 ACTIVE 회원 반환, created_at DESC 정렬', async () => {
    const admin = await seedUser('admin@example.com', { role: 'ADMIN', verified: true });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await getUsers(at);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: { users: Array<{ id: string }>; total: number };
    };
    expect(body.data.total).toBe(1);
  });
});
