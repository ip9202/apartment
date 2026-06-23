"use client";

import { useState, useCallback } from 'react';
import { NOTICES, SUGGESTIONS, getTimelineColors, getTabStyles, getCatTabStyles, type Screen } from './demo-data';

// DesktopApp - Desktop viewport with 256px sidebar + 1000px main area

export default function DesktopApp() {
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

  const showAuthScreen = !isLoggedIn;
  const showLogin = screen === 'login';
  const showSignup = screen === 'signup';
  const showVerify = screen === 'verify';

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

  const publicToggleBg = newPublic ? '#2563EB' : '#E5E7EB';
  const publicToggleLeft = newPublic ? '23px' : '3px';

  const loginBtnBg = loginLoading ? '#93C5FD' : '#2563EB';
  const parkingBtnBg = parkingApplied ? '#DC2626' : '#2563EB';
  const parkingBtnLabel = parkingApplied ? '신청 취소' : '신청하기';

  const filteredNotices = noticeFilter === '전체' ? NOTICES : NOTICES.filter(n => n.category === noticeFilter);
  const filteredSuggestions = suggestionFilter === '전체' ? SUGGESTIONS : SUGGESTIONS.filter(s => s.status === suggestionFilter);
  const selectedNotice = selectedNoticeId ? NOTICES.find(n => n.id === selectedNoticeId) : null;
  const selectedSuggestion = selectedSuggestionId ? SUGGESTIONS.find(s => s.id === selectedSuggestionId) : null;

  const sidebarEmail = isAdmin ? 'admin@aitteulak.com' : 'resident@aitteulak.com';
  const sidebarUnit = isAdmin ? '관리사무소' : 'A동 201호';

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

  const handleLogout = useCallback(() => {
    setIsLoggedIn(false);
    setScreen('login');
    setLoginEmail('');
    setLoginPassword('');
  }, []);

  return (
    <>
      {/* ── AUTH SCREENS ── */}
      {showAuthScreen && (
        <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#EFF6FF 0%,#F0F9FF 60%,#F3F4F6 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>

          {/* LOGIN */}
          {showLogin && (
            <div style={{ width: "100%", maxWidth: "440px", background: "white", borderRadius: "24px", padding: "48px", boxShadow: "0 8px 40px rgba(0,0,0,0.10)" }}>
              <div style={{ textAlign: "center", marginBottom: "40px" }}>
                <div style={{ width: "68px", height: "68px", background: "linear-gradient(135deg,#2563EB,#1D4ED8)", borderRadius: "20px", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 24px rgba(37,99,235,0.35)" }}>
                  <span style={{ color: "white", fontSize: "28px", fontWeight: 900, letterSpacing: "-1px" }}>아</span>
                </div>
                <h1 style={{ fontSize: "24px", fontWeight: 900, color: "#111827", margin: "0 0 6px", letterSpacing: "-0.8px" }}>아이뜨락</h1>
                <p style={{ fontSize: "14px", color: "#9CA3AF", margin: "0" }}>서귀포 서홍동 아파트 커뮤니티</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "16px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151", display: "block", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "0.5px" }}>이메일</label>
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') doLogin(loginEmail, loginPassword);
                    }}
                    placeholder="이메일을 입력해 주세요"
                    style={{ width: "100%", height: "48px", border: "1.5px solid #E5E7EB", borderRadius: "10px", padding: "0 16px", fontSize: "15px", color: "#111827", outline: "none", background: "#F9FAFB" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151", display: "block", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "0.5px" }}>비밀번호</label>
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') doLogin(loginEmail, loginPassword);
                    }}
                    placeholder="비밀번호를 입력해 주세요"
                    style={{ width: "100%", height: "48px", border: "1.5px solid #E5E7EB", borderRadius: "10px", padding: "0 16px", fontSize: "15px", color: "#111827", outline: "none", background: "#F9FAFB" }}
                  />
                </div>
              </div>
              {loginError && (
                <div style={{ padding: "10px 14px", background: "#FEF2F2", borderRadius: "8px", marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "15px" }}>⚠️</span>
                  <span style={{ fontSize: "13px", color: "#DC2626" }}>{loginError}</span>
                </div>
              )}
              <button
                onClick={() => doLogin(loginEmail, loginPassword)}
                style={{ width: "100%", height: "50px", background: loginBtnBg, color: "white", border: "none", borderRadius: "12px", fontSize: "16px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", marginBottom: "16px", letterSpacing: "-0.2px" }}
              >
                {loginLoading ? (
                  <span style={{ width: "18px", height: "18px", border: "2.5px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }}></span>
                ) : "로그인"}
              </button>
              <p style={{ textAlign: "center", fontSize: "14px", color: "#9CA3AF", margin: "0 0 28px" }}>
                계정이 없으신가요?{" "}
                <span onClick={() => setScreen('signup')} style={{ color: "#2563EB", fontWeight: 600, cursor: "pointer" }}>회원가입</span>
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                <div style={{ flex: 1, height: "1px", background: "#F3F4F6" }}></div>
                <span style={{ fontSize: "11px", color: "#D1D5DB", fontWeight: 600, letterSpacing: "0.6px", textTransform: "uppercase" }}>소셜 로그인</span>
                <div style={{ flex: 1, height: "1px", background: "#F3F4F6" }}></div>
              </div>
              <button
                onClick={() => doLogin('kakao@user.com', 'kakao')}
                style={{ width: "100%", height: "50px", background: "#FEE500", color: "rgba(0,0,0,0.85)", border: "none", borderRadius: "12px", fontSize: "15px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "9px", marginBottom: "16px", letterSpacing: "-0.3px" }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="rgba(0,0,0,0.85)"><path d="M12 3C6.48 3 2 6.92 2 11.75c0 2.99 1.71 5.63 4.31 7.27L5.2 22.38a.5.5 0 0 0 .74.55l4.38-2.94c.55.07 1.1.11 1.68.11 5.52 0 10-3.92 10-8.75C22 6.92 17.52 3 12 3z"></path></svg>
                카카오로 시작하기
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                <div style={{ flex: 1, height: "1px", background: "#F3F4F6" }}></div>
                <span style={{ fontSize: "11px", color: "#D1D5DB", fontWeight: 600, letterSpacing: "0.6px", textTransform: "uppercase" }}>체험하기</span>
                <div style={{ flex: 1, height: "1px", background: "#F3F4F6" }}></div>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  onClick={() => doLogin('resident@aitteulak.com', 'test1234')}
                  style={{ flex: 1, height: "44px", background: "#EFF6FF", color: "#1D4ED8", border: "1.5px solid #BFDBFE", borderRadius: "10px", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}
                >👤 입주민</button>
                <button
                  onClick={() => doLogin('admin@aitteulak.com', 'test1234')}
                  style={{ flex: 1, height: "44px", background: "#F0FDF4", color: "#15803D", border: "1.5px solid #BBF7D0", borderRadius: "10px", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}
                >🔧 관리자</button>
              </div>
            </div>
          )}

          {/* SIGNUP */}
          {showSignup && (
            <div style={{ width: "100%", maxWidth: "480px", background: "white", borderRadius: "24px", padding: "40px 48px", boxShadow: "0 8px 40px rgba(0,0,0,0.10)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "32px" }}>
                <div
                  onClick={handleGoBack}
                  style={{ width: "36px", height: "36px", borderRadius: "10px", background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M12.5 15L7.5 10L12.5 5" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                </div>
                <h2 style={{ fontSize: "20px", fontWeight: 900, color: "#111827", margin: "0", letterSpacing: "-0.5px" }}>회원가입</h2>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151", display: "block", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "0.5px" }}>이메일</label>
                  <input type="email" placeholder="이메일을 입력해 주세요" style={{ width: "100%", height: "48px", border: "1.5px solid #E5E7EB", borderRadius: "10px", padding: "0 16px", fontSize: "15px", color: "#111827", outline: "none", background: "#F9FAFB" }} />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151", display: "block", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "0.5px" }}>비밀번호</label>
                  <input type="password" placeholder="8자 이상, 영문+숫자 조합" style={{ width: "100%", height: "48px", border: "1.5px solid #E5E7EB", borderRadius: "10px", padding: "0 16px", fontSize: "15px", color: "#111827", outline: "none", background: "#F9FAFB" }} />
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151", display: "block", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "0.5px" }}>비밀번호 확인</label>
                  <input type="password" placeholder="비밀번호를 다시 입력해 주세요" style={{ width: "100%", height: "48px", border: "1.5px solid #E5E7EB", borderRadius: "10px", padding: "0 16px", fontSize: "15px", color: "#111827", outline: "none", background: "#F9FAFB" }} />
                </div>
                <div style={{ padding: "16px", background: "#F9FAFB", borderRadius: "10px", border: "1px solid #E5E7EB" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                    <div style={{ width: "20px", height: "20px", border: "2px solid #2563EB", borderRadius: "5px", background: "#2563EB", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><span style={{ color: "white", fontSize: "11px", fontWeight: 900 }}>✓</span></div>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>전체 동의</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingLeft: "4px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "13px", color: "#6B7280" }}>[필수] 이용약관</span>
                      <span style={{ fontSize: "12px", color: "#2563EB", fontWeight: 600, cursor: "pointer" }}>보기 ›</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "13px", color: "#6B7280" }}>[필수] 개인정보 처리방침</span>
                      <span style={{ fontSize: "12px", color: "#2563EB", fontWeight: 600, cursor: "pointer" }}>보기 ›</span>
                    </div>
                  </div>
                </div>
                <button onClick={() => setScreen('verify')} style={{ width: "100%", height: "50px", background: "#2563EB", color: "white", border: "none", borderRadius: "12px", fontSize: "16px", fontWeight: 700, cursor: "pointer", letterSpacing: "-0.2px" }}>회원가입</button>
                <p style={{ textAlign: "center", fontSize: "14px", color: "#9CA3AF", margin: "0" }}>
                  이미 계정이 있으신가요?{" "}
                  <span onClick={() => setScreen('login')} style={{ color: "#2563EB", fontWeight: 600, cursor: "pointer" }}>로그인</span>
                </p>
              </div>
            </div>
          )}

          {/* VERIFY */}
          {showVerify && (
            <div style={{ width: "100%", maxWidth: "440px", background: "white", borderRadius: "24px", padding: "40px 48px", boxShadow: "0 8px 40px rgba(0,0,0,0.10)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "32px" }}>
                <div
                  onClick={handleGoBack}
                  style={{ width: "36px", height: "36px", borderRadius: "10px", background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M12.5 15L7.5 10L12.5 5" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                </div>
                <h2 style={{ fontSize: "20px", fontWeight: 900, color: "#111827", margin: "0", letterSpacing: "-0.5px" }}>동/호수 인증</h2>
              </div>
              <div style={{ textAlign: "center", marginBottom: "32px" }}>
                <div style={{ fontSize: "52px", marginBottom: "14px" }}>🏠</div>
                <h3 style={{ fontSize: "18px", fontWeight: 800, color: "#111827", margin: "0 0 8px", letterSpacing: "-0.4px" }}>거주 중인 동/호수를 인증해 주세요</h3>
                <p style={{ fontSize: "14px", color: "#6B7280", margin: "0", lineHeight: "1.6" }}>입주민 자격 확인을 위한 1회성 인증입니다</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "24px" }}>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151", display: "block", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "0.5px" }}>동 선택</label>
                  <select style={{ width: "100%", height: "48px", border: "1.5px solid #E5E7EB", borderRadius: "10px", padding: "0 16px", fontSize: "15px", color: "#111827", outline: "none", background: "#F9FAFB", cursor: "pointer", appearance: "none" }}>
                    <option value="">동을 선택해 주세요</option>
                    <option value="A">A동</option>
                    <option value="B">B동</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151", display: "block", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "0.5px" }}>호수 선택</label>
                  <select style={{ width: "100%", height: "48px", border: "1.5px solid #E5E7EB", borderRadius: "10px", padding: "0 16px", fontSize: "15px", color: "#111827", outline: "none", background: "#F9FAFB", cursor: "pointer", appearance: "none" }}>
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
                style={{ width: "100%", height: "50px", background: "#2563EB", color: "white", border: "none", borderRadius: "12px", fontSize: "16px", fontWeight: 700, cursor: "pointer", letterSpacing: "-0.2px" }}
              >인증하기</button>
            </div>
          )}

        </div>
      )}

      {/* ── MAIN APP ── */}
      {isLoggedIn && (
        <div style={{ minHeight: "100vh", display: "flex", background: "#F3F4F6" }}>

          {/* SIDEBAR - 256px width */}
          <div style={{ width: "256px", minHeight: "100vh", background: "white", borderRight: "1px solid #E5E7EB", position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 20, display: "flex", flexDirection: "column", overflowY: "auto" }}>

            {/* Logo */}
            <div style={{ padding: "22px 20px 18px", borderBottom: "1px solid #F3F4F6", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ width: "38px", height: "38px", background: "linear-gradient(135deg,#2563EB,#1D4ED8)", borderRadius: "11px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 4px 12px rgba(37,99,235,0.28)" }}>
                  <span style={{ color: "white", fontSize: "16px", fontWeight: 900 }}>아</span>
                </div>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: 900, color: "#111827", letterSpacing: "-0.5px", lineHeight: 1.2 }}>아이뜨락</div>
                  <div style={{ fontSize: "11px", color: "#9CA3AF", fontWeight: 500 }}>서귀포 서홍동</div>
                </div>
              </div>
            </div>

            {/* Nav */}
            <nav style={{ padding: "10px", flex: 1 }}>

              {/* Resident nav */}
              {!isAdmin && (
                <>
                  <div onClick={() => setScreen('home')} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", cursor: "pointer", marginBottom: "2px", background: screen === 'home' ? '#EFF6FF' : 'transparent', color: screen === 'home' ? '#1D4ED8' : '#374151' }}>
                    <span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>🏠</span>
                    <span style={{ fontSize: "14px", fontWeight: screen === 'home' ? 700 : 500 }}>홈</span>
                  </div>
                  <div onClick={() => setScreen('notices')} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", cursor: "pointer", marginBottom: "2px", background: (screen === 'notices' || screen === 'noticeDetail') ? '#EFF6FF' : 'transparent', color: (screen === 'notices' || screen === 'noticeDetail') ? '#1D4ED8' : '#374151' }}>
                    <span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>📢</span>
                    <span style={{ fontSize: "14px", fontWeight: (screen === 'notices' || screen === 'noticeDetail') ? 700 : 500 }}>공지사항</span>
                  </div>
                  <div onClick={() => setScreen('suggestions')} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", cursor: "pointer", marginBottom: "2px", background: ['suggestions', 'newSuggestion', 'suggestionDetail'].includes(screen) ? '#EFF6FF' : 'transparent', color: ['suggestions', 'newSuggestion', 'suggestionDetail'].includes(screen) ? '#1D4ED8' : '#374151' }}>
                    <span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>📝</span>
                    <span style={{ fontSize: "14px", fontWeight: ['suggestions', 'newSuggestion', 'suggestionDetail'].includes(screen) ? 700 : 500 }}>건의사항</span>
                  </div>
                  <div onClick={() => setScreen('parking')} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", cursor: "pointer", marginBottom: "2px", background: screen === 'parking' ? '#EFF6FF' : 'transparent', color: screen === 'parking' ? '#1D4ED8' : '#374151' }}>
                    <span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>🚗</span>
                    <span style={{ fontSize: "14px", fontWeight: screen === 'parking' ? 700 : 500 }}>주차 추첨</span>
                  </div>
                  <div onClick={() => setScreen('mypage')} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", cursor: "pointer", marginBottom: "2px", background: screen === 'mypage' ? '#EFF6FF' : 'transparent', color: screen === 'mypage' ? '#1D4ED8' : '#374151' }}>
                    <span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>👤</span>
                    <span style={{ fontSize: "14px", fontWeight: screen === 'mypage' ? 700 : 500 }}>마이페이지</span>
                  </div>
                </>
              )}

              {/* Admin nav */}
              {isAdmin && (
                <>
                  <div onClick={() => setScreen('admin')} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", cursor: "pointer", marginBottom: "2px", background: screen === 'admin' ? '#EFF6FF' : 'transparent', color: screen === 'admin' ? '#1D4ED8' : '#374151' }}>
                    <span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>🏠</span>
                    <span style={{ fontSize: "14px", fontWeight: screen === 'admin' ? 700 : 500 }}>대시보드</span>
                  </div>
                  <div onClick={() => setScreen('notices')} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", cursor: "pointer", marginBottom: "2px", background: (screen === 'notices' || screen === 'noticeDetail') ? '#EFF6FF' : 'transparent', color: (screen === 'notices' || screen === 'noticeDetail') ? '#1D4ED8' : '#374151' }}>
                    <span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>📢</span>
                    <span style={{ fontSize: "14px", fontWeight: (screen === 'notices' || screen === 'noticeDetail') ? 700 : 500 }}>공지사항</span>
                  </div>
                  <div onClick={() => setScreen('suggestions')} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", cursor: "pointer", marginBottom: "2px", background: ['suggestions', 'newSuggestion', 'suggestionDetail'].includes(screen) ? '#EFF6FF' : 'transparent', color: ['suggestions', 'newSuggestion', 'suggestionDetail'].includes(screen) ? '#1D4ED8' : '#374151' }}>
                    <span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>📝</span>
                    <span style={{ fontSize: "14px", fontWeight: ['suggestions', 'newSuggestion', 'suggestionDetail'].includes(screen) ? 700 : 500 }}>건의 관리</span>
                  </div>
                  <div onClick={() => setScreen('parking')} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", cursor: "pointer", marginBottom: "2px", background: screen === 'parking' ? '#EFF6FF' : 'transparent', color: screen === 'parking' ? '#1D4ED8' : '#374151' }}>
                    <span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>🚗</span>
                    <span style={{ fontSize: "14px", fontWeight: screen === 'parking' ? 700 : 500 }}>추첨 관리</span>
                  </div>
                </>
              )}

            </nav>

            {/* User info */}
            <div style={{ padding: "16px", borderTop: "1px solid #F3F4F6", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                <div style={{ width: "36px", height: "36px", background: "#EFF6FF", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "16px" }}>👤</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "12px", color: "#374151", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sidebarEmail}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "3px" }}>
                    <span style={{ background: isAdmin ? '#DC2626' : '#2563EB', color: "white", fontSize: "10px", fontWeight: 700, padding: "1px 6px", borderRadius: "4px" }}>{isAdmin ? '관리자' : '입주민'}</span>
                    <span style={{ fontSize: "11px", color: "#9CA3AF" }}>{sidebarUnit}</span>
                  </div>
                </div>
              </div>
              <button onClick={handleLogout} style={{ width: "100%", height: "34px", background: "#FEF2F2", color: "#DC2626", border: "1px solid #FEE2E2", borderRadius: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>로그아웃</button>
            </div>
          </div>

          {/* MAIN CONTENT - 1000px max width, offset by 256px sidebar */}
          <div style={{ flex: 1, marginLeft: "256px", minHeight: "100vh" }}>

            {/* HOME */}
            {screen === 'home' && (
              <div>
                <div style={{ background: "white", borderBottom: "1px solid #E5E7EB", padding: "0 40px", height: "64px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
                  <h1 style={{ fontSize: "20px", fontWeight: 900, color: "#111827", margin: "0", letterSpacing: "-0.5px" }}>홈</h1>
                  <div style={{ width: "36px", height: "36px", background: "#F9FAFB", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", position: "relative" }}>
                    <span style={{ fontSize: "18px" }}>🔔</span>
                    <div style={{ position: "absolute", top: "7px", right: "7px", width: "7px", height: "7px", background: "#DC2626", borderRadius: "50%", border: "1.5px solid white" }}></div>
                  </div>
                </div>
                <div style={{ padding: "32px 40px" }}>
                  <div style={{ marginBottom: "28px" }}>
                    <h2 style={{ fontSize: "22px", fontWeight: 900, color: "#111827", margin: "0 0 6px", letterSpacing: "-0.5px" }}>안녕하세요, A동 201호 입주민님 👋</h2>
                    <p style={{ fontSize: "14px", color: "#6B7280", margin: "0" }}>오늘도 아이뜨락과 함께 편안한 하루 되세요.</p>
                  </div>
                  {/* Pinned notices */}
                  <div style={{ marginBottom: "28px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: "12px" }}>📌 고정 공지</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {NOTICES.filter(n => n.pinned).map(notice => (
                        <div
                          key={notice.id}
                          onClick={handleOpenNotice}
                          data-id={notice.id}
                          style={{ padding: "14px 18px", background: "white", borderRadius: "12px", display: "flex", alignItems: "center", gap: "12px", cursor: "pointer", border: "1px solid #DBEAFE", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
                        >
                          <span style={{ fontSize: "16px", flexShrink: 0 }}>📢</span>
                          <span style={{ fontSize: "14px", fontWeight: 500, color: "#1D4ED8", flex: 1 }}>{notice.title}</span>
                          <span style={{ fontSize: "12px", color: "#93C5FD", flexShrink: 0, whiteSpace: "nowrap" }}>{notice.date}</span>
                          <svg width="6" height="10" viewBox="0 0 7 12" fill="none"><path d="M1 11L6 6L1 1" stroke="#BFDBFE" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* 2-col layout */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "24px", alignItems: "start" }}>
                    {/* Recent notices */}
                    <div style={{ background: "white", borderRadius: "16px", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                      <div style={{ padding: "18px 24px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #F3F4F6" }}>
                        <span style={{ fontSize: "16px", fontWeight: 900, color: "#111827", letterSpacing: "-0.5px" }}>최신 공지</span>
                        <span onClick={() => setScreen('notices')} style={{ fontSize: "13px", color: "#2563EB", fontWeight: 600, cursor: "pointer" }}>전체 보기 →</span>
                      </div>
                      {NOTICES.slice(0, 5).map(notice => (
                        <div
                          key={notice.id}
                          onClick={handleOpenNotice}
                          data-id={notice.id}
                          style={{ padding: "14px 24px", borderBottom: "1px solid #F9FAFB", cursor: "pointer", display: "flex", alignItems: "center", gap: "14px" }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "14px", fontWeight: 500, color: "#111827", marginBottom: "5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.2px" }}>{notice.title}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                              <span style={{ fontSize: "11px", fontWeight: 600, color: "#2563EB", background: "#EFF6FF", padding: "2px 7px", borderRadius: "4px" }}>{notice.category}</span>
                              <span style={{ fontSize: "11px", color: "#C4C9D4" }}>{notice.date}</span>
                            </div>
                          </div>
                          <svg width="6" height="10" viewBox="0 0 7 12" fill="none"><path d="M1 11L6 6L1 1" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                        </div>
                      ))}
                    </div>
                    {/* Right column */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                      <div
                        onClick={() => setScreen('parking')}
                        style={{ background: "linear-gradient(135deg,#1E3A8A,#2563EB)", borderRadius: "16px", padding: "22px", cursor: "pointer", overflow: "hidden", position: "relative" }}
                      >
                        <div style={{ position: "absolute", right: "-10px", top: "-10px", fontSize: "80px", opacity: 0.1, userSelect: "none", pointerEvents: "none" }}>🚗</div>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#93C5FD", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "5px" }}>🎯 진행 중인 추첨</div>
                        <div style={{ fontSize: "17px", fontWeight: 900, color: "white", marginBottom: "4px", letterSpacing: "-0.5px" }}>2026년 7월 주차 추첨</div>
                        <div style={{ fontSize: "13px", color: "#BFDBFE", marginBottom: "16px" }}>신청 6.21 ~ 6.25 · 현재 47명 신청</div>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", background: "white", color: "#1D4ED8", fontSize: "13px", fontWeight: 700, padding: "8px 14px", borderRadius: "8px" }}>신청하기 →</div>
                      </div>
                      <div style={{ background: "white", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: "14px" }}>내 활동</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                          <div style={{ textAlign: "center", padding: "14px", background: "#F9FAFB", borderRadius: "10px" }}>
                            <div style={{ fontSize: "26px", fontWeight: 900, color: "#2563EB", marginBottom: "4px", letterSpacing: "-0.5px" }}>3</div>
                            <div style={{ fontSize: "12px", color: "#6B7280", fontWeight: 500 }}>작성 건의</div>
                          </div>
                          <div style={{ textAlign: "center", padding: "14px", background: "#F9FAFB", borderRadius: "10px" }}>
                            <div style={{ fontSize: "26px", fontWeight: 900, color: "#16A34A", marginBottom: "4px", letterSpacing: "-0.5px" }}>1</div>
                            <div style={{ fontSize: "12px", color: "#6B7280", fontWeight: 500 }}>완료 건의</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* NOTICE LIST */}
            {screen === 'notices' && (
              <div>
                <div style={{ background: "white", borderBottom: "1px solid #E5E7EB", padding: "0 40px", height: "64px", display: "flex", alignItems: "center", position: "sticky", top: 0, zIndex: 10 }}>
                  <h1 style={{ fontSize: "20px", fontWeight: 900, color: "#111827", margin: "0", letterSpacing: "-0.5px" }}>공지사항</h1>
                </div>
                <div style={{ background: "white", padding: "12px 40px", borderBottom: "1px solid #E5E7EB", display: "flex", gap: "6px" }}>
                  <div data-filter="전체" onClick={handleSetNoticeFilter} style={{ height: "34px", padding: "0 16px", borderRadius: "17px", display: "flex", alignItems: "center", fontSize: "13px", fontWeight: nAll.weight, cursor: "pointer", background: nAll.bg, color: nAll.color, border: `1.5px solid ${nAll.border}` }}>전체</div>
                  <div data-filter="일반공지" onClick={handleSetNoticeFilter} style={{ height: "34px", padding: "0 16px", borderRadius: "17px", display: "flex", alignItems: "center", fontSize: "13px", fontWeight: nGen.weight, cursor: "pointer", background: nGen.bg, color: nGen.color, border: `1.5px solid ${nGen.border}` }}>일반공지</div>
                  <div data-filter="시설관리" onClick={handleSetNoticeFilter} style={{ height: "34px", padding: "0 16px", borderRadius: "17px", display: "flex", alignItems: "center", fontSize: "13px", fontWeight: nFac.weight, cursor: "pointer", background: nFac.bg, color: nFac.color, border: `1.5px solid ${nFac.border}` }}>시설관리</div>
                  <div data-filter="생활안내" onClick={handleSetNoticeFilter} style={{ height: "34px", padding: "0 16px", borderRadius: "17px", display: "flex", alignItems: "center", fontSize: "13px", fontWeight: nLife.weight, cursor: "pointer", background: nLife.bg, color: nLife.color, border: `1.5px solid ${nLife.border}` }}>생활안내</div>
                </div>
                <div style={{ padding: "28px 40px", maxWidth: "960px" }}>
                  <div style={{ background: "white", borderRadius: "16px", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                    {filteredNotices.map(notice => (
                      <div
                        key={notice.id}
                        onClick={handleOpenNotice}
                        data-id={notice.id}
                        style={{ padding: "16px 24px", borderBottom: "1px solid #F9FAFB", cursor: "pointer", display: "flex", alignItems: "center", gap: "14px" }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "15px", fontWeight: 500, color: "#111827", marginBottom: "5px", letterSpacing: "-0.2px" }}>{notice.title}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                            <span style={{ fontSize: "11px", fontWeight: 600, color: "#2563EB", background: "#EFF6FF", padding: "2px 7px", borderRadius: "4px" }}>{notice.category}</span>
                            <span style={{ fontSize: "12px", color: "#C4C9D4" }}>{notice.date}</span>
                          </div>
                        </div>
                        <svg width="6" height="10" viewBox="0 0 7 12" fill="none"><path d="M1 11L6 6L1 1" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* NOTICE DETAIL */}
            {screen === 'noticeDetail' && selectedNotice && (
              <div>
                <div style={{ background: "white", borderBottom: "1px solid #E5E7EB", padding: "0 40px", height: "64px", display: "flex", alignItems: "center", gap: "12px", position: "sticky", top: 0, zIndex: 10 }}>
                  <div onClick={handleGoBack} style={{ width: "36px", height: "36px", background: "#F3F4F6", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M12.5 15L7.5 10L12.5 5" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                  </div>
                  <h1 style={{ fontSize: "18px", fontWeight: 700, color: "#111827", margin: "0", letterSpacing: "-0.3px" }}>공지 상세</h1>
                </div>
                <div style={{ padding: "40px", maxWidth: "800px" }}>
                  <div style={{ background: "white", borderRadius: "16px", padding: "40px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "16px", flexWrap: "wrap" }}>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "#2563EB", background: "#EFF6FF", padding: "4px 12px", borderRadius: "6px" }}>{selectedNotice.category}</span>
                      {selectedNotice.pinned && (
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "#DC2626", background: "#FEF2F2", padding: "4px 12px", borderRadius: "6px" }}>📌 고정</span>
                      )}
                    </div>
                    <h2 style={{ fontSize: "22px", fontWeight: 900, color: "#111827", margin: "0 0 14px", lineHeight: 1.45, letterSpacing: "-0.5px" }}>{selectedNotice.title}</h2>
                    <div style={{ fontSize: "13px", color: "#9CA3AF", marginBottom: "28px", paddingBottom: "24px", borderBottom: "1px solid #F3F4F6", display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "15px" }}>🏢</span><span>관리사무소</span><span>·</span><span>{selectedNotice.date}</span>
                    </div>
                    <div style={{ fontSize: "15px", color: "#374151", lineHeight: 1.9, whiteSpace: "pre-line", letterSpacing: "-0.1px" }}>{selectedNotice.content}</div>
                  </div>
                </div>
              </div>
            )}

            {/* SUGGESTION LIST */}
            {screen === 'suggestions' && (
              <div>
                <div style={{ background: "white", borderBottom: "1px solid #E5E7EB", padding: "0 40px", height: "64px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
                  <h1 style={{ fontSize: "20px", fontWeight: 900, color: "#111827", margin: "0", letterSpacing: "-0.5px" }}>건의사항</h1>
                  {!isAdmin && (
                    <button onClick={() => setScreen('newSuggestion')} style={{ height: "40px", padding: "0 18px", background: "#2563EB", color: "white", border: "none", borderRadius: "10px", fontSize: "14px", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "20px", lineHeight: 1 }}>+</span><span>새 건의</span>
                    </button>
                  )}
                </div>
                <div style={{ background: "white", padding: "12px 40px", borderBottom: "1px solid #E5E7EB", display: "flex", gap: "6px" }}>
                  <div data-filter="전체" onClick={handleSetSuggestionFilter} style={{ height: "34px", padding: "0 16px", borderRadius: "17px", display: "flex", alignItems: "center", fontSize: "13px", fontWeight: sAll.weight, cursor: "pointer", background: sAll.bg, color: sAll.color, border: `1.5px solid ${sAll.border}` }}>전체</div>
                  <div data-filter="접수" onClick={handleSetSuggestionFilter} style={{ height: "34px", padding: "0 16px", borderRadius: "17px", display: "flex", alignItems: "center", fontSize: "13px", fontWeight: s1.weight, cursor: "pointer", background: s1.bg, color: s1.color, border: `1.5px solid ${s1.border}` }}>접수</div>
                  <div data-filter="처리중" onClick={handleSetSuggestionFilter} style={{ height: "34px", padding: "0 16px", borderRadius: "17px", display: "flex", alignItems: "center", fontSize: "13px", fontWeight: s2.weight, cursor: "pointer", background: s2.bg, color: s2.color, border: `1.5px solid ${s2.border}` }}>처리중</div>
                  <div data-filter="완료" onClick={handleSetSuggestionFilter} style={{ height: "34px", padding: "0 16px", borderRadius: "17px", display: "flex", alignItems: "center", fontSize: "13px", fontWeight: s3.weight, cursor: "pointer", background: s3.bg, color: s3.color, border: `1.5px solid ${s3.border}` }}>완료</div>
                </div>
                <div style={{ padding: "24px 40px", maxWidth: "960px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {filteredSuggestions.map(item => (
                      <div
                        key={item.id}
                        onClick={handleOpenSuggestion}
                        data-id={item.id}
                        style={{ background: "white", borderRadius: "12px", padding: "18px 24px", cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", display: "flex", alignItems: "center", gap: "14px" }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
                            <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 9px", borderRadius: "5px", background: item.statusBg, color: item.statusColor }}>{item.status}</span>
                            <span style={{ fontSize: "11px", color: "#9CA3AF", background: "#F3F4F6", padding: "3px 8px", borderRadius: "5px" }}>{item.category}</span>
                            {item.isPublic && (
                              <span style={{ fontSize: "11px", color: "#9CA3AF", background: "#F3F4F6", padding: "2px 7px", borderRadius: "4px" }}>공개</span>
                            )}
                          </div>
                          <div style={{ fontSize: "15px", fontWeight: 600, color: "#111827", marginBottom: "5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.2px" }}>{item.title}</div>
                          <div style={{ fontSize: "12px", color: "#C4C9D4" }}>{item.unit} · {item.date}</div>
                        </div>
                        <svg width="6" height="10" viewBox="0 0 7 12" fill="none"><path d="M1 11L6 6L1 1" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* NEW SUGGESTION */}
            {screen === 'newSuggestion' && (
              <div>
                <div style={{ background: "white", borderBottom: "1px solid #E5E7EB", padding: "0 40px", height: "64px", display: "flex", alignItems: "center", gap: "12px", position: "sticky", top: 0, zIndex: 10 }}>
                  <div onClick={handleGoBack} style={{ width: "36px", height: "36px", background: "#F3F4F6", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M12.5 15L7.5 10L12.5 5" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                  </div>
                  <h1 style={{ fontSize: "18px", fontWeight: 700, color: "#111827", margin: "0", letterSpacing: "-0.3px" }}>건의 등록</h1>
                </div>
                <div style={{ padding: "40px", maxWidth: "680px" }}>
                  {newSubmitted && (
                    <div style={{ background: "#F0FDF4", border: "1.5px solid #86EFAC", borderRadius: "12px", padding: "16px 20px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "12px", animation: "slideUp 0.3s ease" }}>
                      <span style={{ fontSize: "22px" }}>✅</span>
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 700, color: "#15803D", marginBottom: "1px" }}>등록 완료!</div>
                        <div style={{ fontSize: "12px", color: "#16A34A" }}>건의사항이 등록되었습니다.</div>
                      </div>
                    </div>
                  )}
                  <div style={{ background: "white", borderRadius: "16px", padding: "32px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                    <div style={{ marginBottom: "24px" }}>
                      <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151", display: "block", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>카테고리</label>
                      <div style={{ display: "flex", gap: "7px", flexWrap: "wrap" }}>
                        <div data-cat="시설" onClick={handleSetNewCategory} style={{ height: "36px", padding: "0 16px", borderRadius: "18px", display: "flex", alignItems: "center", fontSize: "13px", fontWeight: c1.weight, cursor: "pointer", background: c1.bg, color: c1.color, border: `1.5px solid ${c1.border}` }}>시설</div>
                        <div data-cat="환경" onClick={handleSetNewCategory} style={{ height: "36px", padding: "0 16px", borderRadius: "18px", display: "flex", alignItems: "center", fontSize: "13px", fontWeight: c2.weight, cursor: "pointer", background: c2.bg, color: c2.color, border: `1.5px solid ${c2.border}` }}>환경</div>
                        <div data-cat="안전" onClick={handleSetNewCategory} style={{ height: "36px", padding: "0 16px", borderRadius: "18px", display: "flex", alignItems: "center", fontSize: "13px", fontWeight: c3.weight, cursor: "pointer", background: c3.bg, color: c3.color, border: `1.5px solid ${c3.border}` }}>안전</div>
                        <div data-cat="편의" onClick={handleSetNewCategory} style={{ height: "36px", padding: "0 16px", borderRadius: "18px", display: "flex", alignItems: "center", fontSize: "13px", fontWeight: c4.weight, cursor: "pointer", background: c4.bg, color: c4.color, border: `1.5px solid ${c4.border}` }}>편의</div>
                        <div data-cat="기타" onClick={handleSetNewCategory} style={{ height: "36px", padding: "0 16px", borderRadius: "18px", display: "flex", alignItems: "center", fontSize: "13px", fontWeight: c5.weight, cursor: "pointer", background: c5.bg, color: c5.color, border: `1.5px solid ${c5.border}` }}>기타</div>
                      </div>
                    </div>
                    <div style={{ marginBottom: "18px" }}>
                      <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151", display: "block", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "0.5px" }}>제목</label>
                      <input
                        type="text"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        placeholder="제목을 입력해 주세요 (최대 100자)"
                        style={{ width: "100%", height: "48px", border: "1.5px solid #E5E7EB", borderRadius: "10px", padding: "0 16px", fontSize: "15px", color: "#111827", outline: "none", background: "#F9FAFB" }}
                      />
                    </div>
                    <div style={{ marginBottom: "20px" }}>
                      <label style={{ fontSize: "12px", fontWeight: 700, color: "#374151", display: "block", marginBottom: "7px", textTransform: "uppercase", letterSpacing: "0.5px" }}>내용</label>
                      <textarea
                        value={newContent}
                        onChange={(e) => setNewContent(e.target.value)}
                        placeholder="불편하신 점이나 개선이 필요한 내용을 자유롭게 작성해 주세요"
                        style={{ width: "100%", height: "140px", border: "1.5px solid #E5E7EB", borderRadius: "10px", padding: "12px 16px", fontSize: "15px", color: "#111827", outline: "none", background: "#F9FAFB", resize: "none", lineHeight: "1.6" }}
                      />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: "18px", borderTop: "1px solid #F3F4F6" }}>
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "#374151", marginBottom: "2px" }}>공개 여부</div>
                        <div style={{ fontSize: "12px", color: "#9CA3AF" }}>공개 시 모든 입주민이 열람합니다</div>
                      </div>
                      <div onClick={() => setNewPublic(!newPublic)} style={{ width: "48px", height: "28px", borderRadius: "14px", cursor: "pointer", position: "relative", background: publicToggleBg, transition: "background 0.2s", flexShrink: 0 }}>
                        <div style={{ position: "absolute", top: "3px", left: publicToggleLeft, width: "22px", height: "22px", background: "white", borderRadius: "11px", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", transition: "left 0.2s" }}></div>
                      </div>
                    </div>
                  </div>
                  <button onClick={handleSubmitSuggestion} style={{ width: "100%", height: "52px", background: "#2563EB", color: "white", border: "none", borderRadius: "12px", fontSize: "16px", fontWeight: 700, cursor: "pointer", marginTop: "16px", letterSpacing: "-0.2px" }}>등록하기</button>
                </div>
              </div>
            )}

            {/* SUGGESTION DETAIL */}
            {screen === 'suggestionDetail' && selectedSuggestion && (
              <div>
                <div style={{ background: "white", borderBottom: "1px solid #E5E7EB", padding: "0 40px", height: "64px", display: "flex", alignItems: "center", gap: "12px", position: "sticky", top: 0, zIndex: 10 }}>
                  <div onClick={handleGoBack} style={{ width: "36px", height: "36px", background: "#F3F4F6", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M12.5 15L7.5 10L12.5 5" stroke="#374151" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                  </div>
                  <h1 style={{ fontSize: "18px", fontWeight: 700, color: "#111827", margin: "0", letterSpacing: "-0.3px" }}>건의 상세</h1>
                </div>
                <div style={{ padding: "32px 40px", display: "grid", gridTemplateColumns: "1fr 300px", gap: "24px", alignItems: "start", maxWidth: "1000px" }}>
                  {/* Left: content + reply */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div style={{ background: "white", borderRadius: "16px", padding: "28px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "14px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 700, padding: "4px 12px", borderRadius: "6px", background: selectedSuggestion.statusBg, color: selectedSuggestion.statusColor }}>{selectedSuggestion.status}</span>
                        <span style={{ fontSize: "12px", color: "#9CA3AF", background: "#F3F4F6", padding: "3px 10px", borderRadius: "5px" }}>{selectedSuggestion.category}</span>
                      </div>
                      <h2 style={{ fontSize: "20px", fontWeight: 800, color: "#111827", margin: "0 0 10px", lineHeight: 1.45, letterSpacing: "-0.4px" }}>{selectedSuggestion.title}</h2>
                      <div style={{ fontSize: "13px", color: "#9CA3AF", marginBottom: "18px", paddingBottom: "18px", borderBottom: "1px solid #F3F4F6" }}>{selectedSuggestion.unit} · {selectedSuggestion.date}</div>
                      <p style={{ fontSize: "15px", color: "#374151", lineHeight: 1.85, margin: 0 }}>{selectedSuggestion.content}</p>
                    </div>
                    {selectedSuggestion.hasReply && (
                      <div style={{ background: "white", borderRadius: "16px", padding: "28px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                          <div style={{ width: "32px", height: "32px", background: "#EFF6FF", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><span style={{ fontSize: "16px" }}>🏢</span></div>
                          <div>
                            <div style={{ fontSize: "14px", fontWeight: 700, color: "#1D4ED8" }}>관리사무소 답변</div>
                            <div style={{ fontSize: "11px", color: "#9CA3AF" }}>{selectedSuggestion.replyDate}</div>
                          </div>
                        </div>
                        <p style={{ fontSize: "14px", color: "#374151", lineHeight: 1.8, margin: 0, padding: "16px 18px", background: "#F0F9FF", borderRadius: "10px", borderLeft: "3px solid #2563EB" }}>{selectedSuggestion.reply}</p>
                      </div>
                    )}
                  </div>
                  {/* Right: timeline */}
                  <div style={{ background: "white", borderRadius: "16px", padding: "24px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#374151", marginBottom: "20px", textTransform: "uppercase", letterSpacing: "0.4px" }}>처리 현황</div>
                    <div>
                      {(() => {
                        const timeline = getTimelineColors(selectedSuggestion.step);
                        return (
                          <>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                                <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: timeline.step0Bg, border: `2px solid ${timeline.step0Border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  <span style={{ fontSize: "13px", color: timeline.step0Color, fontWeight: 700 }}>✓</span>
                                </div>
                                <div style={{ width: "2px", height: "36px", background: timeline.line1Bg }}></div>
                              </div>
                              <div style={{ paddingTop: "6px", paddingBottom: "28px" }}>
                                <div style={{ fontSize: "14px", fontWeight: 600, color: timeline.step0LabelColor, marginBottom: "2px" }}>접수</div>
                                <div style={{ fontSize: "12px", color: "#9CA3AF" }}>건의사항 접수 완료</div>
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                                <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: timeline.step1Bg, border: `2px solid ${timeline.step1Border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  <span style={{ fontSize: "13px", color: timeline.step1Color, fontWeight: 700 }}>✓</span>
                                </div>
                                <div style={{ width: "2px", height: "36px", background: timeline.line2Bg }}></div>
                              </div>
                              <div style={{ paddingTop: "6px", paddingBottom: "28px" }}>
                                <div style={{ fontSize: "14px", fontWeight: 600, color: timeline.step1LabelColor, marginBottom: "2px" }}>처리중</div>
                                <div style={{ fontSize: "12px", color: "#9CA3AF" }}>담당자 검토 및 처리</div>
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
                              <div style={{ flexShrink: 0 }}>
                                <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: timeline.step2Bg, border: `2px solid ${timeline.step2Border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                  <span style={{ fontSize: "13px", color: timeline.step2Color, fontWeight: 700 }}>✓</span>
                                </div>
                              </div>
                              <div style={{ paddingTop: "6px" }}>
                                <div style={{ fontSize: "14px", fontWeight: 600, color: timeline.step2LabelColor, marginBottom: "2px" }}>완료</div>
                                <div style={{ fontSize: "12px", color: "#9CA3AF" }}>처리 완료 및 답변</div>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* PARKING */}
            {screen === 'parking' && (
              <div>
                <div style={{ background: "white", borderBottom: "1px solid #E5E7EB", padding: "0 40px", height: "64px", display: "flex", alignItems: "center", position: "sticky", top: 0, zIndex: 10 }}>
                  <h1 style={{ fontSize: "20px", fontWeight: 900, color: "#111827", margin: "0", letterSpacing: "-0.5px" }}>주차 추첨</h1>
                </div>
                <div style={{ padding: "32px 40px", maxWidth: "900px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", alignItems: "start" }}>
                  <div style={{ background: "white", borderRadius: "16px", overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
                    <div style={{ background: "linear-gradient(135deg,#1E3A8A,#2563EB)", padding: "24px" }}>
                      <div style={{ fontSize: "11px", color: "#93C5FD", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: "5px" }}>진행 중인 추첨</div>
                      <div style={{ fontSize: "20px", fontWeight: 900, color: "white", marginBottom: "4px", letterSpacing: "-0.5px" }}>2026년 7월 지정 주차</div>
                      <div style={{ fontSize: "13px", color: "#BFDBFE" }}>신청 기간: 6.21(토) ~ 6.25(수)</div>
                    </div>
                    <div style={{ padding: "24px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "22px" }}>
                        <div>
                          <div style={{ fontSize: "11px", color: "#9CA3AF", marginBottom: "4px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.3px" }}>추첨 일시</div>
                          <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>6.26(목) 자동 추첨</div>
                        </div>
                        <div>
                          <div style={{ fontSize: "11px", color: "#9CA3AF", marginBottom: "4px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.3px" }}>신청 인원</div>
                          <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>47명</div>
                        </div>
                        <div>
                          <div style={{ fontSize: "11px", color: "#9CA3AF", marginBottom: "4px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.3px" }}>총 구역 수</div>
                          <div style={{ fontSize: "14px", fontWeight: 700, color: "#111827" }}>30구역</div>
                        </div>
                        <div>
                          <div style={{ fontSize: "11px", color: "#9CA3AF", marginBottom: "4px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.3px" }}>대상 구역</div>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>A·B구역</div>
                        </div>
                      </div>
                      {parkingApplied && (
                        <div style={{ background: "#F0FDF4", border: "1.5px solid #86EFAC", borderRadius: "10px", padding: "12px 16px", marginBottom: "14px", display: "flex", alignItems: "center", gap: "10px", animation: "slideUp 0.3s ease" }}>
                          <span style={{ fontSize: "18px" }}>✅</span>
                          <span style={{ fontSize: "14px", fontWeight: 600, color: "#15803D" }}>추첨 신청이 완료되었습니다.</span>
                        </div>
                      )}
                      <button onClick={() => setParkingApplied(!parkingApplied)} style={{ width: "100%", height: "50px", background: parkingBtnBg, color: "white", border: "none", borderRadius: "12px", fontSize: "16px", fontWeight: 700, cursor: "pointer", letterSpacing: "-0.2px" }}>{parkingBtnLabel}</button>
                    </div>
                  </div>
                  <div style={{ background: "white", borderRadius: "16px", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                    <div style={{ padding: "18px 24px", borderBottom: "1px solid #F3F4F6" }}>
                      <span style={{ fontSize: "15px", fontWeight: 800, color: "#111827", letterSpacing: "-0.3px" }}>지난 추첨 이력</span>
                    </div>
                    <div style={{ padding: "18px 24px", borderBottom: "1px solid #F9FAFB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "#111827", marginBottom: "2px" }}>2026년 6월 주차 추첨</div>
                        <div style={{ fontSize: "12px", color: "#9CA3AF" }}>신청 39명 · 당첨 30명</div>
                      </div>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "#16A34A", background: "#DCFCE7", padding: "4px 10px", borderRadius: "6px" }}>완료</span>
                    </div>
                    <div style={{ padding: "18px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: "14px", fontWeight: 600, color: "#111827", marginBottom: "2px" }}>2026년 5월 주차 추첨</div>
                        <div style={{ fontSize: "12px", color: "#9CA3AF" }}>신청 43명 · 당첨 30명</div>
                      </div>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "#16A34A", background: "#DCFCE7", padding: "4px 10px", borderRadius: "6px" }}>완료</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* MY PAGE */}
            {screen === 'mypage' && (
              <div>
                <div style={{ background: "white", borderBottom: "1px solid #E5E7EB", padding: "0 40px", height: "64px", display: "flex", alignItems: "center", position: "sticky", top: 0, zIndex: 10 }}>
                  <h1 style={{ fontSize: "20px", fontWeight: 900, color: "#111827", margin: "0", letterSpacing: "-0.5px" }}>마이페이지</h1>
                </div>
                <div style={{ padding: "32px 40px", maxWidth: "860px", display: "grid", gridTemplateColumns: "280px 1fr", gap: "24px", alignItems: "start" }}>
                  <div style={{ background: "white", borderRadius: "16px", padding: "24px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                    <div style={{ textAlign: "center", paddingBottom: "20px", borderBottom: "1px solid #F3F4F6", marginBottom: "20px" }}>
                      <div style={{ width: "64px", height: "64px", borderRadius: "32px", background: "#EFF6FF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "28px", margin: "0 auto 12px" }}>👤</div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827", marginBottom: "7px", wordBreak: "break-all" }}>resident@aitteulak.com</div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "white", background: "#2563EB", padding: "3px 8px", borderRadius: "4px" }}>입주민</span>
                        <span style={{ fontSize: "13px", color: "#374151", fontWeight: 600 }}>A동 201호</span>
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                      <div style={{ textAlign: "center", padding: "14px", background: "#F9FAFB", borderRadius: "10px" }}>
                        <div style={{ fontSize: "24px", fontWeight: 900, color: "#2563EB", marginBottom: "4px", letterSpacing: "-0.5px" }}>3</div>
                        <div style={{ fontSize: "12px", color: "#6B7280", fontWeight: 500 }}>작성한 건의</div>
                      </div>
                      <div style={{ textAlign: "center", padding: "14px", background: "#F9FAFB", borderRadius: "10px" }}>
                        <div style={{ fontSize: "24px", fontWeight: 900, color: "#16A34A", marginBottom: "4px", letterSpacing: "-0.5px" }}>1</div>
                        <div style={{ fontSize: "12px", color: "#6B7280", fontWeight: 500 }}>완료된 건의</div>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={{ background: "white", borderRadius: "16px", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                      <div onClick={() => setScreen('suggestions')} style={{ padding: "16px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", borderBottom: "1px solid #F9FAFB" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}><span style={{ fontSize: "20px" }}>📝</span><span style={{ fontSize: "15px", fontWeight: 500, color: "#111827" }}>내 건의사항</span></div>
                        <svg width="6" height="10" viewBox="0 0 7 12" fill="none"><path d="M1 11L6 6L1 1" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                      </div>
                      <div style={{ padding: "16px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", borderBottom: "1px solid #F9FAFB" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}><span style={{ fontSize: "20px" }}>🔔</span><span style={{ fontSize: "15px", fontWeight: 500, color: "#111827" }}>알림 설정</span></div>
                        <svg width="6" height="10" viewBox="0 0 7 12" fill="none"><path d="M1 11L6 6L1 1" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                      </div>
                      <div style={{ padding: "16px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}><span style={{ fontSize: "20px" }}>🔒</span><span style={{ fontSize: "15px", fontWeight: 500, color: "#111827" }}>비밀번호 변경</span></div>
                        <svg width="6" height="10" viewBox="0 0 7 12" fill="none"><path d="M1 11L6 6L1 1" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                      </div>
                    </div>
                    <div style={{ background: "white", borderRadius: "16px", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                      <div style={{ padding: "16px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", borderBottom: "1px solid #F9FAFB" }}>
                        <span style={{ fontSize: "14px", color: "#374151" }}>이용약관</span>
                        <svg width="6" height="10" viewBox="0 0 7 12" fill="none"><path d="M1 11L6 6L1 1" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                      </div>
                      <div style={{ padding: "16px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}>
                        <span style={{ fontSize: "14px", color: "#374151" }}>개인정보 처리방침</span>
                        <svg width="6" height="10" viewBox="0 0 7 12" fill="none"><path d="M1 11L6 6L1 1" stroke="#D1D5DB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"></path></svg>
                      </div>
                    </div>
                    <button onClick={handleLogout} style={{ width: "100%", height: "46px", background: "white", color: "#DC2626", border: "1.5px solid #FEE2E2", borderRadius: "12px", fontSize: "15px", fontWeight: 600, cursor: "pointer" }}>로그아웃</button>
                  </div>
                </div>
              </div>
            )}

            {/* ADMIN DASHBOARD */}
            {screen === 'admin' && (
              <div>
                <div style={{ background: "white", borderBottom: "1px solid #E5E7EB", padding: "0 40px", height: "64px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
                  <div>
                    <div style={{ fontSize: "11px", color: "#9CA3AF", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: "1px" }}>관리사무소</div>
                    <h1 style={{ fontSize: "18px", fontWeight: 900, color: "#111827", margin: "0", letterSpacing: "-0.5px" }}>관리 대시보드</h1>
                  </div>
                  <div style={{ width: "36px", height: "36px", background: "#EFF6FF", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ fontSize: "18px" }}>🔧</span></div>
                </div>
                <div style={{ padding: "32px 40px" }}>
                  {/* Stats */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "16px", marginBottom: "28px" }}>
                    <div style={{ background: "white", borderRadius: "14px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                      <div style={{ fontSize: "11px", color: "#9CA3AF", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.3px", marginBottom: "10px" }}>미처리 건의</div>
                      <div style={{ fontSize: "34px", fontWeight: 900, color: "#D97706", marginBottom: "4px", letterSpacing: "-1px" }}>3</div>
                      <div style={{ fontSize: "12px", color: "#9CA3AF" }}>처리 대기 중</div>
                    </div>
                    <div style={{ background: "white", borderRadius: "14px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                      <div style={{ fontSize: "11px", color: "#9CA3AF", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.3px", marginBottom: "10px" }}>미인증 회원</div>
                      <div style={{ fontSize: "34px", fontWeight: 900, color: "#DC2626", marginBottom: "4px", letterSpacing: "-1px" }}>5</div>
                      <div style={{ fontSize: "12px", color: "#9CA3AF" }}>동/호수 미인증</div>
                    </div>
                    <div style={{ background: "white", borderRadius: "14px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                      <div style={{ fontSize: "11px", color: "#9CA3AF", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.3px", marginBottom: "10px" }}>진행 추첨</div>
                      <div style={{ fontSize: "34px", fontWeight: 900, color: "#2563EB", marginBottom: "4px", letterSpacing: "-1px" }}>1</div>
                      <div style={{ fontSize: "12px", color: "#9CA3AF" }}>신청자 47명</div>
                    </div>
                    <div style={{ background: "white", borderRadius: "14px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                      <div style={{ fontSize: "11px", color: "#9CA3AF", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.3px", marginBottom: "10px" }}>오늘 공지</div>
                      <div style={{ fontSize: "34px", fontWeight: 900, color: "#16A34A", marginBottom: "4px", letterSpacing: "-1px" }}>1</div>
                      <div style={{ fontSize: "12px", color: "#9CA3AF" }}>등록 완료</div>
                    </div>
                  </div>
                  {/* Quick actions */}
                  <div style={{ background: "white", borderRadius: "14px", padding: "20px 28px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", marginBottom: "24px" }}>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "#374151", marginBottom: "16px", textTransform: "uppercase", letterSpacing: "0.4px" }}>빠른 관리</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "12px" }}>
                      <div style={{ padding: "18px", background: "#EFF6FF", borderRadius: "12px", textAlign: "center", cursor: "pointer" }}>
                        <div style={{ fontSize: "24px", marginBottom: "6px" }}>📢</div>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: "#1D4ED8" }}>공지 등록</div>
                      </div>
                      <div onClick={() => setScreen('suggestions')} style={{ padding: "18px", background: "#FEF3C7", borderRadius: "12px", textAlign: "center", cursor: "pointer" }}>
                        <div style={{ fontSize: "24px", marginBottom: "6px" }}>📝</div>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: "#92400E" }}>건의 관리</div>
                      </div>
                      <div onClick={() => setScreen('parking')} style={{ padding: "18px", background: "#F0FDF4", borderRadius: "12px", textAlign: "center", cursor: "pointer" }}>
                        <div style={{ fontSize: "24px", marginBottom: "6px" }}>🚗</div>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: "#166534" }}>추첨 관리</div>
                      </div>
                      <div style={{ padding: "18px", background: "#F3F4F6", borderRadius: "12px", textAlign: "center", cursor: "pointer" }}>
                        <div style={{ fontSize: "24px", marginBottom: "6px" }}>👥</div>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: "#374151" }}>회원 관리</div>
                      </div>
                    </div>
                  </div>
                  {/* Recent suggestions */}
                  <div style={{ background: "white", borderRadius: "14px", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                    <div style={{ padding: "18px 28px", borderBottom: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "15px", fontWeight: 800, color: "#111827", letterSpacing: "-0.3px" }}>최근 건의</span>
                      <span onClick={() => setScreen('suggestions')} style={{ fontSize: "13px", color: "#2563EB", fontWeight: 600, cursor: "pointer" }}>전체 보기 →</span>
                    </div>
                    {SUGGESTIONS.map(item => (
                      <div
                        key={item.id}
                        onClick={handleOpenSuggestion}
                        data-id={item.id}
                        style={{ padding: "16px 28px", borderBottom: "1px solid #F9FAFB", cursor: "pointer", display: "flex", alignItems: "center", gap: "14px" }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "14px", fontWeight: 500, color: "#111827", marginBottom: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: "-0.2px" }}>{item.title}</div>
                          <div style={{ fontSize: "12px", color: "#9CA3AF" }}>{item.unit} · {item.date}</div>
                        </div>
                        <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 9px", borderRadius: "5px", flexShrink: 0, background: item.statusBg, color: item.statusColor }}>{item.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

          </div>

        </div>
      )}
    </>
  );
}
