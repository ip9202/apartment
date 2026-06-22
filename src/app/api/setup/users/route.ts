/**
 * GET /api/setup/users — SPEC-SETUP-001 Phase E (M4 회원 목록 조회).
 *
 * ADMIN 전용. building/role/page/limit/status 쿼리 필터 지원.
 * - 미인증/불량/만료 AT → 401 (REQ-SETUP-016a, AC-018a)
 * - 비-ADMIN → 403 (REQ-SETUP-016b, AC-018b)
 * - 200 + { success, data: { users, total, page, limit } } (REQ-SETUP-014, AC-016)
 * - password_hash 절대 미포함 (REQ-SETUP-015, AC-017)
 * - status 생략 시 ACTIVE 만 (REQ-SETUP-017, AC-019)
 *
 * @MX:NOTE: [AUTO] status 기본값은 ACTIVE — 관리사무소 회원 관리 화면 기본 동작 (REQ-017).
 *           ?status=INACTIVE 시 INACTIVE 만, ?status=ALL 시 전체. 그 외 값은 400.
 *
 * @MX:NOTE: [AUTO] 페이지네이션 기본값 — page=1, limit=20, 최대 100 (plan.md Phase 4).
 *           created_at DESC 기본 정렬 (REQ-014).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '../../../../lib/db';
import { requireAdmin, badRequest } from '../../../../lib/rbac';

/** 허용 역할 코드 — 시드 고정 5종 (SETUP-03 OUT). */
const ALLOWED_ROLES = ['ADMIN', 'CHAIR', 'REP', 'AUDITOR', 'RESIDENT'] as const;

/** 허용 status 값. 생략 시 ACTIVE 기본 (호출측에서 적용). */
const ALLOWED_STATUS = ['ACTIVE', 'INACTIVE', 'ALL'] as const;

/** 쿼리 파라미터 스키마 — 모두 optional. page/limit 은 정수 범위 검증. */
const ListQuerySchema = z.object({
  building: z.string().uuid().optional(),
  role: z.enum(ALLOWED_ROLES).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(ALLOWED_STATUS).optional(),
});

/** 회원 목록 한 행 — 명시적 컬럼 선택 결과 (password_hash 절대 미포함). */
interface UserRow {
  id: string;
  email: string;
  role: string;
  status: string;
  unit_id: string | null;
  unit_number: string | null;
  building_id: string | null;
  building_name: string | null;
  managed_building_id: string | null;
  verified_at: string | null;
  created_at: string;
}

/** 클라이언트에 응답할 user 객체 — password_hash 계열 키 어떤 것도 노출하지 않는다. */
interface UserListItem {
  id: string;
  email: string;
  role: string;
  status: string;
  unit_id: string | null;
  unit_number: string | null;
  building_id: string | null;
  building_name: string | null;
  managed_building_id: string | null;
  verified_at: string | null;
  created_at: string;
}

/** 200 응답 본문 — REQ-014/AC-016. */
interface ListResponse {
  success: true;
  data: {
    users: UserListItem[];
    total: number;
    page: number;
    limit: number;
  };
}

/**
 * 쿼리 파라미터 파싱 — searchParams 를 Record 로 변환 후 Zod 검증.
 * 실패(형식 오류, unknown role/status, page/limit 범위 위반) 시 400.
 */
function parseListQuery(
  searchParams: URLSearchParams,
): { ok: true; value: z.infer<typeof ListQuerySchema> } | { ok: false; message: string } {
  const raw: Record<string, string> = {};
  for (const key of ['building', 'role', 'page', 'limit', 'status'] as const) {
    const v = searchParams.get(key);
    if (v !== null) raw[key] = v;
  }
  // building 의 UUID 형식 에러 메시지 명확화
  if (raw.building !== undefined) {
    const uuidOk = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.building);
    if (!uuidOk) {
      return { ok: false, message: 'building 파라미터는 UUID 형식이어야 합니다' };
    }
  }
  const parsed = ListQuerySchema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const path = firstIssue.path.join('.');
    return {
      ok: false,
      message: `잘못된 쿼리 파라미터${path ? ` (${path})` : ''}: ${firstIssue.message}`,
    };
  }
  return { ok: true, value: parsed.data };
}

/**
 * GET /api/setup/users — ADMIN 회원 목록 조회 (REQ-SETUP-014).
 *
 * 필터: building(users.unit_id→units.building_id), role(roles.code),
 *       status(기본 ACTIVE), page/limit 페이지네이션.
 */
export async function GET(request: Request): Promise<Response> {
  // 1. RBAC — AT 검증 + ADMIN 검사 (401/403 은 requireAdmin 이 처리)
  const auth = await requireAdmin(request);
  if ('response' in auth) {
    return auth.response;
  }

  // 2. 쿼리 파라미터 파싱 + 검증 (400)
  const url = new URL(request.url);
  const parsed = parseListQuery(url.searchParams);
  if (!parsed.ok) {
    return badRequest(parsed.message);
  }
  const params = parsed.value;

  const page = params.page ?? 1;
  const limit = params.limit ?? 20;
  // status 생략 → ACTIVE 기본 (REQ-017)
  const statusFilter = params.status ?? 'ACTIVE';

  // 3. WHERE 절 조건 누적 — 값은 항상 파라미터로 바인딩 (문자열 보간 금지)
  const conditions: string[] = [];
  const values: unknown[] = [];

  // @MX:WARN: [AUTO] password_hash 는 아래 SELECT 컬럼 리스트에 절대 포함하지 말 것.
  // @MX:REASON: password_hash 가 응답에 노출되면 자격증명 누출 (REQ-015, AC-017). SELECT * 도 금지.
  //             명시적 컬럼 열거만 허용.
  const selectColumns = [
    'u.id AS id',
    'u.email AS email',
    'r.code AS role',
    'u.status AS status',
    'u.unit_id AS unit_id',
    'un.unit_number AS unit_number',
    'b.id AS building_id',
    'b.name AS building_name',
    'u.managed_building_id AS managed_building_id',
    'u.verified_at AS verified_at',
    'u.created_at AS created_at',
  ].join(', ');

  if (params.building) {
    values.push(params.building);
    conditions.push(`b.id = $${values.length}`);
  }
  if (params.role) {
    values.push(params.role);
    conditions.push(`r.code = $${values.length}`);
  }
  if (statusFilter !== 'ALL') {
    values.push(statusFilter);
    conditions.push(`u.status = $${values.length}`);
  }

  // building 필터가 걸려도 b 조인은 동일. 단 unit 없는 사용자는 b.id IS NULL 이므로
  // building 필터 시 자연 제외된다. building 미지정 시 LEFT JOIN 으로 unit 없는 사용자도 포함.
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // 4. 전체 카운트 (필터 기준)
  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN units un ON un.id = u.unit_id
    LEFT JOIN buildings b ON b.id = un.building_id
    ${whereClause}
  `;
  const countRes = await query<{ total: number }>(countSql, values);
  const total = countRes.rows[0]?.total ?? 0;

  // 5. 페이지 슬라이스 조회 — OFFSET/LIMIT 파라미터 바인딩
  const offset = (page - 1) * limit;
  const listValues = [...values, limit, offset];
  const listSql = `
    SELECT ${selectColumns}
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN units un ON un.id = u.unit_id
    LEFT JOIN buildings b ON b.id = un.building_id
    ${whereClause}
    ORDER BY u.created_at DESC
    LIMIT $${listValues.length - 1} OFFSET $${listValues.length}
  `;
  const listRes = await query<UserRow>(listSql, listValues);

  // 6. UserRow → UserListItem 매핑 (password_hash 계열 키 명시적 배제)
  const users: UserListItem[] = listRes.rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    unit_id: row.unit_id,
    unit_number: row.unit_number,
    building_id: row.building_id,
    building_name: row.building_name,
    managed_building_id: row.managed_building_id,
    verified_at: row.verified_at,
    created_at: row.created_at,
  }));

  const body: ListResponse = {
    success: true,
    data: { users, total, page, limit },
  };
  return NextResponse.json(body, { status: 200 });
}
