---
id: "SPEC-PARKING-001"
version: "0.2.0"
status: "draft"
created: "2026-06-23"
updated: "2026-06-23"
author: "강력쇠주먹"
priority: "P0"
issue_number: 0
labels: ["parking", "parking-lottery", "slot-assignment"]
---

# SPEC-PARKING-001: 주차 자리 번호 배정 추첨 (회차생성/추첨/취소/자동배정/결과공개/열람/투명성)

아이뜨락 아파트 커뮤니티 플랫폼의 주차 추첨(PARKING) 도메인 스펙. 본 SPEC은 PARKING 도메인 P0 전체 범위(PARKING-01 회차 생성, PARKING-02 추첨(자리 확정), PARKING-03 추첨 취소/반납, PARKING-04 자동배정 실행, PARKING-05 결과 공개, PARKING-06 결과 열람, PARKING-07 투명성 공개) 및 `parking_rounds`/`parking_assignments` 신규 테이블 migration 008 책임을 정의한다. P1 항목(PARKING-08 추첨 이력 조회) 및 알림/P2 기능은 본 SPEC 범위에서 명시적으로 제외한다.

**도메인 본질 (중요)**: 본 시스템은 win/lose 당첨 추첨이 아니다. **slot assignment (자리 번호 배정) 추첨**이다. 모든 세대는 1자리를 보장받으며 탈락자가 없다. 회차 seed 기반 결정론적 순열로 unit→slot 배정을 결정하며, 순서 무관, 동시성 충돌 불가, 재현 검증 가능하다.

**PARKING ID 재매핑 노트**: 도메인 정정(slot assignment)으로 구 PARKING-04(일괄 추첨 실행)는 PARKING-02(주민 버튼 즉시 자리 확정)로 흡수됨. 본 SPEC의 PARKING-04는 "미참여 세대 자동배정 실행"으로 재정의됨 (OPEN→ASSIGNED 전이).

---

## HISTORY

- **2026-06-23 (iteration 2)**: plan-auditor 감사 결함 수정 (강력쇠주먹). HARD 4종 + SHOULD 7종 반영:
  - **D1**: phantom 식별자(존재하지 않는 REQ-PK 번호) 제거 → "P1 별도 SPEC(관리소 수동 배정 API)"로 문구 통일.
  - **D2**: REQ-PK-023/024 모순 해결 — 미공개 회차 비권한자 타인 결과 조회 시 서버 자동 필터링(본인 assignment만 200, 없으면 빈 목록)으로 통일. 타인 존재 여부를 응답 차이로 누출하지 않음(정보은닉, enumeration 공격 방어). REQ-PK-024를 Unwanted EARS(정보은닉)로 재구성.
  - **D3**: REQ-PK-018 도메인 불변 "탈락자 없음" 강제 — 자리 부족 시 409 Conflict + 트랜잭션 전체 롤백(부분 배정 금지). 정상 흐름(REQ-PK-003 사전 검증)에서는 도달 불가한 방어적 불변 수호.
  - **D4**: frontmatter labels 추가 + created/updated 명명을 선행 SPEC 표준(created/updated)에 통일, author/priority 값 동기화.
  - **S1**: research.md 구 모델 동기화 배너 추가.
  - **S2**: PARKING ID 재매핑 노트 추가 (PARKING-04 일괄 추첨 → 흡수/재정의).
  - **S3/S4**: AC-PK-005/CC-PK-003 이진 판정 가능 기준화.
  - **S5**: REQ-PK-017 WHAT/WHY 전환 (동시성 직렬화 HOW는 plan.md 전용).
  - **S6**: seed 공개 근거 명시 (seed 불변, 사후 조작 불가).
  - **N3**: REQ-PK-007 주석에 동일 unit_id 가구원 중복 409 의도적 동작 명시.

- **2026-06-23**: 최초 작성 (MoAI, Phase 1B Planning + Phase 2 Creation 통합). interview.md 도메인 모델 정정 반영:
  - (1) **도메인 정정**: win/lose 추첨 → **slot assignment (자리 번호 배정)**. 모든 세대 1자리 보장, 탈락자 없음. 회차 seed 기반 결정론적 순열로 unit→slot 배정.
  - (2) **회차 상태머신**: `OPEN → ASSIGNED → PUBLISHED → CLOSED` (자동배정 실행 트리거가 OPEN→ASSIGNED 전이). 역방향 전이 금지 (409).
  - (3) **자리풀 동적 입력**: 관리소가 회차 생성 시 자리 번호 풀(목록)을 직접 입력. 시스템 고정 1~38 아님. `slot_pool JSONB` 저장 (문자열/숫자 혼합 허용).
  - (4) **applications 테이블 통합**: 신청(applications)과 배정(allocations) 분리 불필요 — 추첨=자리확정 동시 발생. `parking_assignments` 단일 테이블 (assignment_source: DRAW/AUTO/ADMIN).
  - (5) **seed 투명성 공개**: seed + 순열 알고리즘(Fisher-Yates + HMAC-SHA256 PRNG) + 정렬 입력(unit 목록) 공개 → 재현 검증 가능. product.md "랜덤 시드와 당첨 결과 공개로 공정성 보장" (product.md:154) 부합.
  - (6) **동시성 전략**: 자동배정 실행 시 동시 실행 직렬화 보장 (SETUP role route 패턴 재사용, 구현 디테일은 plan.md §4). 추첨(자리확정)은 `UNIQUE(round_id, unit_id)` 제약이 1차 방어.

---

## 1. 배경 및 목적

아이뜨락 아파트(총 2개 동 / 38세대)의 주차 자리 배정을 투명하고 공정하게 수행하기 위해, 관리사무소가 회차를 생성하고 입주민이 추첨 버튼으로 자기 자리를 확정하며, 미참여 세대는 자동배정으로 같은 순열에서 배정받는 시스템을 제공한다. AUTH P0가 `users`/`roles`/`buildings`/`units` 스키마와 JWT 인증을 구축했고, SETUP P0가 RBAC 헬퍼와 단지 구성 데이터를 구축했으며, NOTICE/SUGGEST P0가 route-level Bearer 인증, 카테고리 시드, 상태전이 화이트리스트 패턴을 확립했으므로, 본 SPEC은 이 패턴들을 재사용하여 PARKING 도메인 전체 기능을 구현한다.

본 SPEC은 다음을 달성해야 한다:

- PARKING-01: 회차 생성(`POST /api/parking/rounds`) — ADMIN/CHAIR, 기간+자리풀(동적 입력)+seed 확정
- PARKING-02: 추첨(자리 확정)(`POST /api/parking/rounds/[id]/draw`) — RESIDENT 이상, 세대당 1회, seed 순열에서 본인 slot 확정
- PARKING-03: 추첨 취소/반납(`DELETE /api/parking/rounds/[id]/draw`) — 본인, OPEN 상태만
- PARKING-04: 자동배정 실행(`POST /api/parking/rounds/[id]/auto-assign`) — ADMIN, 미참여 세대 같은 순열 배정, OPEN→ASSIGNED 전이
- PARKING-05: 결과 공개(`PUT /api/parking/rounds/[id]/publish`) — ADMIN, is_published 토글, ASSIGNED→PUBLISHED 전이
- PARKING-06: 결과 열람(`GET /api/parking/rounds/[id]/allocations`) — RESIDENT 이상, 역할별 가시성 분기
- PARKING-07: 투명성 공개(`GET /api/parking/rounds/[id]/verify`) — seed+순열 알고리즘+정렬 입력 공개, 재현 검증
- M5: `parking_rounds`/`parking_assignments` 신규 테이블 migration 008

기술 결정 근거는 `research.md` 및 `interview.md`를 참조한다.

---

## 2. 범위

### 2.1 In-Scope (본 SPEC이 구현하는 것)

- PARKING-01: 회차 생성(`POST /api/parking/rounds`) — ADMIN/CHAIR, name/application_start/application_end/slot_pool(동적 입력) 검증, seed 자동 생성(randomBytes), status='OPEN'
- PARKING-02: 추첨(자리 확정)(`POST /api/parking/rounds/[id]/draw`) — RESIDENT 이상(ADMIN 제외), 회차 status='OPEN'만 허용, 세대당 1회(UNIQUE(round_id, unit_id)), seed 순열에서 본인 slot 산출 및 assignment 생성(DRAW)
- PARKING-03: 추첨 취소/반납(`DELETE /api/parking/rounds/[id]/draw`) — 본인 assignment 취소(삭제), OPEN 상태만
- PARKING-04: 자동배정 실행(`POST /api/parking/rounds/[id]/auto-assign`) — ADMIN, 미참여 세대(assignment 없는 unit)를 같은 seed 순열에서 배정(AUTO), 회차 status OPEN→ASSIGNED 전이(동시 실행 직렬화 — 구현 디테일은 plan.md §4)
- PARKING-05: 결과 공개(`PUT /api/parking/rounds/[id]/publish`) — ADMIN, is_published 토글, status ASSIGNED→PUBLISHED 전이
- PARKING-06: 결과 열람(`GET /api/parking/rounds/[id]/allocations`) — RESIDENT 이상, 역할별 가시성(RESIDENT/AUDITOR 본인, REP 담당동, CHAIR/ADMIN 전체), is_published=false 시 비-ADMIN/비-CHAIR 본인만
- PARKING-07: 투명성 공개(`GET /api/parking/rounds/[id]/verify`) — RESIDENT 이상, seed + 순열 알고리즘(Fisher-Yates + HMAC-SHA256) + 정렬된 unit 목록 공개, 재현 검증 응답
- M5: `parking_rounds`/`parking_assignments` 신규 테이블 migration 008_parking.sql
- `parking_rounds`/`parking_assignments` 테이블 읽기/쓰기
- AUTH/SETUP/NOTICE/SUGGEST 산출물 재사용: `src/lib/{db,auth,rbac}.ts`, `verifyAccessToken`, `requireAdmin`, `query`, `withTransaction`, RBAC 응답 빌더, UUID 정규식 패턴, zod 검증, route-level Bearer 인증 패턴, 상태전이 화이트리스트 패턴, 동시성 직렬화 패턴

### 2.2 Out-of-Scope (별도 SPEC)

- PARKING-08 추첨 이력 조회 (P1) — 과거 회차별 배정 이력 조회, 통계. 본 SPEC은 현재 회차 열람만 지원
- 주차 알림(푸시/이메일, P2) — 회차 생성/추첨 결과 공개 시 알림 발송
- 회차 수정/삭제 — 본 SPEC은 회차 생성만. 기간 변경, 자리풀 재입력, 회차 삭제는 OUT (관리소 "번호 재입력"은 P1 별도 SPEC)
- 자리 번호 체계 관리 — 자리풀은 회차별 동적 입력이지, 전역 자리 번호 마스터 테이블이 아님
- 주차권 QR/바코드 — 배정된 자리 번호의 물리적 표식 발급은 OUT
- 주차위반 단속 — 주차 규칙 위반 감지/단속은 OUT
- 공지(NOTICE) / 건의(SUGGEST) 도메인 — 별도 SPEC

---

## 3. 가정 및 사전 조건 (Dependencies)

본 SPEC은 다음 사전 조건이 충족되었다고 가정한다:

1. **SPEC-AUTH-001 P0 완료·병합**: `users`/`roles`/`buildings`/`units` 테이블 스키마(migration 001)와 JWT 인증(`verifyAccessToken`)이 이미 존재한다. `users.unit_id`는 동/호수 인증 완료된 사용자만 NOT NULL 값을 가지며, 본 SPEC의 추첨(자리 확정)은 `unit_id` NOT NULL 사용자만 허용한다.
2. **SPEC-SETUP-001 P0 완료·병합**: RBAC 헬퍼 `src/lib/rbac.ts`(`requireAdmin`, `requirePrivileged`, 응답 빌더 `unauthorized`/`forbidden`/`badRequest`/`notFound`/`conflict`/`validationError`)가 이미 존재하며 본 SPEC이 재사용한다. `users.managed_building_id`(REP 담당 동)는 PARKING-06 REP 담당동 가시성 필터링에 사용된다. `src/lib/db.ts`의 `withTransaction`(BEGIN/COMMIT/ROLLBACK 불변 계약)을 자동배정 원자 트랜잭션에 재사용한다.
3. **SPEC-NOTICE-001 P0 완료·병합**: route-level Bearer 인증 패턴(`verify-unit/route.ts:46-63`)이 확립되어 있으며, 본 SPEC의 모든 PARKING 엔드포인트 인증이 동일 패턴을 따른다.
4. **SPEC-SUGGEST-001 P0 완료·병합**: 도메인 로컬 RBAC 헬퍼 패턴(`src/lib/suggest-rbac.ts`, Option C — 공통 `rbac.ts` 수정 없음)과 상태전이 화이트리스트 패턴(`ALLOWED_TRANSITIONS` 맵, 불허 전이 409)이 확립되어 있으며, 본 SPEC의 `parking-rbac.ts`와 회차 상태머신이 동일 패턴을 따른다.
5. **DB 라이브러리 재사용 가능**: `src/lib/db.ts`(PostgreSQL 연결 풀, `query`, `withTransaction`)가 AUTH/SETUP/NOTICE/SUGGEST P0에서 구현되어 있으며 본 SPEC이 재사용한다.
6. **AUTH 미들웨어 패턴 재사용**: `src/middleware.ts`는 AT 쿠키(Edge/jose)만 검사하고 Authorization 헤더(Bearer)를 검사하지 않으므로, 모든 PARKING 엔드포인트는 route handler 내부에서 route-level Bearer 인증을 강제한다(NOTICE/SUGGEST 패턴 동일).
7. **환경 변수**: AUTH/SETUP/NOTICE/SUGGEST와 동일(`DATABASE_URL`, `JWT_SECRET` 등) — 신규 불필요.
8. **HTTPS 강제**: 모든 API는 HTTPS(Railway 자동 제공). 개발 환경 예외 허용.
9. **역할 5종 고정**: ADMIN(관리사무소)/CHAIR(회장)/REP(동대표)/AUDITOR(감사)/RESIDENT(일반 입주민).
10. **Node.js crypto 내장 사용**: HMAC-SHA256 PRNG는 `node:crypto`(`createHmac`, `randomBytes`)로 구현. 외부 라이브러리 의존성 추가 없음.
11. **38세대 시드 데이터**: AUTH/SETUP 시드 데이터(A동 26세대 + B동 12세대 = 총 38세대)가 `units` 테이블에 존재한다. 자동배정 실행 시 이 units 목록을 결정론적 정렬(building_name ASC, unit_number ASC)하여 순열 입력으로 사용한다.

---

## 4. 기능 요구사항 (EARS)

### M1. 회차 생성 (PARKING-01)

#### REQ-PK-001 (Event-driven) — ADMIN/CHAIR 회차 생성

> **When** ADMIN 또는 CHAIR 역할의 인증 사용자가 신규 회차(name, application_start, application_end, slot_pool)를 포함하여 회차 생성을 요청하면, the system **shall** `parking_rounds` 테이블에 신규 레코드를 생성하고 `201 Created` 응답과 함께 회차 ID, 이름, 기간, 자리풀, 상태('OPEN'), seed_value, 생성 시각을 반환한다. `seed_value`는 `randomBytes(16).toString('base64')`로 자동 생성되며 회차 생성 시점에 확정된다. `status`는 'OPEN', `is_published`는 false로 설정된다.

#### REQ-PK-002 (Unwanted) — 기간 유효성 위반 회차 생성 금지

> **If** 회차 생성 요청의 `application_start` >= `application_end` 이면, **then** the system **shall not** 회차를 생성하고 `422 Unprocessable Entity` 응답을 반환한다 (추첨 기간 시작 < 종료 불변).

#### REQ-PK-003 (Unwanted) — 자리풀 빈 배열 회차 생성 금지

> **If** 회차 생성 요청의 `slot_pool`이 빈 배열이거나 세대수(units 테이블 행 수)보다 적으면, **then** the system **shall not** 회차를 생성하고 `422 Unprocessable Entity` 응답을 반환한다 (모든 세대 1자리 보장 — slot assignment 도메인 불변).

#### REQ-PK-004 (Unwanted) — 미인증 회차 생성 거부 (401)

> **If** 회차 생성(`POST`) 요청이 유효한 액세스 토큰 없이(누락/만료/변조) 수신되면, **then** the system **shall not** 로직을 실행하고 `401 Unauthorized` 응답을 반환한다.

#### REQ-PK-005 (State-driven) — 비-ADMIN/비-CHAIR 회차 생성 금지 (403)

> **While** 요청자가 유효한 액세스 토큰으로 인증되었으나 역할이 ADMIN 또는 CHAIR가 아닌 상태에서 회차 생성을 시도하면, the system **shall** `403 Forbidden` 응답을 반환한다.

---

### M2. 추첨(자리 확정) (PARKING-02)

#### REQ-PK-006 (Event-driven) — RESIDENT 이상 추첨(자리 확정)

> **When** RESIDENT/REP/AUDITOR 역할의 인증 사용자(unit_id NOT NULL)가 특정 회차(id)의 추첨 버튼(자리 확정)을 요청하면, the system **shall** 회차의 seed_value와 정렬된 units 목록 및 slot_pool을 사용하여 결정론적 순열(unit→slot 매핑)을 산출하고, 요청자의 unit_id에 해당하는 slot을 `parking_assignments` 테이블에 기록(assignment_source='DRAW', drawn_at=now(), drawn_by=요청자 user id)한 후 `200 OK` 응답과 함께 배정된 자리 번호를 반환한다. 순서 무관 — 먼저/나중 누르든 동일 결과.

#### REQ-PK-007 (Unwanted) — 세대당 1회 추첨 중복 금지

> **If** 요청자의 unit_id에 이미 해당 회차의 assignment(DRAW/AUTO/ADMIN)가 존재하면, **then** the system **shall not** 신규 assignment를 생성하고 `409 Conflict` 응답을 반환한다 (UNIQUE(round_id, unit_id) 제약 — 세대당 1배정 불변). 동일 unit_id를 공유하는 사용자(가구원 2명) 중 첫 추첨자만 자리를 확정하며, 두 번째 요청은 UNIQUE(round_id, unit_id) 위반으로 409를 받는다 — 이는 "세대당 1자리" 불변에 의한 의도된 동작이다.

#### REQ-PK-008 (Unwanted) — OPEN 상태 외 추첨 금지

> **If** 추첨 요청 대상 회차의 status가 'OPEN'이 아니면(ASSIGNED/PUBLISHED/CLOSED), **then** the system **shall not** 추첨을 수행하고 `409 Conflict` 응답을 반환한다 (추첨은 OPEN 상태에서만 — 상태머신 불변).

#### REQ-PK-009 (Unwanted) — 동/호수 미인증 사용자 추첨 금지

> **If** 인증된 사용자의 `users.unit_id`가 NULL(동/호수 미인증)인 상태에서 추첨을 시도하면, **then** the system **shall not** assignment를 생성하고 `403 Forbidden` 응답을 반환한다 (slot assignment는 호수 귀속 필수).

#### REQ-PK-010 (Unwanted) — 추첨 미인증 거부 (401)

> **If** 추첨(`POST /api/parking/rounds/[id]/draw`) 요청이 유효한 액세스 토큰 없이 수신되면, **then** the system **shall not** 로직을 실행하고 `401 Unauthorized` 응답을 반환한다.

---

### M3. 추첨 취소/반납 (PARKING-03)

#### REQ-PK-011 (Event-driven) — 본인 추첨 취소

> **When** 추첨(자리 확정)을 완료한 사용자가 본인 assignment(DRAW)의 취소를 요청하면, the system **shall** 해당 assignment 행을 삭제하고 `200 OK` 응답을 반환한다. 취소 후 동일 회차에서 재추첨 가능(같은 seed → 같은 slot이지만, assignment 재생성 가능).

#### REQ-PK-012 (Unwanted) — OPEN 상태 외 추첨 취소 금지

> **If** 취소 요청 대상 회차의 status가 'OPEN'이 아니면, **then** the system **shall not** 취소를 수행하고 `409 Conflict` 응답을 반환한다 (취소는 OPEN 상태에서만 — 자동배정 완료 후 불가).

#### REQ-PK-013 (Unwanted) — 타인/자동배정 assignment 취소 금지

> **If** 취소 요청자가 assignment의 drawn_by가 아니거나(타인), assignment_source가 'AUTO' 또는 'ADMIN'이면, **then** the system **shall not** 취소를 수행하고 `403 Forbidden` 응답을 반환한다 (본인 DRAW assignment만 취소 가능).

#### REQ-PK-014 (Unwanted) — 미존재 assignment 취소 404

> **If** 취소 요청 대상 assignment가 존재하지 않으면(이미 취소했거나 추첨 안 함), **then** the system **shall** `404 Not Found` 응답을 반환한다.

---

### M4. 자동배정 실행 (PARKING-04)

#### REQ-PK-015 (Event-driven) — ADMIN 자동배정 실행 (미참여 세대)

> **When** ADMIN이 특정 회차(id)의 자동배정 실행을 요청하면, the system **shall** 회차의 seed_value와 정렬된 전체 units 목록 및 slot_pool을 사용하여 결정론적 순열을 산출하고, 미참여 세대(assignment가 없는 unit)에 해당하는 slot을 `parking_assignments`에 일괄 기록(assignment_source='AUTO', drawn_at=NULL, drawn_by=NULL)한 후, 회차 status를 'OPEN'에서 'ASSIGNED'로 전이시키고 `200 OK` 응답과 함께 배정된 세대 수 및 미배정 세대 수(자리풀 부족 시)를 반환한다. 이 작업은 단일 트랜잭션(`withTransaction`)으로 원자적 실행된다.

#### REQ-PK-016 (Unwanted) — OPEN 상태 외 자동배정 금지

> **If** 자동배정 요청 대상 회차의 status가 'OPEN'이 아니면(이미 ASSIGNED/PUBLISHED/CLOSED), **then** the system **shall not** 자동배정을 수행하고 `409 Conflict` 응답을 반환한다 (자동배정은 OPEN→ASSIGNED 단방향 전이만 — 회차 상태머신 불변).

#### REQ-PK-017 (Ubiquitous) — 자동배정 동시 실행 직렬화

> **The system shall** 동시 자동배정 실행 요청을 직렬화하여 단 한 건만 성공하고 나머지는 `409 Conflict`를 반환하도록 보장한다 (세대당 1배정 + OPEN→ASSIGNED 단일 전이 불변 수호).

#### REQ-PK-018 (Unwanted) — 자리풀 부족 자동배정 전체 실패 (도메인 불변 수호)

> **If** 자동배정 실행 시 사용가능 slot 수가 미참여 세대 수보다 부족하면(unit 수 > 사용가능 slot 수), **then** the system **shall** `409 Conflict` 응답을 반환하고 자동배정 트랜잭션을 전체 롤백하며 부분 배정을 허용하지 않는다 (도메인 불변 "모든 세대 1자리 보장, 탈락자 없음" 강제). 회차 status는 'OPEN'으로 유지된다(ASSIGNED로 전이하지 않음). 단, 정상 조건(REQ-PK-003가 회차 생성 시 slot_pool 크기 >= 세대수를 사전 검증)에서는 이 경로에 도달할 수 없으므로, 본 요구사항은 방어적 불변 수호 역할을 한다.

#### REQ-PK-019 (State-driven) — 비-ADMIN 자동배정 금지 (403)

> **While** 요청자가 유효한 액세스 토큰으로 인증되었으나 역할이 ADMIN이 아닌 상태에서 자동배정 실행을 시도하면, the system **shall** `403 Forbidden` 응답을 반환한다 (자동배정은 ADMIN 전용).

---

### M5. 결과 공개/열람/투명성 (PARKING-05, 06, 07)

#### REQ-PK-020 (Event-driven) — ADMIN 결과 공개 토글

> **When** ADMIN이 특정 회차(id)의 결과 공개를 요청하면, the system **shall** 회차 status가 'ASSIGNED'인지 확인 후, `is_published`를 true로, status를 'PUBLISHED'로 전이시키고 `200 OK` 응답을 반환한다. 이후 모든 인증 사용자가 역할별 가시성(REQ-PK-023)에 따라 배정 결과를 열람할 수 있다.

#### REQ-PK-021 (Unwanted) — ASSIGNED 상태 외 결과 공개 금지

> **If** 결과 공개 요청 대상 회차의 status가 'ASSIGNED'가 아니면(OPEN/PUBLISHED/CLOSED), **then** the system **shall not** 공개를 수행하고 `409 Conflict` 응답을 반환한다 (공개는 ASSIGNED→PUBLISHED 단방향 전이만).

#### REQ-PK-022 (State-driven) — 비-ADMIN 결과 공개 금지 (403)

> **While** 요청자가 유효한 액세스 토큰으로 인증되었으나 역할이 ADMIN이 아닌 상태에서 결과 공개를 시도하면, the system **shall** `403 Forbidden` 응답을 반환한다.

#### REQ-PK-023 (Event-driven) — 역할별 결과 열람 가시성 분기

> **When** 인증된 사용자가 특정 회차(id)의 배정 결과 열람을 요청하면, the system **shall** 회차의 `is_published`와 요청자 역할에 따라 서버 사이드 자동 필터링을 수행하고 `200 OK` 응답으로 배정 목록을 반환한다. 필터링 규칙: (a) is_published=true인 경우, RESIDENT/AUDITOR는 본인 unit 배정만, REP는 담당 동(managed_building_id == 배정 unit building) 배정만, CHAIR/ADMIN은 전체; (b) is_published=false인 경우, 비-ADMIN/비-CHAIR는 본인 unit 배정만(비공개 상태에서 본인 확인 허용), ADMIN/CHAIR는 전체.

#### REQ-PK-024 (Unwanted) — 미공개 회차 타인 결과 존재 여부 누출 금지 (정보은닉)

> **If** is_published=false인 회차에서 비-ADMIN/비-CHAIR 요청자가 타인 또는 타동 배정 결과 조회를 시도하면, **then** the system **shall** 본인 assignment만 반환하거나(본인 assignment가 없으면 빈 목록을) `200 OK` 응답으로 반환하며, 타인 결과의 존재 여부를 응답 차이(200 vs 403, 빈 목록 vs 비어있지 않은 목록)로 누출하지 않는다 (정보은닉 원칙 — enumeration 공격 방어).

#### REQ-PK-025 (Unwanted) — 결과 열람 미인증 거부 (401)

> **If** 결과 열람(`GET /api/parking/rounds/[id]/allocations`) 요청이 유효한 액세스 토큰 없이 수신되면, **then** the system **shall not** 결과를 반환하고 `401 Unauthorized` 응답을 반환한다.

#### REQ-PK-026 (Event-driven) — 투명성 공개 (seed+알고리즘+입력)

> **When** 인증된 사용자가 특정 회차(id)의 투명성 검증을 요청하면, the system **shall** 회차의 `seed_value`, 순열 알고리즘(Fisher-Yates + HMAC-SHA256 PRNG 식별자), 정렬된 unit 목록 입력을 공개하고 `200 OK` 응답과 함께 반환한다. 이 정보로 누구나 동일 배정 결과를 재현할 수 있다. 응답에 알고리즘 명칭, seed, 정렬 기준(building_name ASC, unit_number ASC), 자리풀을 포함한다.

#### REQ-PK-027 (Ubiquitous) — 재현 검증 가능성 보장

> **The system shall** 동일한 seed_value + 동일한 정렬된 unit 목록 + 동일한 slot_pool 입력에 대해 항상 동일한 unit→slot 배정 결과를 산출한다. 이는 결정론적 순열(HMAC-SHA256 PRNG + Fisher-Yates)의 불변 계약이며, 재현 검증 테스트로 보장된다.

---

## 5. Exclusions (What NOT to Build)

본 SPEC은 다음 항목을 구현하지 않는다 (별도 SPEC 또는 명시적 OUT):

1. **PARKING-08 추첨 이력 조회 (P1)** — 과거 회차별 배정 이력 조회, 통계, 경향 분석. 본 SPEC은 현재 회차 열람(PARKING-06)만 지원. `@MX:TODO: PARKING-08 이력 조회 P1 별도 SPEC`으로 표시.
2. **주차 알림 (푸시/이메일, P2)** — 회차 생성, 추첨 결과 공개, 자동배정 완료 시 입주민 알림 발송. P2.
3. **회차 수정/삭제** — 회차 생성 후 기간 변경, 자리풀 재입력(번호 재입력), 회차 삭제는 본 SPEC 범위 외. 관리소 "번호 재입력" 기능은 P1 별도 SPEC. 회차는 생성 후 수정 불가(불변 seed 보장). `@MX:TODO: 회차 수정/삭제 P1 별도 SPEC`.
4. **자리 번호 체계 마스터 관리** — 자리풀은 회차별 동적 입력(JSONB)이지, 전역 자리 번호 마스터 테이블이 아님. 자리 번호 체계(구역별 번호 규칙 등) 관리는 OUT.
5. **주차권 QR/바코드 발급** — 배정된 자리 번호의 물리적 표식(QR 코드, 바코드, 출력물) 발급은 OUT.
6. **주차위반 단속** — 주차 규칙 위반(지정 자리 외 주차 등) 감지/단속/이력은 OUT.
7. **관리소 수동 배정 (ADMIN 직접 slot 지정)** — 자동배정 외에 관리소가 특정 세대에 특정 slot을 수동 지정하는 기능(assignment_source='ADMIN')은 본 SPEC에서 자동배정 트랜잭션 내 미배정 세대 처리(REQ-PK-018)로 한정. 별도 수동 배정 API는 P1 별도 SPEC.
8. **공지(NOTICE) / 건의(SUGGEST) 도메인** — 별도 SPEC.

---

## 6. 비기능 요구사항 (제약)

### 6.1 보안 (Security)

- **RBAC + 역할 분기**: PARKING API는 서버 사이드 JWT 검증 + 역할 기반 접근 제어 필수. 특히 결과 열람(M5)은 역할별 서버 자동 필터링(RESIDENT 본인 / REP 담당 동 / CHAIR·ADMIN 전체)이 핵심 — 클라이언트 단독 신뢰 금지. 미공개 회차에서 비권한자의 타인 결과 조회 시 본인 assignment만(없으면 빈 목록) 200으로 반환하여 타인 결과 존재 여부를 누출하지 않는다(정보은닉, REQ-PK-024).
- **SQL Injection 방어**: 모든 DB 쿼리는 Parameterized Query(`query` 함수). 문자열 결합 쿼리 금지.
- **입력 유효성 검증**: 서버 사이드 zod 스키마 필수. name `VARCHAR(100)` (1~100자), application_start/application_end ISO 8601 TIMESTAMPTZ, slot_pool JSONB 배열(최소 1 요소, 세대수 이상), path param UUID 형식 검증(`UUID_RE` 패턴 재사용, `z.string().uuid()` 금지 — zod 4 deprecated).
- **seed 불변 보장**: `parking_rounds.seed_value`는 회차 생성 시 한 번 설정되며 이후 UPDATE 금지. 트랜잭션 내에서만 읽기. seed 조작 원천 차단.
- **seed 공개 근거**: seed_value는 회차 생성 시 확정 후 불변(REQ seed immutability)이므로, 공개되어도 사후 조작이 불가능하다. research.md:1027의 "seed 가변 전제하의 보안 우려(비-ADMIN seed 노출 시 조작 가능성)"는 본 설계에서 무효이다. seed 공개는 재현 검증(PARKING-07)의 공정성 기반이다.
- **개인정보 최소화**: 배정 결과 응답에 user email/password_hash 미포함. unit_id, building, unit_number, assigned_slot만 노출. drawn_by는 ADMIN/CHAIR만 조회 가능.

### 6.2 성능 (Performance)

- 모든 PARKING API 응답 시간: P95 500ms 이하 (PRD §5-1 기준).
- 자동배정 실행(REQ-PK-015)은 38세대 기준 단일 트랜잭션 내 순열 산출 + 일괄 INSERT이므로 1초 이내 완료 예상.
- 결정론적 순열 산출(HMAC-SHA256 PRNG + Fisher-Yates)은 38세대 기준 ~1ms 예상 (성능 병목 아님).
- 회차별 assignments 조회는 `idx_parking_assignments_round` 인덱스 활용.

### 6.3 가용성 (Availability)

- 단일 PostgreSQL 인스턴스 의존(Railway Managed DB, AUTH/SETUP/NOTICE/SUGGEST와 공유).
- migration 008은 migration 007(SUGGEST) 이후 순차 적용. 신규 테이블 2종 생성이므로 기존 데이터 영향 없음. `CREATE TABLE IF NOT EXISTS` 사용으로 멱등성 보장.

### 6.4 감사 (Auditability)

- 회차 생성, 추첨(자리 확정), 취소, 자동배정 실행, 결과 공개 이벤트는 애플리케이션 로그로 기록(단, PII는 로그에서 제외).
- 권한 오용 시도(비-ADMIN 회차 생성/자동배정/공개 시도, OPEN 외 추첨 시도, 타인 취소 시도)는 경고 로그로 기록 권장(SUGGEST/NOTICE 동일 패턴 — 본 SPEC에서 로깅 구현은 필수 아님).
- 자동배정 실행 시 미배정 세대 발생 여부는 응답 및 로그에 기록.

---

## 7. MX Tag Plan (코드 주석 계획)

Run Phase에서 다음 @MX 태그를 적용한다:

### @MX:ANCHOR (fan_in >= 3 또는 공개 API 경계)

- `parking-lottery.ts` `generatePermutation` — 주민 추첨(M2), 자동배정(M4), 재현검증(M5) 3곳에서 호출 (fan_in=3)
- `parking-rbac.ts` `requireAuthenticated` — 여러 PARKING 라우트에서 공유 (fan_in >= 3)
- `parking_rounds`/`parking_assignments` 스키마 불변 지점 — migration 008 정의

### @MX:WARN with @MX:REASON (위험 영역)

- 자동배정 실행 트랜잭션 동시성 직렬화 구간 — `@MX:REASON: 동시 자동배정 실행 직렬화 load-bearing. SETUP role route 패턴. 두 관리자 동시 실행 시 단 한 건만 성공, 나머지 409. 직렬화 제거 시 중복 배정 위험. 구현 디테일(FOR UPDATE)은 plan.md §4.2`
- seed 불변 보장 — `@MX:REASON: seed_value는 회차 생성 시 한 번 설정, UPDATE 금지. seed 조작 원천 차단. 투명성 공개(PARKING-07)의 공정성 기반`
- UNIQUE(round_id, unit_id) 중복 방어 — `@MX:REASON: 세대당 1배정 불변. 동시 추첨 버튼 클릭 시 두 번째 INSERT는 unique violation → 409. slot assignment 도메인 핵심 제약`
- 회차 상태머신 전이 — `@MX:REASON: OPEN→ASSIGNED→PUBLISHED→CLOSED 단방향. 역방향 전이 409. 자동배정은 OPEN→ASSIGNED만, 공개는 ASSIGNED→PUBLISHED만`

### @MX:NOTE (도메인 의도 전달)

- slot assignment 도메인 본질 — `@MX:NOTE: win/lose 추첨 아님. 모든 세대 1자리 보장, 탈락자 없음. 회차 seed 기반 결정론적 순열로 unit→slot 배정`
- slot_pool 동적 입력 — `@MX:NOTE: 관리소가 회차 생성 시 자리 번호 풀을 직접 입력. 시스템 고정 1~38 아님. JSONB 저장`
- applications 테이블 통합 — `@MX:NOTE: 신청/배정 분리 불필요. 추첨=자리확정 동시 발생. parking_assignments 단일 테이블 (DRAW/AUTO/ADMIN)`
- 재현 검증 — `@MX:NOTE: 동일 seed + 동일 정렬 unit 목록 + 동일 slot_pool → 동일 배정 결과. HMAC-SHA256 PRNG 결정론 보장`

### @MX:TODO (후속 SPEC 연결 지점)

- PARKING-08 이력 조회 — `@MX:TODO: P1 별도 SPEC, 과거 회차 배정 이력/통계`
- 회차 수정/삭제 — `@MX:TODO: P1 별도 SPEC, 기간 변경/자리풀 재입력`
- 관리소 수동 배정 API — `@MX:TODO: P1 별도 SPEC, ADMIN 직접 slot 지정 (assignment_source='ADMIN' 독립 API)`

---

## 8. 검증 기준 요약

상세 Given/When/Then 시나리오는 `acceptance.md`를 참조. 각 모듈당 최소 2개 시나리오, 총 27개 REQ-PK-XXX 요구사항에 대한 검증 케이스를 정의한다. 동시성 시나리오(동시 추첨 버튼, 자동배정 중 충돌, 회차 전환), 투명성 검증(재현 가능성), 엣지케이스(미참여 세대, 자리풀 부족, 취소 후 재추첨)를 포함한다.

---

## 9. 참조 문서

- `interview.md` (본 디렉토리): 도메인 모델 정정(slot assignment), 3가지 정책 결정(회차 seed 순열, 자리풀 동적 입력, 관리소 수동 트리거)
- `research.md` (본 디렉토리): 기존 패턴 조사 결과(동시성 직렬화, withTransaction, RBAC Option C, validators, 상태전이 화이트리스트, migration 패턴, 결정론적 PRNG 옵션 trade-off)
- `plan.md` (본 디렉토리): TDD 구현 계획, 파일 목록, migration 008 스키마 상세, 회차 상태머신 정의
- `acceptance.md` (본 디렉토리): 검증 시나리오, 품질 게이트 기준
- `.moai/specs/SPEC-AUTH-001/spec.md`: AUTH 도메인 스펙(의존 SPEC, users/units 스키마 + verifyAccessToken)
- `.moai/specs/SPEC-SETUP-001/spec.md`: SETUP 도메인 스펙(의존 SPEC, rbac.ts requireAdmin/requirePrivileged + withTransaction + managed_building_id)
- `.moai/specs/SPEC-NOTICE-001/spec.md`: NOTICE 도메인 스펙(참조 SPEC, route-level Bearer 인증 패턴)
- `.moai/specs/SPEC-SUGGEST-001/spec.md`: SUGGEST 도메인 스펙(참조 SPEC, Option C RBAC + 상태전이 화이트리스트 패턴)
- `.moai/project/product.md`: 제품 문서(PARKING-01~08 요구사항 §83-104, 가치 제안 "랜덤 시드와 당첨 결과 공개로 공정성 보장" §154)

---

## Implementation Notes

**구현 상태**: 초안 (사용자 승인 전)

### Delta 마커 (brownfield — AUTH/SETUP/NOTICE/SUGGEST 기반)

본 SPEC은 기존 AUTH/SETUP/NOTICE/SUGGEST P0 구현 위에 구축된다:

- **[EXISTING]** `src/lib/db.ts` (`query`, `withTransaction`) — 재사용, 수정 없음
- **[EXISTING]** `src/lib/auth.ts` (`verifyAccessToken`) — 재사용, 수정 없음
- **[EXISTING]** `src/lib/rbac.ts` (`requireAdmin`, `requirePrivileged`, 응답 빌더) — 재사용, 수정 없음
- **[EXISTING]** `src/middleware.ts` — 수정 불필요 (`/api/parking/*`는 기존 matcher로 인증 적용)
- **[EXISTING]** `migrations/001~007` — 재사용, 수정 없음
- **[NEW]** `migrations/008_parking.sql` — parking_rounds + parking_assignments 신규 테이블
- **[NEW]** `src/lib/parking-rbac.ts` — PARKING 도메인 로컬 RBAC 헬퍼 (Option C, suggest-rbac.ts 패턴)
- **[NEW]** `src/lib/parking-lottery.ts` — 결정론적 순열 산출 (HMAC-SHA256 PRNG + Fisher-Yates)
- **[NEW]** `src/app/api/parking/rounds/route.ts` — 회차 생성 (POST ADMIN/CHAIR)
- **[NEW]** `src/app/api/parking/rounds/[id]/draw/route.ts` — 추첨/취소 (POST/DELETE)
- **[NEW]** `src/app/api/parking/rounds/[id]/auto-assign/route.ts` — 자동배정 실행 (POST ADMIN)
- **[NEW]** `src/app/api/parking/rounds/[id]/publish/route.ts` — 결과 공개 (PUT ADMIN)
- **[NEW]** `src/app/api/parking/rounds/[id]/allocations/route.ts` — 결과 열람 (GET 역할별 분기)
- **[NEW]** `src/app/api/parking/rounds/[id]/verify/route.ts` — 투명성 공개 (GET)
- **[NEW]** 각 route.test.ts, migration-008.test.ts, parking-lottery.test.ts

### 승인 게이트 (Decision Point 1) — 사용자 재확인 필요 항목

1. **Q2 자리풀 동적 입력**: 관리소가 회차 생성 시 자리 번호 풀(목록)을 직접 입력하는 동적 슬롯 모델 해석이 맞는지 확인 필요 (interview.md 명시, Plan Review에서 재확인).
2. **회차 상태머신**: `OPEN → ASSIGNED → PUBLISHED → CLOSED` 단방향 전이가 맞는지, DRAWING 중간 상태 생략이 허용되는지 확인.
3. **AUDITOR 권한**: apt_08 §7에 명시 없음 → RESIDENT 동일 취급(본인 배정만 열람). 후속 보안 정책 명시 권장.

---

*본 SPEC의 PARKING routes는 greenfield(미구현)이므로, 기존 AUTH/SETUP/NOTICE/SUGGEST 산출물은 [EXISTING] 재사용, 신규 파일은 [NEW]로 표시했다. 공유 파일(rbac.ts, db.ts, middleware.ts)은 일체 수정하지 않는다 (Maintain Scope Discipline).*
