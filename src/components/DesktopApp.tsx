"use client";

import { useState, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { NOTICES, type Screen } from './demo-data';

/**
 * DesktopApp - Desktop viewport component
 * Full app with authentication, notices, suggestions, parking
 *
 * REQ-AUTH-INT-023: DesktopApp useAuth 연동
 * REQ-AUTH-INT-024: login 화면 API 연동
 * REQ-AUTH-INT-025: signup 화면 API 연동
 * REQ-AUTH-INT-026: verify-unit 화면 API 연동
 * REQ-AUTH-INT-027: logout 기능 API 연동
 *
 * @MX:ANCHOR: [AUTO] 데스크탑 앱의 단일 진입점 — fan_in >= 3 (메인 레이아웃)
 * @MX:REASON: 이 컴포넌트를 통해 데스크탑 전체 플로우가 제어되며, 변경 시 모든 화면에 영향.
 */
export default function DesktopApp() {
  const { state, login, signup, verifyUnit, logout } = useAuth();

  // State
  const [screen, setScreen] = useState<Screen>('login');

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Signup form state
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [signupName, setSignupName] = useState('');

  // Verify unit form state
  const [verifyBuilding, setVerifyBuilding] = useState('');
  const [verifyUnitNumber, setVerifyUnitNumber] = useState('');

  // Form validation state
  const [formError, setFormError] = useState<string | null>(null);

  // Computed values
  const isAdmin = state.user?.role === 'ADMIN';

  const showAuthScreen = !state.user;
  const showLogin = screen === 'login';
  const showSignup = screen === 'signup';
  const showVerify = screen === 'verify';

  // Navigation handlers
  const navigate = useCallback((newScreen: Screen) => {
    setScreen(newScreen);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  /**
   * 로그인 처리 (REQ-AUTH-INT-024)
   * useAuth.login 호출 → 성공 시 홈/관리자 화면 이동
   */
  const doLogin = useCallback(async (email: string, password: string) => {
    if (!email || !password) {
      setFormError('이메일과 비밀번호를 모두 입력해 주세요.');
      return;
    }
    setFormError(null);
    await login(email, password);

    // 로그인 성공 후 화면 전환 (useAuth 상태로 판단)
    if (state.user) {
      const isAdmin = state.user.role === 'ADMIN';
      setScreen(isAdmin ? 'admin' : 'home');
    }
  }, [login, state.user]);

  /**
   * 회원가입 처리 (REQ-AUTH-INT-025)
   */
  const doSignup = useCallback(async () => {
    if (!signupEmail || !signupPassword || !signupName) {
      setFormError('모든 필드를 입력해 주세요.');
      return;
    }
    if (signupPassword.length < 8) {
      setFormError('비밀번호는 8자 이상이어야 합니다.');
      return;
    }
    setFormError(null);
    await signup(signupEmail, signupPassword, signupName);

    // 회원가입 성공 후 verify 화면 이동
    if (state.user) {
      setScreen('verify');
    }
  }, [signup, signupEmail, signupPassword, signupName, state.user]);

  /**
   * 동호수 인증 처리 (REQ-AUTH-INT-026)
   */
  const doVerifyUnit = useCallback(async () => {
    if (!verifyBuilding || !verifyUnitNumber) {
      setFormError('동과 호수를 모두 선택해 주세요.');
      return;
    }
    setFormError(null);
    await verifyUnit(verifyBuilding, verifyUnitNumber);

    // 인증 성공 후 홈 화면 이동
    if (state.user?.verified) {
      setScreen('home');
    }
  }, [verifyUnit, verifyBuilding, verifyUnitNumber, state.user]);

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#F3F4F6' }}>
      {/* ── SIDEBAR ── */}
      {state.user && (
        <div style={{
          width: '256px',
          backgroundColor: 'white',
          borderRight: '1px solid #E5E7EB',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0
        }}>
          {/* Logo */}
          <div style={{ padding: '24px', borderBottom: '1px solid #E5E7EB' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '32px' }}>🏢</span>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#111827', letterSpacing: '-0.3px' }}>아이틀아파트</div>
                <div style={{ fontSize: '13px', color: '#6B7280', marginTop: '2px' }}>입주민 포털</div>
              </div>
            </div>
          </div>

          {/* User Info */}
          <div style={{ padding: '20px 24px', borderBottom: '1px solid #E5E7EB' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: '#DBEAFE',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20px'
              }}>👤</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#111827',
                  marginBottom: '2px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>{state.user?.email || 'user@example.com'}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#2563EB',
                    backgroundColor: '#DBEAFE',
                    padding: '2px 6px',
                    borderRadius: '4px'
                  }}>입주민</span>
                  <span style={{ fontSize: '13px', color: '#374151', fontWeight: 600 }}>
                    A동 201호
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            <div style={{ marginBottom: '24px' }}>
              <div style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#9CA3AF',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '12px',
                paddingLeft: '12px'
              }}>메인</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div
                  onClick={() => navigate('home')}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    backgroundColor: screen === 'home' ? '#EFF6FF' : 'transparent',
                    color: screen === 'home' ? '#2563EB' : '#374151',
                    fontSize: '14px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}
                >
                  <span>🏠</span>
                  <span>홈</span>
                </div>
                <div
                  onClick={() => navigate('notices')}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    backgroundColor: screen === 'notices' ? '#EFF6FF' : 'transparent',
                    color: screen === 'notices' ? '#2563EB' : '#374151',
                    fontSize: '14px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}
                >
                  <span>📢</span>
                  <span>공지사항</span>
                </div>
                <div
                  onClick={() => navigate('suggestions')}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    backgroundColor: screen === 'suggestions' ? '#EFF6FF' : 'transparent',
                    color: screen === 'suggestions' ? '#2563EB' : '#374151',
                    fontSize: '14px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}
                >
                  <span>💡</span>
                  <span>건의사항</span>
                </div>
                <div
                  onClick={() => navigate('parking')}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    backgroundColor: screen === 'parking' ? '#EFF6FF' : 'transparent',
                    color: screen === 'parking' ? '#2563EB' : '#374151',
                    fontSize: '14px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}
                >
                  <span>🚗</span>
                  <span>주차배정</span>
                </div>
              </div>
            </div>

            {isAdmin && (
              <div style={{ marginBottom: '24px' }}>
                <div style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#9CA3AF',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: '12px',
                  paddingLeft: '12px'
                }}>관리자</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div
                    onClick={() => navigate('admin')}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      backgroundColor: screen === 'admin' ? '#EFF6FF' : 'transparent',
                      color: screen === 'admin' ? '#2563EB' : '#374151',
                      fontSize: '14px',
                      fontWeight: 500,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px'
                    }}
                  >
                    <span>⚙️</span>
                    <span>관리자메뉴</span>
                  </div>
                </div>
              </div>
            )}

            <div>
              <div style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#9CA3AF',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '12px',
                paddingLeft: '12px'
              }}>설정</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div
                  onClick={() => navigate('mypage')}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    backgroundColor: screen === 'mypage' ? '#EFF6FF' : 'transparent',
                    color: screen === 'mypage' ? '#2563EB' : '#374151',
                    fontSize: '14px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}
                >
                  <span>👤</span>
                  <span>계정설정</span>
                </div>
              </div>
            </div>
          </div>

          {/* Logout */}
          <div style={{ padding: '16px', borderTop: '1px solid #E5E7EB' }}>
            <button
              onClick={() => {
                logout();
                setScreen('login');
                setLoginEmail('');
                setLoginPassword('');
              }}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: 'white',
                border: '1px solid #E5E7EB',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 500,
                color: '#374151',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <span>🚪</span>
              <span>로그아웃</span>
            </button>
          </div>
        </div>
      )}

      {/* ── AUTH SCREENS ── */}
      {showAuthScreen && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
          <div style={{
            width: '100%',
            maxWidth: '440px',
            backgroundColor: 'white',
            borderRadius: '16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            overflow: 'hidden'
          }}>
            {/* LOGIN */}
            {showLogin && (
              <div style={{ padding: '40px' }}>
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏢</div>
                  <h2 style={{
                    fontSize: '24px',
                    fontWeight: 700,
                    color: '#111827',
                    marginBottom: '8px',
                    letterSpacing: '-0.5px'
                  }}>아이틀아파트</h2>
                  <p style={{ fontSize: '15px', color: '#6B7280', margin: 0 }}>입주민 포털에 오신 것을 환영합니다</p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div>
                    <label style={{
                      display: 'block',
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#374151',
                      marginBottom: '8px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>이메일</label>
                    <input
                      type="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="이메일을 입력해 주세요"
                      style={{
                        width: '100%',
                        height: '50px',
                        border: '1.5px solid #E5E7EB',
                        borderRadius: '10px',
                        padding: '0 16px',
                        fontSize: '15px',
                        color: '#111827',
                        outline: 'none',
                        backgroundColor: '#F9FAFB',
                        transition: 'border-color 0.2s'
                      }}
                    />
                  </div>

                  <div>
                    <label style={{
                      display: 'block',
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#374151',
                      marginBottom: '8px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>비밀번호</label>
                    <input
                      type="password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="비밀번호를 입력해 주세요"
                      style={{
                        width: '100%',
                        height: '50px',
                        border: '1.5px solid #E5E7EB',
                        borderRadius: '10px',
                        padding: '0 16px',
                        fontSize: '15px',
                        color: '#111827',
                        outline: 'none',
                        backgroundColor: '#F9FAFB',
                        transition: 'border-color 0.2s'
                      }}
                    />
                  </div>

                  {formError && (
                    <div style={{
                      padding: '10px 14px',
                      backgroundColor: '#FEF2F2',
                      border: '1px solid #FECACA',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '12px'
                    }}>
                      <span style={{ fontSize: '15px' }}>⚠️</span>
                      <span style={{ fontSize: '13px', color: '#DC2626' }}>{formError}</span>
                    </div>
                  )}
                  {state.error && (
                    <div style={{
                      padding: '10px 14px',
                      backgroundColor: '#FEF2F2',
                      border: '1px solid #FECACA',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <span style={{ fontSize: '15px' }}>⚠️</span>
                      <span style={{ fontSize: '13px', color: '#DC2626' }}>{state.error}</span>
                    </div>
                  )}

                  <button
                    onClick={() => doLogin(loginEmail, loginPassword)}
                    disabled={state.loading}
                    style={{
                      width: '100%',
                      height: '52px',
                      backgroundColor: state.loading ? '#93C5FD' : '#2563EB',
                      color: 'white',
                      border: 'none',
                      borderRadius: '12px',
                      fontSize: '16px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      letterSpacing: '-0.2px'
                    }}
                  >
                    {state.loading ? (
                      <span style={{
                        width: '18px',
                        height: '18px',
                        border: '2px solid white',
                        borderTopColor: 'transparent',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                      }} />
                    ) : '로그인'}
                  </button>

                  <div style={{
                    display: 'flex',
                    gap: '12px',
                    marginTop: '8px'
                  }}>
                    <button
                      onClick={() => doLogin('resident@aitteulak.com', 'test1234')}
                      style={{
                        flex: 1,
                        padding: '10px',
                        backgroundColor: '#F3F4F6',
                        border: '1px solid #E5E7EB',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}>👤 입주민</button>
                    <button
                      onClick={() => doLogin('admin@aitteulak.com', 'test1234')}
                      style={{
                        flex: 1,
                        padding: '10px',
                        backgroundColor: '#F3F4F6',
                        border: '1px solid #E5E7EB',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}>🔧 관리자</button>
                  </div>
                </div>

                <p style={{
                  textAlign: 'center',
                  fontSize: '14px',
                  color: '#9CA3AF',
                  margin: '24px 0 0 0'
                }}>
                  계정이 없으신가요?{' '}
                  <span
                    onClick={() => setScreen('signup')}
                    style={{ color: '#2563EB', fontWeight: 600, cursor: 'pointer' }}
                  >회원가입</span>
                </p>
              </div>
            )}

            {/* SIGNUP */}
            {showSignup && (
              <div style={{ padding: '40px' }}>
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>📝</div>
                  <h2 style={{
                    fontSize: '24px',
                    fontWeight: 700,
                    color: '#111827',
                    marginBottom: '8px',
                    letterSpacing: '-0.5px'
                  }}>회원가입</h2>
                  <p style={{ fontSize: '15px', color: '#6B7280', margin: 0 }}>아이틀아파트 입주민 계정을 생성합니다</p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                  <div>
                    <label style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#374151',
                      marginBottom: '7px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>이메일</label>
                    <input
                      type="email"
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      placeholder="이메일을 입력해 주세요"
                      style={{
                        width: '100%',
                        height: '50px',
                        border: '1.5px solid #E5E7EB',
                        borderRadius: '10px',
                        padding: '0 16px',
                        fontSize: '15px',
                        color: '#111827',
                        outline: 'none',
                        backgroundColor: '#F9FAFB'
                      }}
                    />
                  </div>

                  <div>
                    <label style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#374151',
                      marginBottom: '7px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>이름</label>
                    <input
                      type="text"
                      value={signupName}
                      onChange={(e) => setSignupName(e.target.value)}
                      placeholder="이름을 입력해 주세요"
                      style={{
                        width: '100%',
                        height: '50px',
                        border: '1.5px solid #E5E7EB',
                        borderRadius: '10px',
                        padding: '0 16px',
                        fontSize: '15px',
                        color: '#111827',
                        outline: 'none',
                        backgroundColor: '#F9FAFB'
                      }}
                    />
                  </div>

                  <div>
                    <label style={{
                      display: 'block',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#374151',
                      marginBottom: '7px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>비밀번호</label>
                    <input
                      type="password"
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      placeholder="8자 이상, 영문+숫자 조합"
                      style={{
                        width: '100%',
                        height: '50px',
                        border: '1.5px solid #E5E7EB',
                        borderRadius: '10px',
                        padding: '0 16px',
                        fontSize: '15px',
                        color: '#111827',
                        outline: 'none',
                        backgroundColor: '#F9FAFB'
                      }}
                    />
                  </div>

                  {formError && (
                    <div style={{
                      padding: '10px 14px',
                      backgroundColor: '#FEF2F2',
                      border: '1px solid #FECACA',
                      borderRadius: '8px',
                      marginBottom: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <span style={{ fontSize: '15px' }}>⚠️</span>
                      <span style={{ fontSize: '13px', color: '#DC2626' }}>{formError}</span>
                    </div>
                  )}
                  {state.error && (
                    <div style={{
                      padding: '10px 14px',
                      backgroundColor: '#FEF2F2',
                      border: '1px solid #FECACA',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <span style={{ fontSize: '15px' }}>⚠️</span>
                      <span style={{ fontSize: '13px', color: '#DC2626' }}>{state.error}</span>
                    </div>
                  )}

                  <button
                    onClick={() => doSignup()}
                    disabled={state.loading}
                    style={{
                      width: '100%',
                      height: '52px',
                      backgroundColor: state.loading ? '#93C5FD' : '#2563EB',
                      color: 'white',
                      border: 'none',
                      borderRadius: '12px',
                      fontSize: '16px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      letterSpacing: '-0.2px'
                    }}
                  >
                    {state.loading ? '가입 중...' : '회원가입'}
                  </button>

                  <p style={{
                    textAlign: 'center',
                    fontSize: '14px',
                    color: '#9CA3AF',
                    margin: '0'
                  }}>
                    이미 계정이 있으신가요?{' '}
                    <span
                      onClick={() => setScreen('login')}
                      style={{ color: '#2563EB', fontWeight: 600, cursor: 'pointer' }}
                    >로그인</span>
                  </p>
                </div>
              </div>
            )}

            {/* VERIFY UNIT */}
            {showVerify && (
              <div style={{ padding: '40px' }}>
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                  <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏢</div>
                  <h2 style={{
                    fontSize: '24px',
                    fontWeight: 700,
                    color: '#111827',
                    marginBottom: '8px',
                    letterSpacing: '-0.5px'
                  }}>동호수 인증</h2>
                  <p style={{ fontSize: '15px', color: '#6B7280', margin: 0 }}>거주 중인 동호수를 인증해 주세요</p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div>
                    <label style={{
                      display: 'block',
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#374151',
                      marginBottom: '8px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>동 선택</label>
                    <select
                      value={verifyBuilding}
                      onChange={(e) => setVerifyBuilding(e.target.value)}
                      style={{
                        width: '100%',
                        height: '50px',
                        border: '1.5px solid #E5E7EB',
                        borderRadius: '10px',
                        padding: '0 16px',
                        fontSize: '15px',
                        color: '#111827',
                        outline: 'none',
                        backgroundColor: '#F9FAFB',
                        cursor: 'pointer',
                        appearance: 'none',
                        WebkitAppearance: 'none'
                      }}
                    >
                      <option value="">동을 선택해 주세요</option>
                      <option value="A">A동</option>
                      <option value="B">B동</option>
                      <option value="C">C동</option>
                    </select>
                  </div>

                  <div>
                    <label style={{
                      display: 'block',
                      fontSize: '14px',
                      fontWeight: 600,
                      color: '#374151',
                      marginBottom: '8px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>호수 선택</label>
                    <select
                      value={verifyUnitNumber}
                      onChange={(e) => setVerifyUnitNumber(e.target.value)}
                      style={{
                        width: '100%',
                        height: '50px',
                        border: '1.5px solid #E5E7EB',
                        borderRadius: '10px',
                        padding: '0 16px',
                        fontSize: '15px',
                        color: '#111827',
                        outline: 'none',
                        backgroundColor: '#F9FAFB',
                        cursor: 'pointer',
                        appearance: 'none',
                        WebkitAppearance: 'none'
                      }}
                    >
                      <option value="">호수를 선택해 주세요</option>
                      <option>101호</option>
                      <option>102호</option>
                      <option>103호</option>
                      <option>201호</option>
                      <option>202호</option>
                      <option>203호</option>
                      <option>301호</option>
                      <option>302호</option>
                      <option>303호</option>
                      <option>401호</option>
                      <option>402호</option>
                      <option>403호</option>
                    </select>
                  </div>

                  {formError && (
                    <div style={{
                      padding: '10px 14px',
                      backgroundColor: '#FEF2F2',
                      border: '1px solid #FECACA',
                      borderRadius: '8px',
                      marginBottom: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <span style={{ fontSize: '15px' }}>⚠️</span>
                      <span style={{ fontSize: '13px', color: '#DC2626' }}>{formError}</span>
                    </div>
                  )}
                  {state.error && (
                    <div style={{
                      padding: '10px 14px',
                      backgroundColor: '#FEF2F2',
                      border: '1px solid #FECACA',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <span style={{ fontSize: '15px' }}>⚠️</span>
                      <span style={{ fontSize: '13px', color: '#DC2626' }}>{state.error}</span>
                    </div>
                  )}

                  <button
                    onClick={() => doVerifyUnit()}
                    disabled={state.loading}
                    style={{
                      width: '100%',
                      height: '52px',
                      backgroundColor: state.loading ? '#93C5FD' : '#2563EB',
                      color: 'white',
                      border: 'none',
                      borderRadius: '12px',
                      fontSize: '16px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      letterSpacing: '-0.2px'
                    }}
                  >
                    {state.loading ? '인증 중...' : '인증하기'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MAIN APP ── */}
      {state.user && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{
            backgroundColor: 'white',
            borderBottom: '1px solid #E5E7EB',
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div>
              <h1 style={{
                fontSize: '20px',
                fontWeight: 700,
                color: '#111827',
                margin: 0,
                letterSpacing: '-0.3px'
              }}>
                {screen === 'home' && '홈'}
                {screen === 'notices' && '공지사항'}
                {screen === 'noticeDetail' && '공지상세'}
                {screen === 'suggestions' && '건의사항'}
                {screen === 'suggestionDetail' && '건의상세'}
                {screen === 'parking' && '주차배정'}
                {screen === 'admin' && '관리자메뉴'}
                {screen === 'mypage' && '계정설정'}
              </h1>
            </div>
            <div style={{ fontSize: '13px', color: '#6B7280' }}>
              {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
            </div>
          </div>

          {/* Content Area - Placeholder */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
            <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
              {/* HOME SCREEN */}
              {screen === 'home' && (
                <div>
                  {/* Welcome Section */}
                  <div style={{
                    backgroundColor: 'white',
                    borderRadius: '12px',
                    padding: '24px',
                    marginBottom: '20px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                  }}>
                    <h2 style={{
                      fontSize: '20px',
                      fontWeight: 700,
                      color: '#111827',
                      marginBottom: '8px',
                      letterSpacing: '-0.3px'
                    }}>안녕하세요, {state.user?.email?.split('@')[0] || '입주민'}님</h2>
                    <p style={{ fontSize: '15px', color: '#6B7280', margin: 0 }}>
                      오늘도 아이틀아파트와 함께 편안한 하루를 보내세요
                    </p>
                  </div>

                  {/* Quick Actions */}
                  <div style={{ marginBottom: '20px' }}>
                    <h3 style={{
                      fontSize: '16px',
                      fontWeight: 600,
                      color: '#111827',
                      marginBottom: '16px'
                    }}>빠른 메뉴</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
                      <div
                        onClick={() => navigate('notices')}
                        style={{
                          backgroundColor: 'white',
                          borderRadius: '12px',
                          padding: '20px',
                          textAlign: 'center',
                          cursor: 'pointer',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                          transition: 'transform 0.2s'
                        }}
                      >
                        <div style={{ fontSize: '36px', marginBottom: '8px' }}>📢</div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>공지사항</div>
                      </div>
                      <div
                        onClick={() => navigate('suggestions')}
                        style={{
                          backgroundColor: 'white',
                          borderRadius: '12px',
                          padding: '20px',
                          textAlign: 'center',
                          cursor: 'pointer',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                          transition: 'transform 0.2s'
                        }}
                      >
                        <div style={{ fontSize: '36px', marginBottom: '8px' }}>💡</div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>건의사항</div>
                      </div>
                      <div
                        onClick={() => navigate('parking')}
                        style={{
                          backgroundColor: 'white',
                          borderRadius: '12px',
                          padding: '20px',
                          textAlign: 'center',
                          cursor: 'pointer',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                          transition: 'transform 0.2s'
                        }}
                      >
                        <div style={{ fontSize: '36px', marginBottom: '8px' }}>🚗</div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>주차배정</div>
                      </div>
                      <div
                        onClick={() => navigate('mypage')}
                        style={{
                          backgroundColor: 'white',
                          borderRadius: '12px',
                          padding: '20px',
                          textAlign: 'center',
                          cursor: 'pointer',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                          transition: 'transform 0.2s'
                        }}
                      >
                        <div style={{ fontSize: '36px', marginBottom: '8px' }}>👤</div>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>계정설정</div>
                      </div>
                    </div>
                  </div>

                  {/* Recent Notices */}
                  <div style={{ marginBottom: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <h3 style={{
                        fontSize: '16px',
                        fontWeight: 600,
                        color: '#111827',
                        margin: 0
                      }}>최근 공지</h3>
                      <span
                        onClick={() => navigate('notices')}
                        style={{ fontSize: '14px', color: '#2563EB', fontWeight: 600, cursor: 'pointer' }}
                      >더보기</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {NOTICES.slice(0, 3).map(notice => (
                        <div
                          key={notice.id}
                          style={{
                            backgroundColor: 'white',
                            borderRadius: '10px',
                            padding: '16px',
                            cursor: 'pointer',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                            borderLeft: `4px solid ${notice.category === '일반공지' ? '#3B82F6' : notice.category === '시설관리' ? '#F59E0B' : '#10B981'}`
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                            <span style={{
                              fontSize: '15px',
                              fontWeight: 600,
                              color: '#111827'
                            }}>{notice.title}</span>
                            <span style={{
                              fontSize: '12px',
                              color: '#6B7280',
                              fontWeight: 500
                            }}>{notice.date}</span>
                          </div>
                          <div style={{ fontSize: '13px', color: '#6B7280' }}>
                            {notice.content.substring(0, 60)}...
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
