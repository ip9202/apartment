/**
 * SETUP RBAC 헬퍼 — 공통 인증/권한 검사.
 *
 * POST/DELETE /api/setup/buildings 가 동일한 "AT 추출 → verifyAccessToken → ADMIN 검사" 흐름을
 * 공유하므로 중복을 하나 함수로 묶는다. 실패 시 NextResponse(401/403) 를, 성공 시 caller_id 를 반환.
 *
 * @MX:ANCHOR: [AUTO] SETUP RBAC 진입점 — fan_in >= 3 (buildings POST/DELETE, 향후 units/role/users)
 * @MX:REASON: 401/403 분기 로직이 여러 핸들러에 중복되면 한 곳만 빠뜨려도 권한 우회로 이어짐.
 *             본 함수를 불변 계약으로 취급.
 */

import { NextResponse } from 'next/server';
import { query } from './db';
import { verifyAccessToken } from './auth';

export interface RequireAdminOk {
  callerId: string;
}

export interface RequireAdminErr {
  response: Response;
}

/**
 * 권한 검사 성공 결과 — callerId 와 호출자 역할 코드를 함께 반환.
 * SETUP Phase D(직책 부여)는 ADMIN 과 CHAIR 모두 허용하되, CHAIR 는
 * 부여 가능 직책이 제한되므로 caller 역할 코드가 추가로 필요하다.
 */
export interface RequirePrivilegedOk {
  callerId: string;
  callerRole: string;
}

export interface RequirePrivilegedErr {
  response: Response;
}

/**
 * Authorization: Bearer AT 를 검증하고 ACTIVE ADMIN 임을 확인.
 * - AT 없음/불량/만료 → 401
 * - 인증됨-비-ADMIN → 403
 * 성공 시 { callerId } 반환.
 */
export async function requireAdmin(request: Request): Promise<RequireAdminOk | RequireAdminErr> {
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

  // 호출자 조회 — ACTIVE 상태 + role 코드
  const callerRes = await query<{ role: string }>(
    `SELECT r.code AS role
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.status = 'ACTIVE'`,
    [callerId],
  );
  const caller = callerRes.rows[0];
  if (!caller) {
    return { response: unauthorized() };
  }

  if (caller.role !== 'ADMIN') {
    return { response: forbidden('관리자만 접근할 수 있습니다') };
  }

  return { callerId };
}

/**
 * Authorization: Bearer AT 검증 + ACTIVE 상태 + 허용 역할 코드(allowedRoleCodes) 검사.
 * - AT 없음/불량/만료 → 401
 * - 인증됨-비허용역할 → 403
 * 성공 시 { callerId, callerRole } 반환.
 *
 * @MX:NOTE: [AUTO] SETUP Phase D 직책 부여 엔드포인트는 ADMIN/CHAIR 둘 다 허용해야 한다.
 *           requireAdmin 는 ADMIN 전용으로 유지(Phase B buildings/units 호환성)하고,
 *           본 함수로 허용 역할을 파라미터로 받아 재사용한다. Bearer→verify→ACTIVE 흐름은 동일.
 */
export async function requirePrivileged(
  request: Request,
  allowedRoleCodes: readonly string[],
): Promise<RequirePrivilegedOk | RequirePrivilegedErr> {
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

  const callerRes = await query<{ role: string }>(
    `SELECT r.code AS role
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.status = 'ACTIVE'`,
    [callerId],
  );
  const caller = callerRes.rows[0];
  if (!caller) {
    return { response: unauthorized() };
  }

  if (!allowedRoleCodes.includes(caller.role)) {
    return { response: forbidden('이 작업을 수행할 권한이 없습니다') };
  }

  return { callerId, callerRole: caller.role };
}

/** 401 미인증 응답. */
export function unauthorized(): Response {
  return NextResponse.json(
    { success: false, error: { code: 'UNAUTHORIZED', message: '인증이 필요합니다' } },
    { status: 401 },
  );
}

/** 403 FORBIDDEN 응답 (RBAC). */
export function forbidden(message: string): Response {
  return NextResponse.json(
    { success: false, error: { code: 'FORBIDDEN', message } },
    { status: 403 },
  );
}

/** 400 Bad Request 응답 (path param 형식 오류). */
export function badRequest(message: string): Response {
  return NextResponse.json(
    { success: false, error: { code: 'BAD_REQUEST', message } },
    { status: 400 },
  );
}

/** 404 Not Found 응답. */
export function notFound(message: string): Response {
  return NextResponse.json(
    { success: false, error: { code: 'NOT_FOUND', message } },
    { status: 404 },
  );
}

/** 409 Conflict 응답. */
export function conflict(message: string): Response {
  return NextResponse.json(
    { success: false, error: { code: 'CONFLICT', message } },
    { status: 409 },
  );
}

/** 422 Validation Error 응답. */
export function validationError(message: string): Response {
  return NextResponse.json(
    { success: false, error: { code: 'VALIDATION_ERROR', message } },
    { status: 422 },
  );
}
