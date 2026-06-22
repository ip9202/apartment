/**
 * DELETE /api/setup/buildings/[id] — SPEC-SETUP-001 Phase B (M1 동 관리).
 *
 * ADMIN 동 삭제:
 *   - 미인증 → 401 (REQ-SETUP-004a, EC-007)
 *   - 비-ADMIN → 403 (REQ-SETUP-004b, AC-004)
 *   - UUID 형식 오류 → 400 (EC-SETUP-002, REQ-SETUP-007a)
 *   - 미존재 building_id → 404 (AC-SETUP-005)
 *   - 활성 입주민 존재 → 409 (REQ-SETUP-003, AC-SETUP-003)
 *   - 성공 → 200 { success: true } (SPEC 일반 규약)
 *
 * @MX:NOTE: [AUTO] "활성 입주민" 정의 (REQ-003) — users.unit_id IS NOT NULL 이고
 *           그 unit 의 building_id 가 대상 동이며 users.status='ACTIVE' 인 회원이 1명 이상.
 *           INACTIVE 입주민은 삭제 차단 사유가 아니다.
 *
 * @MX:NOTE: [AUTO] 동 삭제 시 해당 동의 units 도 함께 제거한다 — 활성 입주민 검사를 통과했으므로
 *           units 는 고아 상태(거주자 없음)이며, FK RESTRICT 회피를 위해 먼저 DELETE 한다.
 *           INACTIVE 입주민이 unit_id 로 귀속되어 있을 수 있으나 — 동 자체가 사라지므로
 *           그 입주민의 unit_id 는 별도 정책(강제 탈퇴 시 NULL 처리)에서 다룬다.
 *           여기서는 units 만 제거하고 users.unit_id 갱신은 수행하지 않는다 (트랜잭션 일관성).
 *
 * @MX:NOTE: [AUTO] 트랜잭션 사용 — 존재 확인 + 활성 입주민 카운트 + units/buildings 삭제 를 일관된 스냅샷에서 수행.
 */

import { NextResponse } from 'next/server';
import { withTransaction } from '../../../../../lib/db';
import {
  requireAdmin,
  badRequest,
  notFound,
  conflict,
} from '../../../../../lib/rbac';

/** Next.js 15 동적 라우트 params 타입 (Promise). */
interface BuildingParams {
  params: Promise<{ id: string }>;
}

/** UUID v4 정규식 (path param 형식 검증 — DB 도달 전 차단). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(request: Request, ctx: BuildingParams): Promise<Response> {
  // 1. RBAC — AT 검증 + ADMIN 검사
  const auth = await requireAdmin(request);
  if ('response' in auth) {
    return auth.response;
  }

  // 2. params 파싱 + UUID 형식 검증
  const { id: buildingId } = await ctx.params;
  if (!UUID_RE.test(buildingId)) {
    return badRequest('올바른 동 ID 가 아닙니다');
  }

  // 3. 트랜잭션 — 존재 확인 + 활성 입주민 검사 + 삭제 (원자적)
  try {
    const result = await withTransaction(async (client): Promise<'NOT_FOUND' | 'HAS_RESIDENTS' | 'DELETED'> => {
      // 존재 확인
      const existsRes = await client.query<{ id: string }>(
        'SELECT id FROM buildings WHERE id = $1',
        [buildingId],
      );
      if (!existsRes.rows[0]) {
        return 'NOT_FOUND';
      }

      // 활성 입주민 검사 — REQ-003 정의
      const activeRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM users u
         JOIN units un ON un.id = u.unit_id
         WHERE un.building_id = $1 AND u.status = 'ACTIVE'`,
        [buildingId],
      );
      const activeCount = Number(activeRes.rows[0]?.count ?? 0);
      if (activeCount > 0) {
        return 'HAS_RESIDENTS';
      }

      // 삭제 — 활성 입주민이 없으므로 units 는 고아 상태. FK RESTRICT 회피를 위해
      // units 먼저 제거 후 buildings 제거 (users.unit_id 는 갱신하지 않음 — 본 Phase 범위外).
      await client.query('DELETE FROM units WHERE building_id = $1', [buildingId]);
      await client.query('DELETE FROM buildings WHERE id = $1', [buildingId]);
      return 'DELETED';
    });

    if (result === 'NOT_FOUND') {
      return notFound('존재하지 않는 동입니다');
    }
    if (result === 'HAS_RESIDENTS') {
      return conflict('활성 입주민이 있는 동은 삭제할 수 없습니다');
    }
    // DELETED
    return NextResponse.json({ success: true, data: null }, { status: 200 });
  } catch (err) {
    // FK RESTRICT (units 잔류) 또는 기타 DB 에러 → 409 로 매핑
    if (err && typeof err === 'object' && 'code' in err && err.code === '23503') {
      return conflict('해당 동에 호수가 남아있어 삭제할 수 없습니다');
    }
    return NextResponse.json(
      {
        success: false,
        error: { code: 'DELETE_FAILED', message: '동 삭제 처리 중 오류가 발생했습니다' },
      },
      { status: 500 },
    );
  }
}
