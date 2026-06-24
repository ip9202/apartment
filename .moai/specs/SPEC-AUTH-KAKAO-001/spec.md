---
id: "SPEC-AUTH-KAKAO-001"
title: "카카오 OAuth 2.0 소셜 로그인"
version: "1.1.0"
status: "Completed"
created: "2026-06-24"
updated: "2026-06-24"
author: "강력쇠주먹"
priority: "High"
issue_number: 4
labels: ["auth", "oauth", "kakao", "social-login"]
---

# SPEC-AUTH-KAKAO-001: 카카오 OAuth 2.0 소셜 로그인

아이뜨락 아파트 커뮤니티 플랫폼에 카카오 OAuth 2.0 소셜 로그인(AUTH-02)을 추가한다. 기존 이메일/비밀번호 인증(SPEC-AUTH-001)과 동일한 JWT 세션 체계를 재사용하며, 카카오 인증으로 가입한 사용자도 동일한 verify-unit 플로우를 거친다.

본 SPEC은 brownfield 확장이므로 Delta 마커([EXISTING]/[MODIFY]/[NEW])를 사용하여 기존 자산과의 관계를 명시한다.

---

## HISTORY

- **2026-06-24 (v1.0.0)**: 최초 작성 (강력쇠주먹). Interview Round 1 확정 결정 2종 반영: (1) 이메일 기준 자동 계정 연결 정책, (2) 기존 verify-unit 플로우 유지. SPEC-INTEGRATION-AUTH-001 REQ-AUTH-INT-026의 "카카오 준비 중" stub을 실구현으로 교체하는 후속 SPEC.
- **2026-06-24 (v1.1.0)**: plan-auditor iteration 1 FAIL 결함 수정. D1(3뷰포트 stub 허위 주장 정정 — 실제는 TabletApp.tsx:477만 stub 존재, MobileApp/DesktopApp은 카카오 버튼 자체 부재 → 신규 추가로 명확화), D3(REQ-KAKAO-015 EARS Unwanted→Ubiquitous 재분류), D4(REQ-KAKAO-016 Ubiquitous→Event-Driven 재분류, 내장 조건 제거), D5(자동 연결 후 이메일/비밀번호 로그인 보존 명시 + silent lockout 방지 REQ-KAKAO-017 및 AC-KAKAO-019 추가), D6(PKCE 도입 검토 §6.1 추가), D7(state 쿠키 Max-Age=600s 명시 + 콜백 완료 시 삭제 AC-KAKAO-003 갱신), D8(이메일 자동 연결 계정 탈취 완화 — 최초 연결 시 기존 이메일 계정에 알림 발송, 카카오 이메일 검증 신뢰 전제 명시), D9(AC-KAKAO-014 `grep logs/` → 구조화 로거 검증으로 정정). D2(frontmatter labels/created_at/enum 주장)은 기존 9개 SPEC 관행 준거로 이의 제기 — labels만 선택 추가, created/status는 관행 유지.

---

## 1. 배경 및 목적

기존 인증 시스템은 이메일/비밀번호 자격증명만 지원한다(SPEC-AUTH-001). 한국 사용자 대부분이 카카오 계정을 보유하고 있으므로, 카카오 로그인 버튼 하나로 가입·로그인 마찰을 줄인다.

본 SPEC이 달성해야 할 목표:

- 카카오 OAuth 2.0 Authorization Code 플로우로 카카오 계정 인증 (AUTH-02)
- 카카오가 제공한 이메일을 기준으로 기존 계정과 자동 연결 또는 신규 RESIDENT 가입
- 카카오 가입자도 기존 JWT 세션(AT 15분 httpOnly 쿠키 / RT 7일)을 동일하게 사용 — 세션 메커니즘의 단일성 유지
- 카카오 가입자도 기존 verify-unit 플로우 준수 (verified=false → /verify)
- CSRF 방지를 위한 `state` 파라미터 검증
- 프론트엔드 카카오 로그인 버튼 활성화: `TabletApp.tsx` 기존 stub을 실구현으로 교체, `MobileApp.tsx`·`DesktopApp.tsx`에 카카오 버튼 신규 추가 (3뷰포트 UX 일관성)

기술 결정 근거는 `SPEC-AUTH-001/spec.md` ADR-003(JWT), `.moai/project/tech.md`, 그리고 카카오 로그인 공식 문서(developers.kakao.com)를 참조한다.

---

## 2. 용어 (Glossary)

| 용어 | 정의 |
|------|------|
| 카카오 OAuth 2.0 | 카카오가 제공하는 OAuth 2.0 Authorization Code 플로우 기반 인증. |
| Authorization Code | 카카오 인증 후 리다이렉트로 전달되는 1회성 코드. 서버가 토큰 교환 API로 전달하여 액세스 토큰을 발급받는다. |
| `state` | CSRF 방지용 난수 문자열. 인증 시작 시 생성하여 카카오에 전달, 콜백에서 검증한다. |
| `KAKAO_REST_API_KEY` | 카카오 개발자콘솔에서 발급받은 앱의 REST API 키 (client_id 역할). |
| `KAKAO_CLIENT_SECRET` | 카카오 앱의 Client Secret (토큰 교환 시 필수, 활성화 필요). |
| `KAKAO_REDIRECT_URI` | 카카오 인증 완료 후 돌아올 서버 콜백 URL (`/api/auth/kakao/callback`). |
| 계정 연결 (Account Linking) | 카카오 이메일이 기존 `users.email`과 일치하면 해당 계정에 카카오 수단을 연결. |
| provider | `users.provider` 컬럼 값. `'email'` 또는 `'kakao'`. |
| provider_id | `users.provider_id` 컬럼. 카카오 사용자 고유 ID (불변). |

---

## 3. 범위

### 3.1 In-Scope (본 SPEC이 구현하는 것)

- **[NEW]** 카카오 OAuth Authorization Code 플로우:
  - `GET /api/auth/kakao` — 카카오 인증 화면으로 리다이렉트 (state 포함)
  - `GET /api/auth/kakao/callback` — code → 토큰 교환 → 사용자 정보 조회 → 계정 연결/가입 → 세션 발급
- **[NEW]** 환경 변수: `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `KAKAO_REDIRECT_URI`
- **[NEW]** DB 마이그레이션 011: `users` 테이블 OAuth 연결 보조 인덱스 (`provider`, `provider_id` 조합 유일성 보조)
- **[EXISTING]** `users` 테이블의 `provider`, `provider_id`, `email`, `password_hash`, `role_id`, `verified_at`, `status` 컬럼 재사용 (migration 001에 이미 존재)
- **[EXISTING]** JWT 세션(`src/lib/auth.ts`), 쿠키 정책(`src/lib/cookies.ts`), 미들웨어(`src/middleware.ts`) 재사용
- **[MODIFY]** `useAuth` 훅: `kakaoLogin()` 액션 추가 (카카오 인증 시작 URL로 리다이렉트)
- **[MODIFY]** `TabletApp.tsx` 카카오 버튼: 기존 비활성성 stub(`doLogin('kakao@user.com','kakao')` + disabled + "준비 중", L477) → `useAuth.kakaoLogin()` 실구현 트리거로 교체
- **[NEW]** `MobileApp.tsx`, `DesktopApp.tsx`: 카카오 로그인 버튼 신규 추가 (현재 카카오 버튼 자체가 부재 — `grep "kakao\|카카오" src/components/MobileApp.tsx src/components/DesktopApp.tsx` 0 matches 확인). 3뷰포트 UX 일관성 확보를 위해 TabletApp과 동일한 버튼 컴포넌트/스타일/트리거(`kakaoLogin()`) 적용

### 3.2 Out-of-Scope (별도 SPEC 또는 명시적 OUT)

> 별도 SPEC으로 다룬다. 본 SPEC 구현 중 발견되더라도 수정하지 않는다.

- **타 소셜 provider**: Google, Naver, Apple 등 — 카카오만 지원
- **카카오 싱크(Kakao Sync)**: 추가 항목 동의, 메시지 API, 알림톡 — OUT
- **비밀번호 재설정**: SPEC-AUTH-RESET-001 소관
- **계정 연결 해제 UI**: 카카오 계정과 이메일 계정 연결을 사용자가 직접 끊는 기능 — OUT (본 SPEC은 자동 연결만)
- **다중 provider 연결**: 한 계정에 카카오+Google 동시 연결 — OUT
- **카카오 토큰 갱신/장기 세션**: 카카오 access_token/refresh_token 저장 및 갱신 로직 — OUT (본 SPEC은 카카오 토큰을 1회 사용 후 폐기, 서비스 자체 JWT만 유지)
- **기존 verify-unit 플로우 변경**: 카카오 가입자도 동일한 verify-unit 화면/엔드포인트 사용 (변경 없음)

---

## 4. 가정 및 사전 조건 (Dependencies)

본 SPEC은 다음 사전 조건이 충족되었다고 가정한다:

1. **[EXISTING] SPEC-AUTH-001 완료**: 이메일/비밀번호 인증, JWT 세션, verify-unit, 강제 탈퇴가 모두 구현되어 있다.
2. **[EXISTING] SPEC-INTEGRATION-AUTH-001 완료**: `useAuth` 훅, `/api/auth/me`, 데모 계정 시드, 3개 뷰포트 API 연동이 완료되어 있다.
3. **[EXISTING] `users` 테이블 스키마**: migration 001에 `provider`(기본값 `'email'`), `provider_id`(NULL 허용) 컬럼이 존재한다. 본 SPEC은 이 컬럼을 소비만 한다.
4. **카카오 개발자콘솔 앱 등록**: 앱 생성, REST API 키 발급, Client Secret 활성화, `KAKAO_REDIRECT_URI`에 콜백 URL 등록 완료되어 있어야 한다 (운영자 사전 작업).
5. **[EXISTING] 환경 변수 부트 검증**: `src/lib/env.ts`에 카카오 환경 변수 3종을 추가 등록한다 (누락 시 fail-fast).
6. **[EXISTING] HTTPS 환경**: 카카오는 프로덕션 콜백 URL을 HTTPS만 허용. Railway 환경은 자동 HTTPS. 개발 환경은 `localhost` 예외 허용.
7. **카카오 계정 이메일 동의 항목**: 카카오 앱 설정에서 "카카오계정(이메일)" 동의 항목이 필수 동의로 설정되어 있어야 한다. 이메일 없이는 계정 연결/가입이 불가하다.

---

## 5. 기능 요구사항 (EARS)

### M1. 카카오 인증 시작 (Authorization Redirect)

#### REQ-KAKAO-001 (Event-Driven) — 카카오 로그인 시작 시 state 포함 리다이렉트

> **When** 클라이언트가 `GET /api/auth/kakao`로 요청하면, the system **shall** 난수 `state` 값을 생성하여 httpOnly + SameSite=Lax + **Max-Age=600초** 임시 쿠키에 저장하고, 카카오 인증 화면으로 302 리다이렉트하되 URL에 `client_id`, `redirect_uri`, `response_type=code`, `state`, `scope=account_email` 파라미터를 포함한다. state 쿠키의 TTL은 600초(10분)를 초과할 수 없으며, 콜백 처리 완료 시 즉시 만료(Max-Age=0)되어야 한다.

#### REQ-KAKAO-002 (Unwanted) — state 없는 요청 거부

> **If** 카카오 인증 시작 시 `KAKAO_REST_API_KEY` 또는 `KAKAO_REDIRECT_URI` 환경 변수가 누락되면, **then** the system **shall not** 카카오로 리다이렉트하고, 500 응답과 함께 "카카오 로그인 설정 오류" 메시지를 반환한다 (부트 검증과 별도로 런타임 안전망).

### M2. 카카오 콜백 처리 (Authorization Code → Token → Session)

#### REQ-KAKAO-003 (Event-Driven) — 콜백 code로 토큰 교환

> **When** 카카오가 `GET /api/auth/kakao/callback?code=...&state=...`로 리다이렉트하면, the system **shall** `state` 쿠키값과 URL `state` 파라미터가 일치하는지 검증한 뒤, 카카오 토큰 교환 API(`POST https://kauth.kakao.com/oauth/token`)에 `grant_type=authorization_code`, `client_id`, `client_secret`, `code`, `redirect_uri`를 전송하여 카카오 액세스 토큰을 발급받는다.

#### REQ-KAKAO-004 (Unwanted) — state 불일치 시 거부

> **If** 콜백의 `state` 파라미터가 시작 시 발급한 state 쿠키값과 일치하지 않거나 쿠키가 없으면, **then** the system **shall not** 토큰 교환을 진행하고 400 Bad Request와 함께 "잘못된 접근입니다"를 반환한다 (CSRF 방어).

#### REQ-KAKAO-005 (Event-Driven) — 카카오 토큰으로 사용자 정보 조회

> **When** 카카오 액세스 토큰 발급에 성공하면, the system **shall** 카카오 사용자 정보 API(`GET https://kapi.kakao.com/v2/user/me`)에 `Authorization: Bearer <카카오_access_token>` 헤더로 요청하여 카카오 고유 ID와 이메일을 조회한다.

#### REQ-KAKAO-006 (Unwanted) — 카카오 이메일 누락 시 거부

> **If** 카카오 사용자 정보에 이메일이 없거나 이메일 제공에 동의하지 않은 경우, **then** the system **shall not** 가입/연결을 진행하고, 카카오 동의 화면으로 재유도하거나 안내 메시지("이메일 제공 동의가 필요합니다")와 함께 로그인 화면으로 리다이렉트한다.

### M3. 계정 연결 및 신규 가입 (이메일 기준 자동 연결)

#### REQ-KAKAO-007 (State-Driven) — 기존 이메일 일치 시 카카오 수단 연결

> **While** 카카오가 제공한 이메일이 기존 `users.email` 레코드와 일치하는 상태인 경우, the system **shall** 해당 회원 레코드의 `provider='kakao'`, `provider_id=<카카오_ID>`를 갱신하고 기존 `role_id`, `unit_id`, `verified_at`, `status`, **`password_hash`**를 유지한다 (자동 계정 연결). 단, 기존 계정의 `provider`가 이미 `'kakao'`이고 `provider_id`가 현재 카카오 ID와 다른 경우 연결을 거부한다 (계정 탈취 방어 — §6.1). 최초 1회 연결 시 기존 이메일 계정 소유자에게 연결 사실을 이메일로 알린다 (REQ-KAKAO-017).

#### REQ-KAKAO-008 (Event-Driven) — 신규 이메일 시 RESIDENT 자동 가입

> **When** 카카오 이메일이 기존 `users`에 존재하지 않으면, the system **shall** `role=RESIDENT`, `verified_at=NULL`, `status=ACTIVE`, `provider='kakao'`, `provider_id=<카카오_ID>`, `password_hash=NULL`인 신규 회원 레코드를 생성한다 (비밀번호 없는 소셜 전용 계정).

#### REQ-KAKAO-009 (Unwanted) — 카카오 ID 중복 연결 방지

> **If** 동일한 카카오 `provider_id`가 이미 다른 이메일 계정에 연결되어 있으면, **then** the system **shall not** 새 연결을 생성하고 409 Conflict 응답과 함께 "이미 다른 계정에 연결된 카카오 계정입니다"를 반환한다 (한 카카오 계정 = 한 서비스 계정).

#### REQ-KAKAO-010 (Unwanted) — INACTIVE 계정 로그인 차단

> **If** 자동 연결 대상 기존 계정의 `status='INACTIVE'`인 경우(강제 탈퇴 등), **then** the system **shall not** 세션을 발급하고 403 Forbidden과 함께 "관리사무소에 문의하세요"를 반환한다 (SPEC-AUTH-001 REQ-AUTH-014 연동).

### M4. 세션 발급 (JWT 재사용)

#### REQ-KAKAO-011 (Event-Driven) — 연결/가입 성공 시 기존 JWT 세션 발급

> **When** 계정 연결 또는 신규 가입이 완료되면, the system **shall** 기존 `signAccessToken` / `signRefreshToken`(`src/lib/auth.ts`)을 사용하여 AT(15분)와 RT(7일)를 발급하고, AT는 httpOnly 쿠키(`buildAccessCookie`), RT는 httpOnly 쿠키(`buildRefreshCookie`)로 설정한 뒤 클라이언트를 `verified` 상태에 따라 리다이렉트한다.

#### REQ-KAKAO-012 (State-Driven) — verified=false 시 /verify 강제 이동

> **While** 카카오 로그인으로 발급된 사용자의 `verified_at=NULL` 상태인 경우, the system **shall** 콜백 완료 후 클라이언트를 `/verify`로 리다이렉트한다 (기존 verify-unit 플로우 준수, SPEC-AUTH-001 REQ-AUTH-013 및 SPEC-INTEGRATION-AUTH-001 REQ-AUTH-INT-013과 일관).

#### REQ-KAKAO-013 (Unwanted) — 카카오 토큰 메모리 외 저장 금지

> **If** 카카오 토큰 교환 및 사용자 정보 조회가 완료되면, **then** the system **shall not** 카카오 액세스 토큰·리프레시 토큰을 DB, 쿠키, 로그에 저장하고, 즉시 메모리에서 폐기한다 (최소권한 원칙 — 서비스는 자체 JWT만 유지).

### M5. 프론트엔드 카카오 버튼 활성화

#### REQ-KAKAO-014 (Event-Driven) — 카카오 버튼 클릭 시 인증 시작

> **When** 사용자가 3개 뷰포트(`MobileApp`, `TabletApp`, `DesktopApp`) 중 하나의 "카카오로 시작하기" 버튼을 클릭하면, the system **shall** `useAuth.kakaoLogin()`을 호출하여 `window.location.href = '/api/auth/kakao'`로 서버 측 인증 시작 엔드포인트로 이동한다 (가짜 로그인 폴백 금지). `TabletApp.tsx`는 기존 stub(`doLogin('kakao@user.com','kakao')`, L477)을 실구현으로 교체하고, `MobileApp.tsx`·`DesktopApp.tsx`는 카카오 버튼을 신규 추가한다 (현재 두 파일에는 카카오 버튼이 존재하지 않음).

#### REQ-KAKAO-015 (Ubiquitous) — 카카오 버튼 활성 트리거 일관성

> The system **shall** 3개 뷰포트의 카카오 버튼을 항상 활성화된 상태로 제공하며, `doLogin('kakao@user.com','kakao')` 형태의 가짜 로그인 폴백이나 `disabled` + "준비 중" 라벨을 표시하지 않는다 (SPEC-INTEGRATION-AUTH-001 REQ-AUTH-INT-026 stub 교체 완료 상태).

#### REQ-KAKAO-016 (Event-Driven) — 카카오 로그인 후 세션 복원 일관성

> **When** 카카오 로그인 콜백이 완료되어 리다이렉트된 페이지에서 `useAuth` 훅이 마운트되면, the system **shall** `/api/auth/me`를 호출하여 카카오 가입자의 로그인 상태를 이메일 가입자와 동일하게 복원한다 (세션 메커니즘 단일성).

### M6. 자동 연결 계정 로그인 보존 (Silent Lockout 방지)

#### REQ-KAKAO-017 (State-Driven) — 자동 연결 후에도 기존 이메일/비밀번호 로그인 보존

> **While** 카카오 자동 연결(REQ-KAKAO-007)로 인해 회원 레코드의 `provider='kakao'`로 갱신된 상태인 경우, the system **shall** 기존 `password_hash`가 보존되어 있을 때 이메일/비밀번호 로그인 엔드포인트(`POST /api/auth/login`)를 통해 기존 비밀번호로 로그인할 수 있도록 허용한다 (`provider` 값은 가입 경로 표시용 메타데이터일 뿐, 이메일/비밀번호 인증을 차단하지 않음). 또한 기존 이메일 계정에 카카오 수단이 **최초 1회** 연결되는 경우, 해당 계정의 이메일 주소로 "카카오 계정이 연결되었습니다" 알림을 발송하여 silent lockout 및 계정 탈취를 탐지할 수 있는 창을 제공한다.

---

## 6. 비기능 요구사항 (제약)

### 6.1 보안 (Security)

- **[HARD] state CSRF 방어**: `state`는 예측 불가능한 난수(crypto.randomUUID 또는 동등), httpOnly + SameSite=Lax 쿠키에 저장, 콜백에서 반드시 비교. 불일치 시 400.
- **[HARD] state 쿠키 TTL**: state 쿠키는 **Max-Age=600초(10분)** 를 초과할 수 없음 (REQ-KAKAO-001). 세션 쿠키(무제한 TTL) 사용 금지. 콜백 처리 완료 시 즉시 Max-Age=0으로 삭제되어 1회성 사용을 보장 (재생 공격 창 최소화).
- **[HARD] Client Secret 보호**: `KAKAO_CLIENT_SECRET`는 환경 변수로만 제공, 소스 코드 하드코딩 금지, 응답 본문/로그에 노출 금지.
- **[HARD] 카카오 토큰 미저장**: 카카오 access_token, refresh_token은 1회 사용 후 메모리에서만 폐기. DB/쿠키/로그 저장 금지 (REQ-KAKAO-013).
- **[RECOMMENDED] PKCE (Proof Key for Code Exchange)**: RFC 7636/9700. 2026년 OAuth 2.0 권장사항에 따라 Authorization Code 플로우에 PKCE(`code_verifier`/`code_challenge`) 도입을 권장. 서버 측 confidential client이므로 필수는 아니나, 브라우저 리다이렉트 기반 플로우의 심층 방어(depth-in-defense)로 권장. Run Phase에서 도입 여부를 최종 결정하되, 미도입 시 그 근거를 본 섹션에 명시.
- **[HARD] 이메일 자동 연결 계정 탈취 완화**: 카카오 이메일이 기존 `users.email`과 일치하여 자동 연결 시, 카카오 이메일 검증을 본인확인의 **충분조건이 아닌 보조 신호**로 취급. 완화 조치 (REQ-KAKAO-017): (a) 기존 계정의 `provider`가 이미 `'kakao'`이고 다른 `provider_id`가 설정된 경우 연결 거부 (이미 연결된 계정 보호), (b) 최초 1회 카카오 연결 시 기존 이메일 계정 소유자에게 "카카오 계정이 연결되었습니다" 이메일 알림 발송 (탈취 탐지 창 제공), (c) 카카오 이메일 검증 신뢰 전제 — 카카오 계정 이메일은 카카오 본인인증/Kakao 인증서 기반으로 검증되나, 서비스 자체 계정 소유권 증명과 동등하지는 않음을 명시적 전제로 기록.
- **[EXISTING] JWT/쿠키 정책 준수**: 카카오 세션도 기존 `src/lib/auth.ts`, `src/lib/cookies.ts` 정책을 그대로 사용. 별도 쿠키 속성 하드코딩 금지.
- **[EXISTING] SQL Injection 방어**: 모든 DB 쿼리는 parameterized query 사용.
- **[HTTPS 강제]**: 카카오 콜백은 프로덕션 HTTPS 환경에서만 동작. 개발은 localhost 예외.

### 6.2 성능 (Performance)

- 카카오 토큰 교환 + 사용자 정보 조회 + DB upsert + JWT 발급 전체 흐름: P95 2000ms 이하 (외부 API 의존).
- 카카오 API 호출은 서버 측에서만 수행, 클라이언트에서 카카오 API 직접 호출 금지.

### 6.3 가용성 (Availability)

- 카카오 API 장애 시 사용자에게 "카카오 로그인을 일시적으로 사용할 수 없습니다" 안내 후 이메일 로그인 화면으로 폴백 (자동 재시도 없음, 최대 1회).

### 6.4 감사 (Auditability)

- 카카오 로그인 성공/실패 이벤트는 애플리케이션 로그로 기록 (이메일, provider_id, 성공여부). 카카오 토큰은 로그에서 제외.

### 6.5 개인정보 최소화 (Data Minimization)

- 카카오에서 수집하는 항목: 이메일, 카카오 고유 ID만.
- 미수집: 카카오 닉네임, 프로필 이미지, 출생연도, 성별, 전화번호 (동의 항목에서 제외).
- 카카오 이메일은 서비스 이메일 계정과 동일 취급 (기존 개인정보 처리 방침 준거).

---

## 7. Exclusions (What NOT to Build)

본 SPEC은 다음 항목을 구현하지 않는다:

1. **타 소셜 provider (Google, Naver, Apple 등)** — 카카오만 지원. 다중 provider 추상화 계층은 OUT.
2. **카카오 싱크 (Kakao Sync)** — 메시지 API, 알림톡, 추가 항목 동의는 OUT.
3. **카카오 토큰 저장/갱신** — 카카오 access_token, refresh_token을 영속 저장하지 않음. 서비스는 자체 JWT만 사용 (REQ-KAKAO-013).
4. **계정 연결 해제 UI** — 사용자가 카카오 연결을 직접 끊는 기능 OUT.
5. **다중 provider 연결** — 한 계정에 2개 이상 소셜 수단 연결 OUT.
6. **비밀번호 재설정** — SPEC-AUTH-RESET-001 소관.
7. **기존 verify-unit / JWT / 미들웨어 정책 변경** — 카카오 가입자도 동일 정책 적용, 변경 없음.
8. **카카오 가입자 전용 마이페이지 / 프로필 편집** — 별도 SPEC.

---

## 8. 환경 변수 (Configuration)

본 SPEC이 추가하는 환경 변수:

| 변수명 | 용도 | 예시 |
|--------|------|------|
| `KAKAO_REST_API_KEY` | 카카오 앱 REST API 키 (client_id) | `abcdef1234567890abcdef...` |
| `KAKAO_CLIENT_SECRET` | 카카오 앱 Client Secret (토큰 교환용) | `abcdef...` |
| `KAKAO_REDIRECT_URI` | 카카오 콜백 URL | `https://aitteulak.up.railway.app/api/auth/kakao/callback` |

**[MODIFY]** `src/lib/env.ts`에 위 3종을 추가하여 부트 검증(fail-fast) 대상에 포함한다. 누락 시 애플리케이션 시작 중단.

**[MODIFY]** `.env.example`, `.env.local`, `.env.test`에 카카오 변수 템플릿 추가 (`.env.local`은 운영자가 실값으로 채움).

---

## 9. DB 마이그레이션 (Migration 011)

**[NEW]** `migrations/011_kakao_oauth.sql`:

본 SPEC은 migration 001에 이미 존재하는 `users.provider`, `users.provider_id` 컬럼을 소비한다. 마이그레이션 011은 다음 보조 인덱스만 추가한다 (본문 SQL은 Run Phase에서 작성, 본 SPEC에 기술 금지):

- `users(provider, provider_id)` 부분 유니크 인덱스 — `provider_id IS NOT NULL`인 경우만 (이메일 계정의 provider_id=NULL은 유일성 검사 제외)
- 목적: REQ-KAKAO-009(카카오 ID 중복 연결 방지)를 DB 레벨에서 보장

마이그레이션은 멱등(`CREATE INDEX IF NOT EXISTS`)이어야 한다.

---

## 10. MX Tag Plan (코드 주석 계획)

Run Phase에서 다음 @MX 태그를 적용한다:

### @MX:ANCHOR (fan_in >= 3 또는 공개 API 경계)

- `src/app/api/auth/kakao/callback/route.ts`: 카카오 콜백 진입점 — 외부 시스템(카카오) 통합 경계
- `useAuth.kakaoLogin()`: 3개 뷰포트 컴포넌트에서 호출 (fan_in >= 3)

### @MX:WARN with @MX:REASON (위험 영역)

- `state` 검증 로직 — `@MX:REASON: CSRF 방어 핵심, 누락 시 인가 코드 탈취 공격 가능`
- 카카오 Client Secret 사용 — `@MX:REASON: 노출 시 타 앱 위장 가능`
- 카카오 토큰 폐기 — `@MX:REASON: 영속 저장 시 카카오 계정 권한 과잉 보유`

### @MX:NOTE (도메인 의도 전달)

- 이메일 기준 자동 연결 — `@MX:NOTE: 사용자 마찰 최소화 vs 계정 분할 위험 균형`
- 카카오 가입자 password_hash=NULL — `@MX:NOTE: 소셜 전용 계정은 비밀번호 로그인 불가`
- 카카오 토큰 미저장 — `@MX:NOTE: 서비스 자체 JWT만 유지하는 단일 세션 정책`

### @MX:TODO (후속 연결 지점)

- 타 provider 확장 지점 — `@MX:TODO: Google/Naver 추가 시 provider 추상화 계층 도입 검토`

---

## 11. 검증 기준 요약

상세 Given-When-Then 시나리오는 `acceptance.md`를 참조. 각 모듈당 최소 2개 시나리오, 총 19개 이상 검증 케이스를 정의한다. REQ-KAKAO-001 ~ REQ-KAKAO-017 (17개).

---

## 12. 참조 문서

- `interview.md` (본 디렉토리): 사용자 결정 사항 (이메일 자동 연결, verify-unit 유지)
- `SPEC-AUTH-001/spec.md`: 기존 인증 정책, JWT 세션, verify-unit, 강제 탈퇴
- `SPEC-INTEGRATION-AUTH-001/spec.md`: useAuth 훅, 카카오 stub(REQ-AUTH-INT-026)
- `.moai/project/tech.md`: 기술 스택, ADR-003 (JWT)
- `plan.md` (본 디렉토리): 구현 계획, 파일 목록
- `acceptance.md` (본 디렉토리): 검증 시나리오, 품질 게이트 기준
- 카카오 로그인 공식 문서: developers.kakao.com/docs/login

---

*본 SPEC은 brownfield 프로젝트 기준으로 작성되었다 (Delta 마커 사용).*

---

## 13. Implementation Notes (as-built, 2026-06-24)

본 SPEC은 SPEC-First(Plan-Run-Sync) 워크플로우를 따라 구현 완료되었다. 아래는 구현 결과에서 계획 대비 주요 결정/차이점을 기록한 as-built 요약이다.

### 13.1 PKCE 미도입 근거

Authorization Code Flow에 PKCE를 적용하지 않았다. 근거:
- 본 서버는 **confidential client**(client-secret 보유)이다.
- **state 기반 CSRF 방어**(`crypto.randomUUID`, httpOnly·SameSite=Lax·Max-Age=600s 쿠키, 콜백 일회용 폐기) + **client-secret 환경 변수 전용 관리** 조합으로 인가 코드 가로채기 위협 시나리오를 충분히 완화한다.
- 카카오 액세스/리프레시 토큰은 **1회성 교환 후 메모리에서만 사용**, DB/쿠키 영구 저장 금지 정책으로 리스크를 추가 축소했다.
- 공개 클라이언트(SPA 네이티브 등)가 아니므로 PKCE의 필수 사용 케이스에 해당하지 않는다.

### 13.2 이메일 정규화(소문자) 추가 — evaluator fix cycle

구현 평가(evaluator-active) 단계에서 강화된 항목. 카카오 이메일과 기존 `users.email` 비교 시 **대소문자 정규화(소문자)** 를 적용했다 (REQ-KAKAO-007/017 강화). 이는 대소문자 혼용으로 인한 계정 연결 우회/중복 가입 시나리오를 차단한다.

### 13.3 계획 대비 차이 (Divergence)

- **`kakao-email.ts` 파일 분리**: 계획에는 최초 연결 알림 이메일 로직이 `kakao-account.ts`에 인라인으로 포함되어 있었다. 구현 시 DB upsert(`kakao-account.ts`)와 이메일 발송(`kakao-email.ts`) 관심사 분리를 위해 별도 파일로 분리했다.
- **localhost 하드코딩 제거**: evaluator fix 중 운영 준비성(prod-readiness)을 위해 리다이렉트 URL 호스트를 `request.url` 기반 동적 생성으로 변경했다 (고정 localhost 제거).

### 13.4 운영자 필수 사전 조건 (Operator Prerequisites)

본 기능은 다음 사전 조건이 충족되어야 정상 동작한다:
1. **Kakao Developers Console 앱 등록** (REST API Key, Client Secret 발급)
2. **Redirect URI 등록** — 개발 `http://localhost:3000/api/auth/kakao/callback`, 운영 `https://<prod-domain>/api/auth/kakao/callback`
3. **이메일 동의 항목(`account_email`) 필수 동의 설정** — 자동 계정 연결의 기준이므로 누락 시 가입 불가
4. **환경 변수 3종 설정** — `KAKAO_REST_API_KEY`, `KAKAO_CLIENT_SECRET`, `KAKAO_REDIRECT_URI` (누락 시 fail-fast로 서버 기동 안 함)
5. **DB 마이그레이션 적용** — `npm run db:migrate` (migration 011, `users(provider, provider_id)` 부분 유니크 인덱스)

상세 운영 절차는 `README.md` "카카오 소셜 로그인 설정 (운영자)" 섹션 참조.
