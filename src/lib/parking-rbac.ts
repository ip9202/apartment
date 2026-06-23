/**
 * PARKING 도메인 로컬 RBAC 헬퍼 (SPEC-PARKING-001).
 *
 * Option C 패턴 — 공유 rbac.ts(requireAdmin/requirePrivileged) 수정 없이
 * PARKING 도메인 전용 인증/권한 헬퍼를 별도 파일로 제공 (suggest-rbac.ts 패턴 동일).
 *
 * 본 파일은 두 가지 책임을 갖는다:
 * 1. requireAuthenticated — route-level Bearer → verifyAccessToken → ACTIVE 조회.
 *    (M2 추첨, M3 취소, M6 열람, M7 투명성 — fan_in=4)
 * 2. filterAllocationsByRole — 역할별 가시성 필터링 (REQ-PK-023/024, M6 열람 전용).
 *
 * @MX:ANCHOR: [AUTO] PARKING 도메인 인증 진입점 — fan_in=4 (M2 draw, M3 cancel, M6 allocations, M7 verify)
 * @MX:REASON:  역할별 가시성(REQ-PK-023)과 정보은닉(REQ-PK-024)은 caller 역할/담당동/호수를
 *             모두 필요로 한다. 본 함수가 이 세 값을 불변 계약으로 반환 — 한 곳 누락 시 권한 우회.
 *
 * @MX:NOTE: [AUTO] route-level Bearer 강제 — middleware.ts 는 AT 쿠키(Edge/jose)만 검사.
 *           통합 테스트/외부 클라이언트는 Bearer 사용 → 본 헬퍼가 verifyAccessToken 직접 호출.
 */

import { query } from './db';
import { verifyAccessToken } from './auth';
import { unauthorized } from './rbac';

/** 인증 성공 결과 — 역할/호수/담당동 반환. */
export interface RequireAuthenticatedOk {
  callerId: string;
  callerRole: string;
  unitId: string | null;
  managedBuildingId: string | null;
}

export interface RequireAuthenticatedErr {
  response: Response;
}

/**
 * Authorization: Bearer AT 검증 + ACTIVE 사용자 조회.
 * - AT 없음/불량/만료/비-ACTIVE → 401
 * 성공 시 { callerId, callerRole, unitId, managedBuildingId } 반환.
 */
export async function requireAuthenticated(
  request: Request,
): Promise<RequireAuthenticatedOk | RequireAuthenticatedErr> {
  const authHeader = request.headers.get('authorization') ?? '';
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!bearerMatch) {
    return { response: unauthorized() };
  }

  let atClaims: { sub?: string };
  try {
    atClaims = verifyAccessToken(bearerMatch[1]);
  } catch {
    return { response: unauthorized() };
  }
  const callerId = atClaims.sub;
  if (!callerId) {
    return { response: unauthorized() };
  }

  const callerRes = await query<{
    role: string;
    unit_id: string | null;
    managed_building_id: string | null;
  }>(
    `SELECT r.code AS role, u.unit_id, u.managed_building_id
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.status = 'ACTIVE'`,
    [callerId],
  );
  const caller = callerRes.rows[0];
  if (!caller) {
    return { response: unauthorized() };
  }

  return {
    callerId,
    callerRole: caller.role,
    unitId: caller.unit_id,
    managedBuildingId: caller.managed_building_id,
  };
}

/** 인증 성공 여부 타입 가드. */
export function isAuthOk(
  r: RequireAuthenticatedOk | RequireAuthenticatedErr,
): r is RequireAuthenticatedOk {
  return 'callerId' in r;
}

/**
 * 전체 결과 열람 가능 역할 판정 (ADMIN/CHAIR).
 * 미공개/공개 무관하게 전체를 볼 수 있는 권한.
 */
export function canSeeAll(role: string): boolean {
  return role === 'ADMIN' || role === 'CHAIR';
}

/** filterAllocationsByRole 입력 — allocations 는 building/unit_id/slot 만 필요. */
export interface FilterableAllocation {
  unit_id: string;
  building: string;
}

/** 역할별 가시성 필터링 입력. */
export interface FilterParams<T extends FilterableAllocation> {
  role: string;
  unitId: string | null;
  managedBuildingId: string | null;
  isPublished: boolean;
  allocations: ReadonlyArray<T>;
}

/**
 * 역할별 결과 가시성 필터링 (REQ-PK-023, REQ-PK-024).
 *
 * 공개(is_published=true):
 *   RESIDENT/AUDITOR → 본인 unit 만
 *   REP → 담당동 building 만
 *   CHAIR/ADMIN → 전체
 * 미공개(is_published=false):
 *   ADMIN/CHAIR → 전체 (관리 목적)
 *   그 외 → 본인 unit 만 (정보은닉: 타인 존재 여부 누출 금지, 빈 목록 허용)
 *
 * @MX:NOTE: [AUTO] 정보은닉 원칙 — 미공개 회차에서 비권한자가 타인 조회 시 본인만(없으면 빈 목록)
 *           반환. 200 vs 403, 빈 vs 비어있지 않음 으로 존재 여부 누출 금지 (enumeration 방어).
 */
export function filterAllocationsByRole<T extends FilterableAllocation>(
  params: FilterParams<T>,
): T[] {
  const { role, unitId, managedBuildingId, isPublished, allocations } = params;

  // ADMIN/CHAIR 는 항상 전체
  if (canSeeAll(role)) {
    return [...allocations];
  }

  if (isPublished) {
    if (role === 'REP' && managedBuildingId) {
      // 담당동 building 만
      return allocations.filter((a) => a.building === managedBuildingId);
    }
    // RESIDENT/AUDITOR (및 managedBuildingId 없는 REP) → 본인만
    return allocations.filter((a) => unitId !== null && a.unit_id === unitId);
  }

  // 미공개: 비-ADMIN/비-CHAIR → 본인만 (정보은닉)
  return allocations.filter((a) => unitId !== null && a.unit_id === unitId);
}
