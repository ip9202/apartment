/**
 * GET/DELETE /api/attachments/[id] — SPEC-ATTACHMENT-001 (M3 다운로드 / M4 삭제).
 *
 * GET (REQ-ATT-012~016):
 *   - 미인증 → 401 (REQ-ATT-015)
 *   - path UUID 오류 → 400
 *   - 미존재 → 404 (REQ-ATT-014)
 *   - NOTICE 첨부 → 모든 인증 사용자 허용
 *   - SUGGEST 비공개 첨부 → canAccessPrivate 검사, 실패 시 403 (REQ-ATT-013, 404 아님)
 *   - 디스크 파일 소실 → 500 + 로그 (REQ-ATT-016)
 *   - 성공 → 200 + Content-Type + Content-Disposition: attachment; filename="..."
 *
 * DELETE (REQ-ATT-017~021):
 *   - NOTICE target → ADMIN 만
 *   - SUGGEST target → uploader_id === caller OR ADMIN
 *   - withTransaction 내에서 DB 행 DELETE + 디스크 파일 제거 (CRITICAL #1 single-delete)
 *   - 디스크 제거 실패 시 ROLLBACK (메타데이터/바이너리 일관성)
 *
 * @MX:NOTE: [AUTO] 단일 첨부 DELETE 는 트랜잭션 내 디스크 제거 (롤백 강제). 반면
 *           cascade(NOTICE/SUGGEST/AUTH)는 post-commit best-effort (CRITICAL #1 차이).
 */

import { NextResponse } from 'next/server';
import { query, withTransaction } from '../../../../lib/db';
import { existsSync, statSync } from 'node:fs';
import { badRequest, notFound, forbidden } from '../../../../lib/rbac';
import { requireAuthenticated, suggestForbidden, canAccessPrivate } from '../../../../lib/suggest-rbac';
import { removeAttachmentBinary } from '../../../../lib/attachments-storage';

/** UUID v4 정규식. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AttachmentParams {
  params: Promise<{ id: string }>;
}

/** 다운로드 권한 검사 — target 게시물 가시성 준거 (REQ-ATT-012/013). */
async function canDownload(
  attachment: { target_type: string; target_id: string },
  callerId: string,
  callerRole: string,
  managedBuildingId: string | null,
): Promise<boolean> {
  // NOTICE: 모든 인증 사용자
  if (attachment.target_type === 'NOTICE') return true;
  // SUGGEST: 건의 가시성 검사
  if (attachment.target_type === 'SUGGEST') {
    const suggRes = await query<{ is_public: boolean; author_id: string | null; building_id: string }>(
      `SELECT s.is_public, s.author_id, u.building_id
       FROM suggestions s JOIN units u ON u.id = s.unit_id
       WHERE s.id = $1`,
      [attachment.target_id],
    );
    const sugg = suggRes.rows[0];
    if (!sugg) return false; // 건의 행 자체가 없으면 비정상 — 거부
    if (sugg.is_public) return true;
    return canAccessPrivate(callerRole, callerId, sugg.author_id, managedBuildingId, sugg.building_id);
  }
  return false;
}

/**
 * GET /api/attachments/[id] — 다운로드 스트리밍.
 *
 * @MX:WARN: [AUTO] 디스크 파일 누락(REQ-ATT-016)은 비정상 상태 — 500 + 로그.
 * @MX:REASON:  DB 행 존재 + 디스크 파일 부재 = 메타데이터/바이너리 불일치. 모니터링 대상.
 */
export async function GET(request: Request, ctx: AttachmentParams): Promise<Response> {
  // 1. 인증
  const auth = await requireAuthenticated(request);
  if ('response' in auth) {
    return auth.response;
  }
  const { callerId, callerRole, managedBuildingId } = auth;

  // 2. params + UUID
  const { id: attachmentId } = await ctx.params;
  if (!UUID_REGEX.test(attachmentId)) {
    return badRequest('올바른 첨부 ID 가 아닙니다');
  }

  // 3. 메타데이터 조회 (REQ-ATT-014)
  const metaRes = await query<{
    target_type: string;
    target_id: string;
    original_filename: string;
    mime_type: string;
    storage_path: string;
  }>(
    `SELECT target_type, target_id, original_filename, mime_type, storage_path
     FROM attachments WHERE id = $1`,
    [attachmentId],
  );
  const meta = metaRes.rows[0];
  if (!meta) {
    return notFound('존재하지 않는 첨부입니다');
  }

  // 4. 다운로드 권한 (REQ-ATT-013 — 비공개 SUGGEST 무권한 403)
  const allowed = await canDownload(meta, callerId, callerRole, managedBuildingId);
  if (!allowed) {
    return forbidden('이 첨부를 다운로드할 권한이 없습니다');
  }

  // 5. 디스크 파일 존재 확인 (REQ-ATT-016)
  if (!existsSync(meta.storage_path)) {
    console.error(`[attachments] 디스크 파일 소실 (REQ-ATT-016): attachment_id=${attachmentId} path=${meta.storage_path}`);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: '첨부 파일을 찾을 수 없습니다' } },
      { status: 500 },
    );
  }
  const stat = statSync(meta.storage_path);

  // 6. 스트리밍 응답 — Node Readable → Web ReadableStream
  const { readAttachmentStream } = await import('../../../../lib/attachments-storage');
  const { Readable } = await import('node:stream');
  const nodeStream = readAttachmentStream(meta.storage_path);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  const headers = new Headers({
    'content-type': meta.mime_type,
    'content-disposition': `attachment; filename="${meta.original_filename}"`,
    'content-length': String(stat.size),
  });

  return new Response(webStream, { status: 200, headers });
}

/**
 * DELETE /api/attachments/[id] — 단일 첨부 삭제 (트랜잭션).
 *
 * @MX:WARN: [AUTO] 디스크 제거 실패 시 트랜잭션 ROLLBACK (CRITICAL #1).
 * @MX:REASON:  메타데이터/바이너리 일관성. 디스크 I/O 일시적 장애가 DB 삭제를 차단하면
 *             고아 파일(행은 있고 파일 없음) 발생. 롤백으로 둘 다 보존 후 재시도 유도.
 */
export async function DELETE(request: Request, ctx: AttachmentParams): Promise<Response> {
  // 1. 인증
  const auth = await requireAuthenticated(request);
  if ('response' in auth) {
    return auth.response;
  }
  const { callerId, callerRole } = auth;

  // 2. params + UUID
  const { id: attachmentId } = await ctx.params;
  if (!UUID_REGEX.test(attachmentId)) {
    return badRequest('올바른 첨부 ID 가 아닙니다');
  }

  // 3. 메타데이터 조회 (REQ-ATT-020)
  const metaRes = await query<{
    target_type: string;
    target_id: string;
    uploader_id: string;
    storage_path: string;
  }>('SELECT target_type, target_id, uploader_id, storage_path FROM attachments WHERE id = $1', [attachmentId]);
  const meta = metaRes.rows[0];
  if (!meta) {
    return notFound('존재하지 않는 첨부입니다');
  }

  // 4. 권한 — NOTICE target: ADMIN 만; SUGGEST target: uploader 본인 OR ADMIN (REQ-ATT-019)
  const isAdmin = callerRole === 'ADMIN';
  if (meta.target_type === 'NOTICE') {
    if (!isAdmin) {
      return forbidden('관리자만 공지 첨부를 삭제할 수 있습니다');
    }
  } else {
    // SUGGEST
    const isUploader = meta.uploader_id === callerId;
    if (!isUploader && !isAdmin) {
      return suggestForbidden('첨부 작성자 또는 관리자만 삭제할 수 있습니다');
    }
  }

  // 5. 트랜잭션: DB 행 DELETE + 디스크 파일 제거 (CRITICAL #1)
  try {
    await withTransaction(async (client) => {
      await client.query('DELETE FROM attachments WHERE id = $1', [attachmentId]);
      // 디스크 제거 — 실패 시 throw → withTransaction 이 ROLLBACK
      removeAttachmentBinary(meta.storage_path);
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'DELETE_FAILED', message: '첨부 삭제 중 오류가 발생했습니다' } },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, data: null }, { status: 200 });
}
