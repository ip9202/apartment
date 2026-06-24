/**
 * POST /api/suggestions/[id]/attachments — SPEC-ATTACHMENT-001 (M1, REQ-ATT-002/004/006/007/024).
 *
 * 건의 첨부 업로드 — 작성자 본인 OR ADMIN.
 *   - 미인증 → 401 (REQ-ATT-006)
 *   - path UUID 형식 오류 → 400
 *   - 미존재 건의 → 404 (REQ-ATT-007)
 *   - 타인/비-ADMIN → 403 (REQ-ATT-004)
 *   - 검증 실패/개수 초과 → 422
 *   - 성공 → 201 { id, original_filename, mime_type, size_bytes, created_at }
 *
 * @MX:NOTE: [AUTO] ADMIN 업로드 허용 — uploader_id = 요청자(ADMIN). suggestions.author_id 는
 *           절대 덮어쓰지 않는다 (CRITICAL decision #3). 작성자 본인 업로드 시 uploader_id=작성자.
 */

import { query } from '../../../../../lib/db';
import { badRequest, notFound, validationError } from '../../../../../lib/rbac';
import { requireAuthenticated, suggestForbidden } from '../../../../../lib/suggest-rbac';
import { uploadAttachment } from '../../../../../lib/attachments-upload';

/** UUID v4 정규식 (path param 검증). */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SuggestionAttachmentsParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: SuggestionAttachmentsParams): Promise<Response> {
  // 1. 인증 (REQ-ATT-006)
  const auth = await requireAuthenticated(request);
  if ('response' in auth) {
    return auth.response;
  }
  const { callerId, callerRole } = auth;

  // 2. params + UUID 검증
  const { id: suggestionId } = await ctx.params;
  if (!UUID_REGEX.test(suggestionId)) {
    return badRequest('올바른 건의 ID 가 아닙니다');
  }

  // 3. 건의 존재 + author_id 확인 (REQ-ATT-007)
  const existRes = await query<{ author_id: string | null }>(
    'SELECT author_id FROM suggestions WHERE id = $1',
    [suggestionId],
  );
  if (!existRes.rows[0]) {
    return notFound('존재하지 않는 건의입니다');
  }

  // 4. 권한 — 작성자 본인 OR ADMIN (REQ-ATT-004)
  const isAuthor = existRes.rows[0].author_id !== null && existRes.rows[0].author_id === callerId;
  const isAdmin = callerRole === 'ADMIN';
  if (!isAuthor && !isAdmin) {
    return suggestForbidden('건의 작성자 또는 관리자만 첨부를 업로드할 수 있습니다');
  }

  // 5. multipart 파싱
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return validationError('multipart/form-data 형식이 아닙니다');
  }

  // 6. 공통 업로드 플로우 — uploader_id = callerId (ADMIN 일 수 있음, CRITICAL #3)
  return uploadAttachment('SUGGEST', suggestionId, callerId, formData);
}
