/**
 * PUT /api/suggestions/[id]/status 통합 테스트 — SPEC-SUGGEST-001 M7 (처리 상태 변경).
 *
 * AC-SUGGEST-035 (접수→처리중 → 200),
 * AC-SUGGEST-036 (불가능 전이 접수→완료 → 409),
 * AC-SUGGEST-037 (완료→접수 재오픈 → 200),
 * AC-SUGGEST-038 (처리중→보류 → 200),
 * AC-SUGGEST-039 (미존재 → 404),
 * AC-SUGGEST-040 (미인증 → 401),
 * AC-SUGGEST-041 (비-ADMIN → 403).
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

async function seedUser(email: string, role = 'RESIDENT'): Promise<{ id: string }> {
  const passwordHash = hashPassword(PASSWORD);
  const res = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at)
     VALUES ($1, $2, (SELECT id FROM roles WHERE code = $3), 'email', 'ACTIVE', now())
     RETURNING id`,
    [email, passwordHash, role],
  );
  return { id: res.rows[0].id };
}

async function seedSuggestion(authorId: string, status = '접수'): Promise<string> {
  const a101 = await getUnitId('A동', '101');
  const categoryId = await getCategoryId('시설');
  const res = await query<{ id: string }>(
    `INSERT INTO suggestions (author_id, author_label, unit_id, category_id, title, content, is_public, status, archived)
     VALUES ($1, '입주민', $2, $3, '제목', '내용', true, $4, false) RETURNING id`,
    [authorId, a101, categoryId, status],
  );
  return res.rows[0].id;
}

interface StatusParams {
  params: Promise<{ id: string }>;
}

async function putStatus(at: string | null, suggestionId: string, body: unknown): Promise<Response> {
  const mod = await import('./route');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (at) headers.authorization = `Bearer ${at}`;
  const req = new Request(`${BASE_URL}/${suggestionId}/status`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  return mod.PUT(req, { params: Promise.resolve({ id: suggestionId }) } as StatusParams);
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

describe('PUT /api/suggestions/[id]/status — ADMIN 상태 변경 (M7, REQ-SUGGEST-030~034b)', () => {
  it('AC-035: 접수→처리중 전이 → 200', async () => {
    const author = await seedUser('au@example.com');
    const sid = await seedSuggestion(author.id, '접수');
    const admin = await seedUser('admin@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await putStatus(at, sid, { status: '처리중' });
    expect(res.status).toBe(200);
    const row = await query<{ status: string }>('SELECT status FROM suggestions WHERE id = $1', [sid]);
    expect(row.rows[0].status).toBe('처리중');
  });

  it('AC-036: 불가능 전이 접수→완료 → 409 (현재/요청 상태 응답 포함)', async () => {
    const author = await seedUser('au2@example.com');
    const sid = await seedSuggestion(author.id, '접수');
    const admin = await seedUser('admin2@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await putStatus(at, sid, { status: '완료' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');
    // 상태 미변경
    const row = await query<{ status: string }>('SELECT status FROM suggestions WHERE id = $1', [sid]);
    expect(row.rows[0].status).toBe('접수');
  });

  it('AC-037: 완료→접수 재오픈 → 200', async () => {
    const author = await seedUser('au3@example.com');
    const sid = await seedSuggestion(author.id, '완료');
    const admin = await seedUser('admin3@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await putStatus(at, sid, { status: '접수' });
    expect(res.status).toBe(200);
    const row = await query<{ status: string }>('SELECT status FROM suggestions WHERE id = $1', [sid]);
    expect(row.rows[0].status).toBe('접수');
  });

  it('AC-038: 처리중→보류 전이 → 200', async () => {
    const author = await seedUser('au4@example.com');
    const sid = await seedSuggestion(author.id, '처리중');
    const admin = await seedUser('admin4@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await putStatus(at, sid, { status: '보류' });
    expect(res.status).toBe(200);
    const row = await query<{ status: string }>('SELECT status FROM suggestions WHERE id = $1', [sid]);
    expect(row.rows[0].status).toBe('보류');
  });

  it('AC-039: 미존재 건의 상태 변경 → 404', async () => {
    const admin = await seedUser('admin5@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await putStatus(at, '00000000-0000-0000-0000-000000000000', { status: '처리중' });
    expect(res.status).toBe(404);
  });

  it('AC-040: 미인증 상태 변경 → 401', async () => {
    const author = await seedUser('au5@example.com');
    const sid = await seedSuggestion(author.id);
    const res = await putStatus(null, sid, { status: '처리중' });
    expect(res.status).toBe(401);
  });

  it('AC-041: 비-ADMIN 상태 변경 → 403', async () => {
    const author = await seedUser('au6@example.com');
    const sid = await seedSuggestion(author.id);
    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });

    const res = await putStatus(at, sid, { status: '처리중' });
    expect(res.status).toBe(403);
  });

  it('EC: 잘못된 status enum 값 → 422', async () => {
    const author = await seedUser('au7@example.com');
    const sid = await seedSuggestion(author.id);
    const admin = await seedUser('admin6@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await putStatus(at, sid, { status: '잘못된상태' });
    expect(res.status).toBe(422);
  });

  it('EC: path UUID 오류 → 400', async () => {
    const admin = await seedUser('admin7@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await putStatus(at, 'not-a-uuid', { status: '처리중' });
    expect(res.status).toBe(400);
  });

  it('보류→처리중 전이 → 200', async () => {
    const author = await seedUser('au8@example.com');
    const sid = await seedSuggestion(author.id, '보류');
    const admin = await seedUser('admin8@example.com', 'ADMIN');
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await putStatus(at, sid, { status: '처리중' });
    expect(res.status).toBe(200);
  });
});
