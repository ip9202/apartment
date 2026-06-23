/**
 * PUT /api/parking/rounds/[id]/publish — 결과 공개 (SPEC-PARKING-001 M5, PARKING-05).
 *
 * REQ-PK-020 (ADMIN 공개 → 200, ASSIGNED→PUBLISHED, is_published=true),
 * REQ-PK-021 (ASSIGNED 외 409), REQ-PK-022 (비-ADMIN 403).
 */

import { NextResponse } from 'next/server';
import { query } from '../../../../../../lib/db';
import { requireAdmin, badRequest, notFound, conflict } from '../../../../../../lib/rbac';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PUT(
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

  const roundRes = await query<{ status: string }>(
    'SELECT status FROM parking_rounds WHERE id=$1',
    [roundId],
  );
  const round = roundRes.rows[0];
  if (!round) {
    return notFound('회차를 찾을 수 없습니다');
  }

  // REQ-PK-021: ASSIGNED 상태만 공개 가능
  if (round.status !== 'ASSIGNED') {
    return conflict(`공개는 ASSIGNED 상태에서만 가능합니다 (현재: ${round.status})`);
  }

  await query(
    `UPDATE parking_rounds SET status='PUBLISHED', is_published=true WHERE id=$1`,
    [roundId],
  );

  return NextResponse.json(
    { success: true, data: { published: true, status: 'PUBLISHED' } },
    { status: 200 },
  );
}
