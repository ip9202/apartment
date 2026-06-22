/**
 * GET /api/suggestions/units/[building]/[unit] — SPEC-SUGGEST-001 M8a (호수별 건의 이력).
 *
 * ADMIN/CHAIR 전용. 특정 호수의 모든 건의(archived 포함, 비공개 포함)를 created_at ASC 시간순 반환.
 *   - 미인증 → 401
 *   - 비-ADMIN/비-CHAIR → 403 (REQ-SUGGEST-037b)
 *   - building path UUID 오류 → 400
 *   - 미존재 building/unit 조합 → 404 (REQ-SUGGEST-036)
 *   - 성공 → 200 { suggestions, total, building, unit }
 *
 * @MX:ANCHOR: [AUTO] SUGGEST 호수 이력 API 경계 — ADMIN/CHAIR 전용 + 아카이브/비공개 포함 계약
 * @MX:REASON:  호수별 이력은 ADR-005 호수 귀속 정책의 핵심 산출물 — archived/비공개 무관하게
 *             해당 호수의 전체 건의 이력을 관리사무소/회장이 열람 가능. 비-ADMIN/비-CHAIR 차단 필수.
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../../../lib/db';
import {
  requirePrivileged,
  badRequest,
  notFound,
} from '../../../../../../lib/rbac';

/** UUID v4 정규식. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UnitParams {
  params: Promise<{ building: string; unit: string }>;
}

/**
 * GET /api/suggestions/units/[building]/[unit] — ADMIN/CHAIR 호수별 이력 (REQ-SUGGEST-035~037b).
 */
export async function GET(request: Request, ctx: UnitParams): Promise<Response> {
  // 1. RBAC — ADMIN/CHAIR 만 허용
  const auth = await requirePrivileged(request, ['ADMIN', 'CHAIR']);
  if ('response' in auth) {
    return auth.response;
  }

  // 2. params 파싱
  const { building: buildingId, unit: unitNumber } = await ctx.params;

  // 3. building UUID 형식 검증
  if (!UUID_REGEX.test(buildingId)) {
    return badRequest('올바른 building ID 가 아닙니다');
  }

  // 4. unit_id 해석 — buildings JOIN units. 미존재 404.
  const unitRes = await query<{ unit_id: string; building_name: string; unit_number: string }>(
    `SELECT u.id AS unit_id, b.name AS building_name, u.unit_number
     FROM buildings b JOIN units u ON u.building_id = b.id
     WHERE b.id = $1 AND u.unit_number = $2`,
    [buildingId, unitNumber],
  );
  if (!unitRes.rows[0]) {
    return notFound('존재하지 않는 동/호수입니다');
  }
  const { unit_id: unitId, building_name: buildingName, unit_number: resolvedUnitNumber } = unitRes.rows[0];

  // 5. 해당 unit_id 의 모든 건의(archived 포함, 비공개 포함) created_at ASC 시간순
  const rows = await query<{
    id: string;
    title: string;
    category_name: string;
    is_public: boolean;
    status: string;
    author_label: string;
    created_at: string;
    archived: boolean;
    archived_at: string | null;
  }>(
    `SELECT s.id, s.title, sc.name AS category_name, s.is_public, s.status, s.author_label,
            s.created_at, s.archived, s.archived_at
     FROM suggestions s
     JOIN suggestion_categories sc ON sc.id = s.category_id
     WHERE s.unit_id = $1
     ORDER BY s.created_at ASC`,
    [unitId],
  );

  return NextResponse.json(
    {
      success: true,
      data: {
        suggestions: rows.rows,
        total: rows.rowCount ?? 0,
        building: buildingName,
        unit: resolvedUnitNumber,
      },
    },
    { status: 200 },
  );
}
