/**
 * GET/POST /api/setup/buildings — SPEC-SETUP-001 Phase B (M1 동 관리 + M6 공개 조회).
 *
 * GET  (공개): 동/호수 목록 반환 — 회원 데이터 미포함 (REQ-SETUP-020, AC-024).
 * POST (ADMIN): 동 생성 — 201 (REQ-SETUP-001, AC-001), 중복 409 (REQ-SETUP-002, AC-002),
 *               미인증 401 (REQ-SETUP-004a, EC-007), 비-ADMIN 403 (REQ-SETUP-004b, AC-004),
 *               name 검증 422 (REQ-SETUP-007a, EC-001).
 *
 * @MX:NOTE: [AUTO] GET 은 공개 엔드포인트 — verifyAccessToken 을 호출하지 않는다 (REQ-020).
 *           응답은 동/호수만 노출하며 email/role/password_hash 등 회원 데이터는 절대 포함하지 않는다 (privacy).
 *
 * @MX:NOTE: [AUTO] POST/DELETE 는 route handler 내부에서 인증을 강제한다.
 *           Next.js middleware matcher 는 메서드 무관하게 경로 단위로만 매치되므로
 *           /api/setup/buildings 전체를 matcher 예외에서 제외하고(미들웨어 통과),
 *           POST/DELETE 는 requireAdmin 으로 RBAC 를 핸들러 내부에서 시행한다.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '../../../../lib/db';
import {
  requireAdmin,
  conflict,
  validationError,
} from '../../../../lib/rbac';

/** 동 생성 요청 스키마 — name 은 비어있지 않은 1~20자 문자열 (VARCHAR(20)). */
const CreateBuildingSchema = z.object({
  name: z.string().min(1).max(20),
});

/** 동 + 중첩 호수 응답 타입. */
interface BuildingWithUnits {
  id: string;
  name: string;
  units: Array<{ id: string; unit_number: string }>;
}

/**
 * GET /api/setup/buildings — 공개 조회 (REQ-SETUP-020).
 * 동/호수만 반환. 회원 데이터 미포함.
 *
 * Next.js 는 GET 핸들러에 Request 를 전달할 수 있으나, 본 엔드포인트는 공개라
 * request 본문/헤더를 사용하지 않는다. 시그니처 일관성을 위해 param 만 유지.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: Request): Promise<Response> {
  // 1. 동 목록
  const buildingsRes = await query<{ id: string; name: string }>(
    'SELECT id, name FROM buildings ORDER BY name',
  );
  const buildingIds = buildingsRes.rows.map((r) => r.id);

  // 2. 호수 목록 (building_id 기준 일괄 조회)
  let units: Array<{ id: string; building_id: string; unit_number: string }> = [];
  if (buildingIds.length > 0) {
    const unitsRes = await query<{
      id: string;
      building_id: string;
      unit_number: string;
    }>(
      'SELECT id, building_id, unit_number FROM units WHERE building_id = ANY($1::uuid[]) ORDER BY unit_number',
      [buildingIds],
    );
    units = unitsRes.rows;
  }

  // 3. 동 ↔ 호수 매핑 (회원 데이터 절대 미포함)
  const unitsByBuilding = new Map<string, BuildingWithUnits['units']>();
  for (const u of units) {
    const list = unitsByBuilding.get(u.building_id) ?? [];
    list.push({ id: u.id, unit_number: u.unit_number });
    unitsByBuilding.set(u.building_id, list);
  }

  const result: BuildingWithUnits[] = buildingsRes.rows.map((b) => ({
    id: b.id,
    name: b.name,
    units: unitsByBuilding.get(b.id) ?? [],
  }));

  return NextResponse.json(result, { status: 200 });
}

/**
 * POST /api/setup/buildings — ADMIN 동 생성 (REQ-SETUP-001).
 */
export async function POST(request: Request): Promise<Response> {
  // 1. RBAC — AT 검증 + ADMIN 검사
  const auth = await requireAdmin(request);
  if ('response' in auth) {
    return auth.response;
  }

  // 2. 본문 파싱 + Zod 검증
  let parsedJson: unknown;
  try {
    parsedJson = await request.json();
  } catch {
    return validationError('요청 본문이 올바른 JSON 이 아닙니다');
  }
  const parsed = CreateBuildingSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return validationError('동 이름은 1~20자 문자열이어야 합니다');
  }
  const name = parsed.data.name;

  // 3. 삽입 — UNIQUE 위반 시 409 (REQ-SETUP-002, AC-002). RETURNING 은 성공 시 항상 1행.
  try {
    const r = await query<{ id: string; name: string; created_at: string }>(
      'INSERT INTO buildings (name) VALUES ($1) RETURNING id, name, created_at',
      [name],
    );
    return NextResponse.json(r.rows[0], { status: 201 });
  } catch (err) {
    // pg unique_violation 코드 23505
    if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
      return conflict('이미 존재하는 동 이름입니다');
    }
    throw err;
  }
}
