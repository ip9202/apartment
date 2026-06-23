/**
 * GET /api/parking/rounds/[id]/allocations — 결과 열람 (SPEC-PARKING-001 M6, PARKING-06).
 *
 * REQ-PK-023 (역할별 가시성 분기), REQ-PK-024 (미공개 정보은닉), REQ-PK-025 (미인증 401).
 *
 * @MX:NOTE: [AUTO] 정보은닉 원칙 — 미공개 회차 비권한자 타인 조회 시 본인만(없으면 빈 목록) 200.
 *           200 vs 403 / 빈 vs 비어있지 않음 으로 타인 존재 여부 누출 금지 (enumeration 방어).
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../../../lib/db';
import {
  requireAuthenticated,
  isAuthOk,
  filterAllocationsByRole,
  type FilterableAllocation,
} from '../../../../../../lib/parking-rbac';
import { badRequest, notFound } from '../../../../../../lib/rbac';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AllocationRow extends FilterableAllocation {
  assigned_slot: string;
  unit_number: string;
  assignment_source: string;
}

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

  const roundRes = await query<{ is_published: boolean }>(
    'SELECT is_published FROM parking_rounds WHERE id=$1',
    [roundId],
  );
  const round = roundRes.rows[0];
  if (!round) {
    return notFound('회차를 찾을 수 없습니다');
  }

  // REP 담당동 필터링을 위해 managed_building_id(UUID) → building name 해석
  let managedBuildingName: string | null = null;
  if (auth.managedBuildingId) {
    const mbRes = await query<{ name: string }>('SELECT name FROM buildings WHERE id=$1', [
      auth.managedBuildingId,
    ]);
    managedBuildingName = mbRes.rows[0]?.name ?? null;
  }

  const allocRes = await query<AllocationRow>(
    `SELECT a.unit_id, b.name AS building, a.assigned_slot, u.unit_number, a.assignment_source
     FROM parking_assignments a
     JOIN units u ON u.id = a.unit_id
     JOIN buildings b ON b.id = u.building_id
     WHERE a.round_id = $1
     ORDER BY b.name ASC, u.unit_number ASC`,
    [roundId],
  );

  const filtered = filterAllocationsByRole({
    role: auth.callerRole,
    unitId: auth.unitId,
    managedBuildingId: managedBuildingName,
    isPublished: round.is_published,
    allocations: allocRes.rows,
  });

  const data = filtered.map((a) => ({
    unit_id: a.unit_id,
    building: a.building,
    unit_number: a.unit_number,
    assigned_slot: a.assigned_slot,
    assignment_source: a.assignment_source,
  }));

  return NextResponse.json({ success: true, data }, { status: 200 });
}
