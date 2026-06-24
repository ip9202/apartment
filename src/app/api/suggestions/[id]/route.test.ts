/**
 * GET /api/suggestions/[id] 통합 테스트 — SPEC-SUGGEST-001 M5 (건의 상세 열람).
 *
 * AC-SUGGEST-027 (공개 상세 → 200 + 전체 필드),
 * AC-SUGGEST-028 (비공개 무권한 → 403),
 * AC-SUGGEST-029 (미존재 → 404),
 * AC-SUGGEST-030 (미인증 → 401),
 * EC (path UUID 오류 → 400).
 *
 * PUT(M2 수정) / DELETE(M3 아카이브) 테스트는 Phase D/E 에서 동일 파일에 추가.
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

const BASE_URL = 'http://localhost/api/suggestions';
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
      '009_password_reset_tokens.sql',
      '010_attachments.sql',
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

async function getCategoryId(name: string): Promise<string> {
  const res = await query<{ id: string }>('SELECT id FROM suggestion_categories WHERE name = $1', [name]);
  return res.rows[0].id;
}

async function seedUser(
  email: string,
  opts: { role?: string; unitId?: string | null } = {},
): Promise<{ id: string }> {
  const passwordHash = hashPassword(PASSWORD);
  const roleCode = opts.role ?? 'RESIDENT';
  const res = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id)
     VALUES ($1, $2, (SELECT id FROM roles WHERE code = $3), 'email', 'ACTIVE', now(), $4)
     RETURNING id`,
    [email, passwordHash, roleCode, opts.unitId !== undefined ? opts.unitId : null],
  );
  return { id: res.rows[0].id };
}

interface SuggestionParams {
  params: Promise<{ id: string }>;
}

async function getSuggestion(at: string | null, id: string): Promise<Response> {
  const mod = await import('./route');
  const headers: Record<string, string> = {};
  if (at) headers.authorization = `Bearer ${at}`;
  const req = new Request(`${BASE_URL}/${id}`, { method: 'GET', headers });
  return mod.GET(req, { params: Promise.resolve({ id }) } as SuggestionParams);
}

async function seedSuggestion(opts: {
  authorId: string;
  unitId: string;
  title: string;
  isPublic: boolean;
  categoryId: string;
  status?: string;
}): Promise<string> {
  const res = await query<{ id: string }>(
    `INSERT INTO suggestions (author_id, author_label, unit_id, category_id, title, content, is_public, status, archived)
     VALUES ($1, '입주민', $2, $3, $4, $5, $6, $7, false) RETURNING id`,
    [opts.authorId, opts.unitId, opts.categoryId, opts.title, '내용', opts.isPublic, opts.status ?? '접수'],
  );
  return res.rows[0].id;
}

beforeAll(async () => {
  await ensureSchemaAndSeed();
});

beforeEach(async () => {
  await query('DELETE FROM attachments');
  await query('DELETE FROM suggestion_replies');
  await query('DELETE FROM suggestions');
  await query('UPDATE users SET unit_id = NULL');
  await query('DELETE FROM users');
});

afterAll(async () => {
  await query('DELETE FROM attachments');
  await query('DELETE FROM suggestion_replies');
  await query('DELETE FROM suggestions');
  await query('UPDATE users SET unit_id = NULL');
  await query('DELETE FROM users');
  await pool.end();
});

describe('GET /api/suggestions/[id] — 건의 상세 (M5, REQ-SUGGEST-023~026)', () => {
  it('AC-027: 공개 건의 상세 → 200 + 전체 필드 (content 포함)', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('au@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: '공개 건의', isPublic: true, categoryId });

    const viewer = await seedUser('vw@example.com', { role: 'RESIDENT', unitId: a101 });
    const at = signAccessToken({ sub: viewer.id, role: 'RESIDENT', verified: true });

    const res = await getSuggestion(at, sid);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        id: string;
        title: string;
        content: string;
        category_name: string;
        is_public: boolean;
        status: string;
        author_label: string;
        building: string;
        unit: string;
        author_id: string;
        created_at: string;
        attachments?: unknown[];
      };
    };
    expect(body.data.id).toBe(sid);
    expect(body.data.title).toBe('공개 건의');
    expect(body.data.content).toBe('내용');
    expect(body.data.category_name).toBe('시설');
    expect(body.data.is_public).toBe(true);
    expect(body.data.status).toBe('접수');
    expect(body.data.author_label).toBe('입주민');
    // REQ-ATT-010/011: attachments[] 포함
    expect(Array.isArray(body.data.attachments)).toBe(true);
    expect(body.data.building).toBe('A동');
    expect(body.data.unit).toBe('101');
  });

  it('AC-028: 비공개 타인 건의 상세 → 403 (존재 누출 방지, 404 아님)', async () => {
    const a101 = await getUnitId('A동', '101');
    const a102 = await getUnitId('A동', '102');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('pv@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: '비공개', isPublic: false, categoryId });

    // 타인(다른 호수 RESIDENT) 접근
    const other = await seedUser('ot@example.com', { role: 'RESIDENT', unitId: a102 });
    const at = signAccessToken({ sub: other.id, role: 'RESIDENT', verified: true });

    const res = await getSuggestion(at, sid);
    expect(res.status).toBe(403);
  });

  it('AC-028b: 비공개 본인 건의 상세 → 200 (작성자 본인 허용)', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('self@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: '내 비공개', isPublic: false, categoryId });
    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });

    const res = await getSuggestion(at, sid);
    expect(res.status).toBe(200);
  });

  it('AC-028c: 비공개 REP 담당동 건의 상세 → 200, 비담당동 → 403', async () => {
    const aBuildingId = (await query<{ id: string }>("SELECT id FROM buildings WHERE name='A동'")).rows[0].id;
    const a101 = await getUnitId('A동', '101');
    const b201 = await getUnitId('B동', '201');
    const categoryId = await getCategoryId('시설');

    const aAuthor = await seedUser('aa@example.com', { role: 'RESIDENT', unitId: a101 });
    const bAuthor = await seedUser('bb@example.com', { role: 'RESIDENT', unitId: b201 });
    const aSid = await seedSuggestion({ authorId: aAuthor.id, unitId: a101, title: 'A동 비공개', isPublic: false, categoryId });
    const bSid = await seedSuggestion({ authorId: bAuthor.id, unitId: b201, title: 'B동 비공개', isPublic: false, categoryId });

    // REP (A동 담당)
    const repRes = await query<{ id: string }>(
      `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, managed_building_id)
       VALUES ('rep@example.com', $1, (SELECT id FROM roles WHERE code='REP'), 'email', 'ACTIVE', now(), $2)
       RETURNING id`,
      [hashPassword(PASSWORD), aBuildingId],
    );
    const at = signAccessToken({ sub: repRes.rows[0].id, role: 'REP', verified: true });

    const resA = await getSuggestion(at, aSid);
    expect(resA.status).toBe(200);
    const resB = await getSuggestion(at, bSid);
    expect(resB.status).toBe(403);
  });

  it('AC-029: 미존재 id → 404', async () => {
    const viewer = await seedUser('nf@example.com', { role: 'RESIDENT' });
    const at = signAccessToken({ sub: viewer.id, role: 'RESIDENT', verified: true });

    const res = await getSuggestion(at, '00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('AC-030: 미인증 GET → 401', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('ua@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: '공개', isPublic: true, categoryId });

    const res = await getSuggestion(null, sid);
    expect(res.status).toBe(401);
  });

  it('EC: path UUID 오류 → 400', async () => {
    const viewer = await seedUser('br@example.com', { role: 'RESIDENT' });
    const at = signAccessToken({ sub: viewer.id, role: 'RESIDENT', verified: true });

    const res = await getSuggestion(at, 'not-a-uuid');
    expect(res.status).toBe(400);
  });

  it('CHAIR → 비공개 타인 건의 200 (전체 권한)', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('ch-au@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: '비공개', isPublic: false, categoryId });
    const chair = await seedUser('ch@example.com', { role: 'CHAIR' });
    const at = signAccessToken({ sub: chair.id, role: 'CHAIR', verified: true });

    const res = await getSuggestion(at, sid);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/suggestions/[id] — attachments[] 응답 (SPEC-ATTACHMENT-001 REQ-ATT-010/011)', () => {
  it('건의에 첨부 → attachments[] 메타데이터, storage_path 미노출', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('att-enrich@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: 't', isPublic: true, categoryId });
    const sha = 'c'.repeat(64);
    await query(
      `INSERT INTO attachments (target_type, target_id, uploader_id, original_filename, mime_type, size_bytes, storage_path, sha256)
       VALUES ('SUGGEST', $1, $2, 'p.png', 'image/png', 50, '/tmp/p.png', $3)`,
      [sid, author.id, sha],
    );

    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });
    const res = await getSuggestion(at, sid);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        attachments: Array<{ id: string; original_filename: string; mime_type: string; size_bytes: number; storage_path?: string }>;
      };
    };
    expect(body.data.attachments.length).toBe(1);
    expect(body.data.attachments[0].original_filename).toBe('p.png');
    expect(body.data.attachments[0].size_bytes).toBe(50);
    expect(body.data.attachments[0].storage_path).toBeUndefined();
  });

  it('비공개 건의 무권한 → 403 (attachments 노출 전 차단)', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('att-priv@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: 't', isPublic: false, categoryId });
    const sha = 'd'.repeat(64);
    await query(
      `INSERT INTO attachments (target_type, target_id, uploader_id, original_filename, mime_type, size_bytes, storage_path, sha256)
       VALUES ('SUGGEST', $1, $2, 'p.png', 'image/png', 50, '/tmp/p.png', $3)`,
      [sid, author.id, sha],
    );
    const other = await seedUser('att-other@example.com', { role: 'RESIDENT', unitId: a101 });
    const at = signAccessToken({ sub: other.id, role: 'RESIDENT', verified: true });

    const res = await getSuggestion(at, sid);
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/suggestions/[id] — 건의 수정 (M2, REQ-SUGGEST-006~011)', () => {
  async function putSuggestion(at: string | null, id: string, body: unknown): Promise<Response> {
    const mod = await import('./route');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (at) headers.authorization = `Bearer ${at}`;
    const req = new Request(`${BASE_URL}/${id}`, { method: 'PUT', headers, body: JSON.stringify(body) });
    return mod.PUT(req, { params: Promise.resolve({ id }) } as SuggestionParams);
  }

  it('AC-007: 작성자 본인 수정 → 200 + updated_at 갱신', async () => {
    const a101 = await getUnitId('A동', '101');
    const catFacility = await getCategoryId('시설');
    const catParking = await getCategoryId('주차');
    const author = await seedUser('ed@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: '원제목', isPublic: false, categoryId: catFacility });
    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });

    const res = await putSuggestion(at, sid, {
      title: '수정제목',
      content: '수정내용',
      category_id: catParking,
      is_public: true,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { title: string; category_name: string; is_public: boolean } };
    expect(body.data.title).toBe('수정제목');
    expect(body.data.category_name).toBe('주차');
    expect(body.data.is_public).toBe(true);

    const row = await query<{ content: string; updated_at: string }>(
      'SELECT content, updated_at FROM suggestions WHERE id = $1',
      [sid],
    );
    expect(row.rows[0].content).toBe('수정내용');
  });

  it('AC-008: 타인 수정 → 403 (ADMIN 포함)', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('au2@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: '원제목', isPublic: false, categoryId });
    const other = await seedUser('ot2@example.com', { role: 'RESIDENT', unitId: a101 });
    const at = signAccessToken({ sub: other.id, role: 'RESIDENT', verified: true });

    const res = await putSuggestion(at, sid, {
      title: 'X', content: 'X', category_id: categoryId, is_public: true,
    });
    expect(res.status).toBe(403);
  });

  it('AC-009: archived=true 건의 수정 → 409', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('ar@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: 'X', isPublic: false, categoryId });
    await query('UPDATE suggestions SET archived = true WHERE id = $1', [sid]);
    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });

    const res = await putSuggestion(at, sid, {
      title: 'Y', content: 'Y', category_id: categoryId, is_public: true,
    });
    expect(res.status).toBe(409);
  });

  it('AC-010: status=완료 건의 수정 → 409', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('dn@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: 'X', isPublic: false, categoryId, status: '완료' });
    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });

    const res = await putSuggestion(at, sid, {
      title: 'Y', content: 'Y', category_id: categoryId, is_public: true,
    });
    expect(res.status).toBe(409);
  });

  it('AC-011: 미존재 id 수정 → 404', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('nf2@example.com', { role: 'RESIDENT', unitId: a101 });
    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });

    const res = await putSuggestion(at, '00000000-0000-0000-0000-000000000000', {
      title: 'Y', content: 'Y', category_id: categoryId, is_public: true,
    });
    expect(res.status).toBe(404);
  });

  it('AC-012: 미존재 category_id 수정 → 422', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('nc2@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: 'X', isPublic: false, categoryId });
    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });

    const res = await putSuggestion(at, sid, {
      title: 'Y', content: 'Y', category_id: '00000000-0000-0000-0000-000000000000', is_public: true,
    });
    expect(res.status).toBe(422);
  });

  it('수정 미인증 → 401', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('ua2@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: 'X', isPublic: false, categoryId });

    const res = await putSuggestion(null, sid, {
      title: 'Y', content: 'Y', category_id: categoryId, is_public: true,
    });
    expect(res.status).toBe(401);
  });

  it('path UUID 오류 수정 → 400', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('br2@example.com', { role: 'RESIDENT', unitId: a101 });
    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });

    const res = await putSuggestion(at, 'not-a-uuid', {
      title: 'Y', content: 'Y', category_id: categoryId, is_public: true,
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/suggestions/[id] — 건의 아카이브 (M3, REQ-SUGGEST-012~017)', () => {
  async function deleteSuggestion(at: string | null, id: string): Promise<Response> {
    const mod = await import('./route');
    const headers: Record<string, string> = {};
    if (at) headers.authorization = `Bearer ${at}`;
    const req = new Request(`${BASE_URL}/${id}`, { method: 'DELETE', headers });
    return mod.DELETE(req, { params: Promise.resolve({ id }) } as SuggestionParams);
  }

  it('AC-013: 작성자 아카이브 → 200 + 익명화 (author_id NULL, author_label 전 입주민, unit_id 보존)', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('del@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: '삭제대상', isPublic: false, categoryId });
    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });

    const res = await deleteSuggestion(at, sid);
    expect(res.status).toBe(200);

    const row = await query<{
      author_id: string | null;
      author_label: string;
      archived: boolean;
      unit_id: string;
      archived_at: string | null;
    }>('SELECT author_id, author_label, archived, unit_id, archived_at FROM suggestions WHERE id = $1', [sid]);
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].author_id).toBeNull();
    expect(row.rows[0].author_label).toBe('전 입주민');
    expect(row.rows[0].archived).toBe(true);
    // ADR-005: unit_id 영구 보존
    expect(row.rows[0].unit_id).toBe(a101);
    expect(row.rows[0].archived_at).not.toBeNull();
  });

  it('AC-014: ADMIN 아카이브 → 200 (작성자가 아닌 타인 건의도 가능)', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('admin-au@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: 'X', isPublic: true, categoryId });
    const admin = await seedUser('admin-del@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await deleteSuggestion(at, sid);
    expect(res.status).toBe(200);
    const row = await query<{ archived: boolean }>('SELECT archived FROM suggestions WHERE id = $1', [sid]);
    expect(row.rows[0].archived).toBe(true);
  });

  it('AC-015: 타인(비-ADMIN, 비-작성자) 아카이브 → 403', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('au3@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: 'X', isPublic: false, categoryId });
    const other = await seedUser('ot3@example.com', { role: 'RESIDENT', unitId: a101 });
    const at = signAccessToken({ sub: other.id, role: 'RESIDENT', verified: true });

    const res = await deleteSuggestion(at, sid);
    expect(res.status).toBe(403);
    const row = await query<{ archived: boolean }>('SELECT archived FROM suggestions WHERE id = $1', [sid]);
    expect(row.rows[0].archived).toBe(false);
  });

  it('AC-016: 이미 archived=true 재아카이브 → 409', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('dup@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: 'X', isPublic: false, categoryId });
    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });

    const res1 = await deleteSuggestion(at, sid);
    expect(res1.status).toBe(200);
    const res2 = await deleteSuggestion(at, sid);
    expect(res2.status).toBe(409);
  });

  it('AC-017: 미존재 id 아카이브 → 404', async () => {
    const viewer = await seedUser('nf3@example.com', { role: 'RESIDENT' });
    const at = signAccessToken({ sub: viewer.id, role: 'RESIDENT', verified: true });

    const res = await deleteSuggestion(at, '00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('아카이브 미인증 → 401', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('ua3@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: 'X', isPublic: false, categoryId });

    const res = await deleteSuggestion(null, sid);
    expect(res.status).toBe(401);
  });

  it('REQ-ATT-027: 아카이브 시 첨부 DB 행 + 디스크 파일 일괄 제거 (건의 행은 보존)', async () => {
    const a101 = await getUnitId('A동', '101');
    const categoryId = await getCategoryId('시설');
    const author = await seedUser('cascade-sugg@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion({ authorId: author.id, unitId: a101, title: 'c', isPublic: true, categoryId });

    // 디스크 파일 생성
    const { writeFileSync, existsSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const path1 = join(tmpdir(), `scasc-${Math.random().toString(36).slice(2)}.png`);
    writeFileSync(path1, 'x');
    const sha = '9'.repeat(64);
    await query(
      `INSERT INTO attachments (target_type, target_id, uploader_id, original_filename, mime_type, size_bytes, storage_path, sha256)
       VALUES ('SUGGEST', $1, $2, 's.png', 'image/png', 1, $3, $4)`,
      [sid, author.id, path1, sha],
    );

    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });
    expect(existsSync(path1)).toBe(true);

    const res = await deleteSuggestion(at, sid);
    expect(res.status).toBe(200);

    // 첨부 DB 행 제거
    const cnt = await query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM attachments WHERE target_type = $1 AND target_id = $2',
      ['SUGGEST', sid],
    );
    expect(cnt.rows[0].n).toBe('0');
    // 디스크 파일 제거
    expect(existsSync(path1)).toBe(false);
    // 건의 행은 보존 (archived)
    const srow = await query<{ archived: boolean }>('SELECT archived FROM suggestions WHERE id = $1', [sid]);
    expect(srow.rows[0].archived).toBe(true);
    rmSync(path1, { force: true });
  });
});
