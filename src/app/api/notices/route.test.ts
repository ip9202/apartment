/**
 * GET/POST /api/notices 통합 테스트 — SPEC-NOTICE-001 M1(등록) + M4(목록).
 *
 * AC-NOTICE-003 (ADMIN 등록 → 201),
 * AC-NOTICE-004 (미존재 category_id → 422),
 * AC-NOTICE-005 (미인증 POST → 401),
 * AC-NOTICE-006 (비-ADMIN POST → 403),
 * AC-NOTICE-016 (인증 목록 → 200 + 필터),
 * AC-NOTICE-017 (목록 content 미포함),
 * AC-NOTICE-018 (미인증 GET → 401),
 * AC-NOTICE-019 (전체 역할 GET 허용),
 * EC-NOTICE-001 (title 101자 → 422),
 * EC-NOTICE-002 (content 10001자 → 422),
 * EC-NOTICE-004 (title 빈문자열 → 422),
 * EC-NOTICE-005 (페이지네이션 기본/최대),
 * EC-NOTICE-006 (is_pinned 요청 무시).
 *
 * TEST ISOLATION: beforeAll 마이그레이션(001~006)+시드 멱등, beforeEach truncate + 기본 시드 복원.
 *
 * @MX:ANCHOR: [AUTO] notices 컬렉션 테스트는 자체 스키마/시드 보장 — 형제 테스트 부작용에 견고
 * @MX:REASON: AUTH/SETUP migration 테스트가 동일 test DB 스키마를 DROP/재적용하여 시드 소실 가능.
 *             NOTICE route 는 notice_categories 시드 + ADMIN 사용자 서브쿼리에 의존하므로
 *             비결정적 실패를 막기 위해 beforeAll 에서 스키마+시드를 멱등 보장한다.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from '../../../lib/db';
import { runSeed } from '../../../../scripts/seed';
import {
  createTestPool,
  applySql,
  readMigration,
} from '../../../lib/migration-test-helpers';
import { hashPassword, signAccessToken } from '../../../lib/auth';

const BASE_URL = 'http://localhost/api/notices';
const PASSWORD = 'password123';

/** 마이그레이션 001~006 + 시드를 멱등하게 보장. */
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
    ]) {
      await applySql(setupPool, readMigration(file));
    }
    await runSeed(setupPool);
  } finally {
    await setupPool.end();
  }
}

/** 테스트용 사용자 INSERT — role 선택. */
async function seedUser(
  email: string,
  opts: { role?: string } = {},
): Promise<{ id: string; email: string; role: string }> {
  const passwordHash = hashPassword(PASSWORD);
  const roleCode = opts.role ?? 'RESIDENT';
  const res = await query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id, managed_building_id)
     VALUES (
       $1, $2,
       (SELECT id FROM roles WHERE code = $3),
       'email', 'ACTIVE', now(), NULL, NULL
     )
     RETURNING id, email`,
    [email, passwordHash, roleCode],
  );
  return { id: res.rows[0].id, email: res.rows[0].email, role: roleCode };
}

/** category_id 조회 (name 기준). */
async function getCategoryId(name: string): Promise<string> {
  const res = await query<{ id: string }>(
    'SELECT id FROM notice_categories WHERE name = $1',
    [name],
  );
  return res.rows[0].id;
}

function buildJsonRequest(
  method: string,
  body: unknown,
  at: string | null,
  url: string = BASE_URL,
): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (at) headers.authorization = `Bearer ${at}`;
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function buildGetRequest(at: string | null, url: string = BASE_URL): Request {
  const headers: Record<string, string> = {};
  if (at) headers.authorization = `Bearer ${at}`;
  return new Request(url, { method: 'GET', headers });
}

async function postNotice(body: unknown, at: string | null): Promise<Response> {
  const mod = await import('./route');
  return mod.POST(buildJsonRequest('POST', body, at));
}

async function getNotices(at: string | null, qs: string = ''): Promise<Response> {
  const mod = await import('./route');
  return mod.GET(buildGetRequest(at, qs ? `${BASE_URL}?${qs}` : BASE_URL));
}

beforeAll(async () => {
  await ensureSchemaAndSeed();
});

beforeEach(async () => {
  await query('DELETE FROM notices');
  await query('DELETE FROM suggestions');
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
});

afterAll(async () => {
  await query('DELETE FROM notices');
  await query('DELETE FROM suggestions');
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
  await pool.end();
});

describe('POST /api/notices — ADMIN 공지 등록 (M1, REQ-NOTICE-001~003b)', () => {
  it('AC-003: ADMIN 등록 → 201 + { id, title, category명, content, author_id, created_at } + DB 행 생성', async () => {
    const admin = await seedUser('admin1@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const categoryId = await getCategoryId('시설');

    const res = await postNotice(
      { title: '엘리베이터 점검 안내', content: '점검 예정입니다.', category_id: categoryId },
      at,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        id: string;
        title: string;
        category_name: string;
        content: string;
        author_id: string;
        created_at: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.title).toBe('엘리베이터 점검 안내');
    expect(body.data.category_name).toBe('시설');
    expect(body.data.author_id).toBe(admin.id);

    const row = await query<{ title: string; is_pinned: boolean }>(
      'SELECT title, is_pinned FROM notices WHERE id = $1',
      [body.data.id],
    );
    expect(row.rows[0].title).toBe('엘리베이터 점검 안내');
    expect(row.rows[0].is_pinned).toBe(false);
  });

  it('AC-004: 미존재 category_id 등록 → 422', async () => {
    const admin = await seedUser('admin2@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await postNotice(
      {
        title: '제목',
        content: '내용',
        category_id: '00000000-0000-0000-0000-000000000000',
      },
      at,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');

    // 행 생성되지 않음
    const count = await query('SELECT COUNT(*)::int AS n FROM notices');
    expect((count.rows[0] as { n: number }).n).toBe(0);
  });

  it('AC-005: 미인증 POST (AT 없음) → 401', async () => {
    const categoryId = await getCategoryId('일반');
    const res = await postNotice(
      { title: '제목', content: '내용', category_id: categoryId },
      null,
    );
    expect(res.status).toBe(401);
  });

  it('401: 변조된 AT → 401', async () => {
    const categoryId = await getCategoryId('일반');
    const res = await postNotice(
      { title: '제목', content: '내용', category_id: categoryId },
      'invalid.token.here',
    );
    expect(res.status).toBe(401);
  });

  it('AC-006: 비-ADMIN(RESIDENT) 등록 → 403', async () => {
    const resident = await seedUser('resident1@example.com', { role: 'RESIDENT' });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });
    const categoryId = await getCategoryId('일반');

    const res = await postNotice(
      { title: '제목', content: '내용', category_id: categoryId },
      at,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');

    const count = await query('SELECT COUNT(*)::int AS n FROM notices');
    expect((count.rows[0] as { n: number }).n).toBe(0);
  });

  it('EC-001: title 101자 → 422', async () => {
    const admin = await seedUser('admin3@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const categoryId = await getCategoryId('일반');

    const res = await postNotice(
      { title: '가'.repeat(101), content: '내용', category_id: categoryId },
      at,
    );
    expect(res.status).toBe(422);
  });

  it('EC-002: content 10001자 → 422', async () => {
    const admin = await seedUser('admin4@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const categoryId = await getCategoryId('일반');

    const res = await postNotice(
      { title: '제목', content: '가'.repeat(10001), category_id: categoryId },
      at,
    );
    expect(res.status).toBe(422);
  });

  it('EC-004: title 빈 문자열 → 422', async () => {
    const admin = await seedUser('admin5@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const categoryId = await getCategoryId('일반');

    const res = await postNotice(
      { title: '', content: '내용', category_id: categoryId },
      at,
    );
    expect(res.status).toBe(422);
  });

  it('EC-006: 본문에 is_pinned:true 포함 → 201 + 저장된 행 is_pinned=false (본 SPEC 미노출)', async () => {
    const admin = await seedUser('admin6@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const categoryId = await getCategoryId('일반');

    const res = await postNotice(
      { title: '제목', content: '내용', category_id: categoryId, is_pinned: true },
      at,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string } };
    const row = await query<{ is_pinned: boolean }>(
      'SELECT is_pinned FROM notices WHERE id = $1',
      [body.data.id],
    );
    expect(row.rows[0].is_pinned).toBe(false);
  });
});

describe('GET /api/notices — 인증 사용자 공지 목록 (M4, REQ-NOTICE-011~013a)', () => {
  async function seedNotices(count: number, categoryName: string): Promise<void> {
    const admin = await seedUser(`seeder-${categoryName}-${count}@example.com`, { role: 'ADMIN' });
    const categoryId = await getCategoryId(categoryName);
    for (let i = 0; i < count; i++) {
      await query(
        `INSERT INTO notices (author_id, category_id, title, content)
         VALUES ($1, $2, $3, $4)`,
        [admin.id, categoryId, `제목-${i}`, `내용-${i}`],
      );
    }
  }

  it('AC-016: RESIDENT 목록 → 200 + { data: { notices, total } } + category_id 필터', async () => {
    const resident = await seedUser('r-list@example.com', { role: 'RESIDENT' });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });
    await seedNotices(2, '시설');
    await seedNotices(3, '일반');
    const facilityId = await getCategoryId('시설');

    const res = await getNotices(at, `category_id=${facilityId}&page=1&limit=20`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { notices: Array<{ id: string; title: string; category_name: string; created_at: string }>; total: number };
    };
    expect(body.success).toBe(true);
    expect(body.data.notices.length).toBe(2);
    expect(body.data.total).toBe(2);
    expect(body.data.notices[0].category_name).toBe('시설');
  });

  it('AC-017: 목록 응답에 content 필드 부재', async () => {
    const resident = await seedUser('r-content@example.com', { role: 'RESIDENT' });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });
    await seedNotices(1, '일반');

    const res = await getNotices(at);
    const body = (await res.json()) as { data: { notices: Array<Record<string, unknown>> } };
    expect(body.data.notices.length).toBe(1);
    expect(body.data.notices[0]).not.toHaveProperty('content');
  });

  it('AC-018: 미인증 GET → 401', async () => {
    const res = await getNotices(null);
    expect(res.status).toBe(401);
  });

  it('401: 변조된 AT GET → 401', async () => {
    const res = await getNotices('invalid.token.here');
    expect(res.status).toBe(401);
  });

  it('AC-019: 전체 역할(RESIDENT/REP/AUDITOR/CHAIR/ADMIN) GET → 200', async () => {
    await seedNotices(1, '일반');
    for (const role of ['RESIDENT', 'REP', 'AUDITOR', 'CHAIR', 'ADMIN']) {
      const u = await seedUser(`${role.toLowerCase()}-list@example.com`, { role });
      const at = signAccessToken({ sub: u.id, role, verified: true });
      const res = await getNotices(at);
      expect(res.status).toBe(200);
    }
  });

  it('EC-005: 페이지네이션 기본값(20) + 최대 100 제한', async () => {
    const resident = await seedUser('r-page@example.com', { role: 'RESIDENT' });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });
    await seedNotices(25, '일반');

    // 기본값 → 20개, total=25
    const res1 = await getNotices(at);
    const body1 = (await res1.json()) as { data: { notices: unknown[]; total: number } };
    expect(body1.data.notices.length).toBe(20);
    expect(body1.data.total).toBe(25);

    // limit=200 → 100으로 제한
    const res2 = await getNotices(at, 'limit=200');
    const body2 = (await res2.json()) as { data: { notices: unknown[] } };
    expect(body2.data.notices.length).toBe(25); // 25행 전체 (100 제한보다 작음)
  });

  it('목록 정렬: created_at DESC (최신순)', async () => {
    const resident = await seedUser('r-sort@example.com', { role: 'RESIDENT' });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });
    const admin = await seedUser('sort-admin@example.com', { role: 'ADMIN' });
    const categoryId = await getCategoryId('일반');
    const titles: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await query<{ title: string }>(
        `INSERT INTO notices (author_id, category_id, title, content)
         VALUES ($1, $2, $3, $4) RETURNING title`,
        [admin.id, categoryId, `T${i}`, `C${i}`],
      );
      titles.push(r.rows[0].title);
      // 미세 시간차 보장 (created_at 해상도)
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const res = await getNotices(at);
    const body = (await res.json()) as { data: { notices: Array<{ title: string }> } };
    const got = body.data.notices.map((n) => n.title);
    expect(got).toEqual(['T2', 'T1', 'T0']);
  });
});
