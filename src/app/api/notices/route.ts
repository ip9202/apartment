/**
 * GET/POST /api/notices — SPEC-NOTICE-001 (M1 등록 + M4 목록).
 *
 * GET  (인증 사용자, 역할 무관): 공지 목록 반환 — category_id 필터 + 페이지네이션 + created_at DESC.
 *      응답 항목에 content 미포함 (REQ-NOTICE-012).
 * POST (ADMIN): 공지 등록 — 201, 미존재 category_id 422, 미인증 401, 비-ADMIN 403.
 *
 * @MX:ANCHOR: [AUTO] NOTICE 공개 API 경계 — 다수 클라이언트(관리사무소/입주민 화면) 호출
 * @MX:REASON:  GET 은 route-level Bearer 강제 + content 미노출 계약. POST 는 requireAdmin RBAC.
 *             본 핸들러를 불변 계약으로 취급 (SPEC-NOTICE-001 P0).
 *
 * @MX:NOTE: [AUTO] route-level Bearer 강제 — middleware.ts 는 AT 쿠키(Edge/jose)만 검사하고
 *           Authorization 헤더를 검사하지 않는다. 통합 테스트/외부 클라이언트는 Bearer 를
 *           사용하므로 GET 핸들러 내부에서 verifyAccessToken 을 직접 호출한다.
 *           (verify-unit/route.ts:46-63 패턴 일관, AC-NOTICE-018)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '../../../lib/db';
import { verifyAccessToken } from '../../../lib/auth';
import {
  requireAdmin,
  unauthorized,
  validationError,
} from '../../../lib/rbac';

/** UUID v4 정규식 — zod 4 deprecated z.string().uuid() 대체 (validators.ts idiom 일관). */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 공지 등록 요청 스키마 — is_pinned 미포함 (EC-NOTICE-006: 본문 값 무시). */
const createNoticeSchema = z.object({
  title: z.string().min(1).max(100),
  content: z.string().min(1).max(10000),
  category_id: z
    .string()
    .refine((v) => UUID_REGEX.test(v), '올바른 category_id 가 아닙니다'),
});

/** 목록 조회 쿼리 스키마 — category_id optional, page/limit 숫자 (양수 정수). limit 상한은 코드에서 clamp. */
const listQuerySchema = z.object({
  category_id: z
    .string()
    .refine((v) => UUID_REGEX.test(v), '올바른 category_id 가 아닙니다')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).default(20),
});

/** route-level Bearer 검증 — 미인증 401. GET 핸들러 전용 (requireAdmin 은 POST/PUT/DELETE용). */
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
 * GET /api/notices — 인증 사용자 공지 목록 (REQ-NOTICE-011, 012, 013a).
 * 역할 무관 (RESIDENT/REP/AUDITOR/CHAIR/ADMIN 전부 허용). content 미포함.
 */
export async function GET(request: Request): Promise<Response> {
  // 1. route-level Bearer 검증 (middleware 는 Bearer 미검사)
  const auth = requireAuth(request);
  if (!auth.ok) {
    return auth.response;
  }

  // 2. 쿼리 파라미터 검증
  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse({
    category_id: url.searchParams.get('category_id') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? '쿼리 파라미터 오류');
  }
  const { category_id: categoryId, page } = parsed.data;
  // limit 상한 100으로 clamp (EC-NOTICE-005: ?limit=200 → 100)
  const limit = Math.min(parsed.data.limit, 100);
  const offset = (page - 1) * limit;

  // 3. 목록 조회 — content 미포함, category명 JOIN, created_at DESC
  // @MX:NOTE: [AUTO] Parameterized Query — SQL Injection 방어 (AC-026 일관)
  const rows = await query<{
    id: string;
    title: string;
    category_name: string;
    created_at: string;
  }>(
    `SELECT n.id, n.title, nc.name AS category_name, n.created_at
     FROM notices n
     JOIN notice_categories nc ON nc.id = n.category_id
     ${categoryId ? 'WHERE n.category_id = $3' : ''}
     ORDER BY n.created_at DESC
     LIMIT $1 OFFSET $2`,
    categoryId ? [limit, offset, categoryId] : [limit, offset],
  );

  // 4. 전체 카운트
  const countRes = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM notices ${categoryId ? 'WHERE category_id = $1' : ''}`,
    categoryId ? [categoryId] : [],
  );
  const total = Number(countRes.rows[0]?.n ?? 0);

  return NextResponse.json(
    { success: true, data: { notices: rows.rows, total } },
    { status: 200 },
  );
}

/**
 * POST /api/notices — ADMIN 공지 등록 (REQ-NOTICE-001, 002, 003a, 003b).
 * @MX:WARN: [AUTO] requireAdmin RBAC — 권한 우회 시 비-ADMIN 공지 변조 가능
 * @MX:REASON: 401/403 분기 로직이 핸들러마다 중복되면 한 곳 누락 시 권한 우회로 이어짐.
 *            requireAdmin 불변 계약 (rbac.ts).
 */
export async function POST(request: Request): Promise<Response> {
  // 1. RBAC — AT 검증 + ADMIN 검사 (401/403 분기)
  const auth = await requireAdmin(request);
  if ('response' in auth) {
    return auth.response;
  }
  const authorId = auth.callerId;

  // 2. 본문 파싱 + zod 검증
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return validationError('요청 본문이 올바른 JSON 형식이 아닙니다');
  }
  const parsed = createNoticeSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? '유효성 오류');
  }
  // is_pinned 는 스키마에 없으므로 본문 값 무시 (EC-NOTICE-006, @MX:NOTE: NOTICE-06 전방 호환)
  const { title, content, category_id: categoryId } = parsed.data;

  // 3. category_id 사전 존재 확인 — 미존재 422 (REQ-NOTICE-002, FK 에러 사전 차단)
  const catRes = await query<{ id: string }>(
    'SELECT id FROM notice_categories WHERE id = $1',
    [categoryId],
  );
  if (!catRes.rows[0]) {
    return validationError('존재하지 않는 카테고리입니다');
  }

  // 4. 공지 생성 — is_pinned 디폴트 false (ERD, NOTICE-06 미노출)
  const ins = await query<{
    id: string;
    title: string;
    content: string;
    author_id: string;
    created_at: string;
  }>(
    `INSERT INTO notices (author_id, category_id, title, content)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, content, author_id, created_at`,
    [authorId, categoryId, title, content],
  );
  const row = ins.rows[0];

  // 5. category명 조회 (응답 본문용)
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
      },
    },
    { status: 201 },
  );
}
