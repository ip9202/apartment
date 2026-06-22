/**
 * PUT /api/setup/users/[id]/role — SPEC-SETUP-001 Phase D (M3 직책 부여/회수).
 *
 * ADMIN/CHAIR 직책 부여/회수:
 *   - 미인증 → 401 (REQ-013a, AC-015a)
 *   - 비-ADMIN/비-CHAIR → 403 (REQ-013b, AC-015b)
 *   - path UUID 형식 오류 → 400 (REQ-007a)
 *   - 본문 검증 실패(role/managed_building_id) → 422 (REQ-007a, REQ-011)
 *   - CHAIR 호출자의 CHAIR/ADMIN 부여 시도 → 403 (REQ-012, AC-013)
 *   - 미존재 target user_id → 404 (REQ-009)
 *   - 미존재 managed_building_id(REP 부여 시) → 422 (REQ-009)
 *   - 성공 → 200 { success: true, data: { id, role, managed_building_id } }
 *
 * @MX:NOTE: [AUTO] CHAIR 권한 범위 (REQ-012, EC-005) — CHAIR 호출자는 RESIDENT/REP/AUDITOR 만
 *           부여 가능. CHAIR 또는 ADMIN 부여 시도는 403. ADMIN 호출자는 모든 역할 부여 가능.
 *           이 검사는 인증/역할 검사(requirePrivileged) 와 별개로, caller-vs-target 비교다.
 *
 * @MX:NOTE: [AUTO] REP managed_building_id 단일 출처 (REQ-019) — REP 부여 시 users.managed_building_id
 *           를 제공된 building UUID 로 설정. RESIDENT 회수 시 NULL 로 정리(REP 포인터 단일 출처 유지).
 *
 * @MX:WARN: [AUTO] 회장(CHAIR) 단일성 보장을 위한 SELECT ... FOR UPDATE — load-bearing 동시성 방어.
 * @MX:REASON: FOR UPDATE 가 없으면 두 개의 동시 CHAIR 부여 트랜잭션이 같은 스냅샷을 읽어
 *             기존 CHAIR 가 없다고 판단하고 둘 다 커밋될 수 있다. FOR UPDATE 로 기존 CHAIR 행을
 *             잡으면 두 번째 트랜잭션은 첫 번째가 커밋할 때까지 대기(serialization)하므로
 *             커밋 후 항상 CHAIR 는 정확히 1명이 된다. 이 잠금을 제거/변경하면 EC-004 가 깨진다.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withTransaction } from '../../../../../../lib/db';
import {
  requirePrivileged,
  badRequest,
  notFound,
  validationError,
} from '../../../../../../lib/rbac';

/** Next.js 15 동적 라우트 params 타입 (Promise). */
interface RoleParams {
  params: Promise<{ id: string }>;
}

/** UUID v4 정규식 (path param + managed_building_id 형식 검증). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 허용 역할 코드 (시드 고정 — SPEC 결정 2). */
const ROLE_CODES = ['RESIDENT', 'REP', 'AUDITOR', 'CHAIR', 'ADMIN'] as const;

/** CHAIR 호출자가 부여 가능한 역할 (REQ-012, EC-005). */
const CHAIR_GRANTABLE = ['RESIDENT', 'REP', 'AUDITOR'] as const;

/**
 * 요청 본문 스키마 (REQ-009).
 * - role: 5종 역할 코드 중 하나
 * - managed_building_id: 선택. REP 부여 시 필수(422), 그 외는 무시(NULL 처리).
 *
 * @MX:NOTE: [AUTO] managed_building_id 의 UUID 형식 + 존재 여부는 REP 부여 시에만 검증한다.
 *           REP 가 아닌 역할 부여에서 이 필드가 들어오면 무시한다(SPEC: 다른 역할은 NULL).
 */
const roleSchema = z
  .object({
    role: z.enum(ROLE_CODES),
    managed_building_id: z.string().uuid().optional(),
  })
  .strict();

export async function PUT(request: Request, ctx: RoleParams): Promise<Response> {
  // 1. RBAC — AT 검증 + ADMIN/CHAIR 검사 (REQ-013a/013b)
  const auth = await requirePrivileged(request, ['ADMIN', 'CHAIR']);
  if ('response' in auth) {
    return auth.response;
  }
  const { callerRole } = auth;

  // 2. params 파싱 + UUID 형식 검증
  const { id: targetUserId } = await ctx.params;
  if (!UUID_RE.test(targetUserId)) {
    return badRequest('올바른 회원 ID 가 아닙니다');
  }

  // 3. 본문 파싱 + Zod 검증
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return validationError('잘못된 요청 본문입니다');
  }
  const parsed = roleSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError(parsed.error.issues[0]?.message ?? '직책 요청이 올바르지 않습니다');
  }
  const requestedRole = parsed.data.role;

  // 4. CHAIR 권한 범위 검사 (REQ-012, AC-013, EC-005)
  //    CHAIR 호출자가 CHAIR 또는 ADMIN 부여 시도 → 403
  if (callerRole === 'CHAIR' && !CHAIR_GRANTABLE.includes(requestedRole as typeof CHAIR_GRANTABLE[number])) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'FORBIDDEN', message: '회장은 관리자 또는 회장 직책을 부여할 수 없습니다' },
      },
      { status: 403 },
    );
  }

  // 5. REP 부여 시 managed_building_id 필수 (REQ-011, AC-012)
  if (requestedRole === 'REP' && !parsed.data.managed_building_id) {
    return validationError('REP 부여 시 담당 동(managed_building_id)은 필수입니다');
  }

  // 6. 트랜잭션 — 역할 ID 조회 + 회장 단일성 + target 갱신 (원자적)
  try {
    const result = await withTransaction(
      async (client): Promise<
        | { status: 'TARGET_NOT_FOUND' }
        | { status: 'BUILDING_NOT_FOUND' }
        | { status: 'OK'; managedBuildingId: string | null }
      > => {
        // 대상 사용자 존재 확인
        const targetRes = await client.query<{ id: string }>(
          'SELECT id FROM users WHERE id = $1',
          [targetUserId],
        );
        if (!targetRes.rows[0]) {
          return { status: 'TARGET_NOT_FOUND' };
        }

        // 필요한 role 코드의 role_id 를 한 번에 조회
        const codesToFetch = ['RESIDENT', 'CHAIR', requestedRole];
        const rolesRes = await client.query<{ id: string; code: string }>(
          'SELECT id, code FROM roles WHERE code = ANY($1)',
          [codesToFetch],
        );
        const rolesByCode = new Map(rolesRes.rows.map((r) => [r.code, r.id]));
        const residentRoleId = rolesByCode.get('RESIDENT');
        const chairRoleId = rolesByCode.get('CHAIR');
        const newRoleId = rolesByCode.get(requestedRole);
        if (!residentRoleId || !newRoleId) {
          // 역할 코드가 시드에 없으면 서버 설정 오류
          throw new Error(`ROLE_NOT_SEEDED:${requestedRole}`);
        }

        // REP 부여 시 managed_building_id 존재 검증
        let managedBuildingId: string | null = null;
        if (requestedRole === 'REP') {
          managedBuildingId = parsed.data.managed_building_id ?? null;
          if (managedBuildingId) {
            const bRes = await client.query<{ id: string }>(
              'SELECT id FROM buildings WHERE id = $1',
              [managedBuildingId],
            );
            if (!bRes.rows[0]) {
              return { status: 'BUILDING_NOT_FOUND' };
            }
          }
        }

        // 회장(CHAIR) 단일성 — 기존 CHAIR 행을 잠그고 RESIDENT 로 회수 (REQ-010, AC-011, EC-004)
        if (requestedRole === 'CHAIR' && chairRoleId) {
          // @MX:WARN: FOR UPDATE load-bearing (상단 블록 코멘트 참조)
          await client.query('SELECT id FROM users WHERE role_id = $1 FOR UPDATE', [chairRoleId]);
          await client.query(
            `UPDATE users SET role_id = $1, managed_building_id = NULL
             WHERE role_id = $2 AND id <> $3`,
            [residentRoleId, chairRoleId, targetUserId],
          );
        }

        // 대상 갱신
        // RESIDENT 회수 시 managed_building_id = NULL (REP 포인터 정리, REQ-019)
        // REP 부여 시 managed_building_id = building UUID
        // 그 외(AUDITOR/CHAIR/ADMIN) → managed_building_id = NULL
        await client.query(
          `UPDATE users SET role_id = $1, managed_building_id = $2 WHERE id = $3`,
          [newRoleId, managedBuildingId, targetUserId],
        );

        return { status: 'OK', managedBuildingId };
      },
    );

    if (result.status === 'TARGET_NOT_FOUND') {
      return notFound('존재하지 않는 회원입니다');
    }
    if (result.status === 'BUILDING_NOT_FOUND') {
      return validationError('존재하지 않는 동입니다');
    }

    return NextResponse.json(
      {
        success: true,
        data: { id: targetUserId, role: requestedRole, managed_building_id: result.managedBuildingId },
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'ROLE_UPDATE_FAILED', message: '직책 변경 처리 중 오류가 발생했습니다' },
      },
      { status: 500 },
    );
  }
}
