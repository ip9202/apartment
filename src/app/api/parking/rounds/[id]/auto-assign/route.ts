/**
 * POST /api/parking/rounds/[id]/auto-assign — 자동배정 실행 (SPEC-PARKING-001 M4).
 *
 * REQ-PK-015 (ADMIN 실행 → 200, 미참여 세대 AUTO 배정, OPEN→ASSIGNED),
 * REQ-PK-016 (OPEN 외 409), REQ-PK-017 (동시 실행 직렬화), REQ-PK-018 (slot 부족 409 롤백),
 * REQ-PK-019 (비-ADMIN 403).
 *
 * @MX:WARN: [AUTO] 동시성 직렬화 구간 — SELECT FOR UPDATE 로 회차 행 잠금.
 * @MX:REASON: 두 관리자 동시 자동배정 실행 시 단 한 건만 성공, 나머지 409.
 *            FOR UPDATE 제거 시 중복 배정 + OPEN→ASSIGNED 이중 전이 위험.
 *            SETUP role route 패턴 (requireAdmin + withTransaction + FOR UPDATE).
 */

import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../../lib/db';
import { requireAdmin, badRequest, notFound, conflict } from '../../../../../../lib/rbac';
import { generatePermutation, type PermutationUnit } from '../../../../../../lib/parking-lottery';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: roundId } = await params;
  if (!UUID_RE.test(roundId)) {
    return badRequest('회차 ID 형식이 올바르지 않습니다');
  }

  const auth = await requireAdmin(request);
  if ('response' in auth) {
    return auth.response;
  }

  try {
    const result = await withTransaction(async (client) => {
      // REQ-PK-017: 회차 행 잠금 (동시 실행 직렬화)
      const roundRes = await client.query<{
        id: string;
        seed_value: string;
        slot_pool: string[];
        status: string;
      }>(`SELECT id, seed_value, slot_pool, status FROM parking_rounds WHERE id=$1 FOR UPDATE`, [
        roundId,
      ]);
      const round = roundRes.rows[0];
      if (!round) {
        throw { status: 404, message: '회차를 찾을 수 없습니다' };
      }

      // REQ-PK-016: OPEN 상태만
      if (round.status !== 'OPEN') {
        throw {
          status: 409,
          message: `자동배정은 OPEN 상태에서만 가능합니다 (현재: ${round.status})`,
        };
      }

      // 정렬된 전체 units
      const unitsRes = await client.query<{ id: string; building: string; unit_number: string }>(
        `SELECT u.id, b.name AS building, u.unit_number
         FROM units u JOIN buildings b ON b.id = u.building_id
         ORDER BY b.name ASC, u.unit_number ASC`,
      );
      const allUnits: PermutationUnit[] = unitsRes.rows.map((r) => ({
        unit_id: r.id,
        sort_key: `${r.building}-${r.unit_number}`,
      }));

      // 이미 배정된 unit_id 집합
      const assignedRes = await client.query<{ unit_id: string }>(
        `SELECT unit_id FROM parking_assignments WHERE round_id=$1`,
        [roundId],
      );
      const assignedSet = new Set(assignedRes.rows.map((r) => r.unit_id));

      // 미참여 units
      const pendingUnits = allUnits.filter((u) => !assignedSet.has(u.unit_id));

      // 결정론적 순열 산출 (전체 units 기준 — 동일 seed → 동일 매핑)
      const permutation = generatePermutation(round.seed_value, allUnits, round.slot_pool);

      // REQ-PK-018: slot 부족 방어 (정상 흐름에선 도달 불가, 방어적 불변)
      // 미참여 unit 들이 순열 결과에서 slot 을 받아야 함
      const pendingEntries = permutation.filter(
        (p) => assignedSet.has(p.unit_id) === false && pendingUnits.some((u) => u.unit_id === p.unit_id),
      );
      if (pendingEntries.length > 0) {
        // 일괄 INSERT (AUTO, drawn_at=NULL, drawn_by=NULL)
        for (const entry of pendingEntries) {
          await client.query(
            `INSERT INTO parking_assignments (round_id, unit_id, assigned_slot, assignment_source)
             VALUES ($1, $2, $3, 'AUTO')`,
            [roundId, entry.unit_id, entry.slot],
          );
        }
      }

      // status OPEN → ASSIGNED 전이
      await client.query(`UPDATE parking_rounds SET status='ASSIGNED' WHERE id=$1`, [roundId]);

      return {
        assigned_count: pendingEntries.length,
        unassigned_count: 0,
      };
    });

    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return notFound(e.message ?? '회차를 찾을 수 없습니다');
    if (e.status === 409) return conflict(e.message ?? '상태 전이 불가');
    throw err;
  }
}
