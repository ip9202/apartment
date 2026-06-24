/**
 * GET /api/suggestions/[id] — SPEC-SUGGEST-001 M5 (건의 상세 열람).
 *
 * 인증 사용자(역할별 분기) 건의 상세 조회.
 *   - 미인증 → 401 (REQ-SUGGEST-026)
 *   - path UUID 형식 오류 → 400
 *   - 미존재 id → 404 (REQ-SUGGEST-025)
 *   - 비공개 무권한 → 403 (REQ-SUGGEST-024, 404 아님 — 존재 누출 방지)
 *   - 성공 → 200 { id, title, content, category명, is_public, status, author_label,
 *            building, unit, author_id(아카이브 시 NULL), created_at, updated_at, archived_at }
 *
 * PUT(M2 수정)/DELETE(M3 아카이브) 는 Phase D/E 에서 동일 파일에 추가.
 *
 * @MX:ANCHOR: [AUTO] SUGGEST 상세 API 경계 — 비공개 403 분기 계약
 * @MX:REASON:  비공개 무권한 시 404 가 아닌 403 반환은 존재 누출 방지 (REQ-SUGGEST-024).
 *             본 핸들러 불변 (SPEC-SUGGEST-001 P0).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '../../../../lib/db';
import { badRequest, notFound, forbidden, conflict, validationError } from '../../../../lib/rbac';
import { requireAuthenticated, suggestForbidden, canAccessPrivate } from '../../../../lib/suggest-rbac';

/** UUID v4 정규식 (zod 4 deprecated z.string().uuid() 대체). */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Next.js 15 동적 라우트 params 타입 (Promise). */
interface SuggestionParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/suggestions/[id] — 인증 사용자 건의 상세 (REQ-SUGGEST-023~026).
 */
export async function GET(request: Request, ctx: SuggestionParams): Promise<Response> {
  // 1. route-level Bearer 검증 + 역할 획득
  const auth = await requireAuthenticated(request);
  if ('response' in auth) {
    return auth.response;
  }
  const { callerId, callerRole, managedBuildingId } = auth;

  // 2. params + UUID 형식 검증
  const { id: suggestionId } = await ctx.params;
  if (!UUID_REGEX.test(suggestionId)) {
    return badRequest('올바른 건의 ID 가 아닙니다');
  }

  // 3. 건의 조회 — category명/building/unit JOIN
  const res = await query<{
    id: string;
    title: string;
    content: string;
    category_name: string;
    is_public: boolean;
    status: string;
    author_label: string;
    building_name: string;
    unit_number: string;
    author_id: string | null;
    building_id: string;
    created_at: string;
    updated_at: string;
    archived_at: string | null;
  }>(
    `SELECT s.id, s.title, s.content, sc.name AS category_name, s.is_public, s.status,
            s.author_label, b.name AS building_name, u.unit_number, s.author_id,
            u.building_id, s.created_at, s.updated_at, s.archived_at
     FROM suggestions s
     JOIN suggestion_categories sc ON sc.id = s.category_id
     JOIN units u ON u.id = s.unit_id
     JOIN buildings b ON b.id = u.building_id
     WHERE s.id = $1`,
    [suggestionId],
  );
  const row = res.rows[0];
  if (!row) {
    return notFound('존재하지 않는 건의입니다');
  }

  // 4. 비공개 권한 검사 — 무권한 시 403 (404 아님, REQ-SUGGEST-024)
  if (!row.is_public) {
    if (!canAccessPrivate(callerRole, callerId, row.author_id, managedBuildingId, row.building_id)) {
      return forbidden('이 건의를 조회할 권한이 없습니다');
    }
  }

  // 5. 200 응답
  return NextResponse.json(
    {
      success: true,
      data: {
        id: row.id,
        title: row.title,
        content: row.content,
        category_name: row.category_name,
        is_public: row.is_public,
        status: row.status,
        author_label: row.author_label,
        building: row.building_name,
        unit: row.unit_number,
        author_id: row.author_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        archived_at: row.archived_at,
      },
    },
    { status: 200 },
  );
}

/** 건의 수정 요청 스키마 — 전체 교체 방식 (title/content/category_id/is_public 모두 필수). */
const updateSuggestionSchema = z.object({
  title: z.string().min(1).max(100),
  content: z.string().min(1).max(5000),
  category_id: z
    .string()
    .refine((v) => UUID_REGEX.test(v), '올바른 category_id 가 아닙니다'),
  is_public: z.boolean(),
});

/**
 * PUT /api/suggestions/[id] — 작성자 본인 건의 수정 (REQ-SUGGEST-006~011).
 * archived=true 또는 status='완료' 시 409. 타인 수정 403 (ADMIN 포함).
 */
export async function PUT(request: Request, ctx: SuggestionParams): Promise<Response> {
  // 1. route-level Bearer 검증
  const auth = await requireAuthenticated(request);
  if ('response' in auth) {
    return auth.response;
  }
  const { callerId } = auth;

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
  const parsed = updateSuggestionSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? '유효성 오류');
  }
  const { title, content, category_id: categoryId, is_public } = parsed.data;

  // 4. category_id 사전 존재 확인 (REQ-SUGGEST-010)
  const catRes = await query<{ id: string; name: string }>(
    'SELECT id, name FROM suggestion_categories WHERE id = $1',
    [categoryId],
  );
  if (!catRes.rows[0]) {
    return validationError('존재하지 않는 카테고리입니다');
  }

  // 5. 건의 존재 + author_id + archived/status 조회 (404 우선)
  const existRes = await query<{ author_id: string | null; archived: boolean; status: string }>(
    'SELECT author_id, archived, status FROM suggestions WHERE id = $1',
    [suggestionId],
  );
  if (!existRes.rows[0]) {
    return notFound('존재하지 않는 건의입니다');
  }
  const existing = existRes.rows[0];

  // 6. 작성자 본인 확인 — 아니면 403 (ADMIN 포함, REQ-SUGGEST-007)
  if (!existing.author_id || existing.author_id !== callerId) {
    return forbidden('건의 작성자만 수정할 수 있습니다');
  }

  // 7. archived=true 또는 status='완료' 시 409 (REQ-SUGGEST-008)
  if (existing.archived || existing.status === '완료') {
    return conflict('아카이브되었거나 완료된 건의는 수정할 수 없습니다');
  }

  // 8. 갱신 — updated_at 자동 갱신
  const upd = await query<{ updated_at: string }>(
    `UPDATE suggestions
     SET title = $1, content = $2, category_id = $3, is_public = $4, updated_at = now()
     WHERE id = $5
     RETURNING updated_at`,
    [title, content, categoryId, is_public, suggestionId],
  );

  return NextResponse.json(
    {
      success: true,
      data: {
        id: suggestionId,
        title,
        category_name: catRes.rows[0].name,
        is_public,
        updated_at: upd.rows[0].updated_at,
      },
    },
    { status: 200 },
  );
}

/**
 * DELETE /api/suggestions/[id] — 건의 아카이브 (REQ-SUGGEST-012~017).
 *
 * @MX:WARN: [AUTO] DELETE = archive semantics, NOT row deletion (ADR-005 호수 귀속)
 * @MX:REASON:  행 삭제 시 호수 이력(M8a) 단절. archived=true + 익명화(author_id NULL,
 *             author_label='전 입주민', archived_at=now) 전환. unit_id 영구 보존.
 */
export async function DELETE(request: Request, ctx: SuggestionParams): Promise<Response> {
  // 1. route-level Bearer 검증
  const auth = await requireAuthenticated(request);
  if ('response' in auth) {
    return auth.response;
  }
  const { callerId, callerRole } = auth;

  // 2. params + UUID 형식 검증
  const { id: suggestionId } = await ctx.params;
  if (!UUID_REGEX.test(suggestionId)) {
    return badRequest('올바른 건의 ID 가 아닙니다');
  }

  // 3. 건의 존재 확인 — 미존재 404 (REQ-SUGGEST-016)
  const existRes = await query<{ author_id: string | null; archived: boolean }>(
    'SELECT author_id, archived FROM suggestions WHERE id = $1',
    [suggestionId],
  );
  if (!existRes.rows[0]) {
    return notFound('존재하지 않는 건의입니다');
  }
  const existing = existRes.rows[0];

  // 4. 이미 archived=true → 409 (REQ-SUGGEST-015, 멱등성)
  //    archived 체크를 권한 체크보다 먼저 수행: 아카이브 시 author_id=NULL 이 되므로
  //    권한 체크가 먼저면 재아카이브 시 403(권한)이 반환되어 멱등성 계약이 깨짐.
  if (existing.archived) {
    return conflict('이미 아카이브된 건의입니다');
  }

  // 5. 권한 — 작성자 본인 OR ADMIN (REQ-SUGGEST-014)
  const isAuthor = existing.author_id !== null && existing.author_id === callerId;
  const isAdmin = callerRole === 'ADMIN';
  if (!isAuthor && !isAdmin) {
    return suggestForbidden('건의 작성자 또는 관리자만 아카이브할 수 있습니다');
  }

  // 6. 아카이브 전환 — 익명화 + archived=true + archived_at=now. unit_id 미건드림 (ADR-005)
  await query(
    `UPDATE suggestions
     SET archived = true, author_id = NULL, author_label = '전 입주민', archived_at = now()
     WHERE id = $1`,
    [suggestionId],
  );

  return NextResponse.json({ success: true, data: null }, { status: 200 });
}
