/**
 * POST /api/suggestions/[id]/replies 통합 테스트 — SPEC-SUGGEST-001 M6 (건의 답변 등록).
 *
 * AC-SUGGEST-031 (ADMIN 답변 등록 → 201),
 * AC-SUGGEST-032 (미존재 건의 → 404),
 * AC-SUGGEST-033 (미인증 → 401),
 * AC-SUGGEST-034 (비-ADMIN → 403).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { pool, query } from '../../../../../lib/db';
import { runSeed } from '../../../../../../scripts/seed';
import {
  createTestPool,
  applySql,
  readMigration,
} from '../../../../../lib/migration-test-helpers';
import { hashPassword, signAccessToken } from '../../../../../lib/auth';

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

async function seedSuggestion(authorId: string, unitId: string): Promise<string> {
  const categoryId = await getCategoryId('시설');
  const res = await query<{ id: string }>(
    `INSERT INTO suggestions (author_id, author_label, unit_id, category_id, title, content, is_public, status, archived)
     VALUES ($1, '입주민', $2, $3, '제목', '내용', true, '접수', false) RETURNING id`,
    [authorId, unitId, categoryId],
  );
  return res.rows[0].id;
}

interface ReplyParams {
  params: Promise<{ id: string }>;
}

async function postReply(at: string | null, suggestionId: string, body: unknown): Promise<Response> {
  const mod = await import('./route');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (at) headers.authorization = `Bearer ${at}`;
  const req = new Request(`${BASE_URL}/${suggestionId}/replies`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return mod.POST(req, { params: Promise.resolve({ id: suggestionId }) } as ReplyParams);
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

describe('POST /api/suggestions/[id]/replies — ADMIN 답변 등록 (M6, REQ-SUGGEST-027~029b)', () => {
  it('AC-031: ADMIN 답변 등록 → 201 + DB 행 생성', async () => {
    const a101 = await getUnitId('A동', '101');
    const author = await seedUser('au@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion(author.id, a101);
    const admin = await seedUser('admin@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await postReply(at, sid, { content: '답변 내용입니다.' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; content: string; author_id: string } };
    expect(body.data.content).toBe('답변 내용입니다.');
    expect(body.data.author_id).toBe(admin.id);

    const row = await query<{ suggestion_id: string }>(
      'SELECT suggestion_id FROM suggestion_replies WHERE id = $1',
      [body.data.id],
    );
    expect(row.rows[0].suggestion_id).toBe(sid);
  });

  it('AC-032: 미존재 건의 답변 → 404', async () => {
    const admin = await seedUser('admin2@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await postReply(at, '00000000-0000-0000-0000-000000000000', { content: 'X' });
    expect(res.status).toBe(404);
  });

  it('AC-033: 미인증 답변 → 401', async () => {
    const a101 = await getUnitId('A동', '101');
    const author = await seedUser('au2@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion(author.id, a101);

    const res = await postReply(null, sid, { content: 'X' });
    expect(res.status).toBe(401);
  });

  it('AC-034: 비-ADMIN(RESIDENT) 답변 → 403', async () => {
    const a101 = await getUnitId('A동', '101');
    const author = await seedUser('au3@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion(author.id, a101);
    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });

    const res = await postReply(at, sid, { content: 'X' });
    expect(res.status).toBe(403);
  });

  it('EC: content 빈 문자열 → 422', async () => {
    const a101 = await getUnitId('A동', '101');
    const author = await seedUser('au4@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion(author.id, a101);
    const admin = await seedUser('admin3@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await postReply(at, sid, { content: '' });
    expect(res.status).toBe(422);
  });

  it('EC: content 5001자 → 422', async () => {
    const a101 = await getUnitId('A동', '101');
    const author = await seedUser('au5@example.com', { role: 'RESIDENT', unitId: a101 });
    const sid = await seedSuggestion(author.id, a101);
    const admin = await seedUser('admin4@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await postReply(at, sid, { content: '가'.repeat(5001) });
    expect(res.status).toBe(422);
  });

  it('EC: path UUID 오류 → 400', async () => {
    const admin = await seedUser('admin5@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await postReply(at, 'not-a-uuid', { content: 'X' });
    expect(res.status).toBe(400);
  });
});
