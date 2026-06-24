/**
 * POST /api/suggestions/[id]/attachments 통합 테스트 — SPEC-ATTACHMENT-001 (M1, REQ-ATT-002/004/006/007/024).
 *
 * 건의 첨부 업로드 — 작성자 본인 OR ADMIN. uploader_id = 요청자(ADMIN 가능).
 *
 * @vitest-environment node
 * NOTE: multipart 파싱 위해 Node native Request/FormData 강제.
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
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = 'http://localhost/api/suggestions';
const PASSWORD = 'password123';

let testUploadDir: string;

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

async function seedUser(
  email: string,
  opts: { role?: string; unitId?: string | null } = {},
): Promise<{ id: string }> {
  const passwordHash = hashPassword(PASSWORD);
  const roleCode = opts.role ?? 'RESIDENT';
  const res = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id, managed_building_id)
     VALUES ($1, $2, (SELECT id FROM roles WHERE code = $3), 'email', 'ACTIVE', now(), $4, NULL)
     RETURNING id`,
    [email, passwordHash, roleCode, opts.unitId ?? null],
  );
  return { id: res.rows[0].id };
}

async function getCategoryId(): Promise<string> {
  const res = await query<{ id: string }>('SELECT id FROM suggestion_categories LIMIT 1');
  return res.rows[0].id;
}

async function getUnitId(): Promise<string> {
  const res = await query<{ id: string }>('SELECT id FROM units LIMIT 1');
  return res.rows[0].id;
}

async function seedSuggestion(authorId: string, isPublic: boolean): Promise<string> {
  const categoryId = await getCategoryId();
  const unitId = await getUnitId();
  const res = await query<{ id: string }>(
    `INSERT INTO suggestions (author_id, author_label, unit_id, category_id, title, content, is_public, status, archived)
     VALUES ($1, '입주민', $2, $3, '제목', '내용', $4, '접수', false) RETURNING id`,
    [authorId, unitId, categoryId, isPublic],
  );
  return res.rows[0].id;
}

function pngBuffer(): Buffer {
  return Buffer.concat([Buffer.from('89504E470D0A1A0A', 'hex'), Buffer.alloc(100, 0)]);
}

function buildMultipartRequest(
  url: string,
  file: { filename: string; mimeType: string; buffer: Buffer },
  at: string | null,
): Request {
  const fd = new FormData();
  const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimeType });
  fd.append('file', blob, file.filename);
  const headers: Record<string, string> = {};
  if (at) headers.authorization = `Bearer ${at}`;
  return new Request(url, { method: 'POST', headers, body: fd });
}

async function postAttachment(
  suggestionId: string,
  file: { filename: string; mimeType: string; buffer: Buffer },
  at: string | null,
): Promise<Response> {
  const mod = await import('./route');
  return mod.POST(
    buildMultipartRequest(`${BASE_URL}/${suggestionId}/attachments`, file, at),
    { params: Promise.resolve({ id: suggestionId }) },
  );
}

beforeAll(async () => {
  testUploadDir = mkdtempSync(join(tmpdir(), 'att-suggest-'));
  process.env.ATTACHMENTS_DIR = testUploadDir;
  await ensureSchemaAndSeed();
});

beforeEach(async () => {
  await query('DELETE FROM attachments');
  await query('DELETE FROM suggestions');
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
});

afterAll(async () => {
  await query('DELETE FROM attachments');
  await query('DELETE FROM suggestions');
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
  await pool.end();
  rmSync(testUploadDir, { recursive: true, force: true });
  delete process.env.ATTACHMENTS_DIR;
});

describe('POST /api/suggestions/[id]/attachments (REQ-ATT-002/004/006/007/024)', () => {
  it('REQ-ATT-002: 작성자 본인 업로드 → 201 (uploader_id=작성자)', async () => {
    const author = await seedUser('s-auth@example.com');
    const suggestionId = await seedSuggestion(author.id, true);
    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });

    const res = await postAttachment(suggestionId, { filename: 'pic.png', mimeType: 'image/png', buffer: pngBuffer() }, at);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: { id: string } };
    const row = await query<{ target_type: string; uploader_id: string }>(
      'SELECT target_type, uploader_id FROM attachments WHERE id = $1',
      [body.data.id],
    );
    expect(row.rows[0].target_type).toBe('SUGGEST');
    expect(row.rows[0].uploader_id).toBe(author.id);
  });

  it('REQ-ATT-002 변형: ADMIN 이 건의에 업로드 → 201 (uploader_id=ADMIN, author_id 미건드림)', async () => {
    const author = await seedUser('s-auth2@example.com');
    const admin = await seedUser('s-admin@example.com', { role: 'ADMIN' });
    const suggestionId = await seedSuggestion(author.id, true);
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await postAttachment(suggestionId, { filename: 'pic.png', mimeType: 'image/png', buffer: pngBuffer() }, at);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: { id: string } };
    const row = await query<{ uploader_id: string }>('SELECT uploader_id FROM attachments WHERE id = $1', [body.data.id]);
    expect(row.rows[0].uploader_id).toBe(admin.id);
    // suggestions.author_id unchanged
    const sugg = await query<{ author_id: string }>('SELECT author_id FROM suggestions WHERE id = $1', [suggestionId]);
    expect(sugg.rows[0].author_id).toBe(author.id);
  });

  it('REQ-ATT-004: 타인(비-ADMIN) 업로드 → 403 (저장 안 함)', async () => {
    const author = await seedUser('s-auth3@example.com');
    const other = await seedUser('s-other@example.com');
    const suggestionId = await seedSuggestion(author.id, true);
    const at = signAccessToken({ sub: other.id, role: 'RESIDENT', verified: true });

    const res = await postAttachment(suggestionId, { filename: 'pic.png', mimeType: 'image/png', buffer: pngBuffer() }, at);
    expect(res.status).toBe(403);
    const cnt = await query<{ n: string }>('SELECT COUNT(*)::text AS n FROM attachments');
    expect(cnt.rows[0].n).toBe('0');
  });

  it('REQ-ATT-006: 미인증 → 401', async () => {
    const author = await seedUser('s-auth4@example.com');
    const suggestionId = await seedSuggestion(author.id, true);
    const res = await postAttachment(suggestionId, { filename: 'pic.png', mimeType: 'image/png', buffer: pngBuffer() }, null);
    expect(res.status).toBe(401);
  });

  it('REQ-ATT-007: 미존재 건의 → 404', async () => {
    const admin = await seedUser('s-nf@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await postAttachment(
      '00000000-0000-0000-0000-000000000000',
      { filename: 'pic.png', mimeType: 'image/png', buffer: pngBuffer() },
      at,
    );
    expect(res.status).toBe(404);
  });

  it('REQ-ATT-025: 허용 외 유형 → 422', async () => {
    const author = await seedUser('s-auth5@example.com');
    const suggestionId = await seedSuggestion(author.id, true);
    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });
    const res = await postAttachment(suggestionId, { filename: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') }, at);
    expect(res.status).toBe(422);
  });

  it('path UUID 형식 오류 → 400', async () => {
    const author = await seedUser('s-auth6@example.com');
    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });
    const res = await postAttachment('not-a-uuid', { filename: 'pic.png', mimeType: 'image/png', buffer: pngBuffer() }, at);
    expect(res.status).toBe(400);
  });
});
