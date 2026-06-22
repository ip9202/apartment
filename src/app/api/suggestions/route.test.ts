/**
 * GET/POST /api/suggestions 통합 테스트 — SPEC-SUGGEST-001 M1(등록) + M4(목록).
 *
 * AC-SUGGEST-001 (RESIDENT 등록 → 201),
 * AC-SUGGEST-002 (ADMIN 등록 → 403),
 * AC-SUGGEST-003 (미존재 category_id → 422),
 * AC-SUGGEST-004 (미인증 POST → 401),
 * AC-SUGGEST-005 (unit_id NULL 사용자 등록 → 403),
 * AC-SUGGEST-021~026 (목록 역할별 필터링, content 미포함, 미인증 401, 페이지네이션).
 *
 * TEST ISOLATION: beforeAll 마이그레이션(001~007)+시드 멱등, beforeEach truncate + 기본 시드 복원.
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

const BASE_URL = 'http://localhost/api/suggestions';
const PASSWORD = 'password123';

/** 마이그레이션 001~007 + 시드를 멱등하게 보장. */
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

/** A동 101호 unit_id 조회 (seed 된 데이터). */
async function getUnitId(buildingName: string, unitNumber: string): Promise<string> {
  const res = await query<{ id: string }>(
    `SELECT u.id FROM units u JOIN buildings b ON b.id = u.building_id
     WHERE b.name = $1 AND u.unit_number = $2`,
    [buildingName, unitNumber],
  );
  return res.rows[0].id;
}

/** 테스트용 사용자 INSERT — role + unit 선택. */
async function seedUser(
  email: string,
  opts: { role?: string; unitId?: string | null; managedBuildingId?: string | null } = {},
): Promise<{ id: string; email: string; role: string }> {
  const passwordHash = hashPassword(PASSWORD);
  const roleCode = opts.role ?? 'RESIDENT';
  const res = await query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id, managed_building_id)
     VALUES (
       $1, $2,
       (SELECT id FROM roles WHERE code = $3),
       'email', 'ACTIVE', now(), $4, $5
     )
     RETURNING id, email`,
    [
      email,
      passwordHash,
      roleCode,
      opts.unitId !== undefined ? opts.unitId : null,
      opts.managedBuildingId !== undefined ? opts.managedBuildingId : null,
    ],
  );
  return { id: res.rows[0].id, email: res.rows[0].email, role: roleCode };
}

/** suggestion category_id 조회 (name 기준). */
async function getCategoryId(name: string): Promise<string> {
  const res = await query<{ id: string }>(
    'SELECT id FROM suggestion_categories WHERE name = $1',
    [name],
  );
  return res.rows[0].id;
}

/** A동 building_id 조회. */
async function getBuildingId(name: string): Promise<string> {
  const res = await query<{ id: string }>('SELECT id FROM buildings WHERE name = $1', [name]);
  return res.rows[0].id;
}

function buildJsonRequest(
  method: string,
  body: unknown,
  at: string | null,
  url: string = BASE_URL,
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
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

async function postSuggestion(body: unknown, at: string | null): Promise<Response> {
  const mod = await import('./route');
  return mod.POST(buildJsonRequest('POST', body, at));
}

async function getSuggestions(at: string | null, qs: string = ''): Promise<Response> {
  const mod = await import('./route');
  return mod.GET(buildGetRequest(at, qs ? `${BASE_URL}?${qs}` : BASE_URL));
}

beforeAll(async () => {
  await ensureSchemaAndSeed();
});

beforeEach(async () => {
  await query('DELETE FROM suggestion_replies');
  await query('DELETE FROM suggestions');
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
});

afterAll(async () => {
  await query('DELETE FROM suggestion_replies');
  await query('DELETE FROM suggestions');
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
  await pool.end();
});

describe('POST /api/suggestions — 건의 등록 (M1, REQ-SUGGEST-001~005)', () => {
  it('AC-001: RESIDENT 등록 → 201 + DB 행 생성 (author_id, unit_id 귀속, status 접수, is_public false)', async () => {
    const unitId = await getUnitId('A동', '101');
    const resident = await seedUser('r1@example.com', { role: 'RESIDENT', unitId });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });
    const categoryId = await getCategoryId('시설');

    const res = await postSuggestion(
      {
        title: '엘리베이터 고장',
        content: 'A동 엘리베이터가 멈췄습니다.',
        category_id: categoryId,
        is_public: false,
      },
      at,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        id: string;
        title: string;
        category_name: string;
        is_public: boolean;
        status: string;
        author_label: string;
        building: string;
        unit: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.title).toBe('엘리베이터 고장');
    expect(body.data.category_name).toBe('시설');
    expect(body.data.is_public).toBe(false);
    expect(body.data.status).toBe('접수');
    expect(body.data.author_label).toBe('입주민');
    expect(body.data.building).toBe('A동');
    expect(body.data.unit).toBe('101');

    const row = await query<{
      author_id: string;
      unit_id: string;
      archived: boolean;
      status: string;
    }>('SELECT author_id, unit_id, archived, status FROM suggestions WHERE id = $1', [
      body.data.id,
    ]);
    expect(row.rows[0].author_id).toBe(resident.id);
    expect(row.rows[0].unit_id).toBe(unitId);
    expect(row.rows[0].archived).toBe(false);
    expect(row.rows[0].status).toBe('접수');
  });

  it('AC-001b: 공개 건의 등록 → is_public true 저장', async () => {
    const unitId = await getUnitId('A동', '102');
    const resident = await seedUser('r2@example.com', { role: 'RESIDENT', unitId });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });
    const categoryId = await getCategoryId('주차');

    const res = await postSuggestion(
      { title: '주차장 확대', content: '주차 공간 부족합니다.', category_id: categoryId, is_public: true },
      at,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { is_public: boolean } };
    expect(body.data.is_public).toBe(true);
  });

  it('AC-002: ADMIN 등록 → 403 (관리사무소는 건의 처리 주체)', async () => {
    const admin = await seedUser('admin1@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const categoryId = await getCategoryId('시설');

    const res = await postSuggestion(
      { title: '제목', content: '내용', category_id: categoryId, is_public: false },
      at,
    );
    expect(res.status).toBe(403);
    const count = await query('SELECT COUNT(*)::int AS n FROM suggestions');
    expect((count.rows[0] as { n: number }).n).toBe(0);
  });

  it('AC-003: 미존재 category_id 등록 → 422', async () => {
    const unitId = await getUnitId('A동', '201');
    const resident = await seedUser('r3@example.com', { role: 'RESIDENT', unitId });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });

    const res = await postSuggestion(
      {
        title: '제목',
        content: '내용',
        category_id: '00000000-0000-0000-0000-000000000000',
        is_public: false,
      },
      at,
    );
    expect(res.status).toBe(422);
  });

  it('AC-004: 미인증 POST (AT 없음) → 401', async () => {
    const categoryId = await getCategoryId('시설');
    const res = await postSuggestion(
      { title: '제목', content: '내용', category_id: categoryId, is_public: false },
      null,
    );
    expect(res.status).toBe(401);
  });

  it('401: 변조된 AT → 401', async () => {
    const categoryId = await getCategoryId('시설');
    const res = await postSuggestion(
      { title: '제목', content: '내용', category_id: categoryId, is_public: false },
      'invalid.token.here',
    );
    expect(res.status).toBe(401);
  });

  it('AC-005: unit_id NULL (미인증 사용자) 등록 → 403', async () => {
    const resident = await seedUser('r4@example.com', { role: 'RESIDENT', unitId: null });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });
    const categoryId = await getCategoryId('시설');

    const res = await postSuggestion(
      { title: '제목', content: '내용', category_id: categoryId, is_public: false },
      at,
    );
    expect(res.status).toBe(403);
  });

  it('EC: title 101자 → 422', async () => {
    const unitId = await getUnitId('A동', '202');
    const resident = await seedUser('r5@example.com', { role: 'RESIDENT', unitId });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });
    const categoryId = await getCategoryId('시설');

    const res = await postSuggestion(
      { title: '가'.repeat(101), content: '내용', category_id: categoryId, is_public: false },
      at,
    );
    expect(res.status).toBe(422);
  });

  it('EC: content 5001자 → 422 (SUGGEST는 5000자 제한, NOTICE 10000자와 상이)', async () => {
    const unitId = await getUnitId('A동', '203');
    const resident = await seedUser('r6@example.com', { role: 'RESIDENT', unitId });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });
    const categoryId = await getCategoryId('시설');

    const res = await postSuggestion(
      { title: '제목', content: '가'.repeat(5001), category_id: categoryId, is_public: false },
      at,
    );
    expect(res.status).toBe(422);
  });

  it('EC: title 빈 문자열 → 422', async () => {
    const unitId = await getUnitId('A동', '204');
    const resident = await seedUser('r7@example.com', { role: 'RESIDENT', unitId });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });
    const categoryId = await getCategoryId('시설');

    const res = await postSuggestion(
      { title: '', content: '내용', category_id: categoryId, is_public: false },
      at,
    );
    expect(res.status).toBe(422);
  });
});

describe('GET /api/suggestions — 역할별 목록 (M4, REQ-SUGGEST-018~022)', () => {
  /** 직접 suggestions 행 INSERT (라우트 우회, 시드 데이터). */
  async function seedSuggestion(opts: {
    authorId: string | null;
    unitId: string;
    title: string;
    isPublic: boolean;
    categoryId: string;
    authorLabel?: string;
    archived?: boolean;
    status?: string;
  }): Promise<string> {
    const res = await query<{ id: string }>(
      `INSERT INTO suggestions (author_id, author_label, unit_id, category_id, title, content, is_public, status, archived)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        opts.authorId,
        opts.authorLabel ?? '입주민',
        opts.unitId,
        opts.categoryId,
        opts.title,
        '내용',
        opts.isPublic,
        opts.status ?? '접수',
        opts.archived ?? false,
      ],
    );
    return res.rows[0].id;
  }

  it('AC-021: RESIDENT 목록 → 공개 전체 + 본인 비공개 (타인 비공개 제외)', async () => {
    const a101 = await getUnitId('A동', '101');
    const a102 = await getUnitId('A동', '102');
    const categoryId = await getCategoryId('시설');
    const me = await seedUser('me@example.com', { role: 'RESIDENT', unitId: a101 });
    const other = await seedUser('other@example.com', { role: 'RESIDENT', unitId: a102 });
    const at = signAccessToken({ sub: me.id, role: 'RESIDENT', verified: true });

    // 공개(본인), 비공개(본인), 공개(타인), 비공개(타인) → 3개만 보여야 함 (타인 비공개 제외)
    await seedSuggestion({ authorId: me.id, unitId: a101, title: '내 공개', isPublic: true, categoryId });
    await seedSuggestion({ authorId: me.id, unitId: a101, title: '내 비공개', isPublic: false, categoryId });
    await seedSuggestion({ authorId: other.id, unitId: a102, title: '타인 공개', isPublic: true, categoryId });
    await seedSuggestion({ authorId: other.id, unitId: a102, title: '타인 비공개', isPublic: false, categoryId });

    const res = await getSuggestions(at);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { suggestions: Array<{ title: string }>; total: number };
    };
    expect(body.data.total).toBe(3);
    const titles = body.data.suggestions.map((s) => s.title).sort();
    expect(titles).toEqual(['내 공개', '내 비공개', '타인 공개']);
  });

  it('AC-022: CHAIR 목록 → 전체 (공개/비공개 무관)', async () => {
    const a101 = await getUnitId('A동', '101');
    const a102 = await getUnitId('A동', '102');
    const categoryId = await getCategoryId('시설');
    const r1 = await seedUser('c1@example.com', { role: 'RESIDENT', unitId: a101 });
    const r2 = await seedUser('c2@example.com', { role: 'RESIDENT', unitId: a102 });
    const chair = await seedUser('chair@example.com', { role: 'CHAIR' });
    const at = signAccessToken({ sub: chair.id, role: 'CHAIR', verified: true });

    await seedSuggestion({ authorId: r1.id, unitId: a101, title: '비공개1', isPublic: false, categoryId });
    await seedSuggestion({ authorId: r2.id, unitId: a102, title: '공개1', isPublic: true, categoryId });

    const res = await getSuggestions(at);
    const body = (await res.json()) as { data: { total: number } };
    expect(body.data.total).toBe(2);
  });

  it('AC-023: ADMIN 목록 → 전체 (CHAIR 와 동일)', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const r1 = await seedUser('a1@example.com', { role: 'RESIDENT', unitId: a101 });
    const admin = await seedUser('admin-l@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    await seedSuggestion({ authorId: r1.id, unitId: a101, title: '비공개', isPublic: false, categoryId });

    const res = await getSuggestions(at);
    const body = (await res.json()) as { data: { total: number } };
    expect(body.data.total).toBe(1);
  });

  it('AC-024: REP 목록 → 공개 전체 + 본인 비공개 + 담당 동 비공개', async () => {
    const aBuilding = await getBuildingId('A동');
    const a101 = await getUnitId('A동', '101');
    const b201 = await getUnitId('B동', '201');
    const categoryId = await getCategoryId('시설');
    const aResident = await seedUser('ar@example.com', { role: 'RESIDENT', unitId: a101 });
    const bResident = await seedUser('br@example.com', { role: 'RESIDENT', unitId: b201 });
    const rep = await seedUser('rep@example.com', { role: 'REP', managedBuildingId: aBuilding });
    const at = signAccessToken({ sub: rep.id, role: 'REP', verified: true });

    // A동 비공개(담당), B동 비공개(비담당), 공개 1
    await seedSuggestion({ authorId: aResident.id, unitId: a101, title: 'A동 비공개', isPublic: false, categoryId });
    await seedSuggestion({ authorId: bResident.id, unitId: b201, title: 'B동 비공개', isPublic: false, categoryId });
    await seedSuggestion({ authorId: bResident.id, unitId: b201, title: '공개', isPublic: true, categoryId });

    const res = await getSuggestions(at);
    const body = (await res.json()) as {
      data: { suggestions: Array<{ title: string }>; total: number };
    };
    expect(body.data.total).toBe(2);
    const titles = body.data.suggestions.map((s) => s.title).sort();
    expect(titles).toEqual(['A동 비공개', '공개']);
  });

  it('AC-025: 목록 응답에 content 필드 부재', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const r1 = await seedUser('nc@example.com', { role: 'RESIDENT', unitId: a101 });
    const at = signAccessToken({ sub: r1.id, role: 'RESIDENT', verified: true });
    await seedSuggestion({ authorId: r1.id, unitId: a101, title: '공개', isPublic: true, categoryId });

    const res = await getSuggestions(at);
    const body = (await res.json()) as { data: { suggestions: Array<Record<string, unknown>> } };
    expect(body.data.suggestions.length).toBe(1);
    expect(body.data.suggestions[0]).not.toHaveProperty('content');
  });

  it('AC-026: 미인증 GET → 401', async () => {
    const res = await getSuggestions(null);
    expect(res.status).toBe(401);
  });

  it('EC: 페이지네이션 기본값 20 + 최대 100', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const r1 = await seedUser('pg@example.com', { role: 'RESIDENT', unitId: a101 });
    const at = signAccessToken({ sub: r1.id, role: 'RESIDENT', verified: true });
    for (let i = 0; i < 25; i++) {
      await seedSuggestion({ authorId: r1.id, unitId: a101, title: `T${i}`, isPublic: true, categoryId });
    }

    const res1 = await getSuggestions(at);
    const body1 = (await res1.json()) as { data: { suggestions: unknown[]; total: number } };
    expect(body1.data.suggestions.length).toBe(20);
    expect(body1.data.total).toBe(25);

    const res2 = await getSuggestions(at, 'limit=200');
    const body2 = (await res2.json()) as { data: { suggestions: unknown[] } };
    expect(body2.data.suggestions.length).toBe(25);
  });

  it('필터: status / category_id / is_public 적용', async () => {
    const a101 = await getUnitId('A동', '101');
    const catFacility = await getCategoryId('시설');
    const catParking = await getCategoryId('주차');
    const r1 = await seedUser('flt@example.com', { role: 'RESIDENT', unitId: a101 });
    const at = signAccessToken({ sub: r1.id, role: 'RESIDENT', verified: true });

    await seedSuggestion({ authorId: r1.id, unitId: a101, title: '공개-시설', isPublic: true, categoryId: catFacility });
    await seedSuggestion({ authorId: r1.id, unitId: a101, title: '공개-주차', isPublic: true, categoryId: catParking });
    await seedSuggestion({ authorId: r1.id, unitId: a101, title: '비공개-시설', isPublic: false, categoryId: catFacility });

    const res = await getSuggestions(at, `category_id=${catFacility}&is_public=true`);
    const body = (await res.json()) as { data: { suggestions: Array<{ title: string }>; total: number } };
    expect(body.data.total).toBe(1);
    expect(body.data.suggestions[0].title).toBe('공개-시설');
  });
});
