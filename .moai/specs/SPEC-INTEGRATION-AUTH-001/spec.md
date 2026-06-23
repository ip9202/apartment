---
id: SPEC-INTEGRATION-AUTH-001
title: "프론트엔드↔백엔드 인증 연동 (Auth Integration)"
version: 1.0.0
status: Planned
created: 2026-06-23
updated: 2026-06-23
author: 강력쇠주먹
priority: High
issue_number: ""
---

# SPEC-INTEGRATION-AUTH-001: 프론트엔드↔백엔드 인증 연동

## HISTORY

- 2026-06-23 (v1.0.0): 최초 작성. SPEC-AUTH-001 백엔드 인증 API 완료 이후, 데모용 하드코딩 로그인을 실제 API 호출로 교체하기 위한 연동 명세. 세션 복원 엔드포인트(`/api/auth/me`) 추가, 시드 데모 계정 추가, 공유 `useAuth` 훅 도입 포함.

---

## 1. Background (배경)

"아이뜨락 아파트 커뮤니티" 프로젝트는 SPEC-AUTH-001 을 통해 백엔드 인증 API(`login`, `logout`, `refresh`, `signup`, `verify-unit`, `users/[id]/deactivate`)를 이미 구현 완료한 상태다. AT(Access Token)는 httpOnly 쿠키(`at`)로 설정되며, `src/middleware.ts`가 페이지 라우트 보호를 담당한다(`verified:false` → `/verify`, 미인증 → `/login`).

그러나 프론트엔드는 3개 뷰포트 컴포넌트(`MobileApp.tsx`, `TabletApp.tsx`, `DesktopApp.tsx`)가 각자 데모용 `doLogin(email, password)` 콜백을 가지고 있으며, 이 콜백은 **실제 API 를 호출하지 않고** 이메일 문자열로 admin 여부를 하드코딩 판별한 뒤 가짜 로그인 상태로 전환한다(`setTimeout(..., 800)`).

또한 두 가지 갭이 존재한다:
1. **세션 복원 엔드포인트 부재**: `at` 쿠키는 httpOnly 이므로 클라이언트 JS 가 읽을 수 없다. 페이지 새로고침 시 로그인 여부/역할/verified 상태를 복원할 수 있는 `GET /api/auth/me` 엔드포인트가 없다.
2. **데모 계정 부재**: 시드 스크립트(`scripts/seed.ts`)는 buildings/units/roles 만 생성하며 사용자를 생성하지 않는다. 실제 로그인을 시도해도 계정이 없어 401 만 발생한다.

본 SPEC 은 이 세 가지(세션 복원 엔드포인트, 데모 계정 시드, 프론트엔드 실제 API 연동)를 정의하여 인증 플로우가 end-to-end 로 동작하도록 한다.

### 1.1 현재 검증된 사실 (Verified Facts)

| 항목 | 상태 | 근거 파일 |
|------|------|-----------|
| `POST /api/auth/login` | 구현 완료 | `src/app/api/auth/login/route.ts` |
| 응답 형태 | `{success, data:{access_token, user:{id, role, verified}}}` + httpOnly `at` 쿠키 | login route.ts 본문 |
| `POST /api/auth/verify-unit` | 구현 완료, `Authorization: Bearer <AT>` 필수 | verify-unit route.ts |
| 미들웨어 | `/` 통과, PUBLIC_PATHS=[/login,/signup,/verify], verified 판별 후 리다이렉트 | `src/middleware.ts` |
| AT 쿠키 속성 | `HttpOnly; SameSite=Strict; Path=/; Max-Age=900`, prod 한정 `Secure` | `src/lib/cookies.ts` |
| 프론트 데모 로그인 | 하드코딩(`email.includes('admin')`), API 미호출 | `MobileApp.tsx` L26-40 |
| 시드 스크립트 | buildings/units/roles 만 생성, 사용자 없음 | `scripts/seed.ts` |
| 통일 인증 오류 메시지 | "이메일 또는 비밀번호가 올바르지 않습니다" (사용자 열거 방지) | login route.ts |
| 잠금 정책 | 5회 실패 / 10분 잠금 (429 + Retry-After) | login route.ts, `rate-limit.ts` |

---

## 2. Glossary (용어)

| 용어 | 정의 |
|------|------|
| AT (Access Token) | HS256 서명된 JWT. 클레임: `sub`, `role`, `verified`. TTL 15분. httpOnly 쿠키 `at` + API 응답 본문 `access_token` 으로 이중 전송. |
| RT (Refresh Token) | httpOnly 쿠키 `rt`. Path=/api/auth. TTL 7일. |
| verified | 사용자가 동/호수 인증(`verify-unit`)을 완료하여 `verified_at` 이 NOT NULL 인 상태. |
| 세션 복원 (Session Restore) | 페이지 새로고침/재방문 시 클라이언트가 `GET /api/auth/me` 를 호출해 로그인 상태를 복원하는 행위. |
| useAuth 훅 | 본 SPEC 에서 도입하는 공유 인증 상태/액션 훅. 3개 뷰포트 컴포넌트가 공통 사용. |
| 데모 계정 (Demo Accounts) | 개발/데모 환경에서 로그인 플로우를 검증하기 위해 시드되는 고정 계정 (RESIDENT 1개, ADMIN 1개). |
| 통일 인증 오류 | 사용자 열거 공격 방어를 위해 not-found 와 wrong-password 를 구분하지 않는 동일 401 응답. |

---

## 3. Scope (범위)

### 3.1 In Scope

- **BE 추가**: `GET /api/auth/me` 세션 복원 엔드포인트 (`at` 쿠키 읽기, jose 검증, `{id, email, role, verified, status}` 반환 또는 401)
- **BE 추가**: 시드 스크립트(`scripts/seed.ts`)에 데모 계정 생성 (1 building pair, RESIDENT + ADMIN, password `test1234`)
- **FE 추가**: 공유 `useAuth` 훅 (login/logout/signup/verify-unit 호출 + 마운트 시 세션 복원 + auth 상태 노출)
- **FE 변경**: `MobileApp`, `TabletApp`, `DesktopApp` 의 `doLogin`/`demoLogin`/`demoAdminLogin` 하드코딩을 `useAuth` 호출로 교체
- **FE 변경**: signup 화면 → `POST /api/auth/signup`, verify 화면 → `POST /api/auth/verify-unit` (Bearer AT), logout → `POST /api/auth/logout` 연동
- **상태 동기화**: 로그인 응답의 `role` + `verified` 반영, 새로고침 시 `/api/auth/me` 복원, `verified:false` 시 verify 플로우 유도
- **오류 처리**: 401(통일 인증 오류), 429(잠금), 422(검증 오류) 를 기존 `loginError` UI 상태로 표시

### 3.2 Out of Scope (본 SPEC 범위 외)

> 별도 SPEC 으로 다룬다. 본 SPEC 구현 중 우연히 발견되더라도 수정하지 않는다.

- 도메인 페이지(공지/건의/주차) 라우팅 분리 및 권한 게이트 — 별도 SPEC
- 공지/건의/주차 실제 데이터 연동(wiring) — SPEC-NOTICE-001, SPEC-SUGGEST-001, SPEC-PARKING-001 후속
- 카카오 소셜 로그인 실구현 (현재는 stub) — 별도 SPEC (Open Questions 참조)
- 비밀번호 재설정/찾기 플로우 — 별도 SPEC
- RT 를 이용한 자동 갱신(silent refresh) UX 고도화 — 본 SPEC 은 `refresh` 엔드포인트 존재만 전제, 자동 갱신 로직은 Out of Scope
- 운영 환경(prod) 계정 프로비저닝 — 본 SPEC 의 데모 계정은 개발/데모 전용

---

## 4. Functional Requirements (기능 요구사항)

### 4.1 세션 복원 엔드포인트 (BE)

**REQ-AUTH-INT-001** (Event-Driven):
WHEN 클라이언트가 `GET /api/auth/me` 로 요청하면, 시스템은 httpOnly `at` 쿠키를 읽어 jose(HS256) 로 검증한 뒤, 유효한 경우 `200 OK` 와 `{success:true, data:{id, email, role, verified, status}}` 본문을 반환해야 한다(SHALL).

**REQ-AUTH-INT-002** (Unwanted Behavior):
IF `at` 쿠키가 없거나 만료/서명불일치/형식오류인 경우, THEN 시스템은 `401 Unauthorized` 와 `{success:false, error:"인증이 필요합니다"}` 를 반환해야 한다(SHALL). 이때 사용자 열거 위험이 없으므로 통일 메시지 정책과 무관하다.

**REQ-AUTH-INT-003** (State-Driven):
WHILE 미들웨어가 `at` 쿠키를 동일한 `JWT_SECRET` 으로 검증하는 정책을 따르는 한, `/api/auth/me` 도 동일한 `JWT_SECRET` 과 `jose.jwtVerify` 를 사용해야 한다(SHALL). 검증 로직은 `src/middleware.ts` 의 `extractVerified` 와 일관성을 유지한다.

**REQ-AUTH-INT-004** (Ubiquitous):
`/api/auth/me` 엔드포인트는 인증된 회원의 `status` 필드(`ACTIVE`/`INACTIVE`)를 반드시 반환해야 한다(SHALL). `INACTIVE` 회원이 호출하면 401 이 아닌 200 + `status:"INACTIVE"` 로 반환하여 클라이언트가 강제 탈퇴 플로우를 처리할 수 있도록 한다.

### 4.2 데모 계정 시드 (BE)

**REQ-AUTH-INT-005** (Event-Driven):
WHEN `npm run db:seed` 를 실행하면, 시스템은 멱등하게(`ON CONFLICT DO NOTHING`) 다음 데모 계정을 생성해야 한다(SHALL):
- `resident@aitteulak.com` / `test1234` — 역할 `RESIDENT`, `verified_at = now()` (A동 101호에 unit_id 연결)
- `admin@aitteulak.com` / `test1234` — 역할 `ADMIN`, `verified_at = now()` (`managed_building_id` A동)

**REQ-AUTH-INT-006** (Ubiquitous):
데모 계정의 비밀번호 해시는 기존 `src/lib/auth.ts` 의 `hashPassword` (bcryptjs)를 사용해야 하며(SHALL), 평문 비밀번호를 DB 에 저장하지 않는다.

**REQ-AUTH-INT-007** (State-Driven):
IF 시드 스크립트가 이미 데모 계정을 생성한 상태에서 재실행되면, THEN 기존 계정을 덮어쓰지 않고 `ON CONFLICT DO NOTHING` 으로 건너뛰어야 한다(SHALL).

### 4.3 공유 useAuth 훅 (FE)

**REQ-AUTH-INT-008** (Event-Driven):
WHEN `useAuth` 훅이 마운트되면, 시스템은 즉시 `GET /api/auth/me` 를 호출하여 현재 로그인/역할/verified 상태를 복원해야 한다(SHALL). 복원 중에는 `loading:true` 상태를 노출하여 UI 가 깜빡임을 방지한다.

**REQ-AUTH-INT-009** (Event-Driven):
WHEN `useAuth.login(email, password)` 를 호출하면, 시스템은 `POST /api/auth/login` 에 `{email, password}` JSON 본문을 보내야 하며(SHALL), 성공(200) 시 응답의 `user.role` 과 `user.verified` 를 auth 상태에 반영하고 `access_token` 은 무시한다(AT 쿠키가 이미 설정됨).

**REQ-AUTH-INT-010** (Event-Driven):
WHEN `useAuth.logout()` 를 호출하면, 시스템은 `POST /api/auth/logout` 을 호출한 뒤(SHALL) 로컬 auth 상태를 초기화(`isLoggedIn=false, userRole=null, verified=false`)하고 화면을 `/login` 으로 전환한다.

**REQ-AUTH-INT-011** (Event-Driven):
WHEN `useAuth.signup(payload)` 를 호출하면, 시스템은 `POST /api/auth/signup` 에 payload JSON 을 보내야 하며(SHALL), 성공 시 자동 로그인하지 않고 `/login` 화면으로 안내한다(이메일 인증/로그인 유도).

**REQ-AUTH-INT-012** (Event-Driven):
WHEN `useAuth.verifyUnit(building_id, unit_id)` 를 호출하면, 시스템은 `POST /api/auth/verify-unit` 을 호출하되(SHALL) `Authorization: Bearer <AT>` 헤더를 포함해야 한다. AT 는 `/api/auth/me` 또는 직전 로그인 응답에서 캐시한 값을 사용한다.

**REQ-AUTH-INT-013** (State-Driven):
WHILE `useAuth` 의 auth 상태 중 `verified === false` 이고 현재 화면이 보호 화면(verify/login/signup 외)인 경우, 시스템은 verify 화면으로 사용자를 유도해야 한다(SHALL). 이는 미들웨어(REQ-AUTH-013)의 클라이언트 측 보완이다.

### 4.4 뷰포트 컴포넌트 데모 로그인 제거 (FE)

**REQ-AUTH-INT-014** (Unwanted Behavior):
`MobileApp.tsx`, `TabletApp.tsx`, `DesktopApp.tsx` 의 `doLogin`/`demoLogin`/`demoAdminLogin` 콜백은 더 이상 이메일 문자열로 admin 을 하드코딩 판별하지 않아야 하며(SHALL NOT), 반드시 `useAuth().login` 을 호출해야 한다.

**REQ-AUTH-INT-015** (Ubiquitous):
3개 뷰포트 컴포넌트는 모두 동일한 `useAuth` 인스턴스에서 auth 상태를 소비해야 하며(SHALL), 컴포넌트 간 상태 불일치(예: MobileApp 은 로그인, TabletApp 은 비로그인)가 발생하지 않도록 한다. 상태 소스는 단일(Single Source of Truth)이어야 한다.

**REQ-AUTH-INT-016** (Optional):
WHERE 가능한 경우, 데모용 빠른 로그인 버튼("입주민 체험", "관리자 체험")은 `useAuth.login('resident@aitteulak.com','test1234')` / `useAuth.login('admin@aitteulak.com','test1234')` 형태로 실제 API 를 호출하도록 유지할 수 있다(SHOULD). 단 하드코딩된 가짜 로그인으로 폴백하지 않는다.

**REQ-AUTH-INT-026** (Unwanted Behavior):
"카카오로 시작하기" 버튼은 비활성화(disabled) 처리하고 "준비 중" 라벨을 표시해야 하며(SHALL), 클릭 시 가짜 로그인(`doLogin('kakao@user.com','kakao')`)을 트리거하지 않아야 한다(SHALL NOT). 카카오 OAuth 실구현은 별도 SPEC(SPEC-AUTH-KAKAO-001)에서 다룬다.

### 4.5 오류 처리 (FE/BE)

**REQ-AUTH-INT-017** (State-Driven):
IF `/api/auth/login` 이 401 을 반환하면, THEN `useAuth` 는 기존 `loginError` UI 상태에 서버의 통일 오류 메시지("이메일 또는 비밀번호가 올바르지 않습니다")를 표시해야 하며(SHALL), 로그인 상태로 전환하지 않는다.

**REQ-AUTH-INT-018** (State-Driven):
IF `/api/auth/login` 이 429 (잠금)를 반환하면, THEN `useAuth` 는 `loginError` 에 "잠시 후 다시 시도해 주세요" 메시지를 표시해야 하며(SHALL), `Retry-After` 헤더 값이 있으면 남은 대기 시간(분)을 함께 표시할 수 있다(SHOULD).

**REQ-AUTH-INT-019** (State-Driven):
IF `/api/auth/login` 또는 `/api/auth/signup` 이 422 (검증 오류)를 반환하면, THEN `useAuth` 는 서버가 전달한 필드별 검증 메시지를 해당 입력 필드에 표시해야 한다(SHALL).

---

## 5. Non-Functional Requirements (비기능 요구사항)

### 5.1 보안 (Security)

**REQ-AUTH-INT-020** (Ubiquitous):
AT 는 절대 `localStorage` 나 `sessionStorage` 에 저장하지 않아야 한다(SHALL NOT). AT 는 httpOnly 쿠키로만 전송되며, JS 가 접근할 수 없어야 한다. 이는 SPEC-AUTH-001 ADR-003 과 `src/lib/cookies.ts` 의 기존 정책을 준수한다.

**REQ-AUTH-INT-021** (Ubiquitous):
`/api/auth/me` 엔드포인트는 Edge Runtime 이 아닌 Node.js Runtime 에서 실행되어야 하며(SHALL), `jose` 외에 `jsonwebtoken`/`pg`/`bcryptjs` 를 사용하지 않는다(미들웨어 정책과 일관). 단, DB 조회가 필요한 경우(`status` 필드)에는 Node.js Runtime + `pg` 를 사용할 수 있다.

**REQ-AUTH-INT-022** (Unwanted Behavior):
`useAuth` 훅은 `access_token` 을 메모리에 보관할 수 있으나(SHALL NOT) `window` 전역이나 외부 접근 가능한 객체에 노출하지 않아야 한다. verify-unit 호출에만 일시적으로 사용하고 로그아웃 시 즉시 폐기한다.

**REQ-AUTH-INT-023** (Ubiquitous):
모든 API 호출은 `credentials: 'include'` 옵션을 사용하여 httpOnly 쿠키가 전송되도록 해야 하며(SHALL), 동일 출점(same-origin) 호출이므로 CORS preflight 는 발생하지 않는다.

### 5.2 일관성 (Consistency)

**REQ-AUTH-INT-024** (Ubiquitous):
`/api/auth/me` 가 반환하는 쿠키 속성(HttpOnly, SameSite=Strict, Secure=prod 한정, Path=/, Max-Age=900)은 기존 `buildAccessCookie`(`src/lib/cookies.ts`)와 완전히 동일해야 하며(SHALL), 별도의 쿠키 속성 하드코딩을 만들지 않는다. verify-unit 성공 시 fresh AT 쿠키 설정에도 동일 헬퍼를 재사용한다.

### 5.3 성능 (Performance)

**REQ-AUTH-INT-025** (State-Driven):
WHILE 페이지 새로고침 시 `useAuth` 가 마운트되면, 시스템은 `/api/auth/me` 호출이 완료될 때까지 `loading` 상태를 유지해야 하며(SHALL), 호출 실패 시 즉시 비로그인 상태로 폴백하여 사용자 대기 시간을 최소화한다.

---

## 6. Acceptance Criteria (검수 기준)

> 상세 Given-When-Then 시나리오는 `acceptance.md` 에 정의. 본 섹션은 핵심 검수 항목 요약.

**AC-AUTH-INT-001**: `GET /api/auth/me` 가 유효한 `at` 쿠키로 호출 시 200 + `{id, email, role, verified, status}` 반환
**AC-AUTH-INT-002**: `at` 쿠키 없이 `/api/auth/me` 호출 시 401 반환 (세션 복원 실패 = 비로그인)
**AC-AUTH-INT-003**: `npm run db:seed` 실행 후 `resident@aitteulak.com` / `test1234` 로 `POST /api/auth/login` 호출 시 200 + `verified:true` 반환
**AC-AUTH-INT-004**: `admin@aitteulak.com` 로그인 시 `role:"ADMIN"` 반환
**AC-AUTH-INT-005**: 시드 재실행 시 기존 데모 계정이 덮어쓰기 되지 않음 (멱등)
**AC-AUTH-INT-006**: MobileApp 에서 `resident@aitteulak.com`/`test1234` 입력 후 로그인 시 실제 `/api/auth/login` 호출 (네트워크 탭에서 확인), 하드코딩 분기 없음
**AC-AUTH-INT-007**: 로그인 후 페이지 새로고침 시 `useAuth` 가 `/api/auth/me` 로 상태 복원, 로그인 상태 유지
**AC-AUTH-INT-008**: 잘못된 비밀번호 입력 시 `loginError` UI 에 "이메일 또는 비밀번호가 올바르지 않습니다" 표시
**AC-AUTH-INT-009**: 5회 실패 후 429 응답 시 "잠시 후 다시 시도해 주세요" 표시
**AC-AUTH-INT-010**: signup 화면에서 회원가입 성공 시 `/login` 으로 이동, 자동 로그인 안 함
**AC-AUTH-INT-011**: verify 화면에서 building_id/unit_id 제출 시 `/api/auth/verify-unit` 에 `Authorization: Bearer <AT>` 헤더 포함 (네트워크 탭에서 헤더 확인)
**AC-AUTH-INT-012**: verify-unit 성공 후 auth 상태 `verified:true` 로 갱신, fresh AT 쿠키 재설정
**AC-AUTH-INT-013**: logout 호출 후 auth 상태 초기화, `/login` 이동, `/api/auth/me` 호출 시 401
**AC-AUTH-INT-014**: `localStorage`/`sessionStorage` 에 토큰 저장 코드 grep 시 0 matches
**AC-AUTH-INT-015**: `grep -r "email.includes('admin')"` 시 데모 하드코딩 0 matches (제거 완료)
**AC-AUTH-INT-016**: 3개 뷰포트 컴포넌트 모두 동일 `useAuth` 에서 상태 소비 (상태 불일치 시나리오 테스트 통과)

---

## 7. Dependencies (의존성)

### 7.1 선행 SPEC

- **SPEC-AUTH-001** (인증 백엔드 API): 본 SPEC 은 AUTH-001 의 모든 엔드포인트가 구현 완료된 것을 전제로 한다. 특히 `login`, `verify-unit`, `logout`, `signup`, `refresh` route.ts 와 `src/middleware.ts`, `src/lib/cookies.ts`, `src/lib/auth.ts`, `src/lib/rate-limit.ts` 를 재사용한다.

### 7.2 참조 파일 (구현 시 수정 대상)

| 파일 | 변경 유형 | 비고 |
|------|-----------|------|
| `src/app/api/auth/me/route.ts` | 신규 | `GET` 핸들러, jose 검증 + DB 조회 |
| `src/app/api/auth/me/route.test.ts` | 신규 | 단위/통합 테스트 |
| `scripts/seed.ts` | 수정 | 데모 계정 생성 블록 추가 (기존 트랜잭션 내) |
| `src/hooks/useAuth.ts` (또는 `src/components/useAuth.ts`) | 신규 | 공유 인증 훅 |
| `src/components/MobileApp.tsx` | 수정 | `doLogin` → `useAuth().login` 교체 |
| `src/components/TabletApp.tsx` | 수정 | 동일 |
| `src/components/DesktopApp.tsx` | 수정 | 동일 |
| `src/components/demo-data.ts` | 수정(선택) | 데모 버튼의 이메일/비밀번호 상수화 |

---

## 8. Open Questions (미해결 질문)

> 구현 착수 전 사용자 결정이 필요한 항목. `plan.md` 작성 시 해소 필요.

1. **데모 비밀번호 정책**: `test1234` 는 AUTH-001 의 `loginSchema` 최소 길이(8자)를 만족하는가? 비밀번호 복잡도 요구사항이 있다면 데모 계정도 준수해야 함. — 사용자 확인 필요.
2. **카카오 로그인** (결정됨 2026-06-23): "카카오로 시작하기" 버튼은 **비활성화 + "준비 중" 표시**로 처리한다. 본 SPEC은 이메일 인증에 집중하며, 카카오 OAuth 실구현은 별도 SPEC(SPEC-AUTH-KAKAO-001)에서 다룬다. 데모 중 가짜 로그인(`doLogin('kakao@user.com','kakao')`)으로 인한 혼란을 방지한다. → REQ-AUTH-INT-026 참조.
3. **`/api/auth/me` 의 `status:"INACTIVE"` 회원 처리**: 200 을 반환하되 클라이언트가 강제 탈퇴 안내를 표시하는가(REQ-AUTH-INT-004), 아니면 401 로 통일할 것인가? — 사용자 확인 필요.
4. **데모 계정 이메일 도메인**: `@aitteulak.com` 사용. 실제 프로덕션 도메인과 충돌하지 않는지? — 사용자 확인.
5. **AT 메모리 캐시 방식**: `useAuth` 가 verify-unit 용 AT 를 어디에 보관하는가? (a) `/api/auth/me` 호출 응답에 AT 본문 포함시키기, (b) 로그인 응답의 `access_token` 을 메모리에 캐시. — (b) 가 보안상 더 안전(REQ-AUTH-INT-022). 설계 확정 필요.
6. **멀티 탭 상태 동기화**: 사용자가 두 탭을 열고 한 탭에서 로그아웃 시 다른 탭의 `useAuth` 상태가 갱신되어야 하는가? (BroadcastChannel/storage event 등) — 본 SPEC v1 은 Out of Scope, 추후 SPEC 검토.

---

## 9. Implementation Branch & Git Flow

> 본 SPEC 문서는 **`develop` 브랜치에 직접 커밋**한다 (SPEC 은 공유 계획 산출물이므로 Git Flow 정책에 따라 develop 에서 관리).

- **SPEC 커밋**: `develop` 브랜치 — `docs(integration): SPEC-INTEGRATION-AUTH-001 인증 연동 명세`
- **구현 브랜치**: `feature/SPEC-INTEGRATION-AUTH-001-auth` (develop 에서 분기)
- **PR**: `feature/SPEC-INTEGRATION-AUTH-001-auth` → `develop`
- 구현은 별도 `/moai run` 단계에서 진행하며, 본 SPEC 문서 작성 시점에는 코드를 수정하지 않는다.

---

## 10. Exclusions (What NOT to Build)

> SPEC Scope Boundaries (What/Why vs How) 준수.

- 본 SPEC 은 인증 **연동** 에 집중하며, 새로운 인증 메커니즘(OAuth, MFA, WebAuthn)을 설계하지 않는다.
- 도메인 페이지(공지/건의/주차)의 라우팅 분리, 권한 게이트, 데이터 연동은 포함하지 않는다.
- `/api/auth/me` 외의 신규 인증 API 는 추가하지 않는다.
- UI 디자인(새 로그인 화면 레이아웃, 색상, 컴포넌트 구조)은 기존 Claude Design 산출물을 유지하며, 본 SPEC 은 API 호출 wiring 만 다룬다.
- AT/RT 발급 알고리즘, 쿠키 속성 정책, 잠금 정책 등 AUTH-001 에서 이미 정의된 정책을 재정의하지 않는다 (참조만).

---

_Version: 1.0.0 | Status: Planned | Priority: High_
