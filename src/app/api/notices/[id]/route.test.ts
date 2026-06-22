/**
 * GET /api/notices/[id] 통합 테스트 — SPEC-NOTICE-001 M5(상세).
 *
 * AC-NOTICE-020 (인증 상세 → 200),
 * AC-NOTICE-021 (미존재 → 404),
 * AC-NOTICE-022 (미인증 → 401),
 * EC-NOTICE-003 (path UUID 형식 오류 → 400).
 *
 * TEST ISOLATION: beforeAll 마이그레이션(001~006)+시드 멱등, beforeEach truncate + 재시드.
 *
 * @MX:ANCHOR: [AUTO] notices 상세 테스트는 자체 스키마/시드 보장 — 형제 테스트 부작용에 견고
 * @MX:REASON:  AUTH/SETUP migration 테스트가 동일 test DB 스키마를 DROP/재적용하여 시드 소실 가능.
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

const BASE_URL = 'http://localhost/api/notices';
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
    ]) {
      await applySql(setupPool, readMigration(file));
    }
    await runSeed(setupPool);
  } finally {
    await setupPool.end();
  }
}

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

async function getCategoryId(name: string): Promise<string> {
  const res = await query<{ id: string }>(
    'SELECT id FROM notice_categories WHERE name = $1',
    [name],
  );
  return res.rows[0].id;
}

/** 공지 1행 시드 — id 반환. */
async function seedNotice(opts: { title?: string; categoryName?: string } = {}): Promise<string> {
  const admin = await seedUser(`notice-admin-${Math.random().toString(36).slice(2)}@example.com`, { role: 'ADMIN' });
  const categoryId = await getCategoryId(opts.categoryName ?? '시설');
  const res = await query<{ id: string }>(
    `INSERT INTO notices (author_id, category_id, title, content)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [admin.id, categoryId, opts.title ?? '제목', '내용본문'],
  );
  return res.rows[0].id;
}

function buildGetRequest(at: string | null, url: string): Request {
  const headers: Record<string, string> = {};
  if (at) headers.authorization = `Bearer ${at}`;
  return new Request(url, { method: 'GET', headers });
}

function buildJsonRequest(method: string, url: string, body: unknown, at: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (at) headers.authorization = `Bearer ${at}`;
  return new Request(url, { method, headers, body: JSON.stringify(body) });
}

async function getNotice(id: string, at: string | null): Promise<Response> {
  const mod = await import('./route');
  return mod.GET(buildGetRequest(at, `${BASE_URL}/${id}`), {
    params: Promise.resolve({ id }),
  });
}

async function putNotice(id: string, body: unknown, at: string | null): Promise<Response> {
  const mod = await import('./route');
  return mod.PUT(buildJsonRequest('PUT', `${BASE_URL}/${id}`, body, at), {
    params: Promise.resolve({ id }),
  });
}

async function deleteNotice(id: string, at: string | null): Promise<Response> {
  const mod = await import('./route');
  return mod.DELETE(buildGetRequest(at, `${BASE_URL}/${id}`), {
    params: Promise.resolve({ id }),
  });
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

describe('GET /api/notices/[id] — 인증 사용자 공지 상세 (M5, REQ-NOTICE-014~016a)', () => {
  it('AC-020: RESIDENT 상세 → 200 + { id, title, content, category명, author_id, created_at, updated_at }', async () => {
    const noticeId = await seedNotice({ title: '상세제목' });
    const resident = await seedUser('r-detail@example.com', { role: 'RESIDENT' });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });

    const res = await getNotice(noticeId, at);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        id: string;
        title: string;
        content: string;
        category_name: string;
        author_id: string;
        created_at: string;
        updated_at: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(noticeId);
    expect(body.data.title).toBe('상세제목');
    expect(body.data.content).toBe('내용본문');
    expect(body.data.category_name).toBe('시설');
    expect(body.data.created_at).toBeDefined();
    expect(body.data.updated_at).toBeDefined();
  });

  it('AC-021: 미존재 공지 UUID → 404', async () => {
    const resident = await seedUser('r-nf@example.com', { role: 'RESIDENT' });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });

    const res = await getNotice('00000000-0000-0000-0000-000000000000', at);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('AC-022: 미인증 GET → 401', async () => {
    const noticeId = await seedNotice();
    const res = await getNotice(noticeId, null);
    expect(res.status).toBe(401);
  });

  it('401: 변조된 AT → 401', async () => {
    const noticeId = await seedNotice();
    const res = await getNotice(noticeId, 'invalid.token.here');
    expect(res.status).toBe(401);
  });

  it('EC-003: path param UUID 형식 오류 → 400', async () => {
    const admin = await seedUser('a-uuid@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await getNotice('not-a-uuid', at);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('전체 역할 상세 조회 허용 (RESIDENT/REP/AUDITOR/CHAIR/ADMIN)', async () => {
    const noticeId = await seedNotice();
    for (const role of ['RESIDENT', 'REP', 'AUDITOR', 'CHAIR', 'ADMIN']) {
      const u = await seedUser(`${role.toLowerCase()}-detail@example.com`, { role });
      const at = signAccessToken({ sub: u.id, role, verified: true });
      const res = await getNotice(noticeId, at);
      expect(res.status).toBe(200);
    }
  });
});

describe('PUT /api/notices/[id] — ADMIN 공지 수정 (M2, REQ-NOTICE-004~007b)', () => {
  it('AC-007: ADMIN 수정 → 200 + 갱신된 공지 정보 + updated_at 갱신', async () => {
    const noticeId = await seedNotice({ title: '원본제목', categoryName: '시설' });
    const admin = await seedUser('admin-put@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const generalId = await getCategoryId('일반');

    const res = await putNotice(
      noticeId,
      { title: '수정된 제목', content: '수정된 내용', category_id: generalId },
      at,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; title: string; content: string; category_name: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.title).toBe('수정된 제목');
    expect(body.data.content).toBe('수정된 내용');
    expect(body.data.category_name).toBe('일반');

    const row = await query<{ title: string; content: string }>(
      'SELECT title, content FROM notices WHERE id = $1',
      [noticeId],
    );
    expect(row.rows[0].title).toBe('수정된 제목');
    expect(row.rows[0].content).toBe('수정된 내용');
  });

  it('AC-008: 미존재 공지 수정 → 404', async () => {
    const admin = await seedUser('admin-put-nf@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const categoryId = await getCategoryId('일반');

    const res = await putNotice(
      '00000000-0000-0000-0000-000000000000',
      { title: '제목', content: '내용', category_id: categoryId },
      at,
    );
    expect(res.status).toBe(404);
  });

  it('AC-009: 미존재 category_id 수정 → 422 (공지 행 변경 없음)', async () => {
    const noticeId = await seedNotice({ title: '원본' });
    const admin = await seedUser('admin-put-cat@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await putNotice(
      noticeId,
      {
        title: '수정',
        content: '수정내용',
        category_id: '00000000-0000-0000-0000-000000000000',
      },
      at,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');

    // 공지 행 변경 없음
    const row = await query<{ title: string }>('SELECT title FROM notices WHERE id = $1', [noticeId]);
    expect(row.rows[0].title).toBe('원본');
  });

  it('AC-010: 미인증 PUT → 401', async () => {
    const noticeId = await seedNotice();
    const categoryId = await getCategoryId('일반');
    const res = await putNotice(
      noticeId,
      { title: '수정', content: '내용', category_id: categoryId },
      null,
    );
    expect(res.status).toBe(401);
  });

  it('AC-011: 비-ADMIN(RESIDENT) 수정 → 403 (공지 행 변경 없음)', async () => {
    const noticeId = await seedNotice({ title: '원본' });
    const resident = await seedUser('res-put@example.com', { role: 'RESIDENT' });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });
    const categoryId = await getCategoryId('일반');

    const res = await putNotice(
      noticeId,
      { title: '수정', content: '내용', category_id: categoryId },
      at,
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');

    const row = await query<{ title: string }>('SELECT title FROM notices WHERE id = $1', [noticeId]);
    expect(row.rows[0].title).toBe('원본');
  });
});

describe('DELETE /api/notices/[id] — ADMIN 공지 영구 삭제 (M3, REQ-NOTICE-008~010b)', () => {
  it('AC-012: ADMIN 삭제 → 200 + 행 완전 삭제 (hard delete)', async () => {
    const noticeId = await seedNotice({ title: '삭제대상' });
    const admin = await seedUser('admin-del@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await deleteNotice(noticeId, at);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);

    // 행 완전 삭제 확인 (hard delete)
    const row = await query('SELECT id FROM notices WHERE id = $1', [noticeId]);
    expect((row.rowCount ?? 0)).toBe(0);
  });

  it('AC-013: 미존재 공지 삭제 → 404', async () => {
    const admin = await seedUser('admin-del-nf@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await deleteNotice('00000000-0000-0000-0000-000000000000', at);
    expect(res.status).toBe(404);
  });

  it('AC-014: 미인증 DELETE → 401', async () => {
    const noticeId = await seedNotice();
    const res = await deleteNotice(noticeId, null);
    expect(res.status).toBe(401);
  });

  it('AC-015: 비-ADMIN(REP) 삭제 → 403 (공지 행 삭제되지 않음)', async () => {
    const noticeId = await seedNotice({ title: '유지' });
    const rep = await seedUser('rep-del@example.com', { role: 'REP' });
    const at = signAccessToken({ sub: rep.id, role: 'REP', verified: true });

    const res = await deleteNotice(noticeId, at);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');

    // 행 유지
    const row = await query('SELECT id FROM notices WHERE id = $1', [noticeId]);
    expect((row.rowCount ?? 0)).toBe(1);
  });

  it('EC-003: path param UUID 형식 오류 → 400 (DELETE)', async () => {
    const admin = await seedUser('admin-del-uuid@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await deleteNotice('not-a-uuid', at);
    expect(res.status).toBe(400);
  });
});


