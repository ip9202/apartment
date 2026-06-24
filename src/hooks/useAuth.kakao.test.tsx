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

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
