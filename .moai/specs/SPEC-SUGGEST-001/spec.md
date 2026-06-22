---
id: "SPEC-SUGGEST-001"
version: "1.0.0"
status: "draft"
created: "2026-06-22"
updated: "2026-06-22"
author: "강력쇠주먹"
priority: "P0"
issue_number: 0
---

# SPEC-SUGGEST-001: 건의/문의 (등록/수정/아카이브/열람/답변/상태/호수이력)

아이뜨락 아파트 커뮤니티 플랫폼의 건의/문의(SUGGEST) 도메인 스펙. 본 SPEC은 SUGGEST 도메인 P0 전체 범위(SUGGEST-01 등록, SUGGEST-02 수정, SUGGEST-03/04 아카이브, SUGGEST-05~08 역할별 열람, SUGGEST-09 호수별 이력, SUGGEST-10 답변, SUGGEST-11 처리 상태 변경, SUGGEST-12 상태 확인) 및 `suggestion_categories` 시드 + `suggestion_replies` 신규 테이블 + `suggestions` 테이블 ALTER 확장 책임을 정의한다. P1 항목(SUGGEST-13 건의 카테고리 동적 관리) 및 첨부파일 기능은 본 SPEC 범위에서 명시적으로 제외한다.

---

## HISTORY

- **2026-06-22**: 최초 작성 (강력쇠주먹). 확정 결정 5종 반영: (1) **범위 = FULL P0** — 등록(공개/비공개)·수정(본인)·아카이브(작성자+ADMIN)·열람(역할별 비공개 분기)·호수별 이력(ADMIN/CHAIR)·답변(ADMIN)·상태 전이(접수→처리중→완료→보류, 재오픈)까지 단일 SPEC. (2) **카테고리 = 고정 시드 + ALTER 확장** — `suggestion_categories` 4종 고정 시드(시설/주차/소음/기타). 동적 카테고리 CRUD(SUGGEST-13)는 OUT. (3) **테이블 전략 = 기존 004 ALTER + 신규 테이블** — 기존 `migrations/004_suggestions_minimal.sql`(AUTH 사이드이펙트용 최소 스키마)을 migration 007(`ALTER TABLE`)로 컬럼 7종 추가(category_id, title, content, is_public, status, updated_at, archived_at). 기존 004 컬럼(id, author_id, author_label, archived, unit_id, created_at) 및 데이터 보존. `suggestion_categories` + `suggestion_replies` 신규 테이블도 migration 007에 함께 생성. (4) **첨부파일 = 완전 제외** — NOTICE-001과 동일 정책, 별도 ADR/SPEC으로 이연. (5) **영구 삭제 금지 (archive-only)** — ADR-005 호수 귀속 정책 준거. DELETE 엔드포인트는 archived=true 전환(작성자 익명화: author_id=NULL, author_label="전 입주민", unit_id 보존)이며 행 삭제가 아님.

---

## 1. 배경 및 목적

아이뜨락 아파트(총 2개 동 / 38세대)의 입주민이 관리사무소에 방문 없이 온라인으로 건의/문의를 접수·추적할 수 있는 기능을 제공한다. AUTH P0가 `users`/`roles` 스키마와 JWT 인증을 구축했고, SETUP P0가 RBAC 헬퍼(`requireAdmin`, `requirePrivileged`, 응답 빌더)와 단지 구성 데이터(buildings/units/managed_building_id)를 구축했으며, AUTH 강제 탈퇴(AUTH-07)가 `suggestions` 최소 스키마(migration 004)에 대한 사이드이펙트(author_id NULL + author_label 갱신 + archived=true)를 이미 처리하고 있으므로, 본 SPEC은 이 최소 스키마를 ALTER로 확장하여 SUGGEST 도메인 전체 기능을 구현한다.

본 SPEC은 다음을 달성해야 한다:

- SUGGEST-01: 건의 등록(`POST /api/suggestions`) — RESIDENT 이상(ADMIN 제외), 공개/비공개 선택, building/unit 귀속
- SUGGEST-02: 건의 수정(`PUT /api/suggestions/[id]`) — 작성자 본인, archived/완료 상태 수정 불가
- SUGGEST-03/04: 건의 아카이브(`DELETE /api/suggestions/[id]`) — 작성자 본인 또는 ADMIN, archived=true 전환(ADR-005 익명화)
- SUGGEST-05~08: 건의 목록 열람(`GET /api/suggestions`) — 역할별 비공개 분기(RESIDENT 본인 / REP 담당 동 / CHAIR·ADMIN 전체 / AUDITOR 본인)
- SUGGEST-12: 건의 상세 열람(`GET /api/suggestions/[id]`) — 권한 검사(비공개 시 역할 분기 적용)
- SUGGEST-09: 호수별 건의 이력(`GET /api/suggestions/units/[building]/[unit]`) — ADMIN/CHAIR, 아카이브 포함 시간순
- SUGGEST-10: 건의 답변 등록/수정(`POST /api/suggestions/[id]/replies`) — ADMIN
- SUGGEST-11: 처리 상태 변경(`PUT /api/suggestions/[id]/status`) — ADMIN, 접수→처리중→완료→보류, 완료→재오픈
- M8: `suggestion_categories` 시드 테이블(시설/주차/소음/기타) + `suggestions` ALTER 확장(컬럼 7종 추가) + `suggestion_replies` 신규 테이블 마이그레이션 007

기술 결정 근거는 `research.md` 및 `.moai/project/tech.md`를 참조한다.

---

## 2. 범위

### 2.1 In-Scope (본 SPEC이 구현하는 것)

- SUGGEST-01: 건의 등록(`POST /api/suggestions`) — RESIDENT/REP/AUDITOR/CHAIR(ADMIN 제외), 공개/비공개 선택
- SUGGEST-02: 건의 수정(`PUT /api/suggestions/[id]`) — 작성자 본인 only, archived=true 또는 status='완료' 시 수정 불가
- SUGGEST-03/04: 건의 아카이브(`DELETE /api/suggestions/[id]`) — 작성자 본인 OR ADMIN, archived=true + 익명화 전환(행 삭제 아님)
- SUGGEST-05~08: 건의 목록 열람(`GET /api/suggestions`) — 인증 사용자, 역할별 서버 자동 필터링(공개 전체 + 비공개 역할 분기), `is_public`/`status`/`category_id`/`unit_id` 필터 + 페이지네이션
- SUGGEST-12: 건의 상세 열람(`GET /api/suggestions/[id]`) — 인증 사용자, 비공개 시 권한 검사(역할 분기 적용)
- SUGGEST-09: 호수별 건의 이력(`GET /api/suggestions/units/[building]/[unit]`) — ADMIN/CHAIR, 아카이브 포함 시간순
- SUGGEST-10: 건의 답변 등록(`POST /api/suggestions/[id]/replies`) — ADMIN
- SUGGEST-11: 처리 상태 변경(`PUT /api/suggestions/[id]/status`) — ADMIN, 상태 전이 검증(접수→처리중→완료, 보류, 재오픈)
- M8: `suggestion_categories` 시드 테이블(시설/주차/소음/기타 4종) + `suggestions` ALTER 확장(컬럼 7종) + `suggestion_replies` 신규 테이블 마이그레이션 007
- `suggestions`/`suggestion_categories`/`suggestion_replies` 테이블 읽기/쓰기
- AUTH/SETUP/NOTICE 산출물 재사용: `src/lib/{db,auth,cookies,rbac}.ts`, `verifyAccessToken`, `requireAdmin`, `requirePrivileged`, `query`, RBAC 응답 빌더, UUID 정규식 패턴, zod 검증, route-level Bearer 인증 패턴

### 2.2 Out-of-Scope (별도 SPEC)

- SUGGEST-13 건의 카테고리 동적 관리(P1) — 카테고리 추가/수정/삭제 CRUD. 본 SPEC은 4종(시설/주차/소음/기타) 고정 시드값으로 취급
- 첨부파일(attachments) — 본 SPEC에서 완전 제외. NOTICE-001과 동일 정책, 파일 저장소 백엔드(S3/Railway Volumes/Supabase Storage 등) 결정은 별도 ADR/SPEC으로 이연
- 건의 검색(전문 검색) — 제목/내용 키워드 검색은 본 SPEC 범위 아님. `category_id`/`status`/`is_public`/`unit_id` 필터만 지원
- 건의 알림(푸시/이메일) — P2
- 건의 수정 이력 추적 — 이전 버전 보존 없음. 갱신 시 덮어쓰기
- 건의 답변 삭제 — ADMIN 답변 등록/수정만 지원, 답변 영구 삭제는 OUT
- 공지(NOTICE) / 주차 추첨(PARKING) 도메인 — 별도 SPEC

---

## 3. 가정 및 사전 조건 (Dependencies)

본 SPEC은 다음 사전 조건이 충족되었다고 가정한다:

1. **SPEC-AUTH-001 P0 완료·병합**: `users`/`roles`/`buildings`/`units` 테이블 스키마(migration 001)와 JWT 인증(`verifyAccessToken`)이 이미 존재한다. AUTH 강제 탈퇴(AUTH-07, REQ-AUTH-014)는 `suggestions` 최소 스키마(migration 004)에 대한 사이드이펙트(author_id=NULL, author_label="전 입주민", archived=true)를 이미 처리하고 있으며, 본 SPEC은 migration 007로 이 스키마를 ALTER 확장한다(AUTH 사이드이펙트 로직은 변경 없이 호환성 유지).
2. **SPEC-SETUP-001 P0 완료·병합**: RBAC 헬퍼 `src/lib/rbac.ts`(`requireAdmin`, `requirePrivileged`, 응답 빌더 `unauthorized`/`forbidden`/`badRequest`/`notFound`/`conflict`/`validationError`)가 이미 존재하며 본 SPEC이 재사용한다. `users.managed_building_id`(REP 담당 동 단일 출처)는 SUGGEST-07 REP 비공개 담당 동 필터링에 사용된다.
3. **SPEC-NOTICE-001 P0 완료·병합**: `notice_categories` 시드 테이블 패턴(migration 006)과 route-level Bearer 인증 패턴(`verify-unit/route.ts:46-63`, NOTICE GET 핸들러)이 이미 확립되어 있으며, 본 SPEC의 `suggestion_categories` 시드와 모든 SUGGEST 엔드포인트 인증이 동일 패턴을 따른다.
4. **DB 라이브러리 재사용 가능**: `src/lib/db.ts`(PostgreSQL 연결 풀, `query`)가 AUTH/SETUP/NOTICE P0에서 구현되어 있으며 본 SPEC이 재사용한다.
5. **AUTH 미들웨어 패턴 재사용**: `src/middleware.ts`는 AT 쿠키(Edge/jose)만 검사하고 Authorization 헤더(Bearer)를 검사하지 않으므로, 모든 SUGGEST 엔드포인트는 route handler 내부에서 route-level Bearer 인증을 강제한다(NOTICE GET 패턴 동일, `verify-unit/route.ts:46-63` 준거).
6. **환경 변수**: AUTH/SETUP/NOTICE와 동일(`DATABASE_URL`, `JWT_SECRET` 등) — 신규 불필요.
7. **HTTPS 강제**: 모든 API는 HTTPS(Railway 자동 제공). 개발 환경 예외 허용.
8. **역할 5종 고정**: ADMIN(관리사무소)/CHAIR(회장)/REP(동대표)/AUDITOR(감사)/RESIDENT(일반 입주민) — SUGGEST 권한 매트릭스(apt_08 §7) 적용.
9. **ADR-005 호수 귀속 정책 준거**: 건의는 회원이 아닌 동/호수에 귀속된다. 작성자 탈퇴/아카이브 시 `author_id=NULL`, `author_label="전 입주민"` 처리하되 `unit_id`는 영구 보존된다. 이는 본 SPEC의 가장 중요한 비즈니스 규칙이다.

---

## 4. 기능 요구사항 (EARS)

### M1. 건의 등록 (SUGGEST-01)

#### REQ-SUGGEST-001 (Event-driven) — RESIDENT 이상 건의 등록

> **When** RESIDENT/REP/AUDITOR/CHAIR 역할의 인증 사용자가 신규 건의(title, content, category_id, is_public)를 포함하여 건의 등록을 요청하면, the system **shall** `suggestions` 테이블에 신규 레코드를 생성하고 `201 Created` 응답과 함께 건의 ID, 제목, 카테고리명, 공개여부, 상태('접수'), 작성자 라벨, building/unit 귀속 정보, 생성 시각을 반환한다. `author_id`는 요청자의 user id, `author_label`은 '입주민', `unit_id`는 요청자의 인증된 호수(`users.unit_id`), `status`는 '접수', `archived`는 false로 설정된다.

#### REQ-SUGGEST-002 (Unwanted) — ADMIN 건의 등록 금지

> **If** ADMIN 역할의 호출자가 건의 등록을 시도하면, **then** the system **shall not** 건의를 생성하고 `403 Forbidden` 응답을 반환한다 (관리사무소는 건의 처리 주체이므로 등록 권한 없음 — apt_08 §7 접근 제어 매트릭스 명시).

#### REQ-SUGGEST-003 (Unwanted) — 미존재 category_id 건의 등록 금지

> **If** 건의 등록 요청의 `category_id`가 `suggestion_categories` 테이블에 존재하지 않으면, **then** the system **shall not** 건의를 생성하고 `422 Unprocessable Entity` 응답을 반환한다 (FK 위반 사전 차단).

#### REQ-SUGGEST-004 (Unwanted) — 미인증 건의 등록 거부 (401)

> **If** 건의 등록(`POST`) 요청이 유효한 액세스 토큰 없이(누락/만료/변조) 수신되면, **then** the system **shall not** 로직을 실행하고 `401 Unauthorized` 응답을 반환한다.

#### REQ-SUGGEST-005 (Unwanted) — 동/호수 미인증 사용자 건의 등록 금지

> **If** 인증된 사용자의 `users.unit_id`가 NULL(동/호수 미인증)인 상태에서 건의 등록을 시도하면, **then** the system **shall not** 건의를 생성하고 `403 Forbidden` 응답을 반환한다 (건의는 호수 귀속이 필수이므로 미인증 사용자 등록 불가).

---

### M2. 건의 수정 (SUGGEST-02)

#### REQ-SUGGEST-006 (Event-driven) — 작성자 본인 건의 수정

> **When** 건의의 작성자 본인(author_id == 요청자 user id)이 특정 건의(id)의 title, content, category_id, is_public 중 변경된 필드를 포함하여 수정을 요청하면, the system **shall** `suggestions` 테이블의 해당 레코드를 갱신하고 `200 OK` 응답과 함께 갱신된 건의 정보를 반환한다. `updated_at`은 자동으로 갱신된다.

#### REQ-SUGGEST-007 (Unwanted) — 타인 건의 수정 금지

> **If** 요청자가 건의의 작성자(author_id)가 아닌 상태에서 건의 수정을 시도하면(ADMIN 포함), **then** the system **shall not** 건의를 갱신하고 `403 Forbidden` 응답을 반환한다 (건의 수정은 작성자 본인 only — apt_03 SUGGEST-02 명시).

#### REQ-SUGGEST-008 (Unwanted) — 아카이브/완료 상태 건의 수정 금지

> **If** 수정 대상 건의가 `archived=true` 이거나 `status='완료'` 인 상태이면, **then** the system **shall not** 건의를 갱신하고 `409 Conflict` 응답을 반환한다 (아카이브/완료 건의는 보호 — apt_03 SUGGEST-02 명시).

#### REQ-SUGGEST-009 (Unwanted) — 미존재 건의 수정 404

> **If** 건의 수정 요청의 건의 id가 DB에 존재하지 않으면, **then** the system **shall** `404 Not Found` 응답을 반환한다.

#### REQ-SUGGEST-010 (Unwanted) — 미존재 category_id 건의 수정 금지

> **If** 건의 수정 요청의 `category_id`가 `suggestion_categories` 테이블에 존재하지 않으면, **then** the system **shall not** 건의를 갱신하고 `422 Unprocessable Entity` 응답을 반환한다.

#### REQ-SUGGEST-011 (Unwanted) — 건의 수정 미인증 거부 (401)

> **If** 건의 수정(`PUT`) 요청이 유효한 액세스 토큰 없이 수신되면, **then** the system **shall not** 로직을 실행하고 `401 Unauthorized` 응답을 반환한다.

---

### M3. 건의 아카이브 (SUGGEST-03/04)

#### REQ-SUGGEST-012 (Event-driven) — 작성자 본인 건의 아카이브

> **When** 건의의 작성자 본인(author_id == 요청자 user id)이 특정 건의(id)의 삭제(`DELETE`)를 요청하면, the system **shall** `suggestions` 테이블의 해당 레코드를 `archived=true`, `author_id=NULL`, `author_label='전 입주민'`, `archived_at=now()`로 갱신하고 `200 OK` 응답을 반환한다. `unit_id`는 보존된다(ADR-005 호수 귀속). 행 삭제(hard delete)가 아니다.

#### REQ-SUGGEST-013 (Event-driven) — ADMIN 건의 아카이브

> **When** ADMIN이 특정 건의(id)의 삭제(`DELETE`)를 요청하면(부적절한 내용 아카이브 등), the system **shall** REQ-SUGGEST-012와 동일한 익명화 절차를 수행하고 `200 OK` 응답을 반환한다.

#### REQ-SUGGEST-014 (Unwanted) — 타인 건의 아카이브 금지

> **If** 요청자가 건의의 작성자(author_id)가 아니며 동시에 ADMIN 도 아닌 상태에서 건의 삭제를 시도하면, **then** the system **shall not** 아카이브를 수행하고 `403 Forbidden` 응답을 반환한다.

#### REQ-SUGGEST-015 (Unwanted) — 이미 아카이브된 건의 재아카이브 금지

> **If** 삭제 대상 건의가 이미 `archived=true` 인 상태이면, **then** the system **shall not** 아카이브를 재수행하고 `409 Conflict` 응답을 반환한다 (멱등성 — 중복 아카이브 방지).

#### REQ-SUGGEST-016 (Unwanted) — 미존재 건의 아카이브 404

> **If** 건의 삭제 요청의 건의 id가 DB에 존재하지 않으면, **then** the system **shall** `404 Not Found` 응답을 반환한다.

#### REQ-SUGGEST-017 (Unwanted) — 건의 아카이브 미인증 거부 (401)

> **If** 건의 삭제(`DELETE`) 요청이 유효한 액세스 토큰 없이 수신되면, **then** the system **shall not** 로직을 실행하고 `401 Unauthorized` 응답을 반환한다.

---

### M4. 건의 목록 열람 — 역할별 비공개 분기 (SUGGEST-05~08)

#### REQ-SUGGEST-018 (Event-driven) — 인증 사용자 건의 목록 열람 (역할별 자동 필터링)

> **When** 인증된 사용자가 건의 목록 조회를 요청하면, the system **shall** 요청자의 역할에 따라 서버 사이드에서 자동 필터링을 수행하고 `200 OK` 응답으로 페이지네이션된 건의 목록을 반환한다. 필터링 규칙: 공개(is_public=true) 건의는 모든 인증 사용자에게 노출; 비공개(is_public=false) 건의는 (a) RESIDENT/AUDITOR는 본인 작성(author_id == callerId) 건의만, (b) REP는 본인 작성 + 담당 동(managed_building_id == 건의 building) 건의만, (c) CHAIR/ADMIN은 전체 비공개 포함. `is_public`/`status`/`category_id`/`unit_id` 쿼리 필터와 `page`/`limit` 페이지네이션을 추가 지원한다. 응답의 각 건의는 id, title, category명, is_public, status, author_label, building, unit, created_at을 포함한다.

#### REQ-SUGGEST-019 (Ubiquitous) — 목록 응답 content 미포함

> **The system shall** 건의 목록 응답 본문의 각 건의 항목에 `content` 필드를 포함하지 않는다 (목록은 요약 정보만, 상세는 GET /api/suggestions/[id]에서만).

#### REQ-SUGGEST-020 (Unwanted) — 건의 목록 조회 미인증 거부 (401)

> **If** 건의 목록 조회(`GET /api/suggestions`) 요청이 유효한 액세스 토큰 없이 수신되면, **then** the system **shall not** 목록을 반환하고 `401 Unauthorized` 응답을 반환한다.

#### REQ-SUGGEST-021 (State-driven) — REP 비공개 담당 동 필터링

> **While** 요청자 역할이 REP 인 상태에서 비공개 건의 조회 시, the system **shall** REP의 `users.managed_building_id`와 일치하는 building 에 귀속된 비공개 건의만 노출하고 타 동 비공개 건의는 제외한다.

#### REQ-SUGGEST-022 (State-driven) — RESIDENT/AUDITOR 비공개 본인 필터링

> **While** 요청자 역할이 RESIDENT 또는 AUDITOR 인 상태에서 비공개 건의 조회 시, the system **shall** 본인 작성(author_id == callerId) 비공개 건의만 노출하고 타인 비공개 건의는 제외한다.

---

### M5. 건의 상세 열람 (SUGGEST-12)

#### REQ-SUGGEST-023 (Event-driven) — 인증 사용자 건의 상세 열람 (권한 검사)

> **When** 인증된 사용자가 특정 건의(id)의 상세 조회를 요청하면, the system **shall** REQ-SUGGEST-018의 역할별 비공개 분기 규칙을 적용하여 권한을 검사한 후, 권한이 있으면 `200 OK` 응답과 함께 건의 id, title, content, category명, is_public, status, author_label, building, unit, author_id(아카이브 시 NULL), created_at, updated_at, archived_at(아카이브 시)을 반환한다.

#### REQ-SUGGEST-024 (Unwanted) — 비공개 건의 무권한 열람 403

> **If** 요청자가 비공개 건의에 대한 열람 권한(REQ-SUGGEST-021, REQ-SUGGEST-022 분기)이 없는 상태에서 해당 건의 상세 조회를 시도하면, **then** the system **shall** `403 Forbidden` 응답을 반환한다 (존재 여부 누출 방지 — 404가 아닌 403).

#### REQ-SUGGEST-025 (Unwanted) — 미존재 건의 상세 404

> **If** 건의 상세 조회 요청의 건의 id가 DB에 존재하지 않으면, **then** the system **shall** `404 Not Found` 응답을 반환한다.

#### REQ-SUGGEST-026 (Unwanted) — 건의 상세 조회 미인증 거부 (401)

> **If** 건의 상세 조회(`GET /api/suggestions/[id]`) 요청이 유효한 액세스 토큰 없이 수신되면, **then** the system **shall not** 상세를 반환하고 `401 Unauthorized` 응답을 반환한다.

---

### M6. 건의 답변 등록 (SUGGEST-10)

#### REQ-SUGGEST-027 (Event-driven) — ADMIN 건의 답변 등록

> **When** ADMIN이 특정 건의(id)에 대해 답변(content) 등록을 요청하면, the system **shall** `suggestion_replies` 테이블에 신규 레코드를 생성하고 `201 Created` 응답과 함께 답변 ID, 건의 ID, 작성자 ID, 내용, 생성 시각을 반환한다. `author_id`는 요청자(ADMIN)의 user id로 설정된다.

#### REQ-SUGGEST-028 (Unwanted) — 미존재 건의 답변 등록 404

> **If** 답변 등록 대상 건의 id가 DB에 존재하지 않으면, **then** the system **shall** `404 Not Found` 응답을 반환한다.

#### REQ-SUGGEST-029a (Unwanted) — 답변 등록 미인증 거부 (401)

> **If** 답변 등록(`POST /api/suggestions/[id]/replies`) 요청이 유효한 액세스 토큰 없이 수신되면, **then** the system **shall not** 로직을 실행하고 `401 Unauthorized` 응답을 반환한다.

#### REQ-SUGGEST-029b (State-driven) — 비-ADMIN 답변 등록 금지 (403)

> **While** 요청자가 유효한 액세스 토큰으로 인증되었으나 역할이 ADMIN이 아닌 상태에서 답변 등록을 시도하면, the system **shall** `403 Forbidden` 응답을 반환한다.

---

### M7. 처리 상태 변경 (SUGGEST-11)

#### REQ-SUGGEST-030 (Event-driven) — ADMIN 건의 상태 변경

> **When** ADMIN이 특정 건의(id)의 처리 상태 변경을 요청하면, the system **shall** 상태 전이 규칙(REQ-SUGGEST-031)을 검증한 후 `suggestions.status`를 갱신하고 `200 OK` 응답과 함께 갱신된 상태를 반환한다. `updated_at`은 자동으로 갱신된다. 상태 변경 시 `reason`(사유) 필드는 선택적으로 수락되며 제공된 경우 로그로 기록된다(보류/재오픈 시 권장).

#### REQ-SUGGEST-031 (State-driven) — 상태 전이 규칙 검증

> **While** 상태 변경 요청이 접수되면, the system **shall** 다음 전이만 허용한다: `접수→처리중`, `처리중→완료`, `접수→보류`, `처리중→보류`, `보류→처리중`, `보류→접수`, `완료→접수`(재오픈). 이외의 전이(예: `접수→완료` 스킵, `완료→처리중`)는 거부된다.

#### REQ-SUGGEST-032 (Unwanted) — 불가능한 상태 전이 409

> **If** 상태 변경 요청이 REQ-SUGGEST-031의 허용 전이 규칙을 위반하면, **then** the system **shall not** 상태를 갱신하고 `409 Conflict` 응답을 반환한다 (현재 상태와 요청 상태를 응답에 포함).

#### REQ-SUGGEST-033 (Unwanted) — 미존재 건의 상태 변경 404

> **If** 상태 변경 대상 건의 id가 DB에 존재하지 않으면, **then** the system **shall** `404 Not Found` 응답을 반환한다.

#### REQ-SUGGEST-034a (Unwanted) — 상태 변경 미인증 거부 (401)

> **If** 상태 변경(`PUT /api/suggestions/[id]/status`) 요청이 유효한 액세스 토큰 없이 수신되면, **then** the system **shall not** 로직을 실행하고 `401 Unauthorized` 응답을 반환한다.

#### REQ-SUGGEST-034b (State-driven) — 비-ADMIN 상태 변경 금지 (403)

> **While** 요청자가 유효한 액세스 토큰으로 인증되었으나 역할이 ADMIN이 아닌 상태에서 상태 변경을 시도하면, the system **shall** `403 Forbidden` 응답을 반환한다.

---

### M8a. 호수별 건의 이력 조회 (SUGGEST-09)

#### REQ-SUGGEST-035 (Event-driven) — ADMIN/CHAIR 호수별 건의 이력 조회

> **When** ADMIN 또는 CHAIR이 특정 동/호수에 귀속된 건의 이력 조회를 요청하면, the system **shall** 해당 호수에 귀속된 모든 건의(아카이브 포함, 비공개 포함)를 `created_at` 시간순으로 정렬하여 `200 OK` 응답으로 반환한다. `building`/`unit` path param은 building_id(UUID) + unit_number(String) 조합으로 해석되며, `units` 테이블 JOIN으로 unit_id를 해석한다.

#### REQ-SUGGEST-036 (Unwanted) — 미존재 building/unit 조합 404

> **If** 호수별 이력 조회 요청의 building_id + unit_number 조합이 `units` 테이블에 존재하지 않으면, **then** the system **shall** `404 Not Found` 응답을 반환한다.

#### REQ-SUGGEST-037a (Unwanted) — 호수별 이력 조회 미인증 거부 (401)

> **If** 호수별 이력 조회(`GET /api/suggestions/units/[building]/[unit]`) 요청이 유효한 액세스 토큰 없이 수신되면, **then** the system **shall not** 이력을 반환하고 `401 Unauthorized` 응답을 반환한다.

#### REQ-SUGGEST-037b (State-driven) — 비-ADMIN/비-CHAIR 호수별 이력 조회 금지 (403)

> **While** 요청자가 유효한 액세스 토큰으로 인증되었으나 역할이 ADMIN 또는 CHAIR가 아닌 상태에서 호수별 이력 조회를 시도하면, the system **shall** `403 Forbidden` 응답을 반환한다.

---

### M8b. suggestion_categories 시드 + suggestions ALTER + suggestion_replies 마이그레이션

#### REQ-SUGGEST-038 (Ubiquitous) — suggestion_categories 시드 테이블

> **The system shall** `suggestion_categories` 테이블(id UUID PK, name VARCHAR UNIQUE, sort_order INT)을 생성하고 4종 고정 카테고리 시드(시설/주차/소음/기타)를 migration 007로 삽입한다. 동적 카테고리 CRUD(SUGGEST-13)는 본 SPEC 범위 외.

#### REQ-SUGGEST-039 (Ubiquitous) — suggestions 테이블 ALTER 확장

> **The system shall** 기존 `suggestions` 테이블(migration 004 최소 스키마)에 다음 7개 컬럼을 `ALTER TABLE ... ADD COLUMN`으로 추가한다: `category_id UUID REFERENCES suggestion_categories(id)`, `title VARCHAR(100) NOT NULL DEFAULT ''`, `content TEXT NOT NULL DEFAULT ''`, `is_public BOOLEAN NOT NULL DEFAULT false`, `status VARCHAR(20) NOT NULL DEFAULT '접수'`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `archived_at TIMESTAMPTZ`. 기존 004 컬럼(id, author_id, author_label, archived, unit_id, created_at)과 기존 데이터는 보존된다(AUTH 강제 탈퇴 사이드이펙트 호환성 유지). 인덱스: category_id, is_public, status, archived(units 기존 unit_id, author_id 인덱스는 004에서 이미 생성).

#### REQ-SUGGEST-040 (Ubiquitous) — suggestion_replies 신규 테이블

> **The system shall** `suggestion_replies` 테이블(id UUID PK DEFAULT gen_random_uuid(), suggestion_id UUID FK→suggestions.id NOT NULL, author_id UUID FK→users.id NOT NULL, content TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())을 migration 007로 생성한다. 인덱스: suggestion_id.

---

## 5. Exclusions (What NOT to Build)

본 SPEC은 다음 항목을 구현하지 않는다 (별도 SPEC 또는 명시적 OUT):

1. **첨부파일 (attachments)** — 건의 등록/수정 시 파일 업로드, 건의 상세 시 첨부파일 URL 목록 반환은 본 SPEC에서 완전 제외. NOTICE-001과 동일 정책. 파일 저장소 백엔드(S3/Railway Volumes/Supabase Storage 등) 결정이 선행되어야 하므로 별도 ADR/SPEC으로 이연. 본 SPEC의 API 요청/응답 스키마에는 attachments 필드가 존재하지 않는다. `@MX:TODO: 첨부파일 별도 SPEC`으로 연결 지점 표시.
2. **SUGGEST-13 건의 카테고리 동적 관리 (P1)** — 카테고리 추가/수정/삭제 CRUD. 본 SPEC은 4종(시설/주차/소음/기타) 고정 시드값으로 취급. `@MX:TODO: SUGGEST-13 카테고리 CRUD P1 별도 SPEC`으로 표시.
3. **건의 영구 삭제 (hard delete)** — ADR-005 호수 귀속 정책에 의해 건의는 절대 영구 삭제되지 않는다. DELETE 엔드포인트는 archived=true 전환(익명화)이며 행 삭제가 아니다. `@MX:WARN: DELETE = archive semantics, NOT row deletion`으로 표시.
4. **건의 검색 (전문 검색)** — 제목/내용 키워드 검색은 본 SPEC 범위 아님. `category_id`/`status`/`is_public`/`unit_id` 필터만 지원.
5. **건의 답변 수정/삭제** — 본 SPEC은 답변 등록(POST)만 지원. 답변 수정(PUT)과 답변 삭제(DELETE)는 범위 외. 답변 등록 후 수정이 필요한 경우 새 답변 추가 정책(이력 누적) 가정.
6. **건의 알림 (푸시/이메일, P2)** — 건의 상태 변경 시 작성자 알림 발송은 P2.
7. **건의 수정 이력 추적** — 이전 버전 보존 없음. 갱신 시 덮어쓰기.
8. **공지(NOTICE) / 주차 추첨(PARKING) 도메인** — 별도 SPEC.

---

## 6. 비기능 요구사항 (제약)

### 6.1 보안 (Security)

- **RBAC + 역할 분기**: SUGGEST API는 서버 사이드 JWT 검증 + 역할 기반 접근 제어 필수. 특히 비공개 건의 열람(M4/M5)은 역할별 서버 자동 필터링(RESIDENT 본인 / REP 담당 동 / CHAIR·ADMIN 전체)이 핵심 — 클라이언트 단독 신뢰 금지. 권한 없는 비공개 건의 접근 시 403 반환(존재 여부 누출 방지를 위해 404가 아닌 403, REQ-SUGGEST-024).
- **SQL Injection 방어**: 모든 DB 쿼리는 Parameterized Query(`query` 함수). 문자열 결합 쿼리 금지.
- **입력 유효성 검증**: 서버 사이드 zod 스키마 필수. title `VARCHAR(100)` (1~100자), content `TEXT` (1~5000자, 기능명세서 SUGGEST-01 명시 — NOTICE 10000자와 상이), category_id UUID 형식, is_public boolean, status enum(접수/처리중/완료/보류), path param UUID 형식 검증(`UUID_RE` 패턴 재사용).
- **개인정보 최소화**: 건의 목록/상세 응답에 작성자 email/password_hash 미포함. author_id(UUID, 아카이브 시 NULL)와 author_label(문자열)만 노출.
- **ADR-005 호수 귀속 불변**: 아카이브 시 `unit_id`는 절대 변경/삭제되지 않는다. 이는 호수별 하자·유지보수 이력 추적의 핵심이다.

### 6.2 성능 (Performance)

- 모든 SUGGEST API 응답 시간: P95 500ms 이하 (PRD §5-1).
- 건의 목록 조회 페이지네이션: 기본 limit 20, 최대 100. `OFFSET`/`LIMIT` 기반.
- 역할별 필터링 쿼리는 `is_public`, `unit_id`, `author_id`, `managed_building_id` 인덱스를 활용(ERD 명시 인덱스 + 004 기존 인덱스).
- `created_at DESC` 정렬(목록), `created_at ASC` 정렬(호수별 이력).

### 6.3 가용성 (Availability)

- 단일 PostgreSQL 인스턴스 의존(Railway Managed DB, AUTH/SETUP/NOTICE와 공유).
- migration 007은 migration 006(NOTICE) 이후 순차 적용. 기존 004(suggestions 최소)에 대한 ALTER이므로 AUTH 사이드이펙트 데이터 보존 필수. idempotent 하지 않으므로 한 번만 실행(ALTER ADD COLUMN IF NOT EXISTS 사용으로 멱등성 보장 권장).

### 6.4 감사 (Auditability)

- 건의 등록/수정/아카이브/답변/상태변경 이벤트는 애플리케이션 로그로 기록(단, PII는 로그에서 제외).
- 권한 오용 시도(타인 건의 수정/아카이브 시도, 비-ADMIN 답변/상태변경 시도, 무권한 비공개 열람 시도)는 경고 로그로 기록 권장(NOTICE 동일 패턴 — 본 SPEC에서 로깅 구현은 필수 아님).
- 상태 변경 시 reason(사유) 제공된 경우 로그에 기록(보류/재오픈 시 권장).

---

## 7. MX Tag Plan (코드 주석 계획)

Run Phase에서 다음 @MX 태그를 적용한다:

### @MX:ANCHOR (fan_in >= 3 또는 공개 API 경계)

- `suggestions` CRUD route handlers — 다수 클라이언트(입주민 건의 목록/상세, 관리사무소 처리 화면, 회장 호수별 이력)에서 호출
- migration 007 스키마 불변 지점 — suggestions ALTER + suggestion_categories + suggestion_replies 정의

### @MX:WARN with @MX:REASON (위험 영역)

- 건의 아카이브(DELETE = archive semantics) — `@MX:REASON: 행 삭제가 아님. ADR-005 호수 귀속 정책에 의해 archived=true + author_id=NULL + author_label="전 입주민" 전환. unit_id 영구 보존. 영구 삭제 금지`
- 역할별 비공개 건의 필터링 — `@MX:REASON: 우회 시 타인 비공개 건의 노출. RESIDENT 본인 / REP 담당 동(managed_building_id 매칭) / CHAIR·ADMIN 전체 분기는 서버 사이드 불변`
- 상태 전이 검증 — `@MX:REASON: 접수→완료 스킵 등 불허 전이 차단. apt_03 처리상태전이 규칙 준거`
- 비공개 건의 무권한 접근 403(404 아님) — `@MX:REASON: 존재 여부 누출 방지. 권한 없는 비공개 건의는 404가 아닌 403 반환`

### @MX:NOTE (도메인 의도 전달)

- `suggestions` ALTER 기반 마이그레이션 — `@MX:NOTE: migration 004(AUTH 사이드이펙트 최소 스키마)를 ALTER 확장. 기존 컬럼/데이터 보존 필수. AUTH deactivate 호환성 유지`
- `suggestion_categories` 시드 — `@MX:NOTE: 4종(시설/주차/소음/기타) 고정 시드, 동적 CRUD는 SUGGEST-13 P1 별도 SPEC`
- `suggestions.unit_id` NOT NULL — `@MX:NOTE: ADR-005 호수 귀속. 작성자 탈퇴/아카이브 후에도 unit_id 영구 보존`
- ADMIN 건의 등록 권한 없음 — `@MX:NOTE: apt_08 §7 매트릭스 명시. 관리사무소는 처리 주체이므로 등록 불가(403)`

### @MX:TODO (후속 SPEC 연결 지점)

- SUGGEST-13 카테고리 CRUD — `@MX:TODO: P1 별도 SPEC, suggestion_categories 동적 관리`
- 첨부파일 — `@MX:TODO: 별도 ADR/SPEC, 파일 저장소 백엔드 결정 후`
- 답변 수정/삭제 — `@MX:TODO: 별도 SPEC, suggestion_replies PUT/DELETE 지원`

---

## 8. 검증 기준 요약

상세 Given/When/Then 시나리오는 `acceptance.md`를 참조. 각 모듈당 최소 2개 시나리오, 총 40개 REQ-SUGGEST-XXX 요구사항(001~040, a/b 서브 ID 포함)에 대한 검증 케이스를 정의한다. M8b(suggestions ALTER + categories 시드 + replies 신규)은 migration 검증 테스트로 별도 검증하며, 기존 004 데이터 보존(AUTH 사이드이펙트 호환성)을 포함한다.

---

## 9. 참조 문서

- `research.md` (본 디렉토리): SUGGEST 도메인 기획 발췌 + 의사결정 근거 + 모호점 분석
- `plan.md` (본 디렉토리): TDD 구현 계획, 파일 목록, migration 007 ALTER 상세
- `acceptance.md` (본 디렉토리): 검증 시나리오, 품질 게이트 기준
- `.moai/specs/SPEC-AUTH-001/spec.md`: AUTH 도메인 스펙(의존 SPEC, REQ-AUTH-014 강제 탈퇴 사이드이펙트 + migration 004 소유)
- `.moai/specs/SPEC-SETUP-001/spec.md`: SETUP 도메인 스펙(의존 SPEC, rbac.ts requireAdmin/requirePrivileged + managed_building_id 단일 출처)
- `.moai/specs/SPEC-NOTICE-001/spec.md`: NOTICE 도메인 스펙(참조 SPEC, notice_categories 시드 패턴 + route-level Bearer 인증 패턴)
- 기획 문서(외부): `apt_02_PRD.md` §4-4 건의(상태 정의, SUGGEST-01~13), §5 비기능; `apt_03_기능명세서.md` §4 건의(SUGGEST-01 등록 입력/title 100자·content 5000자, SUGGEST-02 수정 제약, SUGGEST-03/04 아카이브 절차, SUGGEST-09 호수별 이력, 처리상태전이); `apt_04_유저플로우.md` flow 4 건의 등록, flow 5 건의 처리, flow 8 호수별 이력; `apt_05_ERD.md` suggestions/suggestion_categories/suggestion_replies 테이블; `apt_06_API명세서.md` §4 건의 엔드포인트; `apt_08_보안설계.md` §7 접근 제어 매트릭스; `apt_09_ADR.md` ADR-005 건의 데이터 호수 귀속

---

## Implementation Notes

**구현 완료일**: 2026-06-22
**상태**: ✅ 완료 (P0), develop 브랜치에 병합됨 (커밋 0d90dd1)
**테스트 커버리지**: 412/412 통과 (SUGGEST route 93.07%)

### 생성 파일

| 파일 | 모듈 | 목적 |
|------|------|------|
| `migrations/007_suggestions_expand.sql` | M8b | suggestion_categories 시드(시설/주차/소음/기타) + suggestions ALTER(7컬럼) + suggestion_replies 신규 테이블 |
| `src/lib/suggest-rbac.ts` | M1/M4/M5 | SUGGEST 도메인 인증 헬퍼 (requireAuthenticated, Option C — rbac.ts 무변경) |
| `src/app/api/suggestions/route.ts` | M1/M4 | GET 목록(역할별 비공개 분기 + 필터 + 페이지네이션) + POST 등록(ADMIN 403) |
| `src/app/api/suggestions/[id]/route.ts` | M2/M3/M5 | GET 상세(비공개 403) + PUT 수정(작성자 본인) + DELETE 아카이브(익명화) |
| `src/app/api/suggestions/[id]/replies/route.ts` | M6 | POST 답변 등록(ADMIN) |
| `src/app/api/suggestions/[id]/status/route.ts` | M7 | PUT 상태 변경(ADMIN, 화이트리스트 전이 검증) |
| `src/app/api/suggestions/units/[building]/[unit]/route.ts` | M8a | GET 호수별 이력(ADMIN/CHAIR, 아카이브 포함) |
| `src/lib/migration-007.test.ts` | M8b | migration 007 검증 (14 tests, R1 CRITICAL AUTH deactivate 호환성) |
| `src/app/api/suggestions/route.test.ts` | M1/M4 | 목록/등록 검증 (18 tests) |
| `src/app/api/suggestions/[id]/route.test.ts` | M2/M3/M5 | 상세/수정/아카이브 검증 (30 tests) |
| `src/app/api/suggestions/[id]/replies/route.test.ts` | M6 | 답변 등록 검증 (7 tests) |
| `src/app/api/suggestions/[id]/status/route.test.ts` | M7 | 상태 변경 검증 (10 tests) |
| `src/app/api/suggestions/units/[building]/[unit]/route.test.ts` | M8a | 호수별 이력 검증 (8 tests) |

### 수정 파일

| 파일 | 수정 내용 |
|------|-----------|
| 없음 | Option C — rbac.ts 무변경, suggest-rbac.ts 신규 생성 (AUTH/SETUP/NOTICE 333 테스트 회귀 방지) |

### 핵심 구현 결정

1. **route-level Bearer 강제** (REQ-SUGGEST-020, 026, 029a, 034a, 037a): middleware.ts는 AT 쿠키(Edge/jose)만 검사하고 Authorization 헤더를 검사하지 않는다. requireAuthenticated() (suggest-rbac.ts)로 Bearer→verifyAccessToken→ACTIVE 조회 후 {callerId, callerRole, unitId, managedBuildingId} 반환 (NOTICE requireAuth 패턴 확장, fan_in=3 — M1 등록, M4 목록, M5 상세).
2. **역할별 비공개 분기** (REQ-SUGGEST-018, 021, 022): M4 목록 / M5 상세에서 서버 사이드 자동 필터링 — RESIDENT/AUDITOR 본인(author_id == callerId), REP 담당동(managed_building_id == 건의 building), CHAIR/ADMIN 전체. 무권한 비공개 접근 시 403(404 아님, 존재 누출 방지).
3. **아카이브 익명화(ADR-005)** (REQ-SUGGEST-012, 013): DELETE = archived=true + author_id=NULL + author_label='전 입주민' + archived_at=now 전환. unit_id는 영구 보존(호수 이력 추적). 행 삭제(hard delete) 금지.
4. **상태 전이 화이트리스트** (REQ-SUGGEST-031): 접수→{처리중,보류}, 처리중→{완료,보류}, 보류→{처리중,접수}, 완료→접수(재오픈). 불허 전이(접수→완료 스킵 등)는 409 반환.
5. **카테고리 시드 멱등성** (REQ-SUGGEST-038): suggestion_categories.name UNIQUE + ON CONFLICT (name) DO NOTHING (NOTICE 006 패턴 동일). 4종(시설/주차/소음/기타) 고정 시드.
6. **Option C (rbac.ts 무변경)**: suggest-rbac.ts 별도 파일 생성. requireAuthenticated()가 역할/호수/담당동를 반환 (rbac.ts requireAdmin/requirePrivileged 무변경, AUTH/SETUP/NOTICE 333 테스트 회귀 방지).

### 알려진 제한사항

1. **첨부파일(attachments) 미구현**: 본 SPEC 범위 완전 제외 — 파일 저장소 백엔드(S3/Railway Volumes/Supabase Storage 등) 결정 후 별도 ADR/SPEC 필요 (Exclusions #1).
2. **SUGGEST-13 카테고리 동적 CRUD 미구현**: 4종(시설/주차/소음/기타) 고정 시드, name UNIQUE로 멱등성 보장. 동적 카테고리 추가/수정/삭제는 P1 별도 SPEC 필요 (Exclusions #2).
3. **건의 영구 삭제(hard delete) 금지**: ADR-005 호수 귀속 정책 준거 — DELETE = archive semantics (익명화 전환). 행 삭제 금지 (Exclusions #3).
4. **건의 답변 수정/삭제 미구현**: 본 SPEC은 답변 등록(POST)만 지원. 답변 수정(PUT)과 답변 삭제(DELETE)는 범위 외 (Exclusions #5).
5. **건의 검색(전문 검색) 미구현**: 제목/내용 키워드 검색은 본 SPEC 범위 아님. category_id/status/is_public/unit_id 필터만 지원 (Exclusions #4).
6. **AUDITOR 건의 권한**: apt_08 §7 매트릭스 미명시 → RESIDENT 동일 취급(공개+본인비공개 열람, 등록 가능). 후속 보안 정책 명시 권장 (progress.md Known limitations 참조).
7. **상태 변경 reason 필드**: 현재 로그 전용(테이블 컬럼 없음). status_history 테이블 도입 시 별도 SPEC.

### 품질 검증 결과

- **테스트**: 412/412 통과 (기존 333 + 신규 79: migration 14, route 65)
- **타입**: `tsc --noEmit` 0 에러
- **린트**: ESLint 0 경고 (기존 2개 pre-existing warning 유지)
- **보안**: OWASP CLEAN (RBAC/SQL Injection/UUID 검증/Parameterized Query 전부 코드 레벨 확인)
- **커버리지**: SUGGEST route 93.07% lines (임계 85% 충족)

### 의존성

- **SPEC-AUTH-001 P0**: `users`/`roles`/`buildings`/`units` 스키마 및 `src/lib` (db, auth, rbac) 재사용. AUTH 강제 탈퇴(AUTH-07) 사이드이펙트 로직(deactivate/route.ts:131-136)는 migration 007 ALTER 후에도 동일 UPDATE로 정상 동작(R1 CRITICAL — migration-007.test.ts 단정 포함).
- **SPEC-SETUP-001 P0**: RBAC 헬퍼(rbac.ts requireAdmin/requirePrivileged, 응답 빌더) 재사용. REP의 managed_building_id 단일 출처(M5 제거)를 M4 비공개 담당동 필터링에 활용.
- **SPEC-NOTICE-001 P0**: notice_categories 시드 패턴(migration 006)과 route-level Bearer 인증 패턴(verify-unit/route.ts:46-63) 참조.

---

*본 SPEC의 SUGGEST routes는 greenfield(미구현)이므로 Delta 마커 없이 작성되었다. 단, migration 007(suggestions ALTER + categories + replies)은 기존 004 suggestions 테이블(brownfield, AUTH 소유)을 수정하며, AUTH 강제 탈퇴 사이드이펙트 로직(`deactivate` route)의 호환성을 유지해야 한다 — 기존 004 컬럼(id, author_id, author_label, archived, unit_id, created_at)은 보존되고 ALTER ADD로 7개 컬럼만 추가된다.*
