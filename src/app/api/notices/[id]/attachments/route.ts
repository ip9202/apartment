/**
 * POST /api/notices/[id]/attachments — SPEC-ATTACHMENT-001 (M1, REQ-ATT-001/003/005/006/007/008/024).
 *
 * ADMIN 공지 첨부 업로드.
 *   - 미인증 → 401 (REQ-ATT-006)
 *   - path UUID 형식 오류 → 400
 *   - 비-ADMIN → 403 (REQ-ATT-003)
 *   - 미존재 공지 → 404 (REQ-ATT-007)
 *   - 검증 실패/개수 초과 → 422 (REQ-ATT-005/022/023/024/025)
 *   - 성공 → 201 { id, original_filename, mime_type, size_bytes, created_at }
 *
 * @MX:NOTE: [AUTO] ADMIN 만 업로드 (REQ-ATT-003). uploader_id = 요청 ADMIN.
 *           공통 업로드 플로우는 attachments-upload.ts uploadAttachment 참조.
 */

import { query } from '../../../../../lib/db';
import { requireAdmin, badRequest, notFound, validationError } from '../../../../../lib/rbac';
import { uploadAttachment } from '../../../../../lib/attachments-upload';

/** UUID v4 정규식 (path param 검증). */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface NoticeAttachmentsParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: NoticeAttachmentsParams): Promise<Response> {
  // 1. RBAC — ADMIN 만 (REQ-ATT-003)
  const auth = await requireAdmin(request);
  if ('response' in auth) {
    return auth.response;
  }
  const { callerId } = auth;

  // 2. params + UUID 검증
  const { id: noticeId } = await ctx.params;
  if (!UUID_REGEX.test(noticeId)) {
    return badRequest('올바른 공지 ID 가 아닙니다');
  }

  // 3. 공지 존재 확인 (REQ-ATT-007)
  const existsRes = await query<{ id: string }>('SELECT id FROM notices WHERE id = $1', [noticeId]);
  if (!existsRes.rows[0]) {
    return notFound('존재하지 않는 공지입니다');
  }

  // 4. multipart 파싱
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return validationError('multipart/form-data 형식이 아닙니다');
  }

  // 5. 공통 업로드 플로우
  return uploadAttachment('NOTICE', noticeId, callerId, formData);
}
