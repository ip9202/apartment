"use client";

import { useState, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import type { Screen } from './demo-data';

/**
 * MobileApp - Mobile viewport component
 * ONLY renders login/signup/verify screens
 * For other screens, use TabletApp instead
 *
 * REQ-AUTH-INT-014: 하드코딩 제거 및 useAuth 연동
 * REQ-AUTH-INT-015: login 화면 API 연동
 * REQ-AUTH-INT-016: signup 화면 API 연동
 * REQ-AUTH-INT-017: verify-unit 화면 API 연동
 *
 * @MX:ANCHOR: [AUTO] 모바일 인증 화면의 단일 진입점 — fan_in >= 3 (메인 레이아웃)
 * @MX:REASON: 이 컴포넌트를 통해 모바일 인증 플로우가 제어되며, 변경 시 login/signup/verify 화면 전체에 영향.
 */
export default function MobileApp() {
  const { state, login, signup, verifyUnit, kakaoLogin } = useAuth();

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

  /**
   * 로그인 처리 (REQ-AUTH-INT-015)
   * useAuth.login 호출 → 성공 시 홈 화면 이동
   */
  const doLogin = useCallback(async (email: string, password: string) => {
    if (!email || !password) {
      return; // TODO: 에러 상태 추가
    }
    await login(email, password);

    // 로그인 성공 후 화면 전환 (useAuth 상태로 판단)
    if (state.user) {
      const isAdmin = state.user.role === 'ADMIN';
      setScreen(isAdmin ? 'admin' : 'home');
    }
  }, [login, state.user]);

  /**
   * 회원가입 처리 (REQ-AUTH-INT-016)
   */
  const doSignup = useCallback(async () => {
    if (!signupEmail || !signupPassword || !signupName) {
      return; // TODO: 에러 상태 추가
    }
    await signup(signupEmail, signupPassword, signupName);

    // 회원가입 성공 후 verify 화면 이동
    if (state.user) {
      setScreen('verify');
    }
  }, [signup, signupEmail, signupPassword, signupName, state.user]);

  /**
   * 동호수 인증 처리 (REQ-AUTH-INT-017)
   */
  const doVerifyUnit = useCallback(async () => {
    if (!verifyBuilding || !verifyUnitNumber) {
      return; // TODO: 에러 상태 추가
    }
    await verifyUnit(verifyBuilding, verifyUnitNumber);

    // 인증 성공 후 홈 화면 이동
    if (state.user?.verified) {
      setScreen('home');
    }
  }, [verifyUnit, verifyBuilding, verifyUnitNumber, state.user]);

  const goBack = useCallback(() => {
    if (screen === 'signup' || screen === 'verify') {
      setScreen('login');
    }
  }, [screen]);

  // Only render auth screens
  return (
    <div style={{
      minHeight: "100vh",
      backgroundColor: "#b8bcc8",
      display: "flex",
      justifyContent: "center",
      alignItems: "flex-start",
      padding: "32px 20px",
      fontFamily: "'Pretendard',-apple-system,system-ui,sans-serif",
      WebkitFontSmoothing: "antialiased"
    }}>
      <div style={{
        width: "390px",
        height: "844px",
        backgroundColor: "#F9FAFB",
        borderRadius: "44px",
        boxShadow: "0 50px 120px rgba(0,0,0,0.38),0 0 0 1px rgba(0,0,0,0.12),inset 0 0 0 1.5px rgba(255,255,255,0.4)",
        overflow: "hidden",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0
      }}>
        {/* Status bar */}
        <div style={{
          height: "44px",
          backgroundColor: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 28px",
          flexShrink: 0
        }}>
          <span style={{
            fontSize: "15px",
            fontWeight: 600,
            color: "#111827",
            letterSpacing: "-0.3px"
          }}>9:41</span>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
              <rect x="0" y="4" width="3" height="8" rx="1" fill="#111827"></rect>
              <rect x="4.5" y="2.5" width="3" height="9.5" rx="1" fill="#111827"></rect>
              <rect x="9" y="1" width="3" height="11" rx="1" fill="#111827"></rect>
              <rect x="13.5" y="0" width="3" height="12" rx="1" fill="#D1D5DB"></rect>
            </svg>
            <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
              <path d="M8 3C10.2 3 12.2 4 13.6 5.6L15 4.1C13.2 2.1 10.7 1 8 1C5.3 1 2.8 2.1 1 4.1L2.4 5.6C3.8 4 5.8 3 8 3Z" fill="#111827"></path>
              <path d="M8 5.5C9.5 5.5 10.8 6.2 11.8 7.2L13.2 5.7C11.8 4.3 9.9 3.5 8 3.5C6.1 3.5 4.2 4.3 2.8 5.7L4.2 7.2C5.2 6.2 6.5 5.5 8 5.5Z" fill="#111827"></path>
              <circle cx="8" cy="10" r="2" fill="#111827"></circle>
            </svg>
            <div style={{
              width: "25px",
              height: "12px",
              border: "1.5px solid #374151",
              borderRadius: "3px",
              padding: "1.5px",
              display: "flex"
            }}>
              <div style={{
                width: "75%",
                backgroundColor: "#111827",
                borderRadius: "1px"
              }}></div>
            </div>
          </div>
        </div>

        {/* AUTH SCREENS */}
        {!state.user && (
          <div style={{ flex: 1, overflowY: "auto", backgroundColor: "white" }}>

            {/* LOGIN */}
            {screen === 'login' && (
              <div style={{
                padding: "36px 28px 40px",
                animation: "fadeIn 0.3s ease"
              }}>
                <div style={{
                  textAlign: "center",
                  marginBottom: "44px",
                  paddingTop: "16px"
                }}>
                  <div style={{
                    width: "70px",
                    height: "70px",
                    background: "linear-gradient(135deg,#2563EB,#1D4ED8)",
                    borderRadius: "20px",
                    margin: "0 auto 16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 8px 24px rgba(37,99,235,0.38)"
                  }}>
                    <span style={{
                      color: "white",
                      fontSize: "30px",
                      fontWeight: 900,
                      letterSpacing: "-1px"
                    }}>아</span>
                  </div>
                  <h1 style={{
                    fontSize: "24px",
                    fontWeight: 900,
                    color: "#111827",
                    margin: "0 0 6px",
                    letterSpacing: "-0.8px"
                  }}>아이뜨락</h1>
                  <p style={{ fontSize: "13px", color: "#9CA3AF", margin: "0" }}>
                    서귀포 서홍동 아파트 커뮤니티
                  </p>
                </div>
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  marginBottom: "14px"
                }}>
                  <div>
                    <label style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#374151",
                      display: "block",
                      marginBottom: "7px",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px"
                    }}>이메일</label>
                    <input
                      type="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') doLogin(loginEmail, loginPassword);
                      }}
                      placeholder="이메일을 입력해 주세요"
                      style={{
                        width: "100%",
                        height: "50px",
                        border: "1.5px solid #E5E7EB",
                        borderRadius: "10px",
                        padding: "0 16px",
                        fontSize: "15px",
                        color: "#111827",
                        outline: "none",
                        backgroundColor: "#F9FAFB"
                      }}
                    />
                  </div>
                  <div>
                    <label style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#374151",
                      display: "block",
                      marginBottom: "7px",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px"
                    }}>비밀번호</label>
                    <input
                      type="password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') doLogin(loginEmail, loginPassword);
                      }}
                      placeholder="비밀번호를 입력해 주세요"
                      style={{
                        width: "100%",
                        height: "50px",
                        border: "1.5px solid #E5E7EB",
                        borderRadius: "10px",
                        padding: "0 16px",
                        fontSize: "15px",
                        color: "#111827",
                        outline: "none",
                        backgroundColor: "#F9FAFB"
                      }}
                    />
                  </div>
                </div>
                {state.error && (
                  <div style={{
                    padding: "10px 14px",
                    backgroundColor: "#FEF2F2",
                    borderRadius: "8px",
                    marginBottom: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px"
                  }}>
                    <span style={{ fontSize: "15px" }}>⚠️</span>
                    <span style={{ fontSize: "13px", color: "#DC2626" }}>{state.error}</span>
                  </div>
                )}
                <button
                  onClick={() => doLogin(loginEmail, loginPassword)}
                  style={{
                    width: "100%",
                    height: "52px",
                    backgroundColor: state.loading ? "#93C5FD" : "#2563EB",
                    color: "white",
                    border: "none",
                    borderRadius: "12px",
                    fontSize: "16px",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px",
                    marginBottom: "14px",
                    letterSpacing: "-0.2px"
                  }}
                >
                  {state.loading ? (
                    <span style={{
                      width: "18px",
                      height: "18px",
                      border: "2.5px solid rgba(255,255,255,0.3)",
                      borderTopColor: "white",
                      borderRadius: "50%",
                      display: "inline-block",
                      animation: "spin 0.7s linear infinite"
                    }}></span>
                  ) : "로그인"}
                </button>
                <p style={{
                  textAlign: "center",
                  fontSize: "14px",
                  color: "#9CA3AF",
                  margin: "0 0 28px"
                }}>
                  계정이 없으신가요?{" "}
                  <span
                    onClick={() => setScreen('signup')}
                    style={{ color: "#2563EB", fontWeight: 600, cursor: "pointer" }}
                  >회원가입</span>
                </p>
                {/* REQ-KAKAO-015: 카카오 소셜 로그인 진입 — 항상 활성화 */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  marginBottom: "14px"
                }}>
                  <div style={{ flex: 1, height: "1px", backgroundColor: "#F3F4F6" }}></div>
                  <span style={{
                    fontSize: "11px",
                    color: "#D1D5DB",
                    fontWeight: 600,
                    letterSpacing: "0.6px",
                    textTransform: "uppercase"
                  }}>소셜 로그인</span>
                  <div style={{ flex: 1, height: "1px", backgroundColor: "#F3F4F6" }}></div>
                </div>
                <button
                  onClick={kakaoLogin}
                  style={{
                    width: "100%",
                    height: "52px",
                    backgroundColor: "#FEE500",
                    color: "rgba(0,0,0,0.85)",
                    border: "none",
                    borderRadius: "12px",
                    fontSize: "15px",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "9px",
                    marginBottom: "16px",
                    letterSpacing: "-0.3px"
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="rgba(0,0,0,0.85)">
                    <path d="M12 3C6.48 3 2 6.92 2 11.75c0 2.99 1.71 5.63 4.31 7.27L5.2 22.38a.5.5 0 0 0 .74.55l4.38-2.94c.55.07 1.1.11 1.68.11 5.52 0 10-3.92 10-8.75C22 6.92 17.52 3 12 3z"></path>
                  </svg>
                  카카오로 시작하기
                </button>
              </div>
            )}

            {/* SIGNUP */}
            {screen === 'signup' && (
              <div style={{
                padding: "32px 24px",
                animation: "fadeIn 0.3s ease"
              }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  marginBottom: "28px"
                }}>
                  <div
                    onClick={goBack}
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "10px",
                      backgroundColor: "#F3F4F6",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      flexShrink: 0
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <path d="M12.5 15L7.5 10L12.5 5" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path>
                    </svg>
                  </div>
                  <h2 style={{
                    fontSize: "20px",
                    fontWeight: 900,
                    color: "#111827",
                    margin: "0",
                    letterSpacing: "-0.5px"
                  }}>회원가입</h2>
                </div>
                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px"
                }}>
                  <div>
                    <label style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#374151",
                      display: "block",
                      marginBottom: "7px",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px"
                    }}>이메일</label>
                    <input
                      type="email"
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                      placeholder="이메일을 입력해 주세요"
                      style={{
                        width: "100%",
                        height: "50px",
                        border: "1.5px solid #E5E7EB",
                        borderRadius: "10px",
                        padding: "0 16px",
                        fontSize: "15px",
                        color: "#111827",
                        outline: "none",
                        backgroundColor: "#F9FAFB"
                      }}
                    />
                  </div>
                  <div>
                    <label style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#374151",
                      display: "block",
                      marginBottom: "7px",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px"
                    }}>이름</label>
                    <input
                      type="text"
                      value={signupName}
                      onChange={(e) => setSignupName(e.target.value)}
                      placeholder="이름을 입력해 주세요"
                      style={{
                        width: "100%",
                        height: "50px",
                        border: "1.5px solid #E5E7EB",
                        borderRadius: "10px",
                        padding: "0 16px",
                        fontSize: "15px",
                        color: "#111827",
                        outline: "none",
                        backgroundColor: "#F9FAFB"
                      }}
                    />
                  </div>
                  <div>
                    <label style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#374151",
                      display: "block",
                      marginBottom: "7px",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px"
                    }}>비밀번호</label>
                    <input
                      type="password"
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      placeholder="8자 이상, 영문+숫자 조합"
                      style={{
                        width: "100%",
                        height: "50px",
                        border: "1.5px solid #E5E7EB",
                        borderRadius: "10px",
                        padding: "0 16px",
                        fontSize: "15px",
                        color: "#111827",
                        outline: "none",
                        backgroundColor: "#F9FAFB"
                      }}
                    />
                  </div>
                  <div style={{
                    padding: "14px",
                    backgroundColor: "#F9FAFB",
                    borderRadius: "10px",
                    border: "1px solid #E5E7EB"
                  }}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      marginBottom: "10px"
                    }}>
                      <div style={{
                        width: "20px",
                        height: "20px",
                        border: "2px solid #2563EB",
                        borderRadius: "5px",
                        backgroundColor: "#2563EB",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0
                      }}>
                        <span style={{ color: "white", fontSize: "11px", fontWeight: 900 }}>✓</span>
                      </div>
                      <span style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>
                        전체 동의
                      </span>
                    </div>
                    <div style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "9px",
                      paddingLeft: "4px"
                    }}>
                      <div style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}>
                        <span style={{ fontSize: "13px", color: "#6B7280" }}>[필수] 이용약관</span>
                        <span style={{ fontSize: "12px", color: "#2563EB", fontWeight: 600, cursor: "pointer" }}>
                          보기 ›
                        </span>
                      </div>
                      <div style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}>
                        <span style={{ fontSize: "13px", color: "#6B7280" }}>[필수] 개인정보 처리방침</span>
                        <span style={{ fontSize: "12px", color: "#2563EB", fontWeight: 600, cursor: "pointer" }}>
                          보기 ›
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => doSignup()}
                    disabled={state.loading}
                    style={{
                      width: "100%",
                      height: "52px",
                      backgroundColor: state.loading ? "#93C5FD" : "#2563EB",
                      color: "white",
                      border: "none",
                      borderRadius: "12px",
                      fontSize: "16px",
                      fontWeight: 700,
                      cursor: "pointer",
                      letterSpacing: "-0.2px"
                    }}
                  >{state.loading ? '가입 중...' : '회원가입'}</button>
                  <p style={{
                    textAlign: "center",
                    fontSize: "14px",
                    color: "#9CA3AF",
                    margin: "0"
                  }}>
                    이미 계정이 있으신가요?{" "}
                    <span
                      onClick={() => setScreen('login')}
                      style={{ color: "#2563EB", fontWeight: 600, cursor: "pointer" }}
                    >로그인</span>
                  </p>
                </div>
              </div>
            )}

            {/* VERIFY */}
            {screen === 'verify' && (
              <div style={{
                animation: "fadeIn 0.3s ease"
              }}>
                <div style={{
                  height: "56px",
                  display: "flex",
                  alignItems: "center",
                  padding: "0 16px",
                  gap: "4px",
                  borderBottom: "1px solid #F3F4F6"
                }}>
                  <div
                    onClick={goBack}
                    style={{
                      width: "40px",
                      height: "40px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      borderRadius: "10px"
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <path d="M12.5 15L7.5 10L12.5 5" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path>
                    </svg>
                  </div>
                  <span style={{
                    fontSize: "17px",
                    fontWeight: 800,
                    color: "#111827",
                    letterSpacing: "-0.4px"
                  }}>동/호수 인증</span>
                </div>
                <div style={{ padding: "32px 24px" }}>
                  <div style={{
                    textAlign: "center",
                    marginBottom: "32px"
                  }}>
                    <div style={{ fontSize: "52px", marginBottom: "16px" }}>🏠</div>
                    <h2 style={{
                      fontSize: "20px",
                      fontWeight: 800,
                      color: "#111827",
                      margin: "0 0 10px",
                      letterSpacing: "-0.4px"
                    }}>거주 중인 동/호수를 인증해 주세요</h2>
                    <p style={{ fontSize: "14px", color: "#6B7280", margin: "0", lineHeight: "1.6" }}>
                      입주민 자격 확인을 위한 1회성 인증입니다
                    </p>
                  </div>
                  <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "14px",
                    marginBottom: "24px"
                  }}>
                    <div>
                      <label style={{
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#374151",
                        display: "block",
                        marginBottom: "7px",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px"
                      }}>동 선택</label>
                      <select
                        value={verifyBuilding}
                        onChange={(e) => setVerifyBuilding(e.target.value)}
                        style={{
                          width: "100%",
                          height: "50px",
                          border: "1.5px solid #E5E7EB",
                          borderRadius: "10px",
                          padding: "0 16px",
                          fontSize: "15px",
                          color: "#111827",
                          outline: "none",
                          backgroundColor: "#F9FAFB",
                          cursor: "pointer",
                          appearance: "none",
                          WebkitAppearance: "none"
                        }}
                      >
                        <option value="">동을 선택해 주세요</option>
                        <option value="A">A동</option>
                        <option value="B">B동</option>
                      </select>
                    </div>
                    <div>
                      <label style={{
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#374151",
                        display: "block",
                        marginBottom: "7px",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px"
                      }}>호수 선택</label>
                      <select
                        value={verifyUnitNumber}
                        onChange={(e) => setVerifyUnitNumber(e.target.value)}
                        style={{
                          width: "100%",
                          height: "50px",
                          border: "1.5px solid #E5E7EB",
                          borderRadius: "10px",
                          padding: "0 16px",
                          fontSize: "15px",
                          color: "#111827",
                          outline: "none",
                          backgroundColor: "#F9FAFB",
                          cursor: "pointer",
                          appearance: "none",
                          WebkitAppearance: "none"
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
                  </div>
                  <button
                    onClick={() => doVerifyUnit()}
                    disabled={state.loading}
                    style={{
                      width: "100%",
                      height: "52px",
                      backgroundColor: state.loading ? "#93C5FD" : "#2563EB",
                      color: "white",
                      border: "none",
                      borderRadius: "12px",
                      fontSize: "16px",
                      fontWeight: 700,
                      cursor: "pointer",
                      letterSpacing: "-0.2px"
                    }}
                  >{state.loading ? '인증 중...' : '인증하기'}</button>
                </div>
              </div>
            )}

          </div>
        )}

        {/* If logged in, show message - should use TabletApp instead */}
        {state.user && (
          <div style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "40px",
            textAlign: "center"
          }}>
            <div>
              <div style={{ fontSize: "48px", marginBottom: "16px" }}>✅</div>
              <h3 style={{
                fontSize: "18px",
                fontWeight: 700,
                color: "#111827",
                marginBottom: "8px"
              }}>로그인 완료</h3>
              <p style={{ fontSize: "14px", color: "#6B7280", margin: "0 0 16px" }}>
                MobileApp은 인증 화면만 지원합니다.<br/>
                앱을 사용하려면 TabletApp으로 전환됩니다.
              </p>
              <button
                onClick={() => {
                  setScreen('home');
                }}
                style={{
                  padding: "12px 24px",
                  backgroundColor: "#2563EB",
                  color: "white",
                  border: "none",
                  borderRadius: "10px",
                  fontSize: "14px",
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >TabletApp으로 계속하기</button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
