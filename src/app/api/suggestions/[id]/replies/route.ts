/**
 * POST /api/suggestions/[id]/replies — SPEC-SUGGEST-001 M6 (건의 답변 등록).
 *
 * ADMIN 전용 답변 등록.
 *   - 미인증 → 401 (REQ-SUGGEST-029a)
 *   - 비-ADMIN → 403 (REQ-SUGGEST-029b)
 *   - path UUID 형식 오류 → 400
 *   - 미존재 건의 → 404 (REQ-SUGGEST-028)
 *   - content 빈/5000자 초과 → 422
 *   - 성공 → 201 { id, suggestion_id, author_id, content, created_at }
 *
 * @MX:ANCHOR: [AUTO] SUGGEST 답변 API 경계 — ADMIN RBAC 계약
 * @MX:REASON:  답변은 관리사무소(ADMIN)만 작성 가능. 비-ADMIN 허용 시 입주민이 공식 답변 위변조 가능.
 *
 * @MX:TODO: [AUTO] 답변 수정/삭제 별도 SPEC (본 SPEC OUT, Exclusions #5)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '../../../../../lib/db';
import { requireAdmin, badRequest, notFound, validationError } from '../../../../../lib/rbac';

/** UUID v4 정규식. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 답변 등록 스키마 — content max 5000 (건의 본문과 동일 한도). */
const createReplySchema = z.object({
  content: z.string().min(1).max(5000),
});

interface ReplyParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/suggestions/[id]/replies — ADMIN 답변 등록 (REQ-SUGGEST-027~029b).
 */
export async function POST(request: Request, ctx: ReplyParams): Promise<Response> {
  // 1. RBAC — AT 검증 + ADMIN 검사 (401/403 분기)
  const auth = await requireAdmin(request);
  if ('response' in auth) {
    return auth.response;
  }
  const authorId = auth.callerId;

  // 2. params + UUID 형식 검증
  const { id: suggestionId } = await ctx.params;
  if (!UUID_REGEX.test(suggestionId)) {
    return badRequest('올바른 건의 ID 가 아닙니다');
  }

  // 3. 본문 파싱 + zod 검증
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return validationError('요청 본문이 올바른 JSON 형식이 아닙니다');
  }
  const parsed = createReplySchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? '유효성 오류');
  }
  const { content } = parsed.data;

  // 4. 건의 존재 확인 — 미존재 404 (REQ-SUGGEST-028)
  const existRes = await query<{ id: string }>(
    'SELECT id FROM suggestions WHERE id = $1',
    [suggestionId],
  );
  if (!existRes.rows[0]) {
    return notFound('존재하지 않는 건의입니다');
  }

  // 5. 답변 생성
  const ins = await query<{
    id: string;
    content: string;
    author_id: string;
    created_at: string;
  }>(
    `INSERT INTO suggestion_replies (suggestion_id, author_id, content)
     VALUES ($1, $2, $3)
     RETURNING id, content, author_id, created_at`,
    [suggestionId, authorId, content],
  );
  const row = ins.rows[0];

  return NextResponse.json(
    {
      success: true,
      data: {
        id: row.id,
        suggestion_id: suggestionId,
        author_id: row.author_id,
        content: row.content,
        created_at: row.created_at,
      },
    },
    { status: 201 },
  );
}
