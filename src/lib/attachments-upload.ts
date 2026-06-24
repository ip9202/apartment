/**
 * 첨부 업로드 공통 플로우 — SPEC-ATTACHMENT-001 (REQ-ATT-001/002).
 *
 * NOTICE/SUGGEST 양쪽 업로드 route 가 권한 분기 이후 호출하는 공통 함수.
 * 검증 → 개수 한도 → sha256 → 디스크 저장 → 메타데이터 INSERT.
 *
 * @MX:ANCHOR: [AUTO] 첨부 업로드 공통 진행 — fan_in=2 (notice, suggestion route)
 * @MX:REASON:  순서/메타데이터 반환 형태가 양쪽 동일. 본 함수가 권한 이후의 공통 계약.
 */

import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { query } from './db';
import { validationError } from './rbac';
import { validateAttachment, MAX_SIZE_BYTES, MAX_PER_POST, sanitizeFilename } from './attachments-validation';
import { saveAttachmentBinary } from './attachments-storage';

export type AttachmentTarget = 'NOTICE' | 'SUGGEST';

/**
 * FormData 에서 file 추출 → 검증 → 저장 → INSERT. 성공 시 201 Response.
 *
 * @MX:NOTE: [AUTO] jsdom/undici cross-realm 호환성 — `file instanceof File` 은 환경 간
 *           실패하므로 duck-typing(arrayBuffer 함수 존재) 으로 File-like 판별.
 *
 * @MX:NOTE: [AUTO] Next.js 15 App Router — request.formData() 가 multipart 스트리밍 파싱.
 *           Pages Router 의 api.bodyParser.sizeLimit 은 App Router 에 미적용. 10MB 상한은
 *           application-level f.size 검증(REQ-ATT-023) 으로 강제 (CRITICAL decision #4).
 */
export async function uploadAttachment(
  target_type: AttachmentTarget,
  target_id: string,
  uploader_id: string,
  formData: FormData,
): Promise<Response> {
  const file = formData.get('file');
  if (
    !file ||
    typeof file !== 'object' ||
    typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== 'function'
  ) {
    return validationError('file 필드가 필요합니다');
  }
  const f = file as { name: string; type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> };

  // 파일 크기 상한 (App Router — application-level 강제)
  if (f.size > MAX_SIZE_BYTES) {
    return validationError(`파일 크기가 ${MAX_SIZE_BYTES} 바이트를 초과합니다`);
  }

  const buffer = Buffer.from(await f.arrayBuffer());
  const declaredMime = f.type;
  const filename = f.name;

  // 1. 검증
  const v = validateAttachment({ declaredMime, filename, size: f.size, buffer });
  if (!v.ok) {
    return validationError(v.message);
  }

  // 2. 게시물당 첨부 수 한도 (REQ-ATT-024)
  const cntRes = await query<{ n: string }>(
    'SELECT COUNT(*)::text AS n FROM attachments WHERE target_type = $1 AND target_id = $2',
    [target_type, target_id],
  );
  const current = Number(cntRes.rows[0]?.n ?? 0);
  if (current + 1 > MAX_PER_POST) {
    return validationError(`게시물당 최대 ${MAX_PER_POST}개의 첨부만 가능합니다`);
  }

  // 3. sha256 (REQ-ATT-029 무결성)
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  // 4. 디스크 저장 (UUID 파일명, path traversal 방어)
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  const saved = await saveAttachmentBinary(buffer, ext);

  // 5. 메타데이터 INSERT
  const ins = await query<{
    id: string;
    original_filename: string;
    mime_type: string;
    size_bytes: number;
    created_at: string;
  }>(
    `INSERT INTO attachments (target_type, target_id, uploader_id, original_filename, mime_type, size_bytes, storage_path, sha256)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, original_filename, mime_type, size_bytes, created_at`,
    [target_type, target_id, uploader_id, sanitizeFilename(filename), declaredMime, f.size, saved.storagePath, sha256],
  );
  const row = ins.rows[0];

  return NextResponse.json(
    {
      success: true,
      data: {
        id: row.id,
        original_filename: row.original_filename,
        mime_type: row.mime_type,
        size_bytes: Number(row.size_bytes),
        created_at: row.created_at,
      },
    },
    { status: 201 },
  );
}
