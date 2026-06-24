/**
 * useAuth 공유 훅 — 인증 상태 관리 및 액션.
 *
 * REQ-AUTH-INT-011: 인증 상태(user, loading, error) 관리
 * REQ-AUTH-INT-012: 액션(login, logout, signup, verifyUnit) 제공
 * REQ-AUTH-INT-013: 마운트 시 세션 복원(/api/auth/me)
 *
 * @MX:ANCHOR: [AUTO] 모든 인증 상태의 단일 진입점 — fan_in >= 3 (모든 뷰포트 컴포넌트)
 * @MX:REASON: 이 훅을 통해 인증 상태가 일관되며, 변경 시 로그인/로그아웃 플로우 전체에 영향.
 */

'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
  createElement,
} from 'react';
import { useSearchParams } from 'next/navigation';
import {
  login,
  logout,
  signup,
  verifyUnit,
  getMe,
} from '../lib/client';

/**
 * 인증 상태 타입.
 */
export interface AuthState {
  user: {
    id: string;
    email: string;
    role: string;
    verified: boolean;
    status: string;
  } | null;
  loading: boolean;
  error: string | null;
}

/**
 * Auth Context 타입.
 */
interface AuthContextType {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  signup: (
    email: string,
    password: string,
    name: string,
    buildingId?: string,
    unitId?: string
  ) => Promise<void>;
  verifyUnit: (buildingId: string, unitNumber: string) => Promise<void>;
  refresh: () => Promise<void>;
  // REQ-KAKAO-014: 카카오 OAuth 진입 액션 — SPA 외부로 전체 페이지 이동.
  kakaoLogin: () => void;
}

/**
 * Auth Context 생성.
 */
const AuthContext = createContext<AuthContextType | null>(null);

/**
 * useAuth 훅 — 인증 상태 관리 및 액션.
 *
 * 제공 기능:
 * - 인증 상태: user, loading, error
 * - 액션: login, logout, signup, verifyUnit, refresh, kakaoLogin
 * - 자동 세션 복원: 마운트 시 /api/auth/me 호출
 *
 * @example
 * ```tsx
 * const { state, login, logout } = useAuth();
 * await login('admin@example.com', 'password');
 * ```
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

/**
 * AuthProvider 컴포넌트 Props.
 */
interface AuthProviderProps {
  children: ReactNode;
}

/**
 * AuthProvider — 인증 상태 공급자.
 *
 * 모든 뷰포트 컴포넌트를 감싸서 useAuth 훅 사용 가능.
 *
 * @example
 * ```tsx
 * <AuthProvider>
 *   <MobileApp />
 * </AuthProvider>
 * ```
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  });

  // FIX-C2: 카카오 콜백 실패 사유 노출.
  // 콜백은 실패 시 /login?error=kakao&reason=<한글 메시지> 로 리다이렉트한다.
  // 3개 뷰포트 컴포넌트는 state.error 만 렌더링하므로, AuthProvider 가 마운트 시
  // 쿼리 파라미터를 읽어 state.error 로 반영하면 모든 뷰포트에 자동 표시된다.
  // reason 값은 이미 사용자 친화적 한국어(redirectToLogin 이 전체 메시지를 전달).
  const searchParams = useSearchParams();
  useEffect(() => {
    const errorKind = searchParams.get('error');
    const reason = searchParams.get('reason');
    if (errorKind === 'kakao' && reason) {
      setState((prev) => ({ ...prev, error: reason, loading: false }));
    }
  }, [searchParams]);

  /**
   * 로그인 액션.
   */
  const loginAction = useCallback(
    async (email: string, password: string) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      const result = await login({ email, password });

      if ('success' in result && result.success) {
        setState({
          user: {
            id: result.data.user.id,
            email: result.data.user.email,
            role: result.data.user.role,
            verified: result.data.user.verified,
            status: 'ACTIVE',
          },
          loading: false,
          error: null,
        });
      } else {
        setState((prev) => ({ ...prev, error: result.error, loading: false }));
      }
    },
    []
  );

  /**
   * 로그아웃 액션.
   */
  const logoutAction = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    const result = await logout();

    if ('success' in result && result.success) {
      setState({
        user: null,
        loading: false,
        error: null,
      });
    } else {
      setState((prev) => ({ ...prev, error: result.error, loading: false }));
    }
  }, []);

  /**
   * 회원가입 액션.
   */
  const signupAction = useCallback(
    async (
      email: string,
      password: string,
      name: string,
      buildingId?: string,
      unitId?: string
    ) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      const result = await signup({
        email,
        password,
        name,
        buildingId,
        unitId,
      });

      if ('success' in result && result.success) {
        setState({
          user: {
            id: result.data.user.id,
            email: result.data.user.email,
            role: result.data.user.role,
            verified: result.data.user.verified,
            status: 'ACTIVE',
          },
          loading: false,
          error: null,
        });
      } else {
        setState((prev) => ({ ...prev, error: result.error, loading: false }));
      }
    },
    []
  );

  /**
   * 동호수 인증 액션.
   */
  const verifyUnitAction = useCallback(
    async (buildingId: string, unitNumber: string) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      // AT가 필요하지만, httpOnly 쿠키에 있으므로 명시적으로 전달하지 않음
      // 백엔드에서 쿠키를 읽어 검증
      const result = await verifyUnit({ buildingId, unitNumber }, '');

      if ('success' in result && result.success) {
        setState({
          user: {
            id: result.data.user.id,
            email: 'user@example.com', // verify-unit 응답에는 email 없음
            role: result.data.user.role,
            verified: result.data.user.verified,
            status: 'ACTIVE',
          },
          loading: false,
          error: null,
        });
      } else {
        setState((prev) => ({ ...prev, error: result.error, loading: false }));
      }
    },
    []
  );

  /**
   * 세션 새로고침 (refresh).
   */
  const refreshAction = useCallback(async () => {
    // FIX-C2: error 를 무조건 null 로 초기화하지 않음 — 카카오 콜백 사유가
    // 세션 복원 진입부에 의해 덮어쓰기되는 것을 방지.
    setState((prev) => ({ ...prev, loading: true }));

    const result = await getMe();

    if ('success' in result && result.success) {
      setState({
        user: {
          id: result.data.id,
          email: result.data.email,
          role: result.data.role,
          verified: result.data.verified,
          status: result.data.status,
        },
        loading: false,
        error: null,
      });
    } else {
      // 인증되지 않은 경우 -> user/loading 클리어.
      // 단, FIX-C2 로 설정된 카카오 오류 사유(error) 는 보존 —
      // 세션 복원 실패가 콜백 실패 메시지를 덮어쓰지 않도록 한다.
      setState((prev) => ({
        user: null,
        loading: false,
        error: prev.error,
      }));
    }
  }, []);

  /**
   * 마운트 시 세션 복원 (REQ-AUTH-INT-013).
   */
  useEffect(() => {
    refreshAction();
  }, [refreshAction]);

  /**
   * 카카오 OAuth 로그인 진입 (REQ-KAKAO-014).
   *
   * OAuth 는 SPA 외부에서 진행되어야 하므로 전체 페이지 네비게이션을 트리거.
   * 백엔드 GET /api/auth/kakao 가 state 쿠키 + 302 리다이렉트를 처리.
   * 버튼은 항상 활성화 (REQ-KAKAO-015) — 비활성/준비 중 상태 없음.
   *
   * @MX:ANCHOR: [AUTO] 모든 뷰포트 컴포넌트(Mobile/Tablet/Desktop) 의 카카오 진입점 — fan_in >= 3
   * @MX:REASON: 세 컴포넌트가 동일 액션을 공유해야 UX 일관성이 유지됨.
   */
  const kakaoLoginAction = useCallback(() => {
    window.location.href = '/api/auth/kakao';
  }, []);

  const contextValue: AuthContextType = {
    state,
    login: loginAction,
    logout: logoutAction,
    signup: signupAction,
    verifyUnit: verifyUnitAction,
    refresh: refreshAction,
    kakaoLogin: kakaoLoginAction,
  };

  return createElement(AuthContext.Provider, { value: contextValue }, children);
}
