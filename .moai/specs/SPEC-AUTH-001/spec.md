---
id: "SPEC-AUTH-001"
version: "1.1.0"
status: "draft"
created: "2026-06-21"
updated: "2026-06-21"
author: "강력쇠주먹"
priority: "P0"
issue_number: 0
---

# SPEC-AUTH-001: 인증 (Authentication) 시스템

아이뜨락 아파트 커뮤니티 플랫폼의 인증 도메인 스펙. 본 SPEC은 AUTH 도메인 P0 범위(AUTH-01, AUTH-03, AUTH-04, AUTH-07)를 정의하며, P1 항목(AUTH-02/05/06)은 별도 SPEC으로 분리한다.

---

## HISTORY

- **2026-06-21**: 최초 작성 (강력쇠주먹). Phase 0.5 Deep Research 완료 후 Plan Review 게이트 통과. 확정 결정 3종 반영: (1) AUTH-07 API 소유권 AUTH 도메인 귀속, (2) RT 블랙리스트 DB 테이블 도입, (3) Rate Limiting DB 기반 구현.
- **2026-06-21 (rev 1.1.0)**: plan-auditor iteration 1 MAJOR 5건 해소. (1) REQ-AUTH-016 신설 — 비-ADMIN 강제 탈퇴 RBAC 403 (AC-AUTH-023 추적); (2) REQ-AUTH-010a 신설 — 미존재 building/unit → 422 (AC-AUTH-017 추적); (3) REQ-AUTH-011/AC-015를 `users.managed_building_id` 기반으로 변경 + SETUP 마이그레이션 cross-SPEC 의존성 명시; (4) AC-AUTH-027/028/029 신설 — JWT alg/exp 디코딩 및 RT 쿠키 속성 검증; (5) §2.1 suggestions 사이드이펙트 명시 + Exclusion #5 축소 (ADR-005 호수 귀속 정책).

---

## 1. 배경 및 목적

아이뜨락 아파트(총 2개 동 / 38세대) 입주민과 관리사무소를 잇는 웹 플랫폼의 인증 기반을 제공한다. 본 SPEC은 다음을 달성해야 한다:

- 이메일/비밀번호 기반 자체 회원가입 및 로그인 (AUTH-01, AUTH-03)
- 동/호수 기반 입주민 인증 (AUTH-04) — 미인증 시 모든 메인 기능 접근 차단
- 관리사무소(ADMIN)의 강제 탈퇴 기능 (AUTH-07) — 전입·전출 상황 대응
- JWT 기반 세션 관리 (AT 15분 / RT 7일 httpOnly 쿠키) — ADR-003 준거
- 보안 기본 요건 충족: 비밀번호 bcrypt 해시, RT 블랙리스트, Rate Limiting, 사용자 열거 공격 방지

기술 결정 근거는 `research.md` §6 ADR-003 및 `.moai/project/tech.md`를 참조한다.

---

## 2. 범위

### 2.1 In-Scope (본 SPEC이 구현하는 것)

- AUTH-01: 이메일/비밀번호 회원가입 (이메일 중복 검사 포함)
- AUTH-03: 로그인 / 로그아웃 (JWT 세션)
- AUTH-04: 동/호수 인증 (최초 1회)
- AUTH-07: 회원 강제 탈퇴 (관리사무소)
- M3: 토큰 갱신 (refresh) — AUTH-03의 파생 기능이지만 독립 모듈로 명시
- 신규 DB 테이블: `revoked_refresh_tokens` (RT 블랙리스트), `login_attempts` (Rate Limiting 추적)
- `users` 테이블 읽기/쓰기 (회원가입, 로그인, 인증 상태 변경, 강제 탈퇴)
- `buildings`, `units`, `roles` 테이블 읽기 전용 소비 (verify-unit 용도)
- `suggestions` 테이블 컬럼 사이드이펙트 쓰기 (강제 탈퇴 트랜잭션 내 전용): `archived=true`, `author_id=NULL`, `author_label="전 입주민"` — ADR-005(건의 호수 귀속 정책) 준거. **AUTH가 소유하는 도메인 동작**이며 SUGGEST CRUD/담변/상태 전이 로직은 포함하지 않는다 (Exclusion #5 참조).

### 2.2 Out-of-Scope (별도 SPEC)

- AUTH-02 (카카오 소셜 로그인, P1)
- AUTH-05 (비밀번호 재설정, P1)
- AUTH-06 (본인 회원 탈퇴, P1) — 단, AUTH-07의 "건의 아카이브" 로직은 AUTH-06과 공유되므로 재사용 가능 도메인 함수로 분리
- `buildings`, `units`, `roles` CRUD 관리 → SETUP SPEC 소관
- 공지사항(NOTICE) / 건의(SUGGEST) / 주차 추첨(PARKING) 도메인

---

## 3. 가정 및 사전 조건 (Dependencies)

본 SPEC은 다음 사전 조건이 충족되었다고 가정한다:

1. **`buildings` 테이블 seed 데이터**: 아이뜨락 A동, B동 레코드가 존재 (SETUP SPEC 또는 `db:seed` 제공)
2. **`units` 테이블 seed 데이터**: A동 26세대, B동 12세대 호수 레코드가 존재 (4층 없음, A동 3·4호 라인 및 B동 1층 없음 구조 반영)
3. **`roles` 테이블 seed 데이터**: ADMIN, CHAIR, REP, AUDITOR, RESIDENT 5종 레코드가 존재
4. **환경 변수 구성**: `DATABASE_URL`, `JWT_SECRET` (32자 이상), `JWT_REFRESH_SECRET` (JWT_SECRET과 상이, 32자 이상), `NEXT_PUBLIC_APP_URL` 설정됨
5. **HTTPS 강제**: 모든 토큰 전송은 TLS 1.2 이상 환경에서 수행됨 (개발 환경은 예외 허용, 프로덕션은 Railway HTTPS 자동 제공)
6. **`users.managed_building_id` 컬럼 (REQ-AUTH-011)**: `managed_building`은 회원 단위로 표현되어야 하므로 `users` 테이블에 위치한다 (공유 `roles` 룩업 테이블 배치는 2개 동 × 복수 REP 불가). 해당 컬럼의 **마이그레이션 및 스키마 정의는 SETUP SPEC 소관** (roles/buildings 스키마 소유권 일관성). 본 AUTH SPEC은 verify-unit 시 `users.managed_building_id`를 소비(읽기/쓰기)만 한다. **SETUP 마이그레이션 선행 전까지 AUTH 테스트는 이 컬럼을 stub 한다** (cross-SPEC dependency).
7. **ADR-005 (건의 호수 귀속 정책) 요약**: 강제 탈퇴 시 건의 데이터는 영구 보존되며 호수 귀속(`suggestions.unit_id`)을 유지한 채 작성자만 익명화(`author_id=NULL`, `author_label="전 입주민"`, `archived=true`)한다. 본 SPEC의 REQ-AUTH-014 step 2와 §6.5가 이 정책을 준거한다. 원문은 `.moai/project/tech.md`에 위치.

이들 seed 데이터의 **CRUD 관리는 본 SPEC 범위가 아니다** (SETUP SPEC 소관).

---

## 4. 기능 요구사항 (EARS)

### M1. 회원가입 (AUTH-01)

#### REQ-AUTH-001 (Ubiquitous) — 이메일 중복 검사

> **The system shall** 모든 회원가입 요청에 대해 이메일 중복을 검사하고, 이미 가입된 이메일인 경우 가입을 거부한다.

#### REQ-AUTH-002 (Unwanted) — 평문 비밀번호 저장 금지

> **If** 회원가입 시 비밀번호가 제출되면, **then** the system **shall not** 평문으로 비밀번호를 저장하고, bcrypt(salt rounds 12) 해시로만 저장한다.

#### REQ-AUTH-003 (Event-driven) — 가입 성공 시 인증 화면 강제 이동

> **When** 회원가입이 성공하면, the system **shall** `role=RESIDENT`, `verified=false` 상태로 회원 레코드를 생성하고 클라이언트를 동/호수 인증 화면으로 강제 이동시킨다.

---

### M2. 로그인 / 로그아웃 (AUTH-03)

#### REQ-AUTH-004 (Event-driven) — 로그인 시 토큰 발급

> **When** 유효한 이메일/비밀번호로 로그인에 성공하면, the system **shall** Access Token(15분, HS256)을 응답 본문에 반환하고 Refresh Token(7일)을 httpOnly + secure + sameSite=strict 쿠키로 설정한다.

#### REQ-AUTH-005 (Unwanted) — 자격증명 오류 메시지 통일

> **If** 로그인 시 이메일이 존재하지 않거나 비밀번호가 일치하지 않으면, **then** the system **shall not** 어떤 항목이 틀렸는지 구분하는 메시지를 노출하고, 동일한 "이메일 또는 비밀번호가 올바르지 않습니다" 오류를 반환한다 (사용자 열거 공격 방지).

#### REQ-AUTH-006 (State-driven) — 5회 실패 시 10분 잠금

> **While** 동일 이메일에 대해 연속 5회 로그인 실패가 누적된 상태인 경우, the system **shall** 10분간 해당 이메일의 로그인 시도를 차단하고 429 응답을 반환한다.

#### REQ-AUTH-007 (Event-driven) — 로그아웃 시 RT 블랙리스트 등록 및 쿠키 삭제

> **When** 인증된 사용자가 로그아웃을 요청하면, the system **shall** 현재 Refresh Token을 `revoked_refresh_tokens` 테이블에 등록하고 클라이언트의 RT 쿠키를 만료 처리한다.

---

### M3. 토큰 갱신 (Refresh)

#### REQ-AUTH-008 (Event-driven) — RT로 AT 갱신

> **When** 클라이언트가 유효하고 블랙리스트에 등록되지 않은 Refresh Token으로 갱신을 요청하면, the system **shall** 새로운 Access Token(15분)을 발급하여 응답 본문에 반환한다.

#### REQ-AUTH-009 (Unwanted) — 블랙리스트/만료 RT 거부

> **If** Refresh Token이 만료되었거나 블랙리스트에 등록되어 있으면, **then** the system **shall not** 토큰을 갱신하고, 401 응답과 함께 재로그인을 유도한다.

---

### M4. 동/호수 인증 (AUTH-04)

#### REQ-AUTH-010 (Event-driven) — 인증 성공 시 verified=true

> **When** 인증된 사용자가 유효한 `building_id`와 `unit_id`를 제출하고 해당 호수가 이미 인증된 회원이 없으면, the system **shall** 회원의 `unit_id`를 설정하고 `verified_at`을 현재 시각으로 갱신한다.

#### REQ-AUTH-010a (Unwanted) — 미존재 building/unit 제출 시 422 거부

> **If** verify-unit 요청이 DB에 존재하지 않는 `building_id` 또는 `unit_id`를 포함하면 (또는 `building_id`에 속하지 않는 `unit_id`), **then** the system **shall not** 인증을 진행하고 `422 Unprocessable Entity` 응답을 반환한다 (AC-AUTH-017 추적).

#### REQ-AUTH-011 (Event-driven) — 동대표(REP) managed_building 자동 연결

> **When** `role=REP`인 사용자가 동/호수 인증에 성공하면, the system **shall** 해당 회원 레코드의 `users.managed_building_id` 컬럼에 인증한 building_id를 자동 연결한다.
>
> *스키마 결정 (plan-audit iteration 1 MAJOR-2 해결)*: `managed_building`은 **회원 단위(`users.managed_building_id`)**에서 읽는다. 공유 `roles` 룩업 테이블에 두는 스키마는 2개 동 × 복수 REP 표현이 불가하므로 채택하지 않는다. `users.managed_building_id` 컬럼 도입은 SETUP SPEC(roles/buildings 스키마 소유)의 책임이며, AUTH는 verify-unit 시 이 컬럼을 소비만 한다. SETUP 마이그레이션 선행 전까지 AUTH 테스트는 해당 컬럼을 stub 한다 (§3 Dependencies 참조).

#### REQ-AUTH-012 (Unwanted) — 동일 호수 중복 인증 방지

> **If** 이미 다른 회원이 인증한 호수에 대해 인증을 시도하면, **then** the system **shall not** 인증을 진행하고 409 CONFLICT 오류와 "관리사무소에 문의하세요" 안내를 반환한다.

#### REQ-AUTH-013 (State-driven) — 미인증 회원 메인 접근 차단

> **While** 회원이 `verified_at=NULL` 상태인 경우, the system **shall** 모든 메인 기능(공지, 건의, 주차) 접근을 차단하고 동/호수 인증 화면으로 리다이렉트한다.

---

### M5. 강제 탈퇴 (AUTH-07)

#### REQ-AUTH-014 (Event-driven) — ADMIN 강제 탈퇴 실행

> **When** ADMIN이 회원 관리 화면에서 특정 회원의 강제 탈퇴를 실행하면, the system **shall** 다음을 원자적으로(단일 트랜잭션) 수행한다:
> 1. 대상 회원 `status=INACTIVE` 변경
> 2. 해당 회원이 작성한 모든 건의를 아카이브(`archived=true`, `author_label="전 입주민"`, `author_id=NULL`) — ADR-005 호수 귀속 정책 준거; `unit_id`는 유지. AUTH가 소유하는 도메인 사이드이펙트 (SUGGEST CRUD 외, §2.1/Exclusion #5 참조)
> 3. 직책 회수 (의미상 `role=RESIDENT`로 환원, INACTIVE이므로 접근 불가)
> 4. 동/호수 인증 해제 (`unit_id=NULL`, `verified_at=NULL` → 해당 호수 신규 인증 가능 상태로)
> 5. 해당 회원의 모든 Refresh Token 즉시 무효화 (`revoked_refresh_tokens` 일괄 등록)

#### REQ-AUTH-015 (Unwanted) — ADMIN 자체 강제 탈퇴 금지

> **If** 요청자 자신(ADMIN 본인)에 대한 강제 탈퇴를 시도하면, **then** the system **shall not** 탈퇴를 실행하고 403 Forbidden을 반환한다 (운영자 자물쇠 회피).

#### REQ-AUTH-016 (Unwanted) — 비-ADMIN 역할의 강제 탈퇴 호출 거부 (RBAC)

> **If** 강제 탈퇴 엔드포인트(`POST /api/auth/users/[id]/deactivate`) 호출자의 역할이 ADMIN이 아니면 (RESIDENT/CHAIR/REP/AUDITOR), **then** the system **shall not** 탈퇴 로직을 실행하고 `403 Forbidden`을 반환한다 (RBAC 미들웨어 차단, AC-AUTH-023 추적).

---

## 5. Exclusions (What NOT to Build)

본 SPEC은 다음 항목을 구현하지 않는다 (별도 SPEC 또는 명시적 OUT):

1. **AUTH-02 카카오 소셜 로그인 (P1)** — 별도 SPEC에서 OAuth 2.0 흐름 다룸. 단, `users.provider`, `users.provider_id` 컬럼은 AUTH-02 호환성을 위해 현재 스키마에 포함되지만 본 SPEC에서는 사용하지 않는다.
2. **AUTH-05 비밀번호 재설정 (P1)** — 이메일 링크 방식, 링크 유효시간 1시간. 별도 SPEC.
3. **AUTH-06 본인 회원 탈퇴 (P1)** — 본인 요청 탈퇴. 단, AUTH-07의 "건의 아카이브 로직"은 AUTH-06과 재사용되도록 도메인 함수로 분리한다.
4. **`buildings` / `units` / `roles` CRUD** — SETUP SPEC 소관. 본 SPEC은 이 테이블을 읽기 전용으로만 소비한다.
5. **공지(NOTICE) / 건의(SUGGEST) / 주차 추첨(PARKING) 도메인** — 별도 SPEC. SUGGEST 도메인 기능(건의 CRUD/답변/상태 전이/카테고리 관리)은 OUT — 단, 강제 탈퇴 트랜잭션의 `suggestions` 컬럼 사이드이펙트(`author_id=NULL` / `author_label="전 입주민"` / `archived=true`)는 ADR-005 호수 귀속 정책 준수를 위해 AUTH가 소유한다 (§2.1 및 REQ-AUTH-014 step 2 참조).
6. **마이페이지 / 프로필 편집** — 별도 SPEC.
7. **2단계 인증(2FA) / 이메일 인증 링크** — 현재 범위 아님.

---

## 6. 비기능 요구사항 (제약)

### 6.1 보안 (Security)

- **JWT_SECRET / JWT_REFRESH_SECRET**: 각각 32자 이상 무작위 문자열, 서로 상이해야 함. 환경 변수로만 제공, 소스 코드 하드코딩 금지.
- **비밀번호 해시**: bcrypt salt rounds 12 고정. 평문 저장 절대 금지.
- **RT 저장**: httpOnly + secure + sameSite=strict 쿠키만 허용. LocalStorage / SessionStorage 저장 금지 (XSS 방지).
- **CSRF 방지**: RT 쿠키는 SameSite=Strict 설정 필수.
- **SQL Injection 방어**: 모든 DB 쿼리는 Parameterized Query 또는 ORM 사용. 문자열 결합 쿼리 금지.
- **사용자 열거 공격 방지**: 로그인 실패 메시지는 "이메일 없음"과 "비밀번호 오류"를 구분하지 않는다.
- **HTTPS 강제**: 프로덕션 환경에서 모든 토큰 전송은 HTTPS로만. 개발 환경 예외 허용.

### 6.2 성능 (Performance)

- 모든 인증 API 응답 시간: P95 500ms 이하 (PostgreSQL 로컬 또는 Railway 환경)
- bcrypt 해시 연산은 동기 처리 허용 (38세대 규모에서 병목 아님)
- JWT 서명/검증은 메모리 내 수행, DB 조회 없이 self-contained

### 6.3 가용성 (Availability)

- 단일 PostgreSQL 인스턴스에 의존 (Railway Managed DB). 다중 인스턴스 구성은 P2 범위.
- RT 블랙리스트는 DB 기반 → 서버 재시작 후에도 유지.
- Rate Limiting 상태는 DB 기반 (`login_attempts` 테이블) → 서버 재시작 후에도 유지.

### 6.4 감사 (Auditability)

- 회원가입, 로그인, 강제 탈퇴 이벤트는 애플리케이션 로그로 기록 (단, 비밀번호 평문/해시는 로그에서 제외).
- RT 블랙리스트 등록 시각(`revoked_at`) 기록.

### 6.5 개인정보 최소화 (Data Minimization)

- 수집 항목: 이메일, 비밀번호 해시, 동/호수 (인증 완료 시)
- 미수집: 이름, 전화번호, 생년월일
- 강제 탈퇴 시 건의 데이터는 영구 보존 (호수 귀속 유지, ADR-005 준거) → `author_label="전 입주민"`으로 익명화

---

## 7. MX Tag Plan (코드 주석 계획)

Run Phase에서 다음 @MX 태그를 적용한다:

### @MX:ANCHOR (fan_in >= 3 또는 공개 API 경계)

- `src/lib/auth.ts`: 토큰 발급/검증/갱신 함수 — 다수 API route에서 호출
- `src/lib/middleware.ts`: RBAC 미들웨어 — 모든 보호 엔드포인트에서 적용
- `src/lib/db.ts`: PostgreSQL 연결 풀 — 모든 DB 접근 경로

### @MX:WARN with @MX:REASON (위험 영역)

- bcrypt salt rounds 12 해시 — `@MX:REASON: 비밀번호 보안 핵심, rounds 변경 시 전체 해시 재생성 필요`
- JWT 서명 / 검증 — `@MX:REASON: 시크릿 노출 시 전체 세션 위변조 위험`
- RT 블랙리스트 등록/조회 — `@MX:REASON: 누락 시 탈취 토큰 재사용 가능`
- Rate Limiting 잠금 로직 — `@MX:REASON: 임계치 오설정 시 브루트포스 허용 또는 정상 사용자 잠금`

### @MX:NOTE (도메인 의도 전달)

- 회원가입 후 인증 화면 강제 이동 플로우 — `@MX:NOTE: AUTH-04 미완료 시 모든 메인 기능 차단 정책과 연동`
- 동대표(REP) `managed_building` 자동 연결 — `@MX:NOTE: 비공개 건의 열람 권한 위임의 기반 데이터`
- 강제 탈퇴 트랜잭션 경계 — `@MX:NOTE: 5단계 원자적 처리, 중간 실패 시 전체 롤백`

### @MX:TODO (후속 SPEC 연결 지점)

- `users.provider="email"` 기본값 설정 지점 — `@MX:TODO: AUTH-02 카카오 로그인에서 provider="kakao" 사용`
- 비밀번호 재설정 미구현 — `@MX:TODO: AUTH-05 별도 SPEC`

---

## 8. 검증 기준 요약

상세 Given/When/Then 시나리오는 `acceptance.md`를 참조. 각 모듈당 최소 2개 시나리오, 총 13개 이상 검증 케이스를 정의한다.

---

## 9. 참조 문서

- `research.md` (본 디렉토리): AUTH 도메인 Deep Research 전문
- `.moai/project/product.md`: 제품 개요 및 AUTH-01~07 정의
- `.moai/project/structure.md`: 라우팅 구조, 역할 기반 접근 모델, 보안 아키텍처
- `.moai/project/tech.md`: 기술 스택, ADR-003 (JWT 결정), 환경 변수 목록
- `plan.md` (본 디렉토리): TDD 구현 계획, 파일 목록, DB 마이그레이션
- `acceptance.md` (본 디렉토리): 검증 시나리오, 품질 게이트 기준

---

*본 SPEC은 greenfield 프로젝트 기준으로 작성되었다 (Delta 마커 없음).*
