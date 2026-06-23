/**
 * API 클라이언트 라이브러리 — 프론트엔드 인증 API 호출.
 *
 * REQ-AUTH-INT-009: login(), logout(), signup(), verifyUnit(), getMe() 함수 구현
 * REQ-AUTH-INT-010: fetch 래퍼, 에러 처리 (401, 429, 422)
 *
 * @MX:NOTE: [AUTO] 서버 사이드 핸들러는 src/lib/api/auth.ts, 클라이언트 사이드 호출은 이 파일.
 *                 순환 참조 방지: 이 파일은 lib/auth.ts(JWT)를 참조하지 않음.
 * @MX:ANCHOR: [AUTO] 모든 인증 API 호출의 진입점 — fan_in >= 3 (useAuth, 모든 뷰포트 컴포넌트)
 * @MX:REASON: 이 클라이언트를 변경하면 로그인/로그아웃/회원가입/호수인증 플로우 전체에 영향.
 */

/**
 * API 에러 타입.
 */
export interface ApiError {
  success: false;
  error: string;
  code?: string;
  retryAfter?: number; // 429 잠금 경우 (초)
}

/**
 * 로그인 요청 타입.
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * 로그인 응답 타입.
 */
export interface LoginResponse {
  success: true;
  data: {
    access_token: string;
    user: {
      id: string;
      email: string;
      role: string;
      verified: boolean;
    };
  };
}

/**
 * 회원가입 요청 타입.
 */
export interface SignupRequest {
  email: string;
  password: string;
  name: string;
  buildingId?: string;
  unitId?: string;
}

/**
 * 회원가입 응답 타입.
 */
export interface SignupResponse {
  success: true;
  data: {
    user: {
      id: string;
      email: string;
      role: string;
      verified: boolean;
    };
  };
}

/**
 * 동호수 인증 요청 타입.
 */
export interface VerifyUnitRequest {
  buildingId: string;
  unitNumber: string;
}

/**
 * 동호수 인증 응답 타입.
 */
export interface VerifyUnitResponse {
  success: true;
  data: {
    user: {
      id: string;
      role: string;
      verified: boolean;
    };
  };
}

/**
 * 세션 복원 응답 타입.
 */
export interface MeResponse {
  success: true;
  data: {
    id: string;
    email: string;
    role: string;
    verified: boolean;
    status: string;
  };
}

/**
 * POST /api/auth/login — 로그인.
 *
 * @param credentials - 이메일/비밀번호
 * @returns 로그인 응답 또는 에러
 */
export async function login(
  credentials: LoginRequest
): Promise<LoginResponse | ApiError> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
    credentials: 'include', // httpOnly 쿠키를 위해 필요
  });

  const data = await response.json();

  if (!response.ok) {
    return data as ApiError;
  }

  return data as LoginResponse;
}

/**
 * POST /api/auth/logout — 로그아웃.
 *
 * @returns 성공 여부
 */
export async function logout(): Promise<{ success: true } | ApiError> {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  });

  const data = await response.json();

  if (!response.ok) {
    return data as ApiError;
  }

  return data;
}

/**
 * POST /api/auth/signup — 회원가입.
 *
 * @param userData - 회원가입 데이터
 * @returns 회원가입 응답 또는 에러
 */
export async function signup(
  userData: SignupRequest
): Promise<SignupResponse | ApiError> {
  const response = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData),
    credentials: 'include',
  });

  const data = await response.json();

  if (!response.ok) {
    return data as ApiError;
  }

  return data as SignupResponse;
}

/**
 * POST /api/auth/verify-unit — 동호수 인증.
 *
 * @param requestData - building/unit 데이터
 * @param accessToken - Bearer 토큰
 * @returns 인증 응답 또는 에러
 */
export async function verifyUnit(
  requestData: VerifyUnitRequest,
  accessToken: string
): Promise<VerifyUnitResponse | ApiError> {
  const response = await fetch('/api/auth/verify-unit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(requestData),
    credentials: 'include',
  });

  const data = await response.json();

  if (!response.ok) {
    return data as ApiError;
  }

  return data as VerifyUnitResponse;
}

/**
 * GET /api/auth/me — 세션 복원.
 *
 * @returns 사용자 정보 또는 에러
 */
export async function getMe(): Promise<MeResponse | ApiError> {
  const response = await fetch('/api/auth/me', {
    method: 'GET',
    credentials: 'include',
  });

  const data = await response.json();

  if (!response.ok) {
    return data as ApiError;
  }

  return data as MeResponse;
}
