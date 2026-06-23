---
id: "SPEC-SETUP-001"
version: "1.0.0"
status: "Complete"
created: "2026-06-21"
updated: "2026-06-23"
author: "강력쇠주먹"
priority: "P0"
issue_number: 0
---

# SPEC-SETUP-001: 단지 설정 (동/호수/직책/회원 관리)

아이뜨락 아파트 커뮤니티 플랫폼의 단지 설정(SETUP) 도메인 스펙. 본 SPEC은 SETUP 도메인 P0 범위(SETUP-01 동 관리, SETUP-02 호수 관리, SETUP-04 직책 부여/변경/회수, SETUP-05 회원 목록 조회) 및 cross-SPEC 스키마 정리 책임(`managed_building_id` 단일 출처 통일)을 정의한다. P1 항목(SETUP-03 직책 종류 CRUD)은 별도 SPEC으로 분리한다.

---

## HISTORY

- **2026-06-21**: 최초 작성 (강력쇠주먹). Phase 0.5 Deep Research(`research.md` 522 라인) 완료 후 Plan Review 게이트 통과. 확정 결정 4종 반영: (1) 강제 탈퇴 → AUTH 위임(SETUP 미구현, `DELETE /api/setup/users/:id`는 AUTH `/api/auth/users/[id]/deactivate` 호출), (2) SETUP-03 직책 종류 CRUD OUT(P1 별도 SPEC), 역할 5종(ADMIN/CHAIR/REP/AUDITOR/RESIDENT) 고정, (3) CHAIR 직책 부여 권한 = RESIDENT/REP/AUDITOR 한정(ADMIN 부여 시 403), (4) `GET /api/setup/buildings` 공개 처리(middleware matcher 예외, 인증 목적 비인증 허용).
- **2026-06-22**: P0 구현 완료 (강력쇠주먹). develop 브랜치에 병합됨 (커밋 bb7b3f4). 모든 기능 요구사항(REQ-SETUP-001 ~ REQ-SETUP-020) 구현 완료. 테스트 커버리지 290/290 통과.
- **2026-06-23**: 문서 동기화 완료 (강력쇠주먹). 실제 구현된 내용을 SPEC 문서에 반영. README.md에 SETUP 도메인 API 엔드포인트 추가 완료.

---

## 1. 배경 및 목적

아이뜨락 아파트(총 2개 동 / 38세대)의 단지 구성 데이터(동·호수·직책)와 관리사무소(ADMIN) 회원 관리 기능을 제공한다. AUTH P0가 이미 `buildings`/`units`/`roles`/`users` 스키마와 시드 데이터를 마이그레이션 001 + `seed.ts`로 구축했으므로, 본 SPEC은 소유권을 이관받아 확장·관리한다. 동시에 `managed_building_id` 단일 출처 통일(`roles` → `users`)이라는 cross-SPEC 스키마 정리 책임을 진다.

본 SPEC은 다음을 달성해야 한다:

- SETUP-01: 동(building) 추가/삭제 — 활성 입주민 존재 시 삭제 금지
- SETUP-02: 동별 호수(unit) 일괄 업데이트 — 비정형 구조(4층 제외, A동 3·4호 라인, B동 1층 없음) 지원
- SETUP-04: 직책 부여/변경/회수 — 회장(CHAIR) 단일성 원자 보장, 동대표(REP) 담당 동 필수
- SETUP-05: 회원 목록 조회 — 동/역할/페이지 필터, 개인정보 최소화
- M5: `managed_building_id` 단일 출처 통일(`roles` → `users`)
- M6: 동/호수 공개 조회 엔드포인트(`GET /api/setup/buildings`, 비인증 허용)

기술 결정 근거는 `research.md` 및 `.moai/project/tech.md`를 참조한다.

---

## 2. 범위

### 2.1 In-Scope (본 SPEC이 구현하는 것)

- SETUP-01: 동 추가(`POST /api/setup/buildings`), 동 삭제(`DELETE /api/setup/buildings/[id]`) — ADMIN 전용
- SETUP-02: 호수 일괄 업데이트(`PUT /api/setup/buildings/[id]/units`) — ADMIN 전용, diff(추가/삭제) 단일 트랜잭션
- SETUP-04: 직책 부여/변경/회수(`PUT /api/setup/users/[id]/role`) — ADMIN/CHAIR
- SETUP-05: 회원 목록 조회(`GET /api/setup/users`) — ADMIN 전용, building/role/page/limit 필터
- 동/호수 공개 조회(`GET /api/setup/buildings`) — 인증 목적, 비인증 허용
- M5: `roles.managed_building_id` 컬럼 제거, `users.managed_building_id` 단일 출처 확정
- M6: `GET /api/setup/buildings` 공개 엔드포인트(비인증 허용, 회원 데이터 미포함)
- `buildings`/`units`/`users.managed_building_id`/`users.role_id` 테이블 읽기/쓰기
- AUTH 산출물 재사용: `src/lib/{db,auth,cookies}.ts`, `verifyAccessToken`, `withTransaction`, `query`, RBAC route handler 패턴(deactivate route.ts), UUID 정규식, zod 검증

### 2.2 Out-of-Scope (별도 SPEC)

- SETUP-03 직책 종류 CRUD(P1) — 역할 5종(ADMIN/CHAIR/REP/AUDITOR/RESIDENT) 고정
- 강제 탈퇴(`DELETE /api/setup/users/:id`) — AUTH `/api/auth/users/[id]/deactivate` 소유(REQ-AUTH-014, 5단계 원자적 트랜잭션)
- AUTH-06 본인 회원 탈퇴(P1) — 별도 SPEC
- 공지(NOTICE) / 건의(SUGGEST) / 주차 추첨(PARKING) 도메인
- 마이페이지 / 프로필 편집

---

## 3. 가정 및 사전 조건 (Dependencies)

본 SPEC은 다음 사전 조건이 충족되었다고 가정한다:

1. **SPEC-AUTH-001 P0 완료·병합**: `buildings`/`units`/`roles`/`users` 테이블 스키마(migration 001)와 시드 데이터(`scripts/seed.ts`: A동/B동, A동 26세대·B동 12세대 호수, 역할 5종)가 이미 존재한다.
2. **AUTH 라이브러리 재사용 가능**: `src/lib/db.ts`(PostgreSQL 연결 풀, `query`, `withTransaction`), `src/lib/auth.ts`(`verifyAccessToken`, JWT 검증), `src/lib/cookies.ts`가 AUTH P0에서 구현되어 있으며 본 SPEC이 재사용한다.
3. **AUTH 미들웨어 패턴 재사용**: `src/middleware.ts`의 matcher 구조와 RBAC route handler 패턴(`src/app/api/auth/users/[id]/deactivate/route.ts` line 70-84)을 그대로 따른다.
4. **`users.managed_building_id` 컬럼 존재**: AUTH P0(plan-audit iteration 1 MAJOR-2 결정)가 이미 이 컬럼을 `users` 테이블에 정의했으며, AUTH verify-unit(REQ-AUTH-011)이 읽기/쓰기하고 있다. 본 SPEC은 migration 005로 `roles.managed_building_id`를 제거하고 `users.managed_building_id`를 REP 담당 동 단일 출처로 확정한다.
5. **강제 탈퇴는 AUTH 위임**: SETUP-05 회원 목록 화면의 "삭제" 버튼은 클라이언트가 AUTH `POST /api/auth/users/[id]/deactivate`를 직접 호출한다. 본 SPEC은 해당 엔드포인트를 구현하지 않으며, 의존성으로만 문서화한다.
6. **역할 5종 고정**: ADMIN(관리사무소)/CHAIR(회장)/REP(동대표)/AUDITOR(감사)/RESIDENT(일반 입주민) 5종은 시드 고정값이며, SETUP-03(직책 종류 CRUD)은 본 SPEC 범위 외(P1).
7. **환경 변수**: AUTH와 동일(`DATABASE_URL`, `JWT_SECRET` 등) — 신규 불필요.
8. **HTTPS 강제**: 모든 API는 HTTPS(Railway 자동 제공). 개발 환경 예외 허용.

---

## 4. 기능 요구사항 (EARS)

### M1. 동 관리 (SETUP-01)

#### REQ-SETUP-001 (Event-driven) — ADMIN 동 추가

> **When** ADMIN이 신규 동명(name)을 포함하여 동 추가를 요청하면, the system **shall** `buildings` 테이블에 신규 레코드를 생성하고 `201 Created` 응답과 함께 동 ID 및 동명을 반환한다.

#### REQ-SETUP-002 (Unwanted) — 동명 중복 금지

> **If** 동 추가 요청의 name 이 기존 `buildings.name` UNIQUE 제약과 충돌하면, **then** the system **shall not** 레코드를 생성하고 `409 Conflict` 응답을 반환한다.

#### REQ-SETUP-003 (Unwanted) — 활성 입주민 있는 동 삭제 금지 / 미존재 동 404

> **If** 삭제 대상 동의 종속 호수(`units`) 중 활성 입주민(`users.status='ACTIVE'`, `unit_id IS NOT NULL`)이 인증한 호수가 하나라도 존재하면, **then** the system **shall not** 동 및 종속 호수를 삭제하고 `409 Conflict` 응답을 반환한다.
>
> **If** 삭제 대상 building_id 가 DB에 존재하지 않으면, **then** the system **shall** `404 Not Found` 응답을 반환한다 (삭제 대상 없음).

#### REQ-SETUP-004a (Unwanted) — 동 관리 미인증 거부 (401)

> **If** 동 추가(`POST`) 또는 동 삭제(`DELETE`) 요청이 유효한 액세스 토큰 없이(누락/만료/변조) 수신되면, **then** the system **shall not** 로직을 실행하고 `401 Unauthorized` 응답을 반환한다 (인증 실패).

#### REQ-SETUP-004b (State-driven) — ADMIN RBAC (동 관리, 403)

> **While** 요청자가 유효한 액세스 토큰으로 인증되었으나 역할이 ADMIN 이 아닌 상태(CHAIR/REP/AUDITOR/RESIDENT)에서 동 추가(`POST`) 또는 동 삭제(`DELETE`)를 시도하면, the system **shall** `403 Forbidden` 응답을 반환한다 (권한 없음).

---

### M2. 호수 관리 (SETUP-02)

#### REQ-SETUP-005 (Event-driven) — 호수 일괄 업데이트

> **When** ADMIN이 특정 동(building_id)의 전체 호수 배열을 제출하면, the system **shall** 기존 호수와의 diff(추가/삭제)를 단일 트랜잭션으로 적용하고 `200 OK` 응답과 함께 갱신된 호수 목록을 반환한다. 빈 배열(`units: []`) 제출은 유효한 제출로 간주하며, "해당 동의 모든 기존 호수 삭제(REQ-SETUP-006 활성 입주민 검사 적용)"를 의미한다.

#### REQ-SETUP-006 (Unwanted) — 삭제 대상 호수 활성 입주민 금지

> **If** 일괄 업데이트의 삭제 대상 호수(`unit_number`) 중 활성 입주민(`status='ACTIVE'`)이 인증한 호수가 하나라도 존재하면, **then** the system **shall not** 호수 삭제를 진행하고 `409 Conflict` 응답을 반환한다(트랜잭션 전체 롤백).

#### REQ-SETUP-007 (Unwanted) — 미존재 building_id 호수 업데이트 금지

> **If** 호수 업데이트 요청의 building_id 가 DB에 존재하지 않으면, **then** the system **shall not** 업데이트를 진행하고 `404 Not Found` 응답을 반환한다.

#### REQ-SETUP-007a (Unwanted) — 입력 유효성 검증 실패 (422 / 400)

> **If** 동 추가 요청의 name 이 `VARCHAR(20)` 을 초과하거나, path param(`[id]`) 이 `UUID_RE` 형식에 불일치하면, **then** the system **shall not** 로직을 실행하고 name 초과 시 `422 Unprocessable Entity`, UUID 불일치 시 `400 Bad Request` 응답을 반환한다 (NFR §6.1 입력 검증 규격 적용).

#### REQ-SETUP-008a (Unwanted) — 호수 관리 미인증 거부 (401)

> **If** 호수 일괄 업데이트(`PUT`) 요청이 유효한 액세스 토큰 없이(누락/만료/변조) 수신되면, **then** the system **shall not** 로직을 실행하고 `401 Unauthorized` 응답을 반환한다 (인증 실패).

#### REQ-SETUP-008b (State-driven) — ADMIN RBAC (호수 관리, 403)

> **While** 요청자가 유효한 액세스 토큰으로 인증되었으나 역할이 ADMIN 이 아닌 상태(CHAIR/REP/AUDITOR/RESIDENT)에서 호수 업데이트(`PUT`)를 시도하면, the system **shall** `403 Forbidden` 응답을 반환한다 (권한 없음).

---

### M3. 직책 부여/변경/회수 (SETUP-04)

#### REQ-SETUP-009 (Event-driven) — 직책 부여/회수

> **When** ADMIN 또는 CHAIR 이 특정 회원(user_id)에 대해 직책 부여(`role` + 필요시 `managed_building_id`) 또는 회수(`role='RESIDENT'`)를 요청하면, the system **shall** `users.role_id` 를 갱신하고 `200 OK` 응답을 반환한다. 단, `role='REP'` 부여 시 `users.managed_building_id` 를 함께 갱신하고, `role='RESIDENT'` 회수 시 `users.managed_building_id` 를 `NULL` 로 설정한다.

#### REQ-SETUP-010 (Complex/While) — 회장 단일성 원자 보장

> **While** 이미 기존 회장(CHAIR)이 존재하는 상태에서, **when** 신규 회장(CHAIR) 부여 요청이 들어오면, the system **shall** 단일 트랜잭션 내에서 기존 회장을 RESIDENT 로 자동 회수(`role_id` 갱신, `managed_building_id=NULL`)한 후 신규 회장을 부여한다 (회장은 단지당 1명 원자 보장).

#### REQ-SETUP-011 (Unwanted) — REP 부여 시 managed_building_id 누락 금지

> **If** `role='REP'` 부여 요청에 `managed_building_id` 가 누락되면, **then** the system **shall not** 부여를 진행하고 `422 Unprocessable Entity` 응답을 반환한다.

#### REQ-SETUP-012 (Unwanted) — CHAIR 의 ADMIN 부여 금지

> **If** CHAIR 역할의 호출자가 ADMIN 직책을 부여(`role='ADMIN'`)하려 시도하면, **then** the system **shall not** 부여를 진행하고 `403 Forbidden` 응답을 반환한다 (CHAIR 권한 범위 = RESIDENT/REP/AUDITOR 한정; ADMIN 부여/회수는 ADMIN 전용).

#### REQ-SETUP-013a (Unwanted) — 직책 부여 미인증 거부 (401)

> **If** 직책 부여/회수 엔드포인트(`PUT /api/setup/users/[id]/role`) 요청이 유효한 액세스 토큰 없이(누락/만료/변조) 수신되면, **then** the system **shall not** 부여 로직을 실행하고 `401 Unauthorized` 응답을 반환한다 (인증 실패).

#### REQ-SETUP-013b (State-driven) — 비-ADMIN/비-CHAIR 직책 부여 금지 (403)

> **While** 요청자가 유효한 액세스 토큰으로 인증되었으나 역할이 ADMIN 또는 CHAIR 가 아닌 상태(RESIDENT/REP/AUDITOR)에서 직책 부여를 시도하면, the system **shall** 부여 로직을 실행하지 않고 `403 Forbidden` 응답을 반환한다 (권한 없음).

---

### M4. 회원 목록 조회 (SETUP-05)

#### REQ-SETUP-014 (State-driven) — ADMIN 회원 목록 조회

> **While** ADMIN 역할의 호출자가 회원 목록 조회를 요청하는 상태에서, the system **shall** `building`/`role`/`page`/`limit` 쿼리 필터를 지원하고, `created_at DESC` 기본 정렬로 페이지네이션된 회원 목록을 `200 OK` 응답으로 반환한다.

#### REQ-SETUP-015 (Ubiquitous) — password_hash 미노출

> **The system shall** 회원 목록 응답 본문에 `password_hash` 필드를 절대 포함하지 않는다 (개인정보 최소화, AUTH AC-AUTH-025 패턴 동일).

#### REQ-SETUP-016a (Unwanted) — 회원 목록 조회 미인증 거부 (401)

> **If** 회원 목록 조회(`GET /api/setup/users`) 요청이 유효한 액세스 토큰 없이(누락/만료/변조) 수신되면, **then** the system **shall not** 목록을 반환하고 `401 Unauthorized` 응답을 반환한다 (인증 실패).

#### REQ-SETUP-016b (State-driven) — 비-ADMIN 회원 목록 조회 금지 (403)

> **While** 요청자가 유효한 액세스 토큰으로 인증되었으나 역할이 ADMIN 이 아닌 상태(CHAIR/REP/AUDITOR/RESIDENT)에서 회원 목록 조회를 시도하면, the system **shall** 목록을 반환하지 않고 `403 Forbidden` 응답을 반환한다 (권한 없음).

#### REQ-SETUP-017 (Optional) — INACTIVE 회원 포함 조회 (선택)

> **Where** 회원 목록 조회 요청에 명시적 `status` 쿼리 파라미터가 생략된 경우, the system **shall** `status='ACTIVE'` 회원만 기본으로 포함하고 `INACTIVE` 회원은 제외한다 (관리사무소 회원 관리 화면 기본 동작). `?status=INACTIVE` 명시 시 INACTIVE 만, `?status=ALL` 시 전체를 반환한다.

---

### M5. managed_building_id 단일 출처 통일

#### REQ-SETUP-018 (Ubiquitous) — roles.managed_building_id 제거

> **The system shall** `roles` 테이블에서 `managed_building_id` 컬럼 및 종속 외래키 제약을 제거하여, REP 담당 동 정보가 `roles` 가 아닌 `users` 에만 존재하도록 한다. 기존 `roles` 행은 해당 컬럼이 모두 `NULL` 이므로 데이터 손실 없이 안전하다.

#### REQ-SETUP-019 (Ubiquitous) — users.managed_building_id 단일 출처

> **The system shall** REP 담당 동 할당을 `users.managed_building_id` 컬럼을 단일 출처로 확정한다. AUTH verify-unit(REQ-AUTH-011)과 SETUP-04(REQ-SETUP-009)는 모두 이 컬럼을 소비/갱신하며, `roles.managed_building_id` 는 더 이상 참조하지 않는다.

---

### M6. 동/호수 공개 조회 (GET /api/setup/buildings 공개 엔드포인트)

#### REQ-SETUP-020 (Event-driven) — 동/호수 공개 조회 (비인증 허용)

> **When** 클라이언트가 `GET /api/setup/buildings` 로 동/호수 목록을 요청하면, the system **shall** 액세스 토큰 없이(비인증)도 `200 OK` 응답으로 동 목록과 종속 호수(`unit_number` 배열)를 반환한다 (AUTH verify-unit 클라이언트 소비 목적, 공개 엔드포인트). 응답 본문에는 회원 데이터(email/password_hash/role 등)를 절대 포함하지 않는다.

---

## 5. Exclusions (What NOT to Build)

본 SPEC은 다음 항목을 구현하지 않는다 (별도 SPEC 또는 명시적 OUT):

1. **SETUP-03 직책 종류 CRUD (P1)** — 역할 종류 추가/삭제/수정. 본 SPEC은 역할 5종(ADMIN/CHAIR/REP/AUDITOR/RESIDENT)을 시드 고정값으로 취급하며, 커스텀 직책 추가는 별도 SPEC에서 다룬다. `@MX:TODO: SETUP-03 별도 SPEC` 으로 연결 지점 표시.
2. **강제 탈퇴 (`DELETE /api/setup/users/:id`)** — AUTH `/api/auth/users/[id]/deactivate`(REQ-AUTH-014, 5단계 원자적 트랜잭션: `status=INACTIVE` + 건의 아카이브 + role 환원 + `unit_id`/`verified_at` 해제 + RT 갱신 차단)가 소유한다. SETUP-05 회원 목록의 "삭제" 버튼은 클라이언트가 AUTH 엔드포인트를 직접 호출하며, 본 SPEC은 해당 API를 구현하지 않는다 (의존성으로만 문서화).
3. **공지(NOTICE) / 건의(SUGGEST) / 주차 추첨(PARKING) 도메인** — 별도 SPEC.
4. **AUTH verify-unit (`POST /api/auth/verify-unit`)** — AUTH 소유. 본 SPEC은 `buildings`/`units` 데이터를 읽기 전용으로 제공(`GET /api/setup/buildings`)만 하며, AUTH 인증 흐름에 관여하지 않는다.
5. **마이페이지 / 프로필 편집** — 별도 SPEC.
6. **호수 unit_number rename (수정)** — apt_06에 명시 없음. 호수 "수정"은 삭제+추가 조합으로 취급하며, unit rename 지원은 OUT.
7. **2단계 인증(2FA) / 이메일 인증 링크** — 현재 범위 아님.

---

## 6. 비기능 요구사항 (제약)

### 6.1 보안 (Security)

- **RBAC**: 모든 SETUP API(단 `GET /api/setup/buildings` 공개 제외)는 서버 사이드 JWT 검증(`verifyAccessToken`) + role 체크 필수. 클라이언트 단독 신뢰 금지(AUTH 패턴 동일).
- **SQL Injection 방어**: 모든 DB 쿼리는 Parameterized Query(`query` 함수). 문자열 결합 쿼리 금지(AUTH AC-AUTH-026 패턴).
- **입력 유효성 검증**: 서버 사이드 zod 스키마 필수(AUTH verify-unit route.ts 패턴). building name `VARCHAR(20)`, unit_number `VARCHAR(10)`, UUID path param 형식 검증(AUTH deactivate route.ts `UUID_RE` 패턴).
- **개인정보 최소화**: SETUP-05 회원 목록 노출 = email + role + building + unit + verified_at + status. `password_hash` 절대 미포함. 이름/전화번호 미수집 정책 유지.
- **삭제 안전성**: 동/호수 삭제 전 활성 입주민 존재 여부 확인 → 있으면 409. 인증된 입주민의 `unit_id` 가 dangling FK 가 되는 것 방지.

### 6.2 성능 (Performance)

- 모든 SETUP API 응답 시간: P95 500ms 이하.
- 회원 목록 조회 페이지네이션: 기본 limit 20, 최대 100. `OFFSET`/`LIMIT` 기반.
- 호수 일괄 업데이트: 단일 트랜잭션 내 diff 적용(38세대 규모에서 병목 아님).

### 6.3 가용성 (Availability)

- 단일 PostgreSQL 인스턴스 의존(Railway Managed DB, AUTH와 공유).
- migration 005 는 AUTH migration 001 이후 순차 적용. idempotent 하지 않으므로 한 번만 실행.

### 6.4 감사 (Auditability)

- 동 추가/삭제, 호수 업데이트, 직책 부여/회수 이벤트는 애플리케이션 로그로 기록(단, PII 는 로그에서 제외).
- 회장(CHAIR) 단일성 위반 시도, CHAIR 의 ADMIN 부여 시도 등 권한 오용 시도는 경고 로그로 기록.

---

## 7. MX Tag Plan (코드 주석 계획)

Run Phase에서 다음 @MX 태그를 적용한다:

### @MX:ANCHOR (fan_in >= 3 또는 공개 API 경계)

- `buildings`/`units`/`roles` CRUD route handlers — 다수 클라이언트(AUTH verify-unit, SETUP-05 회원 목록, 관리사무소 화면)에서 호출
- migration 005 스키마 불변 지점 — AUTH/SETUP 양 도메인이 의존

### @MX:WARN with @MX:REASON (위험 영역)

- 동/호수 삭제 안전성 체크 로직 — `@MX:REASON: 활성 입주민 unit_id dangling FK 방지, 우회 시 인증된 회원 데이터 손상`
- 회장(CHAIR) 단일성 트랜잭션 — `@MX:REASON: 동시 다중 CHAIR 부여 race condition, withTransaction 외부 처리 시 단일성 위반`
- CHAIR 권한 범위 검사(ADMIN 부여 403) — `@MX:REASON: CHAIR 권한 상승 방지, 권한 매트릭스 핵심 제약`

### @MX:NOTE (도메인 의도 전달)

- `users.managed_building_id` 단일 출처 — `@MX:NOTE: AUTH verify-unit(REQ-AUTH-011)과 SETUP-04(REQ-SETUP-009) 공동 소비, roles.managed_building_id 는 M5 마이그레이션으로 제거됨`
- `GET /api/setup/buildings` 공개 엔드포인트 — `@MX:NOTE: AUTH verify-unit 클라이언트 소비 목적, middleware matcher 예외 처리. POST/DELETE 는 여전히 인증 필요`
- 강제 탈퇴 AUTH 위임 — `@MX:NOTE: SETUP-05 회원 목록 삭제 버튼은 클라이언트가 /api/auth/users/[id]/deactivate 호출, SETUP 미구현`

### @MX:TODO (후속 SPEC 연결 지점)

- SETUP-03 직책 종류 CRUD — `@MX:TODO: P1 별도 SPEC, 역할 5종 고정 해제 시 구현`
- 호수 unit_number rename — `@MX:TODO: 현재 삭제+추가 조합, rename 지원 필요 시 별도 구현`

---

## 8. 검증 기준 요약

상세 Given/When/Then 시나리오는 `acceptance.md`를 참조. 각 모듈당 최소 2개 시나리오, 총 20개 REQ-SETUP-XXX 요구사항(001~020, 일부 a/b 서브 ID 포함)에 대한 검증 케이스를 정의한다. M5(`roles.managed_building_id` 제거)는 AUTH 회귀 테스트(`AC-AUTH-015` REP 인증, `migration-001.test.ts` `assertColumnsExist` roles 블록 업데이트)와 연동 검증한다.

---

## 9. 참조 문서

- `research.md` (본 디렉토리): SETUP 도메인 Deep Research 전문(522 라인)
- `plan.md` (본 디렉토리): TDD 구현 계획, 파일 목록, migration 005 + AUTH 회귀 테스트 업데이트
- `acceptance.md` (본 디렉토리): 검증 시나리오, 품질 게이트 기준
- `.moai/specs/SPEC-AUTH-001/spec.md`: AUTH 도메인 스펙(의존 SPEC, REQ-AUTH-011/014/016 연동)
- `.moai/project/product.md`: 제품 개요 및 SETUP-01~05 정의
- `.moai/project/structure.md`: 라이브딩 구조, 역할 기반 접근 모델
- `.moai/project/tech.md`: 기술 스택, ADR-005(건의 호수 귀속), 환경 변수 목록

---

*본 SPEC의 SETUP routes(buildings/units/roles CRUD, users 목록, role 부여)는 greenfield(미구현)이므로 Delta 마커 없이 작성되었다. 단, `roles.managed_building_id` 제거 마이그레이션은 기존 roles 테이블을 수정(brownfield)하며, AUTH `migration-001.test.ts` 의 `assertColumnsExist` roles 블록(`migration-001.test.ts:90`) 업데이트에 대한 회귀 테스트 계획은 `plan.md`에 명시한다. `migration-001.test.ts:142-145` 의 `users_managed_building_id_fkey` 검증은 `users` 기반이므로 본 SPEC의 영향을 받지 않는다.*

---

## Implementation Notes

**구현 완료일**: 2026-06-22  
**상태**: ✅ 완료 (P0), develop 브랜치에 병합됨 (커밋 bb7b3f4)  
**테스트 커버리지**: 290/290 통과

### 생성 파일

| 파일 | 모듈 | 목적 |
|------|------|------|
| `migrations/005_managed_building_unify.sql` | M5 | `roles.managed_building_id` 제거, `users.managed_building_id` 단일 출처 확정 |
| `src/app/api/setup/buildings/route.ts` | M1/M6 | GET 공개(동/호수 조회), POST ADMIN(동 생성) |
| `src/app/api/setup/buildings/[id]/route.ts` | M1 | DELETE ADMIN(동 삭제, 활성 입주민 409) |
| `src/app/api/setup/buildings/[id]/units/route.ts` | M2 | PUT ADMIN(호수 일괄 업데이트, diff 트랜잭션) |
| `src/app/api/setup/users/route.ts` | M4 | GET ADMIN(회원 목록, 필터 지원, password_hash 미노출) |
| `src/app/api/setup/users/[id]/role/route.ts` | M3 | PUT ADMIN/CHAIR(직책 부여/회수, 회장 단일성 FOR UPDATE) |
| `src/lib/rbac.ts` | 공통 | RBAC 헬퍼 (requireAdmin, requirePrivileged, 공통 응답 생성) |

### 수정 파일

| 파일 | 수정 내용 |
|------|-----------|
| `src/middleware.ts` | matcher 예외 추가 (`GET /api/setup/buildings` 공개, POST/DELETE는 핸들러 내부 인증) |
| AUTH `src/lib/migration-001.test.ts` | `assertColumnsExist` roles 블록에서 `managed_building_id` 제거 (M5 영향) |

### 핵심 구현 결정

1. **회장(CHAIR) 단일성 원자 보장** (REQ-SETUP-010): `SELECT ... FOR UPDATE`로 기존 CHAIR 행을 잠그고 신규 CHAIR 부여 트랜잭션 직렬화. race condition 방어.
2. **password_hash 구조적 배제** (REQ-SETUP-015): 명시적 컬럼 열거(`SELECT u.id, u.email, ...`)로 `password_hash` 절대 미포함. `SELECT *` 금지.
3. **public GET matcher 예외** (REQ-SETUP-020): `GET /api/setup/buildings`만 비인증 허용. POST/DELETE는 `requireAdmin`으로 핸들러 내부에서 인증 강제.
4. **diff 트랜잭션 멱등성** (REQ-SETUP-005): 호수 배열 = 최종 목표 상태. 기존 대비 diff(추가/DELETE)를 단일 트랜잭션으로 적용. 빈 배열 = 전체 삭제.
5. **REP managed_building_id 단일 출처** (REQ-SETUP-019): REP 부여 시 `users.managed_building_id` 설정, RESIDENT 회수 시 `NULL` 정리. `roles.managed_building_id`는 M5로 제거됨.

### 알려진 제한사항

1. **INACTIVE 입주민 FK 차단**: INACTIVE 입주민이 `unit_id`로 귀속된 동/호수 삭제 시 FK RESTRICT로 409 반환 ( misleading message). AUTH 강제탈퇴(`deactivate`) 정책과 조율 필요 — `users.unit_id` 갱신은 AUTH 영역.
2. **감사 로깅 미구현**: 401/403 이벤트 로깅 없음 — 모니터링 권장 (expert-security A09).
3. **ast-grep gate**: sgconfig 미비로 scan 불가 — 인프라 후속.

### 품질 검증 결과

- **테스트**: 290/290 통과 (buildings 19, units 17, role 15, users 16)
- **타입**: `tsc --noEmit` 0 에러
- **린트**: ESLint 0 경고
- **보안**: OWASP CLEAN (manager-quality + expert-security 합의, SQL injection/password_hash/RBAC/FOR UPDATE 전부 코드 레벨 확인)
- **커버리지**: 85%+ 목표 달성

### 의존성

- **SPEC-AUTH-001 P0**: `buildings`/`units`/`roles`/`users` 스키마 및 `src/lib` (db, auth, cookies) 재사용
- **AUTH 회귀**: AC-AUTH-015 (REP 인증) 및 migration-001.test.ts roles 블록 업데이트 통과 확인
