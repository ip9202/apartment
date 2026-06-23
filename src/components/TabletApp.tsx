"use client";

import { useState, useCallback } from 'react';
import { NOTICES, SUGGESTIONS, getTimelineColors, getTabStyles, getCatTabStyles, type Screen } from './demo-data';

export default function TabletApp() {
  // State
  const [screen, setScreen] = useState<Screen>('login');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userRole, setUserRole] = useState<'RESIDENT' | 'ADMIN'>('RESIDENT');

  // Login form state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Notice filter state
  const [noticeFilter, setNoticeFilterState] = useState('전체');
  const [selectedNoticeId, setSelectedNoticeId] = useState<number | null>(null);

  // Suggestion filter state
  const [suggestionFilter, setSuggestionFilterState] = useState('전체');
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<number | null>(null);

  // New suggestion form state
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('시설');
  const [newPublic, setNewPublic] = useState(false);
  const [newSubmitted, setNewSubmitted] = useState(false);

  // Parking state
  const [parkingApplied, setParkingApplied] = useState(false);

  // Computed values
  const isAdmin = userRole === 'ADMIN';

  const navHomeActive = screen === 'home';
  const navNoticeActive = screen === 'notices' || screen === 'noticeDetail';
  const navSuggestActive = ['suggestions', 'newSuggestion', 'suggestionDetail'].includes(screen) && !isAdmin;
  const navParkingActive = screen === 'parking';
  const navMyActive = isAdmin ? screen === 'admin' : screen === 'mypage';

  const nAll = getTabStyles(noticeFilter === '전체');
  const nGen = getTabStyles(noticeFilter === '일반공지');
  const nFac = getTabStyles(noticeFilter === '시설관리');
  const nLife = getTabStyles(noticeFilter === '생활안내');

  const sAll = getTabStyles(suggestionFilter === '전체');
  const s1 = getTabStyles(suggestionFilter === '접수');
  const s2 = getTabStyles(suggestionFilter === '처리중');
  const s3 = getTabStyles(suggestionFilter === '완료');

  const c1 = getCatTabStyles(newCategory === '시설');
  const c2 = getCatTabStyles(newCategory === '환경');
  const c3 = getCatTabStyles(newCategory === '안전');
  const c4 = getCatTabStyles(newCategory === '편의');
  const c5 = getCatTabStyles(newCategory === '기타');

  const filteredNotices = noticeFilter === '전체' ? NOTICES : NOTICES.filter(n => n.category === noticeFilter);
  const filteredSuggestions = suggestionFilter === '전체' ? SUGGESTIONS : SUGGESTIONS.filter(s => s.status === suggestionFilter);
  const selectedNotice = selectedNoticeId ? NOTICES.find(n => n.id === selectedNoticeId) : null;
  const selectedSuggestion = selectedSuggestionId ? SUGGESTIONS.find(s => s.id === selectedSuggestionId) : null;

  // Navigation handlers
  const navigate = useCallback((newScreen: Screen) => {
    setScreen(newScreen);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const doLogin = useCallback((email: string, password: string) => {
    if (!email || !password) {
      setLoginError('이메일과 비밀번호를 입력해 주세요.');
      return;
    }
    setLoginLoading(true);
    setLoginError('');
    setTimeout(() => {
      const admin = email.includes('admin') || email.startsWith('manager');
      setUserRole(admin ? 'ADMIN' : 'RESIDENT');
      setIsLoggedIn(true);
      setScreen(admin ? 'admin' : 'home');
      setLoginLoading(false);
    }, 800);
  }, []);

  const handleSetNoticeFilter = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const filter = (e.currentTarget as HTMLDivElement).dataset.filter || '전체';
    setNoticeFilterState(filter);
  }, []);

  const handleSetSuggestionFilter = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const filter = (e.currentTarget as HTMLDivElement).dataset.filter || '전체';
    setSuggestionFilterState(filter);
  }, []);

  const handleOpenNotice = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const id = parseInt((e.currentTarget as HTMLDivElement).dataset.id || '0');
    setSelectedNoticeId(id);
    setScreen('noticeDetail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleOpenSuggestion = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const id = parseInt((e.currentTarget as HTMLDivElement).dataset.id || '0');
    setSelectedSuggestionId(id);
    setScreen('suggestionDetail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleSetNewCategory = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const cat = (e.currentTarget as HTMLDivElement).dataset.cat || '시설';
    setNewCategory(cat);
  }, []);

  const handleSubmitSuggestion = useCallback(() => {
    if (!newTitle.trim() || !newContent.trim()) return;
    setNewSubmitted(true);
    setTimeout(() => {
      setNewSubmitted(false);
      setNewTitle('');
      setNewContent('');
      setScreen('suggestions');
    }, 1800);
  }, [newTitle, newContent]);

  const handleGoBack = useCallback(() => {
    const map: Record<string, Screen> = {
      noticeDetail: 'notices',
      suggestionDetail: isAdmin ? 'admin' : 'suggestions',
      newSuggestion: 'suggestions',
      signup: 'login',
      verify: 'login',
    };
    navigate(map[screen] || 'home');
  }, [screen, navigate, isAdmin]);

  return (
    <>
      {/* Phone frame container */}
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

          {/* ── AUTH SCREENS ── */}
          {!isLoggedIn && (
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
                  {loginError && (
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
                      <span style={{ fontSize: "13px", color: "#DC2626" }}>{loginError}</span>
                    </div>
                  )}
                  <button
                    onClick={() => doLogin(loginEmail, loginPassword)}
                    style={{
                      width: "100%",
                      height: "52px",
                      backgroundColor: loginLoading ? "#93C5FD" : "#2563EB",
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
                    {loginLoading ? (
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
                    onClick={() => doLogin('kakao@user.com', 'kakao')}
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
                    }}>체험하기</span>
                    <div style={{ flex: 1, height: "1px", backgroundColor: "#F3F4F6" }}></div>
                  </div>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button
                      onClick={() => doLogin('resident@aitteulak.com', 'test1234')}
                      style={{
                        flex: 1,
                        height: "46px",
                        backgroundColor: "#EFF6FF",
                        color: "#1D4ED8",
                        border: "1.5px solid #BFDBFE",
                        borderRadius: "10px",
                        fontSize: "13px",
                        fontWeight: 700,
                        cursor: "pointer"
                      }}
                    >👤 입주민</button>
                    <button
                      onClick={() => doLogin('admin@aitteulak.com', 'test1234')}
                      style={{
                        flex: 1,
                        height: "46px",
                        backgroundColor: "#F0FDF4",
                        color: "#15803D",
                        border: "1.5px solid #BBF7D0",
                        borderRadius: "10px",
                        fontSize: "13px",
                        fontWeight: 700,
                        cursor: "pointer"
                      }}
                    >🔧 관리자</button>
                  </div>
                </div>
              )}

              {/* SIGNUP */}
              {screen === 'signup' && (
                <div style={{ animation: "fadeIn 0.3s ease" }}>
                  <div style={{
                    height: "56px",
                    display: "flex",
                    alignItems: "center",
                    padding: "0 16px",
                    gap: "4px",
                    borderBottom: "1px solid #F3F4F6"
                  }}>
                    <div
                      onClick={handleGoBack}
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
                    }}>회원가입</span>
                  </div>
                  <div style={{
                    padding: "24px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "14px"
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
                    <div>
                      <label style={{
                        fontSize: "12px",
                        fontWeight: 700,
                        color: "#374151",
                        display: "block",
                        marginBottom: "7px",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px"
                      }}>비밀번호 확인</label>
                      <input
                        type="password"
                        placeholder="비밀번호를 다시 입력해 주세요"
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
                      padding: "16px",
                      backgroundColor: "#F9FAFB",
                      borderRadius: "10px",
                      border: "1px solid #E5E7EB"
                    }}>
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        marginBottom: "12px"
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
                        <span style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>전체 동의</span>
                      </div>
                      <div style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                        paddingLeft: "4px"
                      }}>
                        <div style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center"
                        }}>
                          <span style={{ fontSize: "13px", color: "#6B7280" }}>[필수] 이용약관</span>
                          <span style={{ fontSize: "12px", color: "#2563EB", fontWeight: 600, cursor: "pointer" }}>보기 ›</span>
                        </div>
                        <div style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center"
                        }}>
                          <span style={{ fontSize: "13px", color: "#6B7280" }}>[필수] 개인정보 처리방침</span>
                          <span style={{ fontSize: "12px", color: "#2563EB", fontWeight: 600, cursor: "pointer" }}>보기 ›</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => setScreen('verify')}
                      style={{
                        width: "100%",
                        height: "52px",
                        backgroundColor: "#2563EB",
                        color: "white",
                        border: "none",
                        borderRadius: "12px",
                        fontSize: "16px",
                        fontWeight: 700,
                        cursor: "pointer",
                        letterSpacing: "-0.2px"
                      }}
                    >회원가입</button>
                    <p style={{ textAlign: "center", fontSize: "14px", color: "#9CA3AF", margin: "0" }}>
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
                <div style={{ animation: "fadeIn 0.3s ease" }}>
                  <div style={{
                    height: "56px",
                    display: "flex",
                    alignItems: "center",
                    padding: "0 16px",
                    gap: "4px",
                    borderBottom: "1px solid #F3F4F6"
                  }}>
                    <div
                      onClick={handleGoBack}
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
                    <div style={{ textAlign: "center", marginBottom: "32px" }}>
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
                        <select style={{
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
                        }}>
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
                        <select style={{
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
                        }}>
                          <option value="">호수를 선택해 주세요</option>
                          <option>101호</option><option>102호</option><option>103호</option>
                          <option>201호</option><option>202호</option><option>203호</option>
                          <option>301호</option><option>302호</option><option>303호</option>
                          <option>401호</option><option>402호</option><option>403호</option>
                        </select>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setIsLoggedIn(true);
                        setScreen('home');
                        setUserRole('RESIDENT');
                      }}
                      style={{
                        width: "100%",
                        height: "52px",
                        backgroundColor: "#2563EB",
                        color: "white",
                        border: "none",
                        borderRadius: "12px",
                        fontSize: "16px",
                        fontWeight: 700,
                        cursor: "pointer",
                        letterSpacing: "-0.2px"
                      }}
                    >인증하기</button>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* ── MAIN APP ── */}
          {isLoggedIn && (
            <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>

              {/* Scrollable content */}
              <div style={{
                width: "100%",
                height: "100%",
                overflowY: "auto",
                WebkitOverflowScrolling: "touch",
                paddingBottom: "72px"
              }}>

                {/* HOME */}
                {screen === 'home' && (
                  <div style={{ animation: "fadeIn 0.25s ease" }}>
                    <div style={{
                      height: "56px",
                      backgroundColor: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0 20px",
                      borderBottom: "1px solid #F3F4F6",
                      position: "sticky",
                      top: 0,
                      zIndex: 5
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div style={{
                          width: "34px",
                          height: "34px",
                          background: "linear-gradient(135deg,#2563EB,#1D4ED8)",
                          borderRadius: "9px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center"
                        }}>
                          <span style={{ color: "white", fontSize: "15px", fontWeight: 900 }}>아</span>
                        </div>
                        <span style={{
                          fontSize: "19px",
                          fontWeight: 900,
                          color: "#111827",
                          letterSpacing: "-0.7px"
                        }}>아이뜨락</span>
                      </div>
                      <div style={{
                        width: "38px",
                        height: "38px",
                        backgroundColor: "#F9FAFB",
                        borderRadius: "10px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        position: "relative"
                      }}>
                        <span style={{ fontSize: "20px" }}>🔔</span>
                        <div style={{
                          position: "absolute",
                          top: "8px",
                          right: "8px",
                          width: "7px",
                          height: "7px",
                          backgroundColor: "#DC2626",
                          borderRadius: "50%",
                          border: "1.5px solid white"
                        }}></div>
                      </div>
                    </div>

                    {/* Pinned notices */}
                    <div style={{
                      backgroundColor: "white",
                      padding: "16px 20px 8px",
                      borderBottom: "8px solid #F3F4F6"
                    }}>
                      <div style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        color: "#9CA3AF",
                        textTransform: "uppercase",
                        letterSpacing: "0.6px",
                        marginBottom: "10px"
                      }}>📌 고정 공지</div>
                      {NOTICES.filter(n => n.pinned).map(notice => (
                        <div
                          key={notice.id}
                          onClick={handleOpenNotice}
                          data-id={notice.id}
                          style={{
                            padding: "12px 14px",
                            backgroundColor: "#EFF6FF",
                            borderRadius: "10px",
                            marginBottom: "8px",
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            cursor: "pointer",
                            border: "1px solid #DBEAFE"
                          }}
                        >
                          <span style={{ fontSize: "14px", flexShrink: 0 }}>📢</span>
                          <span style={{
                            fontSize: "14px",
                            fontWeight: 500,
                            color: "#1D4ED8",
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap"
                          }}>{notice.title}</span>
                          <span style={{
                            fontSize: "11px",
                            color: "#93C5FD",
                            flexShrink: 0,
                            whiteSpace: "nowrap"
                          }}>{notice.date}</span>
                        </div>
                      ))}
                    </div>

                    {/* Parking CTA */}
                    <div style={{
                      padding: "16px 20px",
                      backgroundColor: "white",
                      borderBottom: "8px solid #F3F4F6"
                    }}>
                      <div
                        onClick={() => setScreen('parking')}
                        style={{
                          padding: "18px",
                          background: "linear-gradient(135deg,#1E3A8A,#2563EB)",
                          borderRadius: "16px",
                          cursor: "pointer",
                          overflow: "hidden",
                          position: "relative"
                        }}
                      >
                        <div style={{
                          position: "absolute",
                          right: "-10px",
                          top: "-10px",
                          fontSize: "90px",
                          opacity: 0.1,
                          userSelect: "none",
                          pointerEvents: "none"
                        }}>🚗</div>
                        <div style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          color: "#93C5FD",
                          textTransform: "uppercase",
                          letterSpacing: "0.8px",
                          marginBottom: "5px"
                        }}>🎯 진행 중인 추첨</div>
                        <div style={{
                          fontSize: "17px",
                          fontWeight: 900,
                          color: "white",
                          marginBottom: "4px",
                          letterSpacing: "-0.5px"
                        }}>2026년 7월 주차 추첨</div>
                        <div style={{ fontSize: "13px", color: "#BFDBFE", marginBottom: "14px" }}>
                          신청 6.21 ~ 6.25 · 현재 47명 신청
                        </div>
                        <div style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          backgroundColor: "white",
                          color: "#1D4ED8",
                          fontSize: "13px",
                          fontWeight: 700,
                          padding: "7px 14px",
                          borderRadius: "8px"
                        }}>신청하기 →</div>
                      </div>
                    </div>

                    {/* Recent notices */}
                    <div style={{ backgroundColor: "white", paddingBottom: "8px" }}>
                      <div style={{
                        padding: "18px 20px 12px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}>
                        <span style={{
                          fontSize: "16px",
                          fontWeight: 900,
                          color: "#111827",
                          letterSpacing: "-0.5px"
                        }}>최신 공지</span>
                        <span
                          onClick={() => setScreen('notices')}
                          style={{ fontSize: "13px", color: "#2563EB", fontWeight: 600, cursor: "pointer" }}
                        >전체 보기 ›</span>
                      </div>
                      {NOTICES.slice(0, 5).map(notice => (
                        <div
                          key={notice.id}
                          onClick={handleOpenNotice}
                          data-id={notice.id}
                          style={{
                            padding: "14px 20px",
                            borderBottom: "1px solid #F9FAFB",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px"
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: "14px",
                              fontWeight: 500,
                              color: "#111827",
                              marginBottom: "5px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              letterSpacing: "-0.2px"
                            }}>{notice.title}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                              <span style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                color: "#2563EB",
                                backgroundColor: "#EFF6FF",
                                padding: "2px 7px",
                                borderRadius: "4px"
                              }}>{notice.category}</span>
                              <span style={{ fontSize: "11px", color: "#C4C9D4" }}>{notice.date}</span>
                            </div>
                          </div>
                          <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
                            <path d="M1 11L6 6L1 1" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
                          </svg>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* NOTICE LIST */}
                {screen === 'notices' && (
                  <div style={{ animation: "fadeIn 0.25s ease" }}>
                    <div style={{
                      height: "56px",
                      backgroundColor: "white",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 20px",
                      borderBottom: "1px solid #F3F4F6",
                      position: "sticky",
                      top: 0,
                      zIndex: 5
                    }}>
                      <span style={{
                        fontSize: "19px",
                        fontWeight: 900,
                        color: "#111827",
                        letterSpacing: "-0.5px"
                      }}>공지사항</span>
                    </div>
                    <div style={{
                      backgroundColor: "white",
                      padding: "10px 16px",
                      borderBottom: "1px solid #F3F4F6",
                      display: "flex",
                      gap: "6px",
                      overflowX: "auto"
                    }}>
                      <div
                        data-filter="전체"
                        onClick={handleSetNoticeFilter}
                        style={{
                          flexShrink: 0,
                          height: "33px",
                          padding: "0 14px",
                          borderRadius: "16px",
                          display: "flex",
                          alignItems: "center",
                          fontSize: "13px",
                          fontWeight: nAll.weight,
                          cursor: "pointer",
                          backgroundColor: nAll.bg,
                          color: nAll.color,
                          border: `1.5px solid ${nAll.border}`
                        }}
                      >전체</div>
                      <div
                        data-filter="일반공지"
                        onClick={handleSetNoticeFilter}
                        style={{
                          flexShrink: 0,
                          height: "33px",
                          padding: "0 14px",
                          borderRadius: "16px",
                          display: "flex",
                          alignItems: "center",
                          fontSize: "13px",
                          fontWeight: nGen.weight,
                          cursor: "pointer",
                          backgroundColor: nGen.bg,
                          color: nGen.color,
                          border: `1.5px solid ${nGen.border}`
                        }}
                      >일반공지</div>
                      <div
                        data-filter="시설관리"
                        onClick={handleSetNoticeFilter}
                        style={{
                          flexShrink: 0,
                          height: "33px",
                          padding: "0 14px",
                          borderRadius: "16px",
                          display: "flex",
                          alignItems: "center",
                          fontSize: "13px",
                          fontWeight: nFac.weight,
                          cursor: "pointer",
                          backgroundColor: nFac.bg,
                          color: nFac.color,
                          border: `1.5px solid ${nFac.border}`
                        }}
                      >시설관리</div>
                      <div
                        data-filter="생활안내"
                        onClick={handleSetNoticeFilter}
                        style={{
                          flexShrink: 0,
                          height: "33px",
                          padding: "0 14px",
                          borderRadius: "16px",
                          display: "flex",
                          alignItems: "center",
                          fontSize: "13px",
                          fontWeight: nLife.weight,
                          cursor: "pointer",
                          backgroundColor: nLife.bg,
                          color: nLife.color,
                          border: `1.5px solid ${nLife.border}`
                        }}
                      >생활안내</div>
                    </div>
                    <div style={{ backgroundColor: "white" }}>
                      {filteredNotices.map(notice => (
                        <div
                          key={notice.id}
                          onClick={handleOpenNotice}
                          data-id={notice.id}
                          style={{
                            padding: "16px 20px",
                            borderBottom: "1px solid #F9FAFB",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px"
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: "15px",
                              fontWeight: 500,
                              color: "#111827",
                              marginBottom: "6px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              letterSpacing: "-0.2px"
                            }}>{notice.title}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                              <span style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                color: "#2563EB",
                                backgroundColor: "#EFF6FF",
                                padding: "2px 7px",
                                borderRadius: "4px"
                              }}>{notice.category}</span>
                              <span style={{ fontSize: "11px", color: "#C4C9D4" }}>{notice.date}</span>
                            </div>
                          </div>
                          <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
                            <path d="M1 11L6 6L1 1" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
                          </svg>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* NOTICE DETAIL */}
                {screen === 'noticeDetail' && selectedNotice && (
                  <div style={{ animation: "fadeIn 0.25s ease" }}>
                    <div style={{
                      height: "56px",
                      backgroundColor: "white",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 16px",
                      gap: "2px",
                      borderBottom: "1px solid #F3F4F6",
                      position: "sticky",
                      top: 0,
                      zIndex: 5
                    }}>
                      <div
                        onClick={handleGoBack}
                        style={{
                          width: "40px",
                          height: "40px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          borderRadius: "10px",
                          flexShrink: 0
                        }}
                      >
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                          <path d="M12.5 15L7.5 10L12.5 5" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                      </div>
                      <span style={{
                        fontSize: "17px",
                        fontWeight: 700,
                        color: "#111827",
                        letterSpacing: "-0.3px"
                      }}>공지 상세</span>
                    </div>
                    <div style={{
                      padding: "24px 20px 80px",
                      backgroundColor: "white"
                    }}>
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "7px",
                        marginBottom: "14px",
                        flexWrap: "wrap"
                      }}>
                        <span style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "#2563EB",
                          backgroundColor: "#EFF6FF",
                          padding: "4px 10px",
                          borderRadius: "6px"
                        }}>{selectedNotice.category}</span>
                        {selectedNotice.pinned && (
                          <span style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "#DC2626",
                            backgroundColor: "#FEF2F2",
                            padding: "4px 10px",
                            borderRadius: "6px"
                          }}>📌 고정</span>
                        )}
                      </div>
                      <h2 style={{
                        fontSize: "20px",
                        fontWeight: 900,
                        color: "#111827",
                        margin: "0 0 12px",
                        lineHeight: 1.45,
                        letterSpacing: "-0.5px"
                      }}>{selectedNotice.title}</h2>
                      <div style={{
                        fontSize: "13px",
                        color: "#9CA3AF",
                        marginBottom: "24px",
                        paddingBottom: "20px",
                        borderBottom: "1px solid #F3F4F6",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px"
                      }}>
                        <span style={{ fontSize: "15px" }}>🏢</span>
                        <span>관리사무소</span>
                        <span>·</span>
                        <span>{selectedNotice.date}</span>
                      </div>
                      <div style={{
                        fontSize: "15px",
                        color: "#374151",
                        lineHeight: 1.8,
                        whiteSpace: "pre-line",
                        letterSpacing: "-0.1px"
                      }}>{selectedNotice.content}</div>
                    </div>
                  </div>
                )}

                {/* SUGGESTION LIST */}
                {screen === 'suggestions' && (
                  <div style={{ animation: "fadeIn 0.25s ease" }}>
                    <div style={{
                      height: "56px",
                      backgroundColor: "white",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 20px",
                      borderBottom: "1px solid #F3F4F6",
                      position: "sticky",
                      top: 0,
                      zIndex: 5
                    }}>
                      <span style={{
                        fontSize: "19px",
                        fontWeight: 900,
                        color: "#111827",
                        letterSpacing: "-0.5px"
                      }}>건의사항</span>
                    </div>
                    <div style={{
                      backgroundColor: "white",
                      padding: "10px 16px",
                      borderBottom: "1px solid #F3F4F6",
                      display: "flex",
                      gap: "6px"
                    }}>
                      <div
                        data-filter="전체"
                        onClick={handleSetSuggestionFilter}
                        style={{
                          flexShrink: 0,
                          height: "33px",
                          padding: "0 14px",
                          borderRadius: "16px",
                          display: "flex",
                          alignItems: "center",
                          fontSize: "13px",
                          fontWeight: sAll.weight,
                          cursor: "pointer",
                          backgroundColor: sAll.bg,
                          color: sAll.color,
                          border: `1.5px solid ${sAll.border}`
                        }}
                      >전체</div>
                      <div
                        data-filter="접수"
                        onClick={handleSetSuggestionFilter}
                        style={{
                          flexShrink: 0,
                          height: "33px",
                          padding: "0 14px",
                          borderRadius: "16px",
                          display: "flex",
                          alignItems: "center",
                          fontSize: "13px",
                          fontWeight: s1.weight,
                          cursor: "pointer",
                          backgroundColor: s1.bg,
                          color: s1.color,
                          border: `1.5px solid ${s1.border}`
                        }}
                      >접수</div>
                      <div
                        data-filter="처리중"
                        onClick={handleSetSuggestionFilter}
                        style={{
                          flexShrink: 0,
                          height: "33px",
                          padding: "0 14px",
                          borderRadius: "16px",
                          display: "flex",
                          alignItems: "center",
                          fontSize: "13px",
                          fontWeight: s2.weight,
                          cursor: "pointer",
                          backgroundColor: s2.bg,
                          color: s2.color,
                          border: `1.5px solid ${s2.border}`
                        }}
                      >처리중</div>
                      <div
                        data-filter="완료"
                        onClick={handleSetSuggestionFilter}
                        style={{
                          flexShrink: 0,
                          height: "33px",
                          padding: "0 14px",
                          borderRadius: "16px",
                          display: "flex",
                          alignItems: "center",
                          fontSize: "13px",
                          fontWeight: s3.weight,
                          cursor: "pointer",
                          backgroundColor: s3.bg,
                          color: s3.color,
                          border: `1.5px solid ${s3.border}`
                        }}
                      >완료</div>
                    </div>
                    <div style={{
                      padding: "12px",
                      backgroundColor: "#F9FAFB",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      paddingBottom: "100px"
                    }}>
                      {filteredSuggestions.map(item => (
                        <div
                          key={item.id}
                          onClick={handleOpenSuggestion}
                          data-id={item.id}
                          style={{
                            backgroundColor: "white",
                            borderRadius: "12px",
                            padding: "16px",
                            cursor: "pointer",
                            boxShadow: "0 1px 4px rgba(0,0,0,0.07)"
                          }}
                        >
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "8px",
                            marginBottom: "8px"
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{
                                fontSize: "11px",
                                fontWeight: 700,
                                padding: "3px 9px",
                                borderRadius: "5px",
                                backgroundColor: item.statusBg,
                                color: item.statusColor
                              }}>{item.status}</span>
                              <span style={{
                                fontSize: "11px",
                                color: "#9CA3AF",
                                backgroundColor: "#F3F4F6",
                                padding: "3px 8px",
                                borderRadius: "5px"
                              }}>{item.category}</span>
                            </div>
                            {item.isPublic && (
                              <span style={{
                                fontSize: "11px",
                                color: "#9CA3AF",
                                backgroundColor: "#F3F4F6",
                                padding: "2px 7px",
                                borderRadius: "4px"
                              }}>공개</span>
                            )}
                          </div>
                          <div style={{
                            fontSize: "14px",
                            fontWeight: 600,
                            color: "#111827",
                            marginBottom: "6px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            letterSpacing: "-0.2px"
                          }}>{item.title}</div>
                          <div style={{ fontSize: "12px", color: "#C4C9D4" }}>
                            {item.unit} · {item.date}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* NEW SUGGESTION */}
                {screen === 'newSuggestion' && (
                  <div style={{ animation: "fadeIn 0.25s ease" }}>
                    <div style={{
                      height: "56px",
                      backgroundColor: "white",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 16px",
                      gap: "2px",
                      borderBottom: "1px solid #F3F4F6",
                      position: "sticky",
                      top: 0,
                      zIndex: 5
                    }}>
                      <div
                        onClick={handleGoBack}
                        style={{
                          width: "40px",
                          height: "40px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          borderRadius: "10px",
                          flexShrink: 0
                        }}
                      >
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                          <path d="M12.5 15L7.5 10L12.5 5" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                      </div>
                      <span style={{
                        fontSize: "17px",
                        fontWeight: 700,
                        color: "#111827",
                        letterSpacing: "-0.3px"
                      }}>건의 등록</span>
                    </div>
                    <div style={{
                      padding: "16px",
                      backgroundColor: "#F9FAFB",
                      paddingBottom: "80px"
                    }}>
                      {newSubmitted && (
                        <div style={{
                          backgroundColor: "#F0FDF4",
                          border: "1.5px solid #86EFAC",
                          borderRadius: "12px",
                          padding: "16px 20px",
                          marginBottom: "14px",
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          animation: "slideUp 0.3s ease"
                        }}>
                          <span style={{ fontSize: "24px" }}>✅</span>
                          <div>
                            <div style={{ fontSize: "14px", fontWeight: 700, color: "#15803D", marginBottom: "1px" }}>
                              등록 완료!
                            </div>
                            <div style={{ fontSize: "12px", color: "#16A34A" }}>
                              건의사항이 등록되었습니다.
                            </div>
                          </div>
                        </div>
                      )}
                      <div style={{
                        backgroundColor: "white",
                        borderRadius: "14px",
                        padding: "20px",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.07)"
                      }}>
                        <div style={{ marginBottom: "20px" }}>
                          <label style={{
                            fontSize: "12px",
                            fontWeight: 700,
                            color: "#374151",
                            display: "block",
                            marginBottom: "10px",
                            textTransform: "uppercase",
                            letterSpacing: "0.5px"
                          }}>카테고리</label>
                          <div style={{ display: "flex", gap: "7px", flexWrap: "wrap" }}>
                            <div
                              data-cat="시설"
                              onClick={handleSetNewCategory}
                              style={{
                                height: "34px",
                                padding: "0 14px",
                                borderRadius: "17px",
                                display: "flex",
                                alignItems: "center",
                                fontSize: "13px",
                                fontWeight: c1.weight,
                                cursor: "pointer",
                                backgroundColor: c1.bg,
                                color: c1.color,
                                border: `1.5px solid ${c1.border}`
                              }}
                            >시설</div>
                            <div
                              data-cat="환경"
                              onClick={handleSetNewCategory}
                              style={{
                                height: "34px",
                                padding: "0 14px",
                                borderRadius: "17px",
                                display: "flex",
                                alignItems: "center",
                                fontSize: "13px",
                                fontWeight: c2.weight,
                                cursor: "pointer",
                                backgroundColor: c2.bg,
                                color: c2.color,
                                border: `1.5px solid ${c2.border}`
                              }}
                            >환경</div>
                            <div
                              data-cat="안전"
                              onClick={handleSetNewCategory}
                              style={{
                                height: "34px",
                                padding: "0 14px",
                                borderRadius: "17px",
                                display: "flex",
                                alignItems: "center",
                                fontSize: "13px",
                                fontWeight: c3.weight,
                                cursor: "pointer",
                                backgroundColor: c3.bg,
                                color: c3.color,
                                border: `1.5px solid ${c3.border}`
                              }}
                            >안전</div>
                            <div
                              data-cat="편의"
                              onClick={handleSetNewCategory}
                              style={{
                                height: "34px",
                                padding: "0 14px",
                                borderRadius: "17px",
                                display: "flex",
                                alignItems: "center",
                                fontSize: "13px",
                                fontWeight: c4.weight,
                                cursor: "pointer",
                                backgroundColor: c4.bg,
                                color: c4.color,
                                border: `1.5px solid ${c4.border}`
                              }}
                            >편의</div>
                            <div
                              data-cat="기타"
                              onClick={handleSetNewCategory}
                              style={{
                                height: "34px",
                                padding: "0 14px",
                                borderRadius: "17px",
                                display: "flex",
                                alignItems: "center",
                                fontSize: "13px",
                                fontWeight: c5.weight,
                                cursor: "pointer",
                                backgroundColor: c5.bg,
                                color: c5.color,
                                border: `1.5px solid ${c5.border}`
                              }}
                            >기타</div>
                          </div>
                        </div>
                        <div style={{ marginBottom: "14px" }}>
                          <label style={{
                            fontSize: "12px",
                            fontWeight: 700,
                            color: "#374151",
                            display: "block",
                            marginBottom: "7px",
                            textTransform: "uppercase",
                            letterSpacing: "0.5px"
                          }}>제목</label>
                          <input
                            type="text"
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            placeholder="제목을 입력해 주세요 (최대 100자)"
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
                        <div style={{ marginBottom: "14px" }}>
                          <label style={{
                            fontSize: "12px",
                            fontWeight: 700,
                            color: "#374151",
                            display: "block",
                            marginBottom: "7px",
                            textTransform: "uppercase",
                            letterSpacing: "0.5px"
                          }}>내용</label>
                          <textarea
                            value={newContent}
                            onChange={(e) => setNewContent(e.target.value)}
                            placeholder="불편하신 점이나 개선이 필요한 내용을 자유롭게 작성해 주세요"
                            style={{
                              width: "100%",
                              height: "110px",
                              border: "1.5px solid #E5E7EB",
                              borderRadius: "10px",
                              padding: "12px 16px",
                              fontSize: "15px",
                              color: "#111827",
                              outline: "none",
                              backgroundColor: "#F9FAFB",
                              resize: "none",
                              lineHeight: "1.6"
                            }}
                          />
                        </div>
                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          paddingTop: "14px",
                          borderTop: "1px solid #F3F4F6"
                        }}>
                          <div>
                            <div style={{ fontSize: "14px", fontWeight: 600, color: "#374151", marginBottom: "2px" }}>
                              공개 여부
                            </div>
                            <div style={{ fontSize: "12px", color: "#9CA3AF" }}>
                              공개 시 모든 입주민이 열람합니다
                            </div>
                          </div>
                          <div
                            onClick={() => setNewPublic(!newPublic)}
                            style={{
                              width: "48px",
                              height: "28px",
                              borderRadius: "14px",
                              cursor: "pointer",
                              position: "relative",
                              backgroundColor: newPublic ? "#2563EB" : "#E5E7EB",
                              transition: "background 0.2s",
                              flexShrink: 0
                            }}
                          >
                            <div style={{
                              position: "absolute",
                              top: "3px",
                              left: newPublic ? "23px" : "3px",
                              width: "22px",
                              height: "22px",
                              backgroundColor: "white",
                              borderRadius: "11px",
                              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                              transition: "left 0.2s"
                            }}></div>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={handleSubmitSuggestion}
                        style={{
                          width: "100%",
                          height: "52px",
                          backgroundColor: "#2563EB",
                          color: "white",
                          border: "none",
                          borderRadius: "12px",
                          fontSize: "16px",
                          fontWeight: 700,
                          cursor: "pointer",
                          marginTop: "14px",
                          letterSpacing: "-0.2px"
                        }}
                      >등록하기</button>
                    </div>
                  </div>
                )}

                {/* SUGGESTION DETAIL */}
                {screen === 'suggestionDetail' && selectedSuggestion && (
                  <div style={{ animation: "fadeIn 0.25s ease" }}>
                    <div style={{
                      height: "56px",
                      backgroundColor: "white",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 16px",
                      gap: "2px",
                      borderBottom: "1px solid #F3F4F6",
                      position: "sticky",
                      top: 0,
                      zIndex: 5
                    }}>
                      <div
                        onClick={handleGoBack}
                        style={{
                          width: "40px",
                          height: "40px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          borderRadius: "10px",
                          flexShrink: 0
                        }}
                      >
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                          <path d="M12.5 15L7.5 10L12.5 5" stroke="#111827" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                      </div>
                      <span style={{
                        fontSize: "17px",
                        fontWeight: 700,
                        color: "#111827",
                        letterSpacing: "-0.3px"
                      }}>건의 상세</span>
                    </div>
                    <div style={{
                      padding: "16px",
                      backgroundColor: "#F9FAFB",
                      paddingBottom: "80px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px"
                    }}>
                      {/* Content card */}
                      <div style={{
                        backgroundColor: "white",
                        borderRadius: "14px",
                        padding: "20px",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.07)"
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "12px" }}>
                          <span style={{
                            fontSize: "12px",
                            fontWeight: 700,
                            padding: "4px 10px",
                            borderRadius: "6px",
                            backgroundColor: selectedSuggestion.statusBg,
                            color: selectedSuggestion.statusColor
                          }}>{selectedSuggestion.status}</span>
                          <span style={{
                            fontSize: "12px",
                            color: "#9CA3AF",
                            backgroundColor: "#F3F4F6",
                            padding: "3px 8px",
                            borderRadius: "5px"
                          }}>{selectedSuggestion.category}</span>
                        </div>
                        <h2 style={{
                          fontSize: "18px",
                          fontWeight: 800,
                          color: "#111827",
                          margin: "0 0 10px",
                          lineHeight: 1.45,
                          letterSpacing: "-0.4px"
                        }}>{selectedSuggestion.title}</h2>
                        <div style={{
                          fontSize: "13px",
                          color: "#9CA3AF",
                          marginBottom: "16px",
                          paddingBottom: "16px",
                          borderBottom: "1px solid #F3F4F6"
                        }}>
                          {selectedSuggestion.unit} · {selectedSuggestion.date}
                        </div>
                        <p style={{
                          fontSize: "14px",
                          color: "#374151",
                          lineHeight: 1.75,
                          margin: 0
                        }}>{selectedSuggestion.content}</p>
                      </div>

                      {/* Timeline */}
                      {(() => {
                        const timeline = getTimelineColors(selectedSuggestion.step);
                        return (
                          <div style={{
                            backgroundColor: "white",
                            borderRadius: "14px",
                            padding: "20px",
                            boxShadow: "0 1px 4px rgba(0,0,0,0.07)"
                          }}>
                            <div style={{
                              fontSize: "13px",
                              fontWeight: 700,
                              color: "#374151",
                              marginBottom: "18px",
                              textTransform: "uppercase",
                              letterSpacing: "0.3px"
                            }}>처리 현황</div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                                <div style={{
                                  width: "32px",
                                  height: "32px",
                                  borderRadius: "50%",
                                  backgroundColor: timeline.step0Bg,
                                  border: `2px solid ${timeline.step0Border}`,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center"
                                }}>
                                  <span style={{
                                    fontSize: "13px",
                                    color: timeline.step0Color,
                                    fontWeight: 700
                                  }}>✓</span>
                                </div>
                                <span style={{
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  color: timeline.step0LabelColor
                                }}>접수</span>
                              </div>
                              <div style={{
                                flex: 1,
                                height: "2px",
                                backgroundColor: timeline.line1Bg,
                                margin: "0 4px",
                                marginBottom: "18px"
                              }}></div>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                                <div style={{
                                  width: "32px",
                                  height: "32px",
                                  borderRadius: "50%",
                                  backgroundColor: timeline.step1Bg,
                                  border: `2px solid ${timeline.step1Border}`,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center"
                                }}>
                                  <span style={{
                                    fontSize: "13px",
                                    color: timeline.step1Color,
                                    fontWeight: 700
                                  }}>✓</span>
                                </div>
                                <span style={{
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  color: timeline.step1LabelColor
                                }}>처리중</span>
                              </div>
                              <div style={{
                                flex: 1,
                                height: "2px",
                                backgroundColor: timeline.line2Bg,
                                margin: "0 4px",
                                marginBottom: "18px"
                              }}></div>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                                <div style={{
                                  width: "32px",
                                  height: "32px",
                                  borderRadius: "50%",
                                  backgroundColor: timeline.step2Bg,
                                  border: `2px solid ${timeline.step2Border}`,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center"
                                }}>
                                  <span style={{
                                    fontSize: "13px",
                                    color: timeline.step2Color,
                                    fontWeight: 700
                                  }}>✓</span>
                                </div>
                                <span style={{
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  color: timeline.step2LabelColor
                                }}>완료</span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Reply */}
                      {selectedSuggestion.hasReply && (
                        <div style={{
                          backgroundColor: "white",
                          borderRadius: "14px",
                          padding: "20px",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.07)"
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                            <div style={{
                              width: "30px",
                              height: "30px",
                              backgroundColor: "#EFF6FF",
                              borderRadius: "8px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0
                            }}>
                              <span style={{ fontSize: "15px" }}>🏢</span>
                            </div>
                            <div>
                              <div style={{ fontSize: "13px", fontWeight: 700, color: "#1D4ED8", marginBottom: "1px" }}>
                                관리사무소
                              </div>
                              <div style={{ fontSize: "11px", color: "#9CA3AF" }}>
                                {selectedSuggestion.replyDate}
                              </div>
                            </div>
                          </div>
                          <p style={{
                            fontSize: "14px",
                            color: "#374151",
                            lineHeight: 1.75,
                            margin: 0,
                            padding: "14px",
                            backgroundColor: "#F0F9FF",
                            borderRadius: "8px",
                            borderLeft: "3px solid #2563EB"
                          }}>{selectedSuggestion.reply}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* PARKING */}
                {screen === 'parking' && (
                  <div style={{ animation: "fadeIn 0.25s ease" }}>
                    <div style={{
                      height: "56px",
                      backgroundColor: "white",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 20px",
                      borderBottom: "1px solid #F3F4F6",
                      position: "sticky",
                      top: 0,
                      zIndex: 5
                    }}>
                      <span style={{
                        fontSize: "19px",
                        fontWeight: 900,
                        color: "#111827",
                        letterSpacing: "-0.5px"
                      }}>주차 추첨</span>
                    </div>
                    <div style={{
                      padding: "16px",
                      backgroundColor: "#F9FAFB",
                      paddingBottom: "80px"
                    }}>
                      <div style={{
                        backgroundColor: "white",
                        borderRadius: "16px",
                        overflow: "hidden",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                        marginBottom: "16px"
                      }}>
                        <div style={{
                          background: "linear-gradient(135deg,#1E3A8A,#2563EB)",
                          padding: "20px"
                        }}>
                          <div style={{
                            fontSize: "11px",
                            color: "#93C5FD",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.8px",
                            marginBottom: "5px"
                          }}>진행 중인 추첨</div>
                          <div style={{
                            fontSize: "18px",
                            fontWeight: 900,
                            color: "white",
                            marginBottom: "4px",
                            letterSpacing: "-0.5px"
                          }}>2026년 7월 지정 주차</div>
                          <div style={{ fontSize: "13px", color: "#BFDBFE" }}>
                            신청 기간: 6.21(토) ~ 6.25(수)
                          </div>
                        </div>
                        <div style={{
                          padding: "20px",
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: "16px",
                          borderBottom: "1px solid #F3F4F6"
                        }}>
                          <div>
                            <div style={{
                              fontSize: "11px",
                              color: "#9CA3AF",
                              marginBottom: "4px",
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.3px"
                            }}>추첨 일시</div>
                            <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>
                              6.26(목) 자동 추첨
                            </div>
                          </div>
                          <div>
                            <div style={{
                              fontSize: "11px",
                              color: "#9CA3AF",
                              marginBottom: "4px",
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.3px"
                            }}>신청 인원</div>
                            <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>
                              47명
                            </div>
                          </div>
                          <div>
                            <div style={{
                              fontSize: "11px",
                              color: "#9CA3AF",
                              marginBottom: "4px",
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.3px"
                            }}>총 구역 수</div>
                            <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>
                              30구역
                            </div>
                          </div>
                          <div>
                            <div style={{
                              fontSize: "11px",
                              color: "#9CA3AF",
                              marginBottom: "4px",
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.3px"
                            }}>대상 구역</div>
                            <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>
                              A·B구역
                            </div>
                          </div>
                        </div>
                        <div style={{ padding: "20px" }}>
                          {parkingApplied && (
                            <div style={{
                              backgroundColor: "#F0FDF4",
                              border: "1.5px solid #86EFAC",
                              borderRadius: "10px",
                              padding: "12px 16px",
                              marginBottom: "14px",
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                              animation: "slideUp 0.3s ease"
                            }}>
                              <span style={{ fontSize: "18px" }}>✅</span>
                              <span style={{ fontSize: "14px", fontWeight: 600, color: "#15803D" }}>
                                추첨 신청이 완료되었습니다.
                              </span>
                            </div>
                          )}
                          <button
                            onClick={() => setParkingApplied(!parkingApplied)}
                            style={{
                              width: "100%",
                              height: "52px",
                              backgroundColor: parkingApplied ? "#DC2626" : "#2563EB",
                              color: "white",
                              border: "none",
                              borderRadius: "12px",
                              fontSize: "16px",
                              fontWeight: 700,
                              cursor: "pointer",
                              letterSpacing: "-0.2px"
                            }}
                          >{parkingApplied ? '신청 취소' : '신청하기'}</button>
                        </div>
                      </div>
                      <div style={{
                        fontSize: "13px",
                        fontWeight: 700,
                        color: "#374151",
                        marginBottom: "10px",
                        textTransform: "uppercase",
                        letterSpacing: "0.3px"
                      }}>지난 추첨 이력</div>
                      <div style={{
                        backgroundColor: "white",
                        borderRadius: "12px",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.07)"
                      }}>
                        <div style={{
                          padding: "16px 20px",
                          borderBottom: "1px solid #F9FAFB",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center"
                        }}>
                          <div>
                            <div style={{ fontSize: "14px", fontWeight: 600, color: "#111827", marginBottom: "2px" }}>
                              2026년 6월 주차 추첨
                            </div>
                            <div style={{ fontSize: "12px", color: "#9CA3AF" }}>
                              신청 39명 · 당첨 30명
                            </div>
                          </div>
                          <span style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "#16A34A",
                            backgroundColor: "#DCFCE7",
                            padding: "4px 10px",
                            borderRadius: "6px"
                          }}>완료</span>
                        </div>
                        <div style={{
                          padding: "16px 20px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center"
                        }}>
                          <div>
                            <div style={{ fontSize: "14px", fontWeight: 600, color: "#111827", marginBottom: "2px" }}>
                              2026년 5월 주차 추첨
                            </div>
                            <div style={{ fontSize: "12px", color: "#9CA3AF" }}>
                              신청 43명 · 당첨 30명
                            </div>
                          </div>
                          <span style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "#16A34A",
                            backgroundColor: "#DCFCE7",
                            padding: "4px 10px",
                            borderRadius: "6px"
                          }}>완료</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* MY PAGE */}
                {screen === 'mypage' && (
                  <div style={{ animation: "fadeIn 0.25s ease" }}>
                    <div style={{
                      height: "56px",
                      backgroundColor: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0 20px",
                      borderBottom: "1px solid #F3F4F6",
                      position: "sticky",
                      top: 0,
                      zIndex: 5
                    }}>
                      <span style={{
                        fontSize: "19px",
                        fontWeight: 900,
                        color: "#111827",
                        letterSpacing: "-0.5px"
                      }}>마이페이지</span>
                    </div>
                    <div style={{
                      padding: "16px",
                      backgroundColor: "#F9FAFB",
                      paddingBottom: "80px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px"
                    }}>
                      <div style={{
                        backgroundColor: "white",
                        borderRadius: "16px",
                        padding: "20px",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.07)"
                      }}>
                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "14px",
                          marginBottom: "20px",
                          paddingBottom: "18px",
                          borderBottom: "1px solid #F3F4F6"
                        }}>
                          <div style={{
                            width: "52px",
                            height: "52px",
                            borderRadius: "26px",
                            backgroundColor: "#EFF6FF",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "22px",
                            flexShrink: 0
                          }}>👤</div>
                          <div>
                            <div style={{
                              fontSize: "15px",
                              fontWeight: 700,
                              color: "#111827",
                              marginBottom: "5px",
                              letterSpacing: "-0.3px"
                            }}>resident@aitteulak.com</div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <span style={{
                                fontSize: "11px",
                                fontWeight: 700,
                                color: "white",
                                backgroundColor: "#2563EB",
                                padding: "3px 8px",
                                borderRadius: "4px"
                              }}>입주민</span>
                              <span style={{ fontSize: "13px", color: "#374151", fontWeight: 600 }}>
                                A동 201호
                              </span>
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                          <div style={{
                            textAlign: "center",
                            padding: "14px",
                            backgroundColor: "#F9FAFB",
                            borderRadius: "10px"
                          }}>
                            <div style={{
                              fontSize: "24px",
                              fontWeight: 900,
                              color: "#2563EB",
                              marginBottom: "4px",
                              letterSpacing: "-0.5px"
                            }}>3</div>
                            <div style={{ fontSize: "12px", color: "#6B7280", fontWeight: 500 }}>
                              작성한 건의
                            </div>
                          </div>
                          <div style={{
                            textAlign: "center",
                            padding: "14px",
                            backgroundColor: "#F9FAFB",
                            borderRadius: "10px"
                          }}>
                            <div style={{
                              fontSize: "24px",
                              fontWeight: 900,
                              color: "#16A34A",
                              marginBottom: "4px",
                              letterSpacing: "-0.5px"
                            }}>1</div>
                            <div style={{ fontSize: "12px", color: "#6B7280", fontWeight: 500 }}>
                              완료된 건의
                            </div>
                          </div>
                        </div>
                      </div>
                      <div style={{
                        backgroundColor: "white",
                        borderRadius: "16px",
                        overflow: "hidden",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.07)"
                      }}>
                        <div
                          onClick={() => setScreen('suggestions')}
                          style={{
                            padding: "16px 20px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            cursor: "pointer",
                            borderBottom: "1px solid #F9FAFB"
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                            <span style={{ fontSize: "20px" }}>📝</span>
                            <span style={{ fontSize: "15px", fontWeight: 500, color: "#111827" }}>내 건의사항</span>
                          </div>
                          <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
                            <path d="M1 11L6 6L1 1" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
                          </svg>
                        </div>
                        <div style={{
                          padding: "16px 20px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          cursor: "pointer",
                          borderBottom: "1px solid #F9FAFB"
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                            <span style={{ fontSize: "20px" }}>🔔</span>
                            <span style={{ fontSize: "15px", fontWeight: 500, color: "#111827" }}>알림 설정</span>
                          </div>
                          <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
                            <path d="M1 11L6 6L1 1" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
                          </svg>
                        </div>
                        <div style={{
                          padding: "16px 20px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          cursor: "pointer"
                        }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                            <span style={{ fontSize: "20px" }}>🔒</span>
                            <span style={{ fontSize: "15px", fontWeight: 500, color: "#111827" }}>비밀번호 변경</span>
                          </div>
                          <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
                            <path d="M1 11L6 6L1 1" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
                          </svg>
                        </div>
                      </div>
                      <div style={{
                        backgroundColor: "white",
                        borderRadius: "16px",
                        overflow: "hidden",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.07)"
                      }}>
                        <div style={{
                          padding: "16px 20px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          cursor: "pointer",
                          borderBottom: "1px solid #F9FAFB"
                        }}>
                          <span style={{ fontSize: "14px", color: "#374151" }}>이용약관</span>
                          <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
                            <path d="M1 11L6 6L1 1" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
                          </svg>
                        </div>
                        <div style={{
                          padding: "16px 20px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          cursor: "pointer"
                        }}>
                          <span style={{ fontSize: "14px", color: "#374151" }}>개인정보 처리방침</span>
                          <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
                            <path d="M1 11L6 6L1 1" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path>
                          </svg>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setIsLoggedIn(false);
                          setScreen('login');
                          setLoginEmail('');
                          setLoginPassword('');
                        }}
                        style={{
                          width: "100%",
                          height: "48px",
                          backgroundColor: "white",
                          color: "#DC2626",
                          border: "1.5px solid #FEE2E2",
                          borderRadius: "12px",
                          fontSize: "15px",
                          fontWeight: 600,
                          cursor: "pointer"
                        }}
                      >로그아웃</button>
                    </div>
                  </div>
                )}

                {/* ADMIN DASHBOARD */}
                {screen === 'admin' && (
                  <div style={{ animation: "fadeIn 0.25s ease" }}>
                    <div style={{
                      height: "56px",
                      backgroundColor: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "0 20px",
                      borderBottom: "1px solid #F3F4F6",
                      position: "sticky",
                      top: 0,
                      zIndex: 5
                    }}>
                      <div>
                        <div style={{
                          fontSize: "11px",
                          color: "#9CA3AF",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.4px",
                          marginBottom: "1px"
                        }}>관리사무소</div>
                        <span style={{
                          fontSize: "17px",
                          fontWeight: 900,
                          color: "#111827",
                          letterSpacing: "-0.5px"
                        }}>관리 대시보드</span>
                      </div>
                      <div style={{
                        width: "36px",
                        height: "36px",
                        backgroundColor: "#EFF6FF",
                        borderRadius: "10px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                      }}>
                        <span style={{ fontSize: "18px" }}>🔧</span>
                      </div>
                    </div>
                    <div style={{
                      padding: "14px",
                      backgroundColor: "#F9FAFB",
                      paddingBottom: "80px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "12px"
                    }}>
                      {/* Stats */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div style={{
                          backgroundColor: "white",
                          borderRadius: "14px",
                          padding: "16px",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.07)"
                        }}>
                          <div style={{
                            fontSize: "11px",
                            color: "#9CA3AF",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.3px",
                            marginBottom: "8px"
                          }}>미처리 건의</div>
                          <div style={{
                            fontSize: "30px",
                            fontWeight: 900,
                            color: "#D97706",
                            marginBottom: "3px",
                            letterSpacing: "-1px"
                          }}>3</div>
                          <div style={{ fontSize: "12px", color: "#9CA3AF" }}>처리 대기 중</div>
                        </div>
                        <div style={{
                          backgroundColor: "white",
                          borderRadius: "14px",
                          padding: "16px",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.07)"
                        }}>
                          <div style={{
                            fontSize: "11px",
                            color: "#9CA3AF",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.3px",
                            marginBottom: "8px"
                          }}>미인증 회원</div>
                          <div style={{
                            fontSize: "30px",
                            fontWeight: 900,
                            color: "#DC2626",
                            marginBottom: "3px",
                            letterSpacing: "-1px"
                          }}>5</div>
                          <div style={{ fontSize: "12px", color: "#9CA3AF" }}>동/호수 미인증</div>
                        </div>
                        <div style={{
                          backgroundColor: "white",
                          borderRadius: "14px",
                          padding: "16px",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.07)"
                        }}>
                          <div style={{
                            fontSize: "11px",
                            color: "#9CA3AF",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.3px",
                            marginBottom: "8px"
                          }}>진행 추첨</div>
                          <div style={{
                            fontSize: "30px",
                            fontWeight: 900,
                            color: "#2563EB",
                            marginBottom: "3px",
                            letterSpacing: "-1px"
                          }}>1</div>
                          <div style={{ fontSize: "12px", color: "#9CA3AF" }}>신청자 47명</div>
                        </div>
                        <div style={{
                          backgroundColor: "white",
                          borderRadius: "14px",
                          padding: "16px",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.07)"
                        }}>
                          <div style={{
                            fontSize: "11px",
                            color: "#9CA3AF",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.3px",
                            marginBottom: "8px"
                          }}>오늘 공지</div>
                          <div style={{
                            fontSize: "30px",
                            fontWeight: 900,
                            color: "#16A34A",
                            marginBottom: "3px",
                            letterSpacing: "-1px"
                          }}>1</div>
                          <div style={{ fontSize: "12px", color: "#9CA3AF" }}>등록 완료</div>
                        </div>
                      </div>

                      {/* Quick actions */}
                      <div style={{
                        backgroundColor: "white",
                        borderRadius: "14px",
                        padding: "16px 20px",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.07)"
                      }}>
                        <div style={{
                          fontSize: "13px",
                          fontWeight: 700,
                          color: "#374151",
                          marginBottom: "12px",
                          textTransform: "uppercase",
                          letterSpacing: "0.3px"
                        }}>빠른 관리</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                          <div style={{
                            padding: "14px",
                            backgroundColor: "#EFF6FF",
                            borderRadius: "10px",
                            textAlign: "center",
                            cursor: "pointer"
                          }}>
                            <div style={{ fontSize: "22px", marginBottom: "4px" }}>📢</div>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: "#1D4ED8" }}>
                              공지 등록
                            </div>
                          </div>
                          <div
                            onClick={() => setScreen('suggestions')}
                            style={{
                              padding: "14px",
                              backgroundColor: "#FEF3C7",
                              borderRadius: "10px",
                              textAlign: "center",
                              cursor: "pointer"
                            }}
                          >
                            <div style={{ fontSize: "22px", marginBottom: "4px" }}>📝</div>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: "#92400E" }}>
                              건의 관리
                            </div>
                          </div>
                          <div
                            onClick={() => setScreen('parking')}
                            style={{
                              padding: "14px",
                              backgroundColor: "#F0FDF4",
                              borderRadius: "10px",
                              textAlign: "center",
                              cursor: "pointer"
                            }}
                          >
                            <div style={{ fontSize: "22px", marginBottom: "4px" }}>🚗</div>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: "#166534" }}>
                              추첨 관리
                            </div>
                          </div>
                          <div style={{
                            padding: "14px",
                            backgroundColor: "#F3F4F6",
                            borderRadius: "10px",
                            textAlign: "center",
                            cursor: "pointer"
                          }}>
                            <div style={{ fontSize: "22px", marginBottom: "4px" }}>👥</div>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: "#374151" }}>
                              회원 관리
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Recent suggestions */}
                      <div style={{
                        backgroundColor: "white",
                        borderRadius: "14px",
                        overflow: "hidden",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.07)"
                      }}>
                        <div style={{
                          padding: "14px 20px",
                          borderBottom: "1px solid #F3F4F6",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center"
                        }}>
                          <span style={{
                            fontSize: "13px",
                            fontWeight: 700,
                            color: "#374151",
                            textTransform: "uppercase",
                            letterSpacing: "0.3px"
                          }}>최근 건의</span>
                          <span
                            onClick={() => setScreen('suggestions')}
                            style={{ fontSize: "12px", color: "#2563EB", fontWeight: 600, cursor: "pointer" }}
                          >전체 보기 ›</span>
                        </div>
                        {SUGGESTIONS.map(item => (
                          <div
                            key={item.id}
                            onClick={handleOpenSuggestion}
                            data-id={item.id}
                            style={{
                              padding: "13px 20px",
                              borderBottom: "1px solid #F9FAFB",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: "12px"
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{
                                fontSize: "14px",
                                fontWeight: 500,
                                color: "#111827",
                                marginBottom: "3px",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                letterSpacing: "-0.2px"
                              }}>{item.title}</div>
                              <div style={{ fontSize: "11px", color: "#9CA3AF" }}>
                                {item.unit} · {item.date}
                              </div>
                            </div>
                            <span style={{
                              fontSize: "11px",
                              fontWeight: 700,
                              padding: "3px 8px",
                              borderRadius: "5px",
                              flexShrink: 0,
                              backgroundColor: item.statusBg,
                              color: item.statusColor
                            }}>{item.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

              </div>

              {/* FAB */}
              {screen === 'suggestions' && !isAdmin && (
                <div
                  onClick={() => setScreen('newSuggestion')}
                  style={{
                    position: "absolute",
                    bottom: "84px",
                    right: "16px",
                    width: "56px",
                    height: "56px",
                    backgroundColor: "#2563EB",
                    borderRadius: "28px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    boxShadow: "0 4px 18px rgba(37,99,235,0.45)",
                    zIndex: 20
                  }}
                >
                  <span style={{
                    color: "white",
                    fontSize: "26px",
                    fontWeight: 300,
                    lineHeight: 1
                  }}>+</span>
                </div>
              )}

              {/* Bottom navigation */}
              <div style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: "72px",
                backgroundColor: "white",
                borderTop: "1px solid #E5E7EB",
                display: "flex",
                alignItems: "stretch",
                zIndex: 10
              }}>
                <div
                  onClick={() => setScreen('home')}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "3px",
                    cursor: "pointer",
                    paddingBottom: "4px"
                  }}
                >
                  <span style={{ fontSize: "22px", opacity: navHomeActive ? 1 : 0.4 }}>🏠</span>
                  <span style={{
                    fontSize: "10px",
                    fontWeight: navHomeActive ? 700 : 400,
                    color: navHomeActive ? "#2563EB" : "#9CA3AF"
                  }}>홈</span>
                </div>
                <div
                  onClick={() => setScreen('notices')}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "3px",
                    cursor: "pointer",
                    paddingBottom: "4px"
                  }}
                >
                  <span style={{ fontSize: "22px", opacity: navNoticeActive ? 1 : 0.4 }}>📢</span>
                  <span style={{
                    fontSize: "10px",
                    fontWeight: navNoticeActive ? 700 : 400,
                    color: navNoticeActive ? "#2563EB" : "#9CA3AF"
                  }}>공지</span>
                </div>
                <div
                  onClick={() => setScreen('suggestions')}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "3px",
                    cursor: "pointer",
                    paddingBottom: "4px"
                  }}
                >
                  <span style={{ fontSize: "22px", opacity: navSuggestActive ? 1 : 0.4 }}>📝</span>
                  <span style={{
                    fontSize: "10px",
                    fontWeight: navSuggestActive ? 700 : 400,
                    color: navSuggestActive ? "#2563EB" : "#9CA3AF"
                  }}>건의</span>
                </div>
                <div
                  onClick={() => setScreen('parking')}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "3px",
                    cursor: "pointer",
                    paddingBottom: "4px"
                  }}
                >
                  <span style={{ fontSize: "22px", opacity: navParkingActive ? 1 : 0.4 }}>🚗</span>
                  <span style={{
                    fontSize: "10px",
                    fontWeight: navParkingActive ? 700 : 400,
                    color: navParkingActive ? "#2563EB" : "#9CA3AF"
                  }}>추첨</span>
                </div>
                <div
                  onClick={() => setScreen(isAdmin ? 'admin' : 'mypage')}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "3px",
                    cursor: "pointer",
                    paddingBottom: "4px"
                  }}
                >
                  <span style={{ fontSize: "22px", opacity: navMyActive ? 1 : 0.4 }}>👤</span>
                  <span style={{
                    fontSize: "10px",
                    fontWeight: navMyActive ? 700 : 400,
                    color: navMyActive ? "#2563EB" : "#9CA3AF"
                  }}>마이</span>
                </div>
              </div>

            </div>
          )}

        </div>
      </div>
    </>
  );
}
