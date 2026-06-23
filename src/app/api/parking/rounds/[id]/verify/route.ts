/**
 * GET /api/parking/rounds/[id]/verify — 투명성 공개 (SPEC-PARKING-001 M7, PARKING-07).
 *
 * REQ-PK-026 (seed + 알고리즘 + 정렬입력 공개), REQ-PK-027 (재현 검증 가능성).
 *
 * @MX:NOTE: [AUTO] seed 공개 근거 — seed_value 는 회차 생성 시 확정 후 불변.
 *           공개되어도 사후 조작 불가 (UPDATE 미구현으로 강제). 재현 검증의 공정성 기반.
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../../../lib/db';
import {
  requireAuthenticated,
  isAuthOk,
} from '../../../../../../lib/parking-rbac';
import { badRequest, notFound } from '../../../../../../lib/rbac';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: roundId } = await params;
  if (!UUID_RE.test(roundId)) {
    return badRequest('회차 ID 형식이 올바르지 않습니다');
  }

  const auth = await requireAuthenticated(request);
  if (!isAuthOk(auth)) {
    return auth.response;
  }

  const roundRes = await query<{ seed_value: string; slot_pool: string[] }>(
    'SELECT seed_value, slot_pool FROM parking_rounds WHERE id=$1',
    [roundId],
  );
  const round = roundRes.rows[0];
  if (!round) {
    return notFound('회차를 찾을 수 없습니다');
  }

  // 정렬된 unit 목록 (순열 입력) — building_name ASC, unit_number ASC
  const unitsRes = await query<{ id: string; building: string; unit_number: string }>(
    `SELECT u.id, b.name AS building, u.unit_number
     FROM units u JOIN buildings b ON b.id = u.building_id
     ORDER BY b.name ASC, u.unit_number ASC`,
  );

  return NextResponse.json(
    {
      success: true,
      data: {
        seed_value: round.seed_value,
        algorithm: 'Fisher-Yates shuffle with HMAC-SHA256 PRNG',
        sort_criteria: 'building_name ASC, unit_number ASC',
        slot_pool: round.slot_pool,
        units: unitsRes.rows.map((u) => ({
          unit_id: u.id,
          building: u.building,
          unit_number: u.unit_number,
        })),
      },
    },
    { status: 200 },
  );
}
