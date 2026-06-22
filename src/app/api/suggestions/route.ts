/**
 * GET/POST /api/suggestions — SPEC-SUGGEST-001 (M1 등록 + M4 목록).
 *
 * GET  (인증 사용자, 역할별 분기): 건의 목록 반환 — RESIDENT/AUDITOR 본인+공개, REP 담당동+공개,
 *      CHAIR/ADMIN 전체. is_public/status/category_id/unit_id 필터 + 페이지네이션 + created_at DESC.
 *      응답 항목에 content 미포함 (REQ-SUGGEST-019).
 * POST (RESIDENT/REP/AUDITOR/CHAIR, ADMIN 제외): 건의 등록 — 201, 미존재 category_id 422,
 *      미인증 401, unit_id NULL 403, ADMIN 403.
 *
 * @MX:ANCHOR: [AUTO] SUGGEST 공개 API 경계 — 역할별 비공개 분기 + ADMIN 등록 403
 * @MX:REASON:  역할별 비공개 분기(RESIDENT 본인 / REP 담당동 / CHAIR·ADMIN 전체)는 SUGGEST 고유 비즈니스 로직.
 *             본 핸들러를 불변 계약으로 취급 (SPEC-SUGGEST-001 P0).
 *
 * @MX:NOTE: [AUTO] route-level Bearer 강제 — middleware.ts 는 AT 쿠키만 검사, Bearer 미검사.
 *           suggest-rbac.ts requireAuthenticated 가 Bearer→verifyAccessToken→ACTIVE 조회 후
 *           {callerId, callerRole, unitId, managedBuildingId} 반환 (NOTICE requireAuth 패턴 확장).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '../../../lib/db';
import { validationError } from '../../../lib/rbac';
import { requireAuthenticated, suggestForbidden } from '../../../lib/suggest-rbac';

/** UUID v4 정규식 (zod 4 deprecated z.string().uuid() 대체). */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 건의 등록 요청 스키마 — content max 5000 (NOTICE 10000과 상이, apt_03 SUGGEST-01 명시). */
const createSuggestionSchema = z.object({
  title: z.string().min(1).max(100),
  content: z.string().min(1).max(5000),
  category_id: z
    .string()
    .refine((v) => UUID_REGEX.test(v), '올바른 category_id 가 아닙니다'),
  is_public: z.boolean(),
});

/** 목록 조회 쿼리 스키마 — 모든 필터 optional, page/limit 숫자. */
const listQuerySchema = z.object({
  is_public: z.enum(['true', 'false']).optional(),
  status: z.string().max(20).optional(),
  category_id: z
    .string()
    .refine((v) => UUID_REGEX.test(v), '올바른 category_id 가 아닙니다')
    .optional(),
  unit_id: z
    .string()
    .refine((v) => UUID_REGEX.test(v), '올바른 unit_id 가 아닙니다')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).default(20),
});

/** 역할별 비공개 건의 접근 권한 — RESIDENT/AUDITOR 본인, REP 담당동, CHAIR/ADMIN 전체. */
function buildVisibilityCondition(
  callerRole: string,
  callerId: string,
  managedBuildingId: string | null,
): { clause: string; params: string[] } {
  // CHAIR/ADMIN: 전체 (조건 없음)
  if (callerRole === 'CHAIR' || callerRole === 'ADMIN') {
    return { clause: '', params: [] };
  }
  // REP: 공개 OR 본인 OR (비공개 ∧ 담당동 호수)
  if (callerRole === 'REP') {
    if (managedBuildingId) {
      return {
        clause:
          '(s.is_public = true OR s.author_id = $1 OR (s.is_public = false AND u.building_id = $2))',
        params: [callerId, managedBuildingId],
      };
    }
    // 담당동 없는 REP 는 RESIDENT 와 동일 (본인 + 공개)
    return {
      clause: '(s.is_public = true OR s.author_id = $1)',
      params: [callerId],
    };
  }
  // RESIDENT/AUDITOR (기본): 공개 OR 본인
  return {
    clause: '(s.is_public = true OR s.author_id = $1)',
    params: [callerId],
  };
}

/**
 * GET /api/suggestions — 인증 사용자 건의 목록 (REQ-SUGGEST-018~022, 역할별 분기).
 */
export async function GET(request: Request): Promise<Response> {
  // 1. route-level Bearer 검증 + 역할/호수/담당동 획득
  const auth = await requireAuthenticated(request);
  if ('response' in auth) {
    return auth.response;
  }
  const { callerRole, callerId, managedBuildingId } = auth;

  // 2. 쿼리 파라미터 검증
  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse({
    is_public: url.searchParams.get('is_public') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    category_id: url.searchParams.get('category_id') ?? undefined,
    unit_id: url.searchParams.get('unit_id') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? '쿼리 파라미터 오류');
  }
  const { is_public, status, category_id: filterCat, unit_id: filterUnit, page } = parsed.data;
  const limit = Math.min(parsed.data.limit, 100);
  const offset = (page - 1) * limit;

  // 3. 역할별 가시성 조건 + 사용자 필터 조건 결합
  // @MX:NOTE: [AUTO] Parameterized WHERE — 역할별 조건 구조는 코드 고정(사용자 입력 아님),
  //           필터값은 $N 파라미터로 바인딩. 동적 SQL 문자열 결합 금지 (SQL Injection 방어).
  const visibility = buildVisibilityCondition(callerRole, callerId, managedBuildingId);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  // units JOIN (가시성 + 필터용)
  // visibility clause 는 이미 $1/$2 사용 → visibility.params 먼저 밀어넣고 paramIdx 조정
  const visibilityParams: unknown[] = [];
  for (const p of visibility.params) {
    visibilityParams.push(p);
  }
  // visibility.clause 의 $1/$2 를 실제 paramIdx 로 교체 필요 → 별도 placeholder 전략:
  // visibility.clause 는 항상 callerId(또는 callerId+managedBuildingId) 부터 시작.
  // 간단히 visibility.params 를 conditions 보다 먼저 바인딩.
  if (visibility.clause) {
    // visibility.clause 의 placeholder($1, $2) 재작성 → paramIdx 기반
    let rewritten = visibility.clause;
    const placeholders: unknown[] = [];
    for (const p of visibilityParams) {
      rewritten = rewritten.replace(`$${placeholders.length + 1}`, `$${paramIdx}`);
      placeholders.push(p);
      paramIdx++;
    }
    conditions.push(rewritten);
    params.push(...placeholders);
  }

  if (is_public !== undefined) {
    conditions.push(`s.is_public = $${paramIdx++}`);
    params.push(is_public === 'true');
  }
  if (status) {
    conditions.push(`s.status = $${paramIdx++}`);
    params.push(status);
  }
  if (filterCat) {
    conditions.push(`s.category_id = $${paramIdx++}`);
    params.push(filterCat);
  }
  if (filterUnit) {
    conditions.push(`s.unit_id = $${paramIdx++}`);
    params.push(filterUnit);
  }
  // archived=false 기본 (아카이브된 건의는 목록에서 제외 — M4 요구사항 준거)
  conditions.push(`s.archived = $${paramIdx++}`);
  params.push(false);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // 4. 목록 조회 — content 미포함, category명/building/unit JOIN, created_at DESC
  //    visibility.clause 가 units JOIN(u) 을 참조할 수 있으므로 항상 JOIN.
  const limitPh = paramIdx++;
  const offsetPh = paramIdx++;
  const rows = await query<{
    id: string;
    title: string;
    category_name: string;
    is_public: boolean;
    status: string;
    author_label: string;
    building_name: string;
    unit_number: string;
    created_at: string;
  }>(
    `SELECT s.id, s.title, sc.name AS category_name, s.is_public, s.status,
            s.author_label, b.name AS building_name, u.unit_number, s.created_at
     FROM suggestions s
     JOIN suggestion_categories sc ON sc.id = s.category_id
     JOIN units u ON u.id = s.unit_id
     JOIN buildings b ON b.id = u.building_id
     ${where}
     ORDER BY s.created_at DESC
     LIMIT $${limitPh} OFFSET $${offsetPh}`,
    [...params, limit, offset],
  );

  // 5. 전체 카운트
  const countRes = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM suggestions s
     JOIN units u ON u.id = s.unit_id
     ${where}`,
    params,
  );
  const total = Number(countRes.rows[0]?.n ?? 0);

  return NextResponse.json(
    {
      success: true,
      data: {
        suggestions: rows.rows.map((r) => ({
          id: r.id,
          title: r.title,
          category_name: r.category_name,
          is_public: r.is_public,
          status: r.status,
          author_label: r.author_label,
          building: r.building_name,
          unit: r.unit_number,
          created_at: r.created_at,
        })),
        total,
      },
    },
    { status: 200 },
  );
}

/**
 * POST /api/suggestions — RESIDENT 이상 건의 등록 (REQ-SUGGEST-001~005).
 * @MX:WARN: [AUTO] ADMIN 등록 403 — 관리사무소는 건의 처리 주체, 등록 권한 없음 (apt_08 §7)
 * @MX:REASON:  ADMIN 이 건의를 등록하면 처리 주체와 작성자가 동일해 역할 충돌. 403 명시.
 */
export async function POST(request: Request): Promise<Response> {
  // 1. route-level Bearer 검증 + 역할 획득
  const auth = await requireAuthenticated(request);
  if ('response' in auth) {
    return auth.response;
  }
  const { callerId, callerRole, unitId } = auth;

  // 2. ADMIN 등록 금지 (REQ-SUGGEST-002)
  if (callerRole === 'ADMIN') {
    return suggestForbidden('관리사무소는 건의를 등록할 수 없습니다');
  }

  // 3. unit_id NULL 검사 (REQ-SUGGEST-005 — 미인증 사용자)
  if (!unitId) {
    return suggestForbidden('동/호수 인증이 완료된 사용자만 건의를 등록할 수 있습니다');
  }

  // 4. 본문 파싱 + zod 검증
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return validationError('요청 본문이 올바른 JSON 형식이 아닙니다');
  }
  const parsed = createSuggestionSchema.safeParse(raw);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? '유효성 오류');
  }
  const { title, content, category_id: categoryId, is_public } = parsed.data;

  // 5. category_id 사전 존재 확인 (REQ-SUGGEST-003, FK 사전 차단)
  const catRes = await query<{ id: string; name: string }>(
    'SELECT id, name FROM suggestion_categories WHERE id = $1',
    [categoryId],
  );
  if (!catRes.rows[0]) {
    return validationError('존재하지 않는 카테고리입니다');
  }

  // 6. 건의 생성 — author_id=caller, unit_id=인증 호수, status='접수', archived=false
  const ins = await query<{ id: string; created_at: string }>(
    `INSERT INTO suggestions (author_id, author_label, unit_id, category_id, title, content, is_public, status, archived)
     VALUES ($1, '입주민', $2, $3, $4, $5, $6, '접수', false)
     RETURNING id, created_at`,
    [callerId, unitId, categoryId, title, content, is_public],
  );
  const row = ins.rows[0];

  // 7. building/unit 명 조회 (응답 본문용)
  const locRes = await query<{ building_name: string; unit_number: string }>(
    `SELECT b.name AS building_name, u.unit_number
     FROM units u JOIN buildings b ON b.id = u.building_id WHERE u.id = $1`,
    [unitId],
  );

  return NextResponse.json(
    {
      success: true,
      data: {
        id: row.id,
        title,
        category_name: catRes.rows[0].name,
        is_public,
        status: '접수',
        author_label: '입주민',
        building: locRes.rows[0].building_name,
        unit: locRes.rows[0].unit_number,
        created_at: row.created_at,
      },
    },
    { status: 201 },
  );
}
