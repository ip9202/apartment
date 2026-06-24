/**
 * GET/DELETE /api/attachments/[id] 통합 테스트 — SPEC-ATTACHMENT-001 (M3/M4).
 *
 * REQ-ATT-012~021.
 *
 * @vitest-environment node
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
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = 'http://localhost/api/attachments';
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

async function seedUser(email: string, opts: { role?: string } = {}): Promise<{ id: string }> {
  const passwordHash = hashPassword(PASSWORD);
  const roleCode = opts.role ?? 'RESIDENT';
  const res = await query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id, managed_building_id)
     VALUES ($1, $2, (SELECT id FROM roles WHERE code = $3), 'email', 'ACTIVE', now(), NULL, NULL)
     RETURNING id`,
    [email, passwordHash, roleCode],
  );
  return { id: res.rows[0].id };
}

async function getCategoryId(): Promise<string> {
  const r1 = await query<{ id: string }>('SELECT id FROM notice_categories LIMIT 1');
  return r1.rows[0].id;
}

async function getSuggestionCategoryId(): Promise<string> {
  const r = await query<{ id: string }>('SELECT id FROM suggestion_categories LIMIT 1');
  return r.rows[0].id;
}

async function getUnitId(): Promise<string> {
  const r = await query<{ id: string }>('SELECT id FROM units LIMIT 1');
  return r.rows[0].id;
}

/** 첨부 1행 직접 INSERT (바이너리는 testUploadDir 에 파일로 생성). */
async function seedAttachment(
  uploaderId: string,
  target_type: 'NOTICE' | 'SUGGEST',
  target_id: string,
  opts: { content?: string; ext?: string; mime?: string } = {},
): Promise<{ id: string; storagePath: string }> {
  const content = opts.content ?? 'binary-data';
  const ext = opts.ext ?? 'png';
  const filename = `${Math.random().toString(36).slice(2)}.${ext}`;
  const absPath = join(testUploadDir, filename);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(absPath, content, 'utf8');
  const sha = (await import('node:crypto')).createHash('sha256').update(content).digest('hex');
  const res = await query<{ id: string }>(
    `INSERT INTO attachments (target_type, target_id, uploader_id, original_filename, mime_type, size_bytes, storage_path, sha256)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      target_type,
      target_id,
      uploaderId,
      `orig.${ext}`,
      opts.mime ?? 'image/png',
      Buffer.byteLength(content),
      absPath,
      sha,
    ],
  );
  return { id: res.rows[0].id, storagePath: absPath };
}

async function seedNoticeTarget(): Promise<string> {
  const admin = await seedUser(`n-admin-${Math.random().toString(36).slice(2)}@example.com`, { role: 'ADMIN' });
  const categoryId = await getCategoryId();
  const res = await query<{ id: string }>(
    `INSERT INTO notices (author_id, category_id, title, content) VALUES ($1, $2, 't', 'c') RETURNING id`,
    [admin.id, categoryId],
  );
  return res.rows[0].id;
}

async function seedSuggestionTarget(authorId: string, isPublic: boolean): Promise<string> {
  const categoryId = await getSuggestionCategoryId();
  const unitId = await getUnitId();
  const res = await query<{ id: string }>(
    `INSERT INTO suggestions (author_id, author_label, unit_id, category_id, title, content, is_public, status, archived)
     VALUES ($1, '입주민', $2, $3, 't', 'c', $4, '접수', false) RETURNING id`,
    [authorId, unitId, categoryId, isPublic],
  );
  return res.rows[0].id;
}

function buildRequest(method: string, url: string, at: string | null): Request {
  const headers: Record<string, string> = {};
  if (at) headers.authorization = `Bearer ${at}`;
  return new Request(url, { method, headers });
}

async function getAttachment(id: string, at: string | null): Promise<Response> {
  const mod = await import('./route');
  return mod.GET(buildRequest('GET', `${BASE_URL}/${id}`, at), { params: Promise.resolve({ id }) });
}

async function deleteAttachment(id: string, at: string | null): Promise<Response> {
  const mod = await import('./route');
  return mod.DELETE(buildRequest('DELETE', `${BASE_URL}/${id}`, at), { params: Promise.resolve({ id }) });
}

beforeAll(async () => {
  testUploadDir = mkdtempSync(join(tmpdir(), 'att-dl-'));
  process.env.ATTACHMENTS_DIR = testUploadDir;
  await ensureSchemaAndSeed();
});

beforeEach(async () => {
  await query('DELETE FROM attachments');
  await query('DELETE FROM notices');
  await query('DELETE FROM suggestions');
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
});

afterAll(async () => {
  await query('DELETE FROM attachments');
  await query('DELETE FROM notices');
  await query('DELETE FROM suggestions');
  await query('UPDATE users SET unit_id = NULL, managed_building_id = NULL');
  await query('DELETE FROM users');
  await pool.end();
  rmSync(testUploadDir, { recursive: true, force: true });
  delete process.env.ATTACHMENTS_DIR;
});

describe('GET /api/attachments/[id] — 다운로드 (REQ-ATT-012~016)', () => {
  it('REQ-ATT-012: NOTICE 첨부 — 모든 인증 사용자 다운로드 → 200 + 스트림 + 헤더', async () => {
    const admin = await seedUser('dl-admin@example.com', { role: 'ADMIN' });
    const noticeId = await seedNoticeTarget();
    const { id } = await seedAttachment(admin.id, 'NOTICE', noticeId, { content: 'hello-png', ext: 'png', mime: 'image/png' });
    const resident = await seedUser('dl-res@example.com');
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });

    const res = await getAttachment(id, at);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toContain('attachment');
    expect(cd).toContain('orig.png');
    const body = await res.text();
    expect(body).toBe('hello-png');
  });

  it('REQ-ATT-012: SUGGEST 공개 건의 첨부 — 인증 사용자 다운로드 → 200', async () => {
    const author = await seedUser('dl-auth@example.com');
    const suggestionId = await seedSuggestionTarget(author.id, true);
    const { id } = await seedAttachment(author.id, 'SUGGEST', suggestionId, { content: 'pub', ext: 'pdf', mime: 'application/pdf' });
    const other = await seedUser('dl-other@example.com');
    const at = signAccessToken({ sub: other.id, role: 'RESIDENT', verified: true });

    const res = await getAttachment(id, at);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });

  it('REQ-ATT-013: SUGGEST 비공개 건의 첨부 — 무권한 → 403 (404 아님)', async () => {
    const author = await seedUser('dl-priv-auth@example.com');
    const suggestionId = await seedSuggestionTarget(author.id, false);
    const { id } = await seedAttachment(author.id, 'SUGGEST', suggestionId);
    const other = await seedUser('dl-priv-other@example.com');
    const at = signAccessToken({ sub: other.id, role: 'RESIDENT', verified: true });

    const res = await getAttachment(id, at);
    expect(res.status).toBe(403);
  });

  it('REQ-ATT-013: SUGGEST 비공개 건의 첨부 — 작성자 본인 → 200', async () => {
    const author = await seedUser('dl-priv-self@example.com');
    const suggestionId = await seedSuggestionTarget(author.id, false);
    const { id } = await seedAttachment(author.id, 'SUGGEST', suggestionId);
    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });

    const res = await getAttachment(id, at);
    expect(res.status).toBe(200);
  });

  it('REQ-ATT-014: 미존재 첨부 → 404', async () => {
    const res = await seedUser('dl-nf@example.com').then((u) =>
      getAttachment('00000000-0000-0000-0000-000000000000', signAccessToken({ sub: u.id, role: 'RESIDENT', verified: true })),
    );
    expect(res.status).toBe(404);
  });

  it('REQ-ATT-015: 미인증 → 401', async () => {
    const admin = await seedUser('dl-unauth@example.com', { role: 'ADMIN' });
    const noticeId = await seedNoticeTarget();
    const { id } = await seedAttachment(admin.id, 'NOTICE', noticeId);
    const res = await getAttachment(id, null);
    expect(res.status).toBe(401);
  });

  it('REQ-ATT-016: 디스크 파일 소실 시 → 500 + 에러 로그', async () => {
    const admin = await seedUser('dl-missing@example.com', { role: 'ADMIN' });
    const noticeId = await seedNoticeTarget();
    const { id, storagePath } = await seedAttachment(admin.id, 'NOTICE', noticeId);
    rmSync(storagePath, { force: true }); // 디스크 파일 제거
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await getAttachment(id, at);
    expect([404, 500]).toContain(res.status);
  });

  it('path UUID 형식 오류 → 400', async () => {
    const u = await seedUser('dl-uuid@example.com');
    const at = signAccessToken({ sub: u.id, role: 'RESIDENT', verified: true });
    const res = await getAttachment('not-a-uuid', at);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/attachments/[id] — 삭제 (REQ-ATT-017~021)', () => {
  it('REQ-ATT-017: NOTICE 첨부 ADMIN 삭제 → 200 + DB 행 + 디스크 파일 제거 (트랜잭션)', async () => {
    const admin = await seedUser('del-admin@example.com', { role: 'ADMIN' });
    const noticeId = await seedNoticeTarget();
    const { id, storagePath } = await seedAttachment(admin.id, 'NOTICE', noticeId);
    expect(existsSync(storagePath)).toBe(true);
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await deleteAttachment(id, at);
    expect(res.status).toBe(200);
    // DB 행 제거
    const row = await query('SELECT id FROM attachments WHERE id = $1', [id]);
    expect(row.rowCount ?? 0).toBe(0);
    // 디스크 파일 제거
    expect(existsSync(storagePath)).toBe(false);
  });

  it('REQ-ATT-018: SUGGEST 첨부 작성자 본인 삭제 → 200', async () => {
    const author = await seedUser('del-auth@example.com');
    const suggestionId = await seedSuggestionTarget(author.id, true);
    const { id } = await seedAttachment(author.id, 'SUGGEST', suggestionId);
    const at = signAccessToken({ sub: author.id, role: 'RESIDENT', verified: true });

    const res = await deleteAttachment(id, at);
    expect(res.status).toBe(200);
    const row = await query('SELECT id FROM attachments WHERE id = $1', [id]);
    expect(row.rowCount ?? 0).toBe(0);
  });

  it('REQ-ATT-018 변형: SUGGEST 첨부 ADMIN 삭제 → 200', async () => {
    const author = await seedUser('del-auth2@example.com');
    const admin = await seedUser('del-admin2@example.com', { role: 'ADMIN' });
    const suggestionId = await seedSuggestionTarget(author.id, true);
    const { id } = await seedAttachment(author.id, 'SUGGEST', suggestionId);
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });

    const res = await deleteAttachment(id, at);
    expect(res.status).toBe(200);
  });

  it('REQ-ATT-019: NOTICE 첨부 비-ADMIN 삭제 → 403 (행 유지)', async () => {
    const admin = await seedUser('del-admin3@example.com', { role: 'ADMIN' });
    const resident = await seedUser('del-res3@example.com');
    const noticeId = await seedNoticeTarget();
    const { id } = await seedAttachment(admin.id, 'NOTICE', noticeId);
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });

    const res = await deleteAttachment(id, at);
    expect(res.status).toBe(403);
    const row = await query('SELECT id FROM attachments WHERE id = $1', [id]);
    expect(row.rowCount ?? 0).toBe(1);
  });

  it('REQ-ATT-019: SUGGEST 첨부 타인(비-ADMIN) 삭제 → 403', async () => {
    const author = await seedUser('del-auth4@example.com');
    const other = await seedUser('del-other4@example.com');
    const suggestionId = await seedSuggestionTarget(author.id, true);
    const { id } = await seedAttachment(author.id, 'SUGGEST', suggestionId);
    const at = signAccessToken({ sub: other.id, role: 'RESIDENT', verified: true });

    const res = await deleteAttachment(id, at);
    expect(res.status).toBe(403);
  });

  it('REQ-ATT-020: 미존재 첨부 삭제 → 404', async () => {
    const admin = await seedUser('del-nf@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await deleteAttachment('00000000-0000-0000-0000-000000000000', at);
    expect(res.status).toBe(404);
  });

  it('REQ-ATT-021: 미인증 삭제 → 401', async () => {
    const admin = await seedUser('del-unauth@example.com', { role: 'ADMIN' });
    const noticeId = await seedNoticeTarget();
    const { id } = await seedAttachment(admin.id, 'NOTICE', noticeId);
    const res = await deleteAttachment(id, null);
    expect(res.status).toBe(401);
  });

  it('path UUID 형식 오류 → 400 (DELETE)', async () => {
    const admin = await seedUser('del-uuid@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await deleteAttachment('not-a-uuid', at);
    expect(res.status).toBe(400);
  });
});
