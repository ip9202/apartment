/**
 * POST/DELETE /api/parking/rounds/[id]/draw — 추첨(자리 확정)/취소 (SPEC-PARKING-001 M2/M3).
 *
 * REQ-PK-006 (RESIDENT 추첨 → 200), REQ-PK-007 (중복 409), REQ-PK-008 (OPEN 외 409),
 * REQ-PK-009 (unit_id NULL 403), REQ-PK-010 (미인증 401),
 * REQ-PK-011 (본인 취소 200), REQ-PK-012 (OPEN 외 취소 409), REQ-PK-013 (타인 403), REQ-PK-014 (미존재 404).
 *
 * @MX:NOTE: [AUTO] 추첨=자리확정 동시 발생. 결정론적 순열에서 본인 unit slot 산출.
 *           순서 무관 — seed 기반 결정론 보장.
 */

import { NextResponse } from 'next/server';
import { query, withTransaction } from '../../../../../../lib/db';
import {
  requireAuthenticated,
  isAuthOk,
} from '../../../../../../lib/parking-rbac';
import { badRequest, notFound, conflict } from '../../../../../../lib/rbac';
import { generatePermutation, type PermutationUnit } from '../../../../../../lib/parking-lottery';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RoundRow {
  id: string;
  seed_value: string;
  slot_pool: string[];
  status: string;
}

async function getRound(roundId: string): Promise<RoundRow | null> {
  const res = await query<RoundRow>(
    `SELECT id, seed_value, slot_pool, status FROM parking_rounds WHERE id = $1`,
    [roundId],
  );
  return res.rows[0] ?? null;
}

/** 결정론적 순열에서 본인 unit 에 해당하는 slot 산출. */
async function computeSlotForUnit(
  seed: string,
  slotPool: string[],
  targetUnitId: string,
): Promise<string> {
  const unitsRes = await query<{ id: string; building: string; unit_number: string }>(
    `SELECT u.id, b.name AS building, u.unit_number
     FROM units u JOIN buildings b ON b.id = u.building_id
     ORDER BY b.name ASC, u.unit_number ASC`,
  );
  const units: PermutationUnit[] = unitsRes.rows.map((r) => ({
    unit_id: r.id,
    sort_key: `${r.building}-${r.unit_number}`,
  }));
  const permutation = generatePermutation(seed, units, slotPool);
  const entry = permutation.find((p) => p.unit_id === targetUnitId);
  if (!entry) {
    throw new Error(`unit ${targetUnitId} 가 순열 결과에 없음`);
  }
  return entry.slot;
}

export async function POST(
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

  // REQ-PK-009: unit_id NULL 추첨 금지
  if (!auth.unitId) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: '동/호수 인증 후 추첨 가능합니다' } },
      { status: 403 },
    );
  }

  const round = await getRound(roundId);
  if (!round) {
    return notFound('회차를 찾을 수 없습니다');
  }

  // REQ-PK-008: OPEN 상태만 추첨 허용
  if (round.status !== 'OPEN') {
    return conflict(`추첨은 OPEN 상태에서만 가능합니다 (현재: ${round.status})`);
  }

  // REQ-PK-007: 세대당 1회 — UNIQUE(round_id, unit_id) 1차 방어 (사전 조회)
  const existing = await query(
    'SELECT 1 FROM parking_assignments WHERE round_id = $1 AND unit_id = $2',
    [roundId, auth.unitId],
  );
  if ((existing.rowCount ?? 0) > 0) {
    return conflict('이미 해당 회차에서 자리가 확정되었습니다 (세대당 1회)');
  }

  // 결정론적 slot 산출
  const slot = await computeSlotForUnit(round.seed_value, round.slot_pool, auth.unitId);

  // INSERT (UNIQUE 위반 시 409 — 동시 추첨 버튼 경쟁)
  try {
    await query(
      `INSERT INTO parking_assignments (round_id, unit_id, assigned_slot, assignment_source, drawn_at, drawn_by)
       VALUES ($1, $2, $3, 'DRAW', now(), $4)`,
      [roundId, auth.unitId, slot, auth.callerId],
    );
  } catch {
    return conflict('이미 해당 회차에서 자리가 확정되었습니다 (세대당 1회)');
  }

  return NextResponse.json(
    { success: true, data: { assigned_slot: slot } },
    { status: 200 },
  );
}

export async function DELETE(
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
  if (!auth.unitId) {
    return notFound('취소할 추첨 기록이 없습니다');
  }

  const round = await getRound(roundId);
  if (!round) {
    return notFound('회차를 찾을 수 없습니다');
  }

  // REQ-PK-012: OPEN 상태만 취소 허용
  if (round.status !== 'OPEN') {
    return conflict(`취소는 OPEN 상태에서만 가능합니다 (현재: ${round.status})`);
  }

  // 본인 DRAW assignment 조회
  const assignRes = await query<{
    id: string;
    drawn_by: string | null;
    assignment_source: string;
  }>(
    `SELECT id, drawn_by, assignment_source FROM parking_assignments
     WHERE round_id = $1 AND unit_id = $2`,
    [roundId, auth.unitId],
  );
  const assignment = assignRes.rows[0];
  if (!assignment) {
    return notFound('취소할 추첨 기록이 없습니다');
  }

  // REQ-PK-013: 본인 DRAW 만 취소 가능
  if (assignment.drawn_by !== auth.callerId || assignment.assignment_source !== 'DRAW') {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: '본인 추첨 기록만 취소할 수 있습니다' } },
      { status: 403 },
    );
  }

  await withTransaction(async (client) => {
    await client.query('DELETE FROM parking_assignments WHERE id = $1', [assignment.id]);
  });

  return NextResponse.json({ success: true, data: { cancelled: true } }, { status: 200 });
}
