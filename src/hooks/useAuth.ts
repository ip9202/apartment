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
 * - 액션: login, logout, signup, verifyUnit, refresh
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
    setState((prev) => ({ ...prev, loading: true, error: null }));

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
      // 인증되지 않은 경우 -> 상태 클리어
      setState({
        user: null,
        loading: false,
        error: null,
      });
    }
  }, []);

  /**
   * 마운트 시 세션 복원 (REQ-AUTH-INT-013).
   */
  useEffect(() => {
    refreshAction();
  }, [refreshAction]);

  const contextValue: AuthContextType = {
    state,
    login: loginAction,
    logout: logoutAction,
    signup: signupAction,
    verifyUnit: verifyUnitAction,
    refresh: refreshAction,
  };

  return createElement(AuthContext.Provider, { value: contextValue }, children);
}
