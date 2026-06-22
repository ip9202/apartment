/**
 * PUT /api/setup/buildings/[id]/units — SPEC-SETUP-001 Phase C (M2 호수 일괄 업데이트).
 *
 * ADMIN 호수 일괄 업데이트 (diff 트랜잭션):
 *   - 미인증 → 401 (REQ-SETUP-008a, AC-009a)
 *   - 비-ADMIN → 403 (REQ-SETUP-008b, AC-009b)
 *   - UUID 형식 오류 → 400 (REQ-SETUP-007a)
 *   - 본문 검증 실패(중복/길이/타입) → 422 (REQ-SETUP-007a)
 *   - 미존재 building_id → 404 (REQ-SETUP-007, AC-008)
 *   - 삭제 대상 호수 활성 입주민 → 409 (REQ-SETUP-006, AC-007)
 *   - 성공 → 200 { success: true, data: { units: [{ id, unit_number }] } }
 *
 * @MX:NOTE: [AUTO] diff 멱등성 (REQ-005) — 요청 배열 = 최종 목표 상태. 기존 대비
 *           추가분을 INSERT, 누락분을 DELETE. 동일 배열 재호출 시 최종 집합 불변.
 *
 * @MX:NOTE: [AUTO] 빈 배열 = 전체 삭제 (EC-003) — REQ-005 가 빈 배열을 유효 제출로 정의.
 *           단 삭제 대상 중 활성 입주민이 있으면 REQ-006 에 의해 409 롤백.
 *
 * @MX:WARN: [AUTO] 일괄 DELETE 는 활성 입주민 검사의 보호를 받는 load-bearing 연산.
 * @MX:REASON: 검사를 우회하거나 누락하면 거주자가 귀속된 호수가 삭제되어
 *             users.unit_id 가 고아 FK 가 되어 데이터 정합성이 깨진다.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withTransaction } from '../../../../../../lib/db';
import {
  requireAdmin,
  badRequest,
  notFound,
  conflict,
  validationError,
} from '../../../../../../lib/rbac';

/** Next.js 15 동적 라우트 params 타입 (Promise). */
interface BuildingParams {
  params: Promise<{ id: string }>;
}

/** UUID v4 정규식 (path param 형식 검증 — DB 도달 전 차단). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 요청 본문 스키마 (REQ-005 — units 문자열 배열).
 * - 각 unit_number: 비어있지 않은 1~10자 문자열 (VARCHAR(10))
 * - 배열 내 중복 금지 (UNIQUE(building_id, unit_number) 클라이언트측 사전 차단 → 422)
 */
const unitsSchema = z
  .object({
    units: z
      .array(z.string().min(1).max(10))
      .max(1000, '호수 개수가 너무 많습니다'),
  })
  .strict()
  .refine((d) => new Set(d.units).size === d.units.length, {
    message: '중복된 호수가 있습니다',
  });

export async function PUT(request: Request, ctx: BuildingParams): Promise<Response> {
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

  // 3. 본문 파싱 + Zod 검증
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return validationError('잘못된 요청 본문입니다');
  }
  const parsed = unitsSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? '호수 목록이 올바르지 않습니다');
  }
  const requested = parsed.data.units;

  // 4. diff 트랜잭션 — 존재 확인 + 활성 입주민 검사 + DELETE/INSERT (원자적)
  try {
    const result = await withTransaction(
      async (client): Promise<
        | { status: 'NOT_FOUND' }
        | { status: 'HAS_RESIDENTS' }
        | { status: 'OK'; units: { id: string; unit_number: string }[] }
      > => {
        // 존재 확인
        const existsRes = await client.query<{ id: string }>(
          'SELECT id FROM buildings WHERE id = $1',
          [buildingId],
        );
        if (!existsRes.rows[0]) {
          return { status: 'NOT_FOUND' };
        }

        // 현재 호수 읽기
        const currentRes = await client.query<{ id: string; unit_number: string }>(
          'SELECT id, unit_number FROM units WHERE building_id = $1',
          [buildingId],
        );
        const currentByNum = new Map<string, string>(
          currentRes.rows.map((r) => [r.unit_number, r.id]),
        );

        const requestedSet = new Set(requested);
        const toAdd: string[] = [];
        for (const num of requested) {
          if (!currentByNum.has(num)) {
            toAdd.push(num);
          }
        }
        const toDeleteIds: string[] = [];
        for (const [num, id] of currentByNum) {
          if (!requestedSet.has(num)) {
            toDeleteIds.push(id);
          }
        }

        // 삭제 대상 활성 입주민 검사 — REQ-006 (Phase B DELETE 와 동일 정의)
        if (toDeleteIds.length > 0) {
          const activeRes = await client.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count
             FROM users u
             WHERE u.unit_id = ANY($1::uuid[]) AND u.status = 'ACTIVE'`,
            [toDeleteIds],
          );
          const activeCount = Number(activeRes.rows[0]?.count ?? 0);
          if (activeCount > 0) {
            return { status: 'HAS_RESIDENTS' };
          }
        }

        // DELETE (추가/삭제 분리 — INSERT 가 먼저면 UNIQUE 충돌 가능성 회피를 위해 DELETE 선)
        if (toDeleteIds.length > 0) {
          await client.query('DELETE FROM units WHERE id = ANY($1::uuid[])', [toDeleteIds]);
        }
        // INSERT
        if (toAdd.length > 0) {
          await client.query(
            `INSERT INTO units (building_id, unit_number)
             SELECT $1, num FROM unnest($2::text[]) AS num`,
            [buildingId, toAdd],
          );
        }

        // 최종 목록 반환
        const finalRes = await client.query<{ id: string; unit_number: string }>(
          'SELECT id, unit_number FROM units WHERE building_id = $1 ORDER BY unit_number',
          [buildingId],
        );
        return { status: 'OK', units: finalRes.rows };
      },
    );

    if (result.status === 'NOT_FOUND') {
      return notFound('존재하지 않는 동입니다');
    }
    if (result.status === 'HAS_RESIDENTS') {
      return conflict('활성 입주민이 있는 호수는 삭제할 수 없습니다');
    }
    return NextResponse.json(
      { success: true, data: { units: result.units } },
      { status: 200 },
    );
  } catch (err) {
    // UNIQUE(building_id, unit_number) 위반 — 중복 검증을 통과했으므로 비정상 케이스
    if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
      return conflict('이미 존재하는 호수입니다');
    }
    return NextResponse.json(
      {
        success: false,
        error: { code: 'UPDATE_FAILED', message: '호수 업데이트 처리 중 오류가 발생했습니다' },
      },
      { status: 500 },
    );
  }
}
