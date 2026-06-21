---
spec_id: "SPEC-AUTH-001"
title: "인증 (Authentication) 시스템 — Compact Edition"
phase: "plan"
status: "draft"
created: "2026-06-21"
updated: "2026-06-21"
author: "강력쇠주먹"
priority: "P0"
issue_number: 0
purpose: "Run Phase 토큰 절약용 요약본 (~30% 절약). 전체 문서는 spec.md/plan.md/acceptance.md 참조."
---

# SPEC-AUTH-001 Compact

본 문서는 Run Phase에서 빠르게 로딩하기 위한 요약본이다. 요구사항, 검증 기준, 파일 목록, 제외 항목만 포함한다. 배경, 기술 접근법, 연구 참조, 주석 이력은 제외한다.

---

## 1. 요구사항 (REQ-AUTH-XXX)

### M1. 회원가입 (AUTH-01)

- **REQ-AUTH-001 (Ubiquitous)**: 모든 회원가입 요청에 대해 이메일 중복을 검사하고, 이미 가입된 이메일인 경우 가입을 거부한다.
- **REQ-AUTH-002 (Unwanted)**: 회원가입 시 비밀번호가 제출되면 평문으로 저장하지 않고 bcrypt(salt rounds 12) 해시로만 저장한다.
- **REQ-AUTH-003 (Event-driven)**: 회원가입이 성공하면 `role=RESIDENT`, `verified=false` 상태로 회원 레코드를 생성하고 클라이언트를 동/호수 인증 화면으로 강제 이동시킨다.

### M2. 로그인 / 로그아웃 (AUTH-03)

- **REQ-AUTH-004 (Event-driven)**: 유효한 이메일/비밀번호로 로그인에 성공하면 Access Token(15분, HS256)을 응답 본문에 반환하고 Refresh Token(7일)을 httpOnly + secure + sameSite=strict 쿠키로 설정한다.
- **REQ-AUTH-005 (Unwanted)**: 로그인 시 이메일이 존재하지 않거나 비밀번호가 일치하지 않으면 어느 항목이 틀렸는지 구분하는 메시지를 노출하지 않고 동일한 "이메일 또는 비밀번호가 올바르지 않습니다" 오류를 반환한다.
- **REQ-AUTH-006 (State-driven)**: 동일 이메일에 대해 연속 5회 로그인 실패가 누적된 상태인 경우 10분간 해당 이메일의 로그인 시도를 차단하고 429 응답을 반환한다.
- **REQ-AUTH-007 (Event-driven)**: 인증된 사용자가 로그아웃을 요청하면 현재 Refresh Token을 `revoked_refresh_tokens` 테이블에 등록하고 클라이언트의 RT 쿠키를 만료 처리한다.

### M3. 토큰 갱신

- **REQ-AUTH-008 (Event-driven)**: 클라이언트가 유효하고 블랙리스트에 등록되지 않은 Refresh Token으로 갱신을 요청하면 새로운 Access Token(15분)을 발급하여 응답 본문에 반환한다.
- **REQ-AUTH-009 (Unwanted)**: Refresh Token이 만료되었거나 블랙리스트에 등록되어 있으면 토큰을 갱신하지 않고 401 응답과 함께 재로그인을 유도한다.

### M4. 동/호수 인증 (AUTH-04)

- **REQ-AUTH-010 (Event-driven)**: 인증된 사용자가 유효한 `building_id`와 `unit_id`를 제출하고 해당 호수가 이미 인증된 회원이 없으면 회원의 `unit_id`를 설정하고 `verified_at`을 현재 시각으로 갱신한다.
- **REQ-AUTH-010a (Unwanted)**: verify-unit 요청이 DB에 존재하지 않는 `building_id` 또는 `unit_id`를 포함하면 인증을 진행하지 않고 `422 Unprocessable Entity`를 반환한다 (AC-AUTH-017).
- **REQ-AUTH-011 (Event-driven)**: `role=REP`인 사용자가 동/호수 인증에 성공하면 해당 회원의 **`users.managed_building_id`** 에 인증한 building_id를 자동 연결한다. (스키마 결정: 회원 단위 컬럼 사용 — SETUP 마이그레이션 선행 전까지 AUTH 테스트는 stub, §3 Dep #6)
- **REQ-AUTH-012 (Unwanted)**: 이미 다른 회원이 인증한 호수에 대해 인증을 시도하면 인증을 진행하지 않고 409 CONFLICT 오류와 "관리사무소에 문의하세요" 안내를 반환한다.
- **REQ-AUTH-013 (State-driven)**: 회원이 `verified_at=NULL` 상태인 경우 모든 메인 기능(공지, 건의, 주차) 접근을 차단하고 동/호수 인증 화면으로 리다이렉트한다.

### M5. 강제 탈퇴 (AUTH-07)

- **REQ-AUTH-014 (Event-driven)**: ADMIN이 회원 관리 화면에서 특정 회원의 강제 탈퇴를 실행하면 다음을 원자적으로(단일 트랜잭션) 수행한다:
  1. 대상 회원 `status=INACTIVE` 변경
  2. 해당 회원이 작성한 모든 건의를 아카이브(`archived=true`, `author_label="전 입주민"`, `author_id=NULL`)
  3. 직책 회수 (`role` → RESIDENT 환원)
  4. 동/호수 인증 해제 (`unit_id=NULL`, `verified_at=NULL`)
  5. 해당 회원의 모든 Refresh Token 즉시 무효화 (`revoked_refresh_tokens` 일괄 등록)
- **REQ-AUTH-015 (Unwanted)**: 요청자 자신(ADMIN 본인)에 대한 강제 탈퇴를 시도하면 탈퇴를 실행하지 않고 403 Forbidden을 반환한다.
- **REQ-AUTH-016 (Unwanted)**: 강제 탈퇴 엔드포인트 호출자의 역할이 ADMIN이 아니면 탈퇴 로직을 실행하지 않고 `403 Forbidden`을 반환한다 (RBAC 미들웨어, AC-AUTH-023).

---

## 2. 검증 기준 요약 (Given/When/Then)

> 전체 시나리오는 acceptance.md 참조. 본 섹션은 핵심 검증 포인트만 요약.

### M1. 회원가입

- **AC-AUTH-001**: 정상 가입 → 201 + `{role:"RESIDENT", verified:false}`, password_hash는 bcrypt 형식
- **AC-AUTH-002**: 이메일 중복 → 409
- **AC-AUTH-003**: 비밀번호 정책 위반 (8자 미만, 영문+숫자 조합 아님) → 422
- **AC-AUTH-004**: DB의 password_hash는 평문이 아닌 bcrypt 해시 (`$2b$12$...`)

### M2. 로그인 / 로그아웃

- **AC-AUTH-005**: 정상 로그인 → 200 + access_token 본문 + RT httpOnly 쿠키 (secure, sameSite=strict)
- **AC-AUTH-006**: 존재하지 않는 이메일과 틀린 비밀번호가 동일한 401 메시지 반환
- **AC-AUTH-007**: 미인증 회원 로그인 → 200 + `verified:false`
- **AC-AUTH-008**: 5회 실패 → 429 + 10분 잠금 (`login_attempts.locked_until`)
- **AC-AUTH-009**: 잠금 해제 후 정상 복귀 → 200 + failed_count 초기화
- **AC-AUTH-010**: 로그아웃 → 200 + RT 블랙리스트 등록 + 쿠키 만료

### M3. 토큰 갱신

- **AC-AUTH-011**: 유효 RT → 200 + 새 access_token
- **AC-AUTH-012**: 블랙리스트 RT → 401
- **AC-AUTH-013**: 만료 RT → 401

### M3.1 토큰 형식 검증 (JWT 디코딩)

- **AC-AUTH-027**: 발급된 AT 디코딩 → `alg=HS256`, `exp−iat ≤ 900`(15분). RS256/24h AT 발급 시 실패 (falsifiable)
- **AC-AUTH-028**: 발급된 RT 디코딩 → `alg=HS256`, `exp−iat ≤ 604800`(7일)
- **AC-AUTH-029**: RT `Set-Cookie` 속성 → `HttpOnly` + `Secure` + `SameSite=Strict` + `Path=/api/auth` + `Max-Age ≤ 604800`

### M4. 동/호수 인증

- **AC-AUTH-014**: 정상 인증 → 200 + verified_at 갱신
- **AC-AUTH-015**: REP 인증 → `users.managed_building_id` 자동 연결 (→ REQ-AUTH-011)
- **AC-AUTH-016**: 동일 호수 중복 → 409 + "관리사무소 문의"
- **AC-AUTH-017**: 미존재 building/unit (또는 building에 속하지 않는 unit_id) → 422 (→ REQ-AUTH-010a)
- **AC-AUTH-018**: 미인증 회원 메인 접근 → /verify 리다이렉트
- **AC-AUTH-019**: 비로그인 접근 → /login 리다이렉트

### M5. 강제 탈퇴

- **AC-AUTH-020**: ADMIN 강제 탈퇴 → 200 + 5단계 원자적 처리 (status=INACTIVE, 건의 아카이브 author_label="전 입주민"/author_id=NULL/archived=true/unit_id 유지 [ADR-005, AUTH 소유 사이드이펙트], role 환원, unit_id/verified_at NULL, RT 일괄 블랙리스트)
- **AC-AUTH-021**: 탈퇴된 회원 RT 사용 → 401 (블랙리스트)
- **AC-AUTH-022**: ADMIN 자체 탈퇴 시도 → 403 (→ REQ-AUTH-015)
- **AC-AUTH-023**: ADMIN 아닌 사용자 시도 → 403 (→ REQ-AUTH-016, RBAC)
- **AC-AUTH-024**: 트랜잭션 중간 실패 → ROLLBACK + 500 (부분 적용 방지)

### 보안

- **AC-AUTH-025**: 모든 인증 API 응답에서 password_hash 필드 제외
- **AC-AUTH-026**: SQL Injection 페이로드 → Parameterized Query로 정상 401, DB 무변조

---

## 3. 파일 생성/수정 목록

### 신규 API Route Handlers

```
src/app/api/auth/signup/route.ts                          # AUTH-01
src/app/api/auth/login/route.ts                           # AUTH-03
src/app/api/auth/logout/route.ts                          # AUTH-03
src/app/api/auth/refresh/route.ts                         # M3
src/app/api/auth/verify-unit/route.ts                     # AUTH-04
src/app/api/auth/users/[id]/deactivate/route.ts           # AUTH-07 (신규 엔드포인트)
```

### 신규 라이브러리

```
src/lib/db.ts                                             # PostgreSQL 연결 풀
src/lib/auth.ts                                           # JWT 발급/검증, bcrypt 해시
src/lib/middleware.ts                                     # RBAC + 미인증 차단
src/lib/rate-limit.ts                                     # 로그인 시도 추적/잠금
src/lib/validators.ts                                     # 입력 유효성 검증 (선택)
src/lib/suggest-archive.ts                                # 건의 아카이브 도메인 함수 (AUTH-06 재사용 대비)
```

### 신규 DB 마이그레이션

```
migrations/002_revoked_refresh_tokens.sql                 # RT 블랙리스트 테이블
migrations/003_login_attempts.sql                         # Rate Limiting 추적 테이블
```

### 신규 UI 페이지

```
src/app/(auth)/login/page.tsx
src/app/(auth)/signup/page.tsx
src/app/(auth)/verify/page.tsx
```

### 신규 타입 정의

```
src/types/auth.ts                                         # User, Token, API 응답 타입
```

### 신규 테스트 (TDD)

각 모듈별 `.test.ts` 파일 (Phase A~H, plan.md §4 참조).

### 환경 설정

```
.env.example                                              # 환경 변수 템플릿 (실제 값 미포함)
.gitignore                                                # .env.local 추가
```

---

## 4. 신규 DB 테이블 스키마 (요약)

### `revoked_refresh_tokens`

| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | UUID | PK |
| token_jti | VARCHAR(255) | NOT NULL, UNIQUE |
| token_hash | VARCHAR(255) | NOT NULL |
| user_id | UUID | FK → users.id, NOT NULL |
| revoked_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |
| expires_at | TIMESTAMPTZ | NOT NULL |

인덱스: `token_hash`, `user_id`, `expires_at`

### `login_attempts`

| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | UUID | PK |
| email | VARCHAR(255) | NOT NULL |
| failed_count | INT | NOT NULL, DEFAULT 0 |
| locked_until | TIMESTAMPTZ | NULLABLE |
| last_attempt_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() |

인덱스: `email`

잠금 로직: `failed_count >= 5` → `locked_until = now() + 10 minutes`; 성공 시 초기화.

---

## 5. Exclusions (구현 제외 항목)

1. **AUTH-02 카카오 소셜 로그인 (P1)** — 별도 SPEC. `users.provider` 컬럼은 DEFAULT 'email' 유지.
2. **AUTH-05 비밀번호 재설정 (P1)** — 이메일 링크 방식, 유효 1시간. 별도 SPEC.
3. **AUTH-06 본인 회원 탈퇴 (P1)** — 본인 요청 탈퇴. 단, AUTH-07 건의 아카이브 로직은 `suggest-archive.ts`로 분리하여 AUTH-06에서 재사용.
4. **`buildings` / `units` / `roles` CRUD 관리** — SETUP SPEC 소관. 본 SPEC은 읽기 전용 소비.
5. **공지(NOTICE) / 건의(SUGGEST) / 주차 추첨(PARKING) 도메인** — 별도 SPEC. SUGGEST 도메인 기능(CRUD/답변/상태 전이/카테고리)은 OUT — 단, 강제 탈퇴 트랜잭션의 `suggestions` 컬럼 사이드이펙트(`author_id=NULL`/`author_label="전 입주민"`/`archived=true`)는 ADR-005 호수 귀속 정책 준수를 위해 AUTH 소유.
6. **마이페이지 / 프로필 편집** — 별도 SPEC.
7. **2단계 인증(2FA) / 이메일 인증 링크** — 현재 범위 아님.

---

## 6. 핵심 제약 (비기능)

- **JWT_SECRET / JWT_REFRESH_SECRET**: 각 32자 이상, 서로 상이, 환경 변수만 사용
- **비밀번호**: bcrypt salt rounds 12, 평문 저장 금지
- **RT 쿠키**: httpOnly + secure + sameSite=strict + path=/api/auth + maxAge=7d
- **Rate Limit**: 5회 실패 / 10분 잠금 (DB 기반 영속화)
- **SQL Injection**: Parameterized Query / ORM 필수
- **성능**: 모든 인증 API P95 500ms 이하
- **커버리지**: 85% 이상 (TRUST 5 Tested)
- **HTTPS**: 프로덕션 강제 (개발 예외 허용)

---

*본 compact 문서는 Run Phase 빠른 로딩용입니다. 상세는 spec.md / plan.md / acceptance.md를 참조하십시오.*
