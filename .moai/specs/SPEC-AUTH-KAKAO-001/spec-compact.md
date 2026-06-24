---
spec_id: "SPEC-AUTH-KAKAO-001"
title: "카카오 OAuth 2.0 소셜 로그인 (Compact)"
version: "1.1.0"
status: "Planned"
created: "2026-06-24"
updated: "2026-06-24"
author: "강력쇠주먹"
priority: "High"
issue_number: ""
labels: ["auth", "oauth", "kakao", "compact"]
---

# SPEC-AUTH-KAKAO-001 (Compact)

카카오 OAuth 2.0 소셜 로그인(AUTH-02). 기존 이메일 인증(SPEC-AUTH-001)에 카카오 로그인 추가. brownfield 확장.

---

## 핵심 결정

1. **계정 정책**: 이메일 기준 자동 연결 (기존 이메일 일치 → 연결, 미존재 → RESIDENT 신규 가입)
2. **verified**: 기존 verify-unit 플로우 유지 (verified=false → /verify)
3. **세션**: 기존 JWT/쿠키 인프라 전면 재사용
4. **카카오 토큰**: 1회 사용 후 폐기, DB/쿠키/로그 미저장

---

## 범위

- **In**: 카카오 Authorization Code 플로우(`/api/auth/kakao`, `/api/auth/kakao/callback`), 환경변수 3종, Migration 011, state CSRF 방어(Max-Age=600s), useAuth.kakaoLogin(), TabletApp stub 교체 + MobileApp/DesktopApp 카카오 버튼 신규 추가
- **Out**: 타 소셜 provider, 카카오 싱크, 비밀번호 재설정, 계정 연결 해제 UI, 카카오 토큰 저장

---

## REQ 목록 (17개)

### M1. 인증 시작
- REQ-KAKAO-001 (Event): `GET /api/auth/kakao` → state 생성(Max-Age=600s) + 302 리다이렉트
- REQ-KAKAO-002 (Unwanted): 환경변수 누락 시 500

### M2. 콜백 처리
- REQ-KAKAO-003 (Event): code → 카카오 토큰 교환 (state 검증 후, 콜백 완료 시 쿠키 삭제)
- REQ-KAKAO-004 (Unwanted): state 불일치 시 400 (CSRF 방어)
- REQ-KAKAO-005 (Event): 카카오 토큰으로 사용자 정보 조회
- REQ-KAKAO-006 (Unwanted): 카카오 이메일 누락 시 거부

### M3. 계정 연결
- REQ-KAKAO-007 (State): 기존 이메일 일치 시 provider/provider_id 갱신 + password_hash 유지 + 최초 연결 알림 (자동 연결)
- REQ-KAKAO-008 (Event): 신규 이메일 시 RESIDENT 자동 가입 (password_hash=NULL)
- REQ-KAKAO-009 (Unwanted): 카카오 ID 중복 연결 시 409
- REQ-KAKAO-010 (Unwanted): INACTIVE 계정 시 403

### M4. 세션 발급
- REQ-KAKAO-011 (Event): 기존 JWT 세션 발급 (AT/RT 쿠키)
- REQ-KAKAO-012 (State): verified=false 시 /verify 리다이렉트
- REQ-KAKAO-013 (Unwanted): 카카오 토큰 DB/쿠키/로그 저장 금지

### M5. 프론트엔드
- REQ-KAKAO-014 (Event): 카카오 버튼 클릭 → kakaoLogin() → /api/auth/kakao (TabletApp stub 교체 + MobileApp/DesktopApp 신규 추가)
- REQ-KAKAO-015 (Ubiquitous): 카카오 버튼 항상 활성 (stub/disabled/가짜 로그인 금지)
- REQ-KAKAO-016 (Event): 카카오 로그인 후 useAuth 마운트 시 /api/auth/me 세션 복원

### M6. 자동 연결 계정 로그인 보존
- REQ-KAKAO-017 (State): 자동 연결 후에도 이메일/비밀번호 로그인 보존(silent lockout 방지) + 최초 연결 알림

---

## 주요 제약

- state CSRF 방어 (crypto.randomUUID, httpOnly SameSite=Lax 쿠키, **Max-Age=600s**, 콜백 완료 시 삭제)
- Client Secret 환경 변수만 (하드코딩/로그 금지)
- 카카오 토큰 1회 사용 후 폐기
- 카카오 API 서버 측에서만 호출
- 이메일 자동 연결 탈취 완화: 기존 provider='kakao' 시 거부, 최초 연결 알림, 비밀번호 로그인 보존
- PKCE 도입 Run Phase 검토 (2026 OAuth 권장)
- P95 2000ms 이하 (외부 API 포함)

---

## 환경 변수

| 변수 | 용도 |
|------|------|
| `KAKAO_REST_API_KEY` | 카카오 앱 REST API 키 (client_id) |
| `KAKAO_CLIENT_SECRET` | 토큰 교환용 secret |
| `KAKAO_REDIRECT_URI` | 콜백 URL |

---

## 파일 변경 요약

| 파일 | 변경 |
|------|------|
| `src/app/api/auth/kakao/route.ts` | [NEW] 인증 시작 |
| `src/app/api/auth/kakao/callback/route.ts` | [NEW] 콜백 처리 |
| `src/lib/kakao.ts` | [NEW] 카카오 OAuth 헬퍼 |
| `src/lib/kakao-account.ts` | [NEW] 계정 연결 로직 |
| `src/lib/env.ts` | [MODIFY] 카카오 변수 부트 검증 |
| `src/hooks/useAuth.ts` | [MODIFY] kakaoLogin() 추가 |
| `src/components/TabletApp.tsx` | [MODIFY] L477 stub 교체 |
| `src/components/MobileApp.tsx` | [NEW] 카카오 버튼 신규 추가 |
| `src/components/DesktopApp.tsx` | [NEW] 카카오 버튼 신규 추가 |
| `migrations/011_kakao_oauth.sql` | [NEW] 부분 유니크 인덱스 |

---

## 참조

- 상세: `spec.md`, `plan.md`, `acceptance.md`
- 선행: SPEC-AUTH-001, SPEC-INTEGRATION-AUTH-001
- 사용자 결정: `interview.md`
