/**
 * useAuth kakaoLogin 액션 테스트 — TDD RED 단계 (SPEC-AUTH-KAKAO-001).
 *
 * REQ-KAKAO-014: kakaoLogin() 액션 제공
 * REQ-KAKAO-015: 카카오 버튼은 항상 활성화 (트리거만 수행, 비활성 상태 없음)
 * REQ-KAKAO-016: 기존 /api/auth/me 세션 복원 로직은 변경 없음
 *
 * 기존 useAuth.test.ts 는 React 를 전역 모킹하고 있어 실제 AuthProvider 액션을
 * 검증하지 못합니다. kakaoLogin 의 실제 동작(전체 페이지 네비게이션)을 검증하기 위해
 * React Testing Library 로 AuthProvider 를 렌더링하는 별도 파일을 사용합니다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { AuthProvider, useAuth } from './useAuth';

// lib/client 모킹 — 실제 네트워크 호출 방지.
// kakaoLogin 은 클라이언트 호출 없이 window.location 만 변경하므로
// getMe(마운트 시 세션 복원)만 stub 처리.
vi.mock('../lib/client', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  signup: vi.fn(),
  verifyUnit: vi.fn(),
  getMe: vi.fn().mockResolvedValue({ success: false, error: 'no session' }),
}));

// next/navigation 모킹 — useSearchParams 를 테스트별로 제어 가능하게 함.
// FIX-C2: 카카오 콜백이 /login?error=kakao&reason=<...> 로 리다이렉트한 경우
// AuthProvider 가 이를 읽어 state.error 로 반영해야 한다.
const { searchParamsMock } = vi.hoisted(() => ({
  searchParamsMock: {
    get: vi.fn().mockReturnValue(null),
  },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsMock,
}));

/**
 * 테스트 컨슈머 — kakaoLogin 액션을 외부로 노출.
 */
let captured: ReturnType<typeof useAuth> | null = null;
function Consumer() {
  captured = useAuth();
  return null;
}

/**
 * window.location.href setter 를 가로채기 위한 스파이.
 * jsdom 은 기본적으로 location.href 쓰기를 제한하므로,
 * Object.defineProperty 로 덮어쓴 가짜 location 객체를 사용.
 */
function installLocationSpy() {
  const hrefSetter = vi.fn();
  const fakeLocation = {
    href: '',
    set href_(v: string) {
      hrefSetter(v);
    },
  };
  Object.defineProperty(window, 'location', {
    value: fakeLocation,
    writable: true,
    configurable: true,
  });
  // 직접 setter 감지를 위해 defineProperty 재정의
  Object.defineProperty(window.location, 'href', {
    configurable: true,
    get: () => '',
    set: hrefSetter,
  });
  return hrefSetter;
}

describe('useAuth.kakaoLogin (SPEC-AUTH-KAKAO-001)', () => {
  beforeEach(() => {
    captured = null;
    vi.clearAllMocks();
    searchParamsMock.get.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('kakaoLogin 호출 시 /api/auth/kakao 로 전체 페이지 이동한다 (REQ-KAKAO-014)', async () => {
    const hrefSetter = installLocationSpy();

    render(createElement(AuthProvider, null, createElement(Consumer)));

    await waitFor(() => expect(captured).not.toBeNull());

    captured!.kakaoLogin();

    expect(hrefSetter).toHaveBeenCalledWith('/api/auth/kakao');
  });

  it('kakaoLogin 은 동기적으로 네비게이션을 트리거한다 (버튼은 항상 활성화, REQ-KAKAO-015)', async () => {
    const hrefSetter = installLocationSpy();

    render(createElement(AuthProvider, null, createElement(Consumer)));

    await waitFor(() => expect(captured).not.toBeNull());

    // 비동기 대기 없이 호출 즉시 네비게이션 발생해야 함
    captured!.kakaoLogin();
    expect(hrefSetter).toHaveBeenCalledTimes(1);
  });
});

/**
 * FIX-C2 (SPEC-AUTH-KAKAO-001): 카카오 실패 사유가 사용자에게 표시되어야 한다.
 *
 * 콜백은 실패 시 /login?error=kakao&reason=<한글 메시지> 로 리다이렉트한다.
 * 기존 버그: 3개 뷰포트 컴포넌트는 state.error 만 렌더링하고 URL 쿼리 파라미터를
 * 읽지 않아, 모든 카카오 실패(state 불일치/이메일 누락/409/403/일반 오류)에서
 * 사용자에게 아무 메시지도 표시되지 않았다.
 *
 * AuthProvider 가 마운트 시 useSearchParams 로 ?error=kakao&reason=... 를 읽어
 * state.error 로 반영하면, 기존 state.error 렌더링 경로를 통해 모든 뷰포트에 표시된다.
 */
describe('useAuth: 카카오 콜백 실패 사유 노출 (FIX-C2)', () => {
  // state.error 를 DOM 에 렌더링하는 컨슈머 — 실제 3개 뷰포트 컴포넌트와 동일 패턴.
  function ErrorConsumer() {
    const { state } = useAuth();
    return createElement('div', { 'data-testid': 'error-box' }, state.error ?? '');
  }

  beforeEach(() => {
    captured = null;
    vi.clearAllMocks();
    searchParamsMock.get.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('?error=kakao&reason=<메시지> 마운트 시 state.error 가 해당 메시지로 설정된다', async () => {
    const reason = '이미 다른 계정에 연결된 카카오 계정입니다';
    searchParamsMock.get.mockImplementation((key: string) => {
      if (key === 'error') return 'kakao';
      if (key === 'reason') return reason;
      return null;
    });

    const { findByTestId } = render(
      createElement(AuthProvider, null, createElement(ErrorConsumer)),
    );

    const box = await findByTestId('error-box');
    expect(box.textContent).toBe(reason);
  });

  it('error 파라미터가 kakao 가 아니면 state.error 를 설정하지 않는다', async () => {
    searchParamsMock.get.mockImplementation((key: string) => {
      if (key === 'error') return 'other';
      if (key === 'reason') return '무시되어야 함';
      return null;
    });

    const { findByTestId } = render(
      createElement(AuthProvider, null, createElement(ErrorConsumer)),
    );

    const box = await findByTestId('error-box');
    expect(box.textContent).toBe('');
  });

  it('쿼리 파라미터가 없으면 정상적으로 세션 복원 플로우가 실행된다 (회귀 없음)', async () => {
    searchParamsMock.get.mockReturnValue(null);

    const { findByTestId } = render(
      createElement(AuthProvider, null, createElement(ErrorConsumer)),
    );

    const box = await findByTestId('error-box');
    // error 미설정 → 빈 문자열 (getMe 실패 시에도 error 는 null 로 유지됨)
    expect(box.textContent).toBe('');
  });
});
