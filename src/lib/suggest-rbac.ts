/**
 * SUGGEST 도메인 로컬 RBAC 헬퍼 — requireAuthenticated (SPEC-SUGGEST-001).
 *
 * NOTICE 가 requireAuth 를 인라인으로 두는 패턴과 달리, SUGGEST 는 M1(등록)/M4(목록)/M5(상세)
 * 세 라우트가 동일한 "route-level Bearer → verifyAccessToken → ACTIVE 조회 → {callerId, callerRole,
 * unitId, managedBuildingId} 반환" 흐름을 공유하므로 별도 파일로 추출한다 (fan_in=3).
 *
 * 공유 rbac.ts(requireAdmin/requirePrivileged)는 수정하지 않는다 (AUTH/SETUP 소유, 333 테스트 회귀 방지).
 *
 * @MX:ANCHOR: [AUTO] SUGGEST 도메인 인증 진입점 — fan_in=3 (M1 create, M4 list, M5 detail)
 * @MX:REASON:  역할별 비공개 분기(M4 목록 / M5 상세)와 ADMIN 등록 403(M1)은 caller 역할/담당동/호수를
 *             모두 필요로 한다. 본 함수가 이 세 값을 불변 계약으로 반환 — 한 곳 누락 시 권한 우회로 이어짐.
 *
 * @MX:NOTE: [AUTO] route-level Bearer 강제 — middleware.ts 는 AT 쿠키(Edge/jose)만 검사하고
 *           Authorization 헤더를 검사하지 않는다. 통합 테스트/외부 클라이언트는 Bearer 를 사용하므로
 *           본 헬퍼가 verifyAccessToken 을 직접 호출한다 (NOTICE requireAuth 패턴 일관).
 */

import { NextResponse } from 'next/server';
import { query } from './db';
import { verifyAccessToken } from './auth';
import { unauthorized } from './rbac';

/** 인증 성공 결과 — 역할/호수/담당동을 함께 반환 (M4 역할 분기 + M1 unit_id NULL 검사용). */
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
 * Authorization: Bearer AT 를 검증하고 ACTIVE 사용자임을 확인.
 * - AT 없음/불량/만료 → 401
 * - ACTIVE 아님 → 401
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

  // 호출자 조회 — ACTIVE 상태 + role 코드 + unit_id + managed_building_id
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

/** 인증 결과 공통 분기 헬퍼 — ok 멥핑 단순화용 (사용 선택적). */
export function isAuthOk(
  r: RequireAuthenticatedOk | RequireAuthenticatedErr,
): r is RequireAuthenticatedOk {
  return 'callerId' in r;
}

/** 403 FORBIDDEN 응답 (M1 ADMIN 등록 금지 / unit_id NULL 등). SUGGEST 로컬 복제 (rbac.ts 의존 최소화). */
export function suggestForbidden(message: string): Response {
  return NextResponse.json(
    { success: false, error: { code: 'FORBIDDEN', message } },
    { status: 403 },
  );
}

/**
 * 비공개 건의 접근 권한 검사 — RESIDENT/AUDITOR 본인, REP 담당동, CHAIR/ADMIN 전체.
 *
 * SPEC-ATTACHMENT-001 T-002: suggestions/[id]/route.ts 에서 추출. ATTACHMENT 다운로드
 * 엔드포인트(GET /api/attachments/[id]) 가 SUGGEST 첨부의 비공개 가시성을 동일 계약으로
 * 재검증(REQ-ATT-013) 하기 위해 공유 헬퍼로 이전.
 *
 * @returns true 허용 / false 거부
 *
 * @MX:ANCHOR: [AUTO] 비공개 건의 접근 권한 불변 계약 — fan_in=2 (suggestions/[id], attachments/[id])
 * @MX:REASON:  RESIDENT/AUDITOR 본인, REP 담당동, CHAIR/ADMIN 전체 분기 로직이 두 곳에 중복되면
 *             한 곳 누락 시 권한 우회로 이어짐 (REQ-ATT-013 존재 누출 방지 403 계약).
 */
export function canAccessPrivate(
  callerRole: string,
  callerId: string,
  authorId: string | null,
  managedBuildingId: string | null,
  suggestionBuildingId: string | null,
): boolean {
  // CHAIR/ADMIN: 전체
  if (callerRole === 'CHAIR' || callerRole === 'ADMIN') return true;
  // 작성자 본인 (아카이브로 author_id NULL 이면 본인 아님)
  if (authorId !== null && authorId === callerId) return true;
  // REP: 담당동
  if (callerRole === 'REP' && managedBuildingId && suggestionBuildingId) {
    return managedBuildingId === suggestionBuildingId;
  }
  return false;
}

/**
 * 역할별 비공개 건의 목록 가시성 조건 빌더 — RESIDENT/AUDITOR 본인+공개, REP 담당동+공개,
 * CHAIR/ADMIN 전체.
 *
 * SPEC-ATTACHMENT-001 T-002: suggestions/route.ts 에서 추출. 공유 가시성 로직 단일 진실 원천.
 *
 * @MX:NOTE: [AUTO] 반환 clause 의 placeholder($1, $2) 는 호출자가 paramIdx 기반 재작성 필요
 *           (suggestions/route.ts GET 참조). clause 가 빈 문자열이면 조건 없음(CHAIR/ADMIN).
 */
export function buildVisibilityCondition(
  callerRole: string,
  callerId: string,
  managedBuildingId: string | null,
): { clause: string; params: string[] } {
  // CHAIR/ADMIN: 전체 (조건 없음)
  if (callerRole === 'CHAIR' || callerRole === 'ADMIN') {
    return { clause: '', params: [] };
  }
  // REP: 공개 OR 본인 OR (비공개 ∧ 담당동 호수)
  if (callerRole === 'REP') {
    if (managedBuildingId) {
      return {
        clause:
          '(s.is_public = true OR s.author_id = $1 OR (s.is_public = false AND u.building_id = $2))',
        params: [callerId, managedBuildingId],
      };
    }
    // 담당동 없는 REP 는 RESIDENT 와 동일 (본인 + 공개)
    return {
      clause: '(s.is_public = true OR s.author_id = $1)',
      params: [callerId],
    };
  }
  // RESIDENT/AUDITOR (기본): 공개 OR 본인
  return {
    clause: '(s.is_public = true OR s.author_id = $1)',
    params: [callerId],
  };
}
