/**
 * GET /api/notices/[id] — SPEC-NOTICE-001 M5 (공지 상세 열람).
 *
 * 인증 사용자(역할 무관) 공지 상세 조회.
 *   - 미인증 → 401 (REQ-NOTICE-016a, AC-NOTICE-022)
 *   - path UUID 형식 오류 → 400 (EC-NOTICE-003)
 *   - 미존재 id → 404 (REQ-NOTICE-015, AC-NOTICE-021)
 *   - 성공 → 200 { id, title, content, category명, author_id, created_at, updated_at }
 *
 * PUT(수정)/DELETE(삭제) 는 Phase D/E 에서 동일 파일에 추가.
 *
 * @MX:ANCHOR: [AUTO] NOTICE 공개 API 경계 — 입주민 상세 화면 호출
 * @MX:REASON:  route-level Bearer 강제 + UUID path 검증 + 404 계약. 본 핸들러 불변 (SPEC-NOTICE-001 P0).
 *
 * @MX:NOTE: [AUTO] route-level Bearer 강제 — middleware.ts 는 AT 쿠키만 검사, Bearer 미검사.
 *           verify-unit/route.ts:46-63 패턴 일관 (AC-NOTICE-022).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query, withTransaction } from '../../../../lib/db';
import { verifyAccessToken } from '../../../../lib/auth';
import {
  requireAdmin,
  unauthorized,
  badRequest,
  notFound,
  validationError,
} from '../../../../lib/rbac';
import { removeAttachmentBinary } from '../../../../lib/attachments-storage';

/** UUID v4 정규식 (validators.ts idiom 일관 — z.string().uuid() deprecated). */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 공지 수정 요청 스키마 — 전체 교체 방식 (title/content/category_id 모두 필수). is_pinned 미포함 (EC-NOTICE-006). */
const updateNoticeSchema = z.object({
  title: z.string().min(1).max(100),
  content: z.string().min(1).max(10000),
  category_id: z
    .string()
    .refine((v) => UUID_REGEX.test(v), '올바른 category_id 가 아닙니다'),
});

/** Next.js 15 동적 라우트 params 타입 (Promise). */
interface NoticeParams {
  params: Promise<{ id: string }>;
}

/** route-level Bearer 검증 — 미인증 401. GET 핸들러용 (requireAdmin 은 POST/PUT/DELETE용). */
function requireAuth(request: Request): { ok: true; callerId: string } | { ok: false; response: Response } {
  const authHeader = request.headers.get('authorization') ?? '';
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!bearerMatch) {
    return { ok: false, response: unauthorized() };
  }
  let claims: { sub?: string };
  try {
    claims = verifyAccessToken(bearerMatch[1]);
  } catch {
    return { ok: false, response: unauthorized() };
  }
  const callerId = claims.sub;
  if (!callerId) {
    return { ok: false, response: unauthorized() };
  }
  return { ok: true, callerId };
}

/**
 * GET /api/notices/[id] — 인증 사용자 공지 상세 (REQ-NOTICE-014, 015, 016a).
 * 역할 무관. content 포함 (목록과 달리 상세는 전체 필드).
 */
export async function GET(request: Request, ctx: NoticeParams): Promise<Response> {
  // 1. route-level Bearer 검증
  const auth = requireAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  // 2. params + UUID 형식 검증 (EC-NOTICE-003)
  const { id: noticeId } = await ctx.params;
  if (!UUID_REGEX.test(noticeId)) {
    return badRequest('올바른 공지 ID 가 아닙니다');
  }

  // 3. 공지 조회 — category명 JOIN, 미존재 404
  const res = await query<{
    id: string;
    title: string;
    content: string;
    category_name: string;
    author_id: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT n.id, n.title, n.content, nc.name AS category_name,
            n.author_id, n.created_at, n.updated_at
     FROM notices n
     JOIN notice_categories nc ON nc.id = n.category_id
     WHERE n.id = $1`,
    [noticeId],
  );
  const row = res.rows[0];
  if (!row) {
    return notFound('존재하지 않는 공지입니다');
  }

  // 첨부 메타데이터 조회 (SPEC-ATTACHMENT-001 REQ-ATT-009/011) — storage_path 미노출
  const attRes = await query<{
    id: string;
    original_filename: string;
    mime_type: string;
    size_bytes: string;
    created_at: string;
  }>(
    `SELECT id, original_filename, mime_type, size_bytes, created_at
     FROM attachments WHERE target_type = 'NOTICE' AND target_id = $1
     ORDER BY created_at ASC`,
    [noticeId],
  );
  const attachments = attRes.rows.map((a) => ({
    id: a.id,
    original_filename: a.original_filename,
    mime_type: a.mime_type,
    size_bytes: Number(a.size_bytes),
    created_at: a.created_at,
  }));

  return NextResponse.json({ success: true, data: { ...row, attachments } }, { status: 200 });
}

/**
 * PUT /api/notices/[id] — ADMIN 공지 수정 (REQ-NOTICE-004, 005, 006, 007a, 007b).
 * 전체 교체 방식 — title/content/category_id 모두 필수. is_pinned 미갱신 (NOTICE-06 전방 호환).
 *
 * @MX:WARN: [AUTO] requireAdmin RBAC — 비-ADMIN 공지 변조 차단
 * @MX:REASON:  권한 우회 시 입주민 공지 위변조 가능. requireAdmin 불변 계약 (rbac.ts).
 */
export async function PUT(request: Request, ctx: NoticeParams): Promise<Response> {
  // 1. RBAC — AT 검증 + ADMIN 검사 (401/403 분기)
  const auth = await requireAdmin(request);
  if ('response' in auth) {
    return auth.response;
  }

  // 2. params + UUID 형식 검증 (EC-NOTICE-003)
  const { id: noticeId } = await ctx.params;
  if (!UUID_REGEX.test(noticeId)) {
    return badRequest('올바른 공지 ID 가 아닙니다');
  }

  // 3. 본문 파싱 + zod 검증
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return validationError('요청 본문이 올바른 JSON 형식이 아닙니다');
  }
  const parsed = updateNoticeSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? '유효성 오류');
  }
  const { title, content, category_id: categoryId } = parsed.data;

  // 4. category_id 사전 존재 확인 — 미존재 422 (REQ-NOTICE-006, FK 사전 차단)
  const catRes = await query<{ id: string }>(
    'SELECT id FROM notice_categories WHERE id = $1',
    [categoryId],
  );
  if (!catRes.rows[0]) {
    return validationError('존재하지 않는 카테고리입니다');
  }

  // 5. 공지 존재 확인 — 미존재 404 (REQ-NOTICE-005)
  const existsRes = await query<{ id: string }>(
    'SELECT id FROM notices WHERE id = $1',
    [noticeId],
  );
  if (!existsRes.rows[0]) {
    return notFound('존재하지 않는 공지입니다');
  }

  // 6. 갱신 — updated_at 자동 갱신, is_pinned 미갱신 (NOTICE-06 미노출)
  const upd = await query<{
    id: string;
    title: string;
    content: string;
    author_id: string;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE notices SET title = $1, content = $2, category_id = $3, updated_at = now()
     WHERE id = $4
     RETURNING id, title, content, author_id, created_at, updated_at`,
    [title, content, categoryId, noticeId],
  );
  const row = upd.rows[0];

  // 7. category명 조회 (응답 본문용)
  const catNameRes = await query<{ name: string }>(
    'SELECT name FROM notice_categories WHERE id = $1',
    [categoryId],
  );

  return NextResponse.json(
    {
      success: true,
      data: {
        id: row.id,
        title: row.title,
        category_name: catNameRes.rows[0].name,
        content: row.content,
        author_id: row.author_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    },
    { status: 200 },
  );
}

/**
 * DELETE /api/notices/[id] — ADMIN 공지 영구 삭제 (REQ-NOTICE-008, 009, 010a, 010b).
 *
 * @MX:WARN: [AUTO] Hard delete — DELETE FROM, 영구 삭제. 복구 불가.
 * @MX:REASON:  기획서(기능명세서/PRD) 명시 정책. 소프트 삭제/archived 는 건의(SUGGEST) 도메인만.
 *             삭제된 공지는 데이터베이스에서 완전히 제거된다.
 */
export async function DELETE(request: Request, ctx: NoticeParams): Promise<Response> {
  // 1. RBAC — AT 검증 + ADMIN 검사 (401/403 분기)
  // @MX:WARN: [AUTO] requireAdmin RBAC — 비-ADMIN 공지 삭제 차단
  // @MX:REASON: 권한 우회 시 공지 은폐/삭제 가능. requireAdmin 불변 계약 (rbac.ts).
  const auth = await requireAdmin(request);
  if ('response' in auth) {
    return auth.response;
  }

  // 2. params + UUID 형식 검증 (EC-NOTICE-003)
  const { id: noticeId } = await ctx.params;
  if (!UUID_REGEX.test(noticeId)) {
    return badRequest('올바른 공지 ID 가 아닙니다');
  }

  // 3. 공지 존재 확인 — 미존재 404 (REQ-NOTICE-009)
  const existsRes = await query<{ id: string }>(
    'SELECT id FROM notices WHERE id = $1',
    [noticeId],
  );
  if (!existsRes.rows[0]) {
    return notFound('존재하지 않는 공지입니다');
  }

  // 4. Hard delete — 영구 삭제 (REQ-NOTICE-008) + 첨부 cascade (REQ-ATT-026)
  //    트랜잭션 내에서 attachments 행 SELECT(storage_path) → DELETE → notice DELETE.
  //    디스크 파일 제거는 post-commit best-effort (CRITICAL #1 cascade 정책).
  let pathsToDelete: string[] = [];
  try {
    pathsToDelete = await withTransaction(async (client) => {
      const delRes = await client.query<{ storage_path: string }>(
        `DELETE FROM attachments WHERE target_type = 'NOTICE' AND target_id = $1 RETURNING storage_path`,
        [noticeId],
      );
      await client.query('DELETE FROM notices WHERE id = $1', [noticeId]);
      return delRes.rows.map((r) => r.storage_path);
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'DELETE_FAILED', message: '공지 삭제 중 오류가 발생했습니다' } },
      { status: 500 },
    );
  }

  // post-commit best-effort 디스크 정리 (실패 시 로그만, 고아 파일은 REQ-ATT-016 모니터링)
  for (const p of pathsToDelete) {
    try {
      removeAttachmentBinary(p);
    } catch (err) {
      console.error(`[attachments] cascade 디스크 제거 실패 (REQ-ATT-026): path=${p}`, err);
    }
  }

  return NextResponse.json({ success: true, data: null }, { status: 200 });
}


