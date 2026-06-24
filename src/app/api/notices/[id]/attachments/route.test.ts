/**
 * POST /api/notices/[id]/attachments 통합 테스트 — SPEC-ATTACHMENT-001 (M1, REQ-ATT-001/003/005/006/007/024).
 *
 * ADMIN 공지 첨부 업로드 — 검증/저장/메타데이터 INSERT.
 *
 * @vitest-environment node
 * NOTE: multipart/form-data 파싱을 위해 Node native(undici) Request/FormData 필요.
 *       jsdom 의 FormData 직렬화는 whatwg parser 가 거부 → node env 강제.
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

const BASE_URL = 'http://localhost/api/notices';
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
  opts: { role?: string } = {},
): Promise<{ id: string; email: string; role: string }> {
  const passwordHash = hashPassword(PASSWORD);
  const roleCode = opts.role ?? 'RESIDENT';
  const res = await query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash, role_id, provider, status, verified_at, unit_id, managed_building_id)
     VALUES ($1, $2, (SELECT id FROM roles WHERE code = $3), 'email', 'ACTIVE', now(), NULL, NULL)
     RETURNING id, email`,
    [email, passwordHash, roleCode],
  );
  return { id: res.rows[0].id, email: res.rows[0].email, role: roleCode };
}

async function getCategoryId(name: string): Promise<string> {
  const res = await query<{ id: string }>('SELECT id FROM notice_categories WHERE name = $1', [name]);
  return res.rows[0].id;
}

async function seedNotice(): Promise<{ id: string; adminId: string }> {
  const admin = await seedUser(`n-admin-${Math.random().toString(36).slice(2)}@example.com`, { role: 'ADMIN' });
  const categoryId = await getCategoryId('시설');
  const res = await query<{ id: string }>(
    `INSERT INTO notices (author_id, category_id, title, content) VALUES ($1, $2, '제목', '내용') RETURNING id`,
    [admin.id, categoryId],
  );
  return { id: res.rows[0].id, adminId: admin.id };
}

function pngBuffer(): Buffer {
  // 8바이트 PNG 시그니처 + 더미
  return Buffer.concat([Buffer.from('89504E470D0A1A0A', 'hex'), Buffer.alloc(100, 0)]);
}

function buildMultipartRequest(
  url: string,
  file: { fieldname: string; filename: string; mimeType: string; buffer: Buffer },
  at: string | null,
): Request {
  // FormData + Blob/File 로 전달 — Request 가 multipart boundary 자동 생성.
  // (수동 boundary 조립은 jsdom/undici parser 가 거부 — whatwg 명시적 직렬화 경유)
  const fd = new FormData();
  const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimeType });
  fd.append(file.fieldname, blob, file.filename);
  const headers: Record<string, string> = {};
  if (at) headers.authorization = `Bearer ${at}`;
  return new Request(url, { method: 'POST', headers, body: fd });
}

async function postAttachment(
  noticeId: string,
  file: { filename: string; mimeType: string; buffer: Buffer },
  at: string | null,
): Promise<Response> {
  const mod = await import('./route');
  return mod.POST(
    buildMultipartRequest(
      `${BASE_URL}/${noticeId}/attachments`,
      { fieldname: 'file', filename: file.filename, mimeType: file.mimeType, buffer: file.buffer },
      at,
    ),
    { params: Promise.resolve({ id: noticeId }) },
  );
}

beforeAll(async () => {
  testUploadDir = mkdtempSync(join(tmpdir(), 'att-notice-'));
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

describe('POST /api/notices/[id]/attachments — ADMIN 공지 첨부 업로드 (REQ-ATT-001/003/005/006/007/024)', () => {
  it('REQ-ATT-001: ADMIN 업로드 → 201 + 메타데이터 + 디스크 저장', async () => {
    const { id: noticeId } = await seedNotice();
    const admin = await seedUser('att-admin@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const buf = pngBuffer();

    const res = await postAttachment(noticeId, { filename: 'pic.png', mimeType: 'image/png', buffer: buf }, at);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; original_filename: string; mime_type: string; size_bytes: number; created_at: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.original_filename).toBe('pic.png');
    expect(body.data.mime_type).toBe('image/png');
    expect(body.data.size_bytes).toBe(buf.length);
    expect(body.data.id).toBeDefined();

    // DB 행 존재
    const row = await query<{ storage_path: string; target_type: string; uploader_id: string }>(
      'SELECT storage_path, target_type, uploader_id FROM attachments WHERE id = $1',
      [body.data.id],
    );
    expect(row.rows[0].target_type).toBe('NOTICE');
    expect(row.rows[0].uploader_id).toBe(admin.id);
    // 디스크 파일 존재
    expect(existsSync(row.rows[0].storage_path)).toBe(true);
  });

  it('REQ-ATT-003: 비-ADMIN(RESIDENT) 업로드 → 403 (파일 저장 안 함)', async () => {
    const { id: noticeId } = await seedNotice();
    const resident = await seedUser('att-res@example.com', { role: 'RESIDENT' });
    const at = signAccessToken({ sub: resident.id, role: 'RESIDENT', verified: true });

    const res = await postAttachment(noticeId, { filename: 'pic.png', mimeType: 'image/png', buffer: pngBuffer() }, at);
    expect(res.status).toBe(403);
    const cnt = await query<{ n: string }>('SELECT COUNT(*)::text AS n FROM attachments');
    expect(cnt.rows[0].n).toBe('0');
  });

  it('REQ-ATT-006: 미인증 → 401', async () => {
    const { id: noticeId } = await seedNotice();
    const res = await postAttachment(noticeId, { filename: 'pic.png', mimeType: 'image/png', buffer: pngBuffer() }, null);
    expect(res.status).toBe(401);
  });

  it('REQ-ATT-007: 미존재 공지 → 404', async () => {
    const admin = await seedUser('att-nf@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await postAttachment(
      '00000000-0000-0000-0000-000000000000',
      { filename: 'pic.png', mimeType: 'image/png', buffer: pngBuffer() },
      at,
    );
    expect(res.status).toBe(404);
  });

  it('REQ-ATT-022: 스푸핑(선언 PNG, 시그니처 JPEG) → 422 (저장 안 함)', async () => {
    const { id: noticeId } = await seedNotice();
    const admin = await seedUser('att-spoof@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const jpegSig = Buffer.concat([Buffer.from('FFD8FF', 'hex'), Buffer.alloc(50, 0)]);
    const res = await postAttachment(noticeId, { filename: 'fake.png', mimeType: 'image/png', buffer: jpegSig }, at);
    expect(res.status).toBe(422);
  });

  it('REQ-ATT-025: 허용 외 유형(.txt) → 422', async () => {
    const { id: noticeId } = await seedNotice();
    const admin = await seedUser('att-txt@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await postAttachment(noticeId, { filename: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }, at);
    expect(res.status).toBe(422);
  });

  it('REQ-ATT-024: 게시물당 5개 초과 → 422', async () => {
    const { id: noticeId } = await seedNotice();
    const admin = await seedUser('att-max@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    // 5개 먼저 업로드 (성공)
    for (let i = 0; i < 5; i++) {
      const r = await postAttachment(noticeId, { filename: `p${i}.png`, mimeType: 'image/png', buffer: pngBuffer() }, at);
      expect(r.status).toBe(201);
    }
    // 6번째 → 422
    const r = await postAttachment(noticeId, { filename: 'p6.png', mimeType: 'image/png', buffer: pngBuffer() }, at);
    expect(r.status).toBe(422);
    const cnt = await query<{ n: string }>('SELECT COUNT(*)::text AS n FROM attachments WHERE target_id = $1', [noticeId]);
    expect(cnt.rows[0].n).toBe('5');
  });

  it('path UUID 형식 오류 → 400', async () => {
    const admin = await seedUser('att-uuid@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    const res = await postAttachment('not-a-uuid', { filename: 'pic.png', mimeType: 'image/png', buffer: pngBuffer() }, at);
    expect(res.status).toBe(400);
  });

  it('빈 FormData (file 필드 누락) → 422 "file 필드가 필요합니다"', async () => {
    const { id: noticeId } = await seedNotice();
    const admin = await seedUser('att-empty@example.com', { role: 'ADMIN' });
    const at = signAccessToken({ sub: admin.id, role: 'ADMIN', verified: true });
    // file 필드 없는 multipart
    const fd = new FormData();
    const req = new Request(`${BASE_URL}/${noticeId}/attachments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${at}` },
      body: fd,
    });
    const mod = await import('./route');
    const res = await mod.POST(req, { params: Promise.resolve({ id: noticeId }) });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { message?: string }; message?: string };
    const msg = body.error?.message ?? body.message ?? '';
    expect(msg).toContain('file 필드가 필요합니다');
  });
});
