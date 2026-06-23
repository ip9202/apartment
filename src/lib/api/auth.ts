/**
 * 인증 API 비즈니스 로직 — 순수 함수 (단위 테스트 가능).
 *
 * REQ-AUTH-INT-001: GET /api/auth/me — at 쿠키를 읽어 사용자 정보 반환
 * REQ-AUTH-INT-002: AT 없음/만료/무효 → 401
 * REQ-AUTH-INT-003: middleware.ts와 동일한 JWT_SECRET + jose 검증
 *
 * @MX:NOTE: [AUTO] Next.js API Route의 Request/Response 객체는 래퍼를 통해 순수 함수로 분리하여
 *                 단위 테스트 가능성 확보 — 핸들러는 이 함수들을 호출하는 역할만 담당.
 */

import { jwtVerify, type JWTVerifyResult } from 'jose';
import { query } from '../db';
import { ACCESS_COOKIE_NAME } from '../cookies';

/**
 * 사용자 정보 타입.
 */
export interface AuthUser {
  id: string;
  email: string;
  role: string;
  verified: boolean;
  status: string;
}

/**
 * 세션 복원 응답 타입.
 */
export interface SessionResponse {
  success: true;
  data: AuthUser;
}

/**
 * 세션 복원 에러 응답 타입.
 */
export interface SessionErrorResponse {
  success: false;
  error: string;
}

/**
 * JWT_SECRET을 Uint8Array로 로드 (jose HS256 검증용).
 * middleware.ts의 getSecret()와 동일한 구현.
 *
 * @throws {Error} JWT_SECRET이 설정되지 않은 경우
 */
function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('[auth/me] JWT_SECRET이 설정되지 않았습니다');
  }
  return new TextEncoder().encode(secret);
}

/**
 * AT 쿠키에서 JWT 페이로드 추출. 실패/없음 시 null 반환.
 * middleware.ts의 extractVerified()와 동일한 검증 로직.
 *
 * @param cookieValue - at 쿠키 값 (undefined 가능)
 * @returns JWT 페이로드 또는 null (검증 실패)
 */
export async function extractJwtPayload(
  cookieValue: string | undefined
): Promise<JWTVerifyResult | null> {
  if (!cookieValue) return null;

  try {
    return await jwtVerify(cookieValue, getSecret(), {
      algorithms: ['HS256'],
    });
  } catch {
    // 만료/서명불일치/잘못된 형식 — 모두 null 반환
    return null;
  }
}

/**
 * JWT 페이로드에서 사용자 ID 추출.
 *
 * @param payload - JWT 페이로드
 * @returns 사용자 ID (sub 클레임)
 * @throws {Error} sub 클레임이 없는 경우
 */
export function extractUserId(payload: JWTVerifyResult): string {
  const sub = payload.payload.sub;
  if (!sub || typeof sub !== 'string') {
    throw new Error('[auth/me] JWT 페이로드에 sub 클레임이 없습니다');
  }
  return sub;
}

/**
 * 사용자 ID로 DB에서 사용자 정보 조회.
 *
 * @param userId - 사용자 ID
 * @returns 사용자 정보 또는 null (존재하지 않음)
 */
export async function fetchUserById(userId: string): Promise<AuthUser | null> {
  const result = await query<{
    id: string;
    email: string;
    role: string;
    verified: boolean;
    status: string;
  }>(
    `SELECT u.id, u.email, r.code AS role,
            u.verified_at IS NOT NULL AS verified,
            u.status
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [userId]
  );

  return result.rows[0] || null;
}

/**
 * GET /api/auth/me 핸들러 — 세션 복원 엔드포인트.
 *
 * 처리 순서:
 *   1. at 쿠키 읽기
 *   2. JWT 검증 (jose HS256)
 *   3. 사용자 ID 추출
 *   4. DB 조회
 *   5. 응답 반환 (200 + 사용자 정보 또는 401)
 *
 * @param request - Next.js Request 객체
 * @returns Response (200 OK + 사용자 정보 또는 401 Unauthorized)
 */
export async function handleGetMe(
  request: Request
): Promise<Response> {
  // 1. at 쿠키 읽기
  const cookieHeader = request.headers.get('cookie');
  const atCookie = parseCookie(cookieHeader, ACCESS_COOKIE_NAME);

  // 2. JWT 검증
  const payload = await extractJwtPayload(atCookie);
  if (!payload) {
    return Response.json(
      { success: false, error: '인증이 필요합니다' },
      { status: 401 }
    );
  }

  // 3. 사용자 ID 추출
  const userId = extractUserId(payload);

  // 4. DB 조회
  const user = await fetchUserById(userId);
  if (!user) {
    return Response.json(
      { success: false, error: '사용자를 찾을 수 없습니다' },
      { status: 401 }
    );
  }

  // 5. 응답 반환
  return Response.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      role: user.role,
      verified: user.verified,
      status: user.status,
    },
  });
}

/**
 * 쿠키 문자열에서 특정 쿠키 값 추출.
 *
 * @param cookieHeader - Cookie 헤더 값
 * @param name - 쿠키 이름
 * @returns 쿠키 값 또는 undefined
 */
function parseCookie(
  cookieHeader: string | null,
  name: string
): string | undefined {
  if (!cookieHeader) return undefined;

  const cookies = cookieHeader.split(';').map((c) => c.trim());
  const target = cookies.find((c) => c.startsWith(`${name}=`));

  return target?.split('=')[1];
}
