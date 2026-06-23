---
id: "SPEC-NOTICE-001"
version: "1.0.0"
status: "Complete"
created: "2026-06-22"
updated: "2026-06-23"
author: "강력쇠주먹"
priority: "P0"
issue_number: 0
---

# SPEC-NOTICE-001: 공지사항 (등록/수정/삭제/열람)

아이뜨락 아파트 커뮤니티 플랫폼의 공지사항(NOTICE) 도메인 스펙. 본 SPEC은 NOTICE 도메인 P0 범위(NOTICE-01 공지 등록, NOTICE-02 공지 수정, NOTICE-03 공지 삭제, NOTICE-04 공지 목록 열람, NOTICE-05 공지 상세 열람) 및 카테고리 시드 마이그레이션 책임을 정의한다. P1 항목(NOTICE-06 상단 고정 노출 동작, NOTICE-07 카테고리 동적 CRUD) 및 첨부파일 기능은 본 SPEC 범위에서 명시적으로 제외한다.

---

## HISTORY

- **2026-06-23**: 구현 완료 및 문서 동기화 (강력쇠주먹). P0 범위 전체 구현 완료: NOTICE-01(공지 등록), NOTICE-02(공지 수정), NOTICE-03(공지 삭제), NOTICE-04(공지 목록 열람), NOTICE-05(공지 상세 열람). Migration 006(notices/notice_categories 테이블) 적용 완료. RBAC 패턴 재사용(requireAdmin, verifyAccessToken). 테스트 커버리지 93.45% 달성(333/333 통과). TRUST 5 품질 게이트 전달. 상태를 "draft"에서 "Complete"로 변경.
- **2026-06-22**: 최초 작성 (강력쇠주먹). 확정 결정 4종 반영: (1) 범위 = P0 ONLY(등록/수정/삭제 ADMIN + 목록/상세 열람 전체 인증 사용자), (2) 카테고리 = 고정 enum 시드(notice_categories 테이블 seed, 일반/긴급/주차/시설), 동적 카테고리 CRUD(NOTICE-07)는 OUT, (3) 첨부파일(attachments) = 본 SPEC에서 완전 제외 — 공지는 제목+카테고리+내용(텍스트)만, 파일 저장소 백엔드 결정은 별도 ADR/SPEC으로 이연, (4) is_pinned(상단 고정) = 본 SPEC에서 API 동작 제외(P1, 별도 SPEC) — 단 ERD 전방 호환성을 위해 notices 테이블에 is_pinned 컬럼은 존재하며, 본 SPEC은 이 컬럼에 대한 어떠한 API 동작도 노출하지 않는다(디폴트 false 로 저장만 됨). 공지 삭제는 영구 삭제(hard delete) — 기획서(기능명세서/PRD)에 명시된 바에 따름.

---

## 1. 배경 및 목적

아이뜨락 아파트(총 2개 동 / 38세대)의 관리사무소(ADMIN)가 입주민에게 공지를 전달하고, 모든 인증 사용자가 공지를 열람할 수 있는 기능을 제공한다. AUTH P0가 `users`/`roles` 스키마와 JWT 인증을 구축했고, SETUP P0가 RBAC 헬퍼(`requireAdmin`, `requirePrivileged`, 응답 빌더)를 구축했으므로, 본 SPEC은 이를 재사용하여 NOTICE 도메인을 구현한다.

본 SPEC은 다음을 달성해야 한다:

- NOTICE-01: 공지 등록(`POST /api/notices`) — ADMIN 전용, 제목(≤100자) + 카테고리 + 내용(≤10000자)
- NOTICE-02: 공지 수정(`PUT /api/notices/[id]`) — ADMIN 전용
- NOTICE-03: 공지 삭제(`DELETE /api/notices/[id]`) — ADMIN 전용, 영구 삭제(hard delete)
- NOTICE-04: 공지 목록 열람(`GET /api/notices`) — 모든 인증 사용자, 카테고리 필터 + 페이지네이션, 최신순
- NOTICE-05: 공지 상세 열람(`GET /api/notices/[id]`) — 모든 인증 사용자
- M6: `notice_categories` 시드 테이블 + `notices` 테이블 마이그레이션(migration 006)

기술 결정 근거는 `research.md` 및 `.moai/project/tech.md`를 참조한다.

---

## 2. 범위

### 2.1 In-Scope (본 SPEC이 구현하는 것)

- NOTICE-01: 공지 등록(`POST /api/notices`) — ADMIN 전용
- NOTICE-02: 공지 수정(`PUT /api/notices/[id]`) — ADMIN 전용
- NOTICE-03: 공지 삭제(`DELETE /api/notices/[id]`) — ADMIN 전용, 영구 삭제(hard delete)
- NOTICE-04: 공지 목록 열람(`GET /api/notices`) — 모든 인증 사용자, `category_id` 필터 + 페이지네이션, `created_at DESC` 최신순
- NOTICE-05: 공지 상세 열람(`GET /api/notices/[id]`) — 모든 인증 사용자
- M6: `notice_categories` 시드 테이블(일반/긴급/주차/시설) + `notices` 테이블 마이그레이션 006
- `notices`/`notice_categories` 테이블 읽기/쓰기
- AUTH/SETUP 산출물 재사용: `src/lib/{db,auth,cookies,rbac}.ts`, `verifyAccessToken`, `requireAdmin`, `query`, RBAC 응답 빌더(unauthorized/forbidden/badRequest/notFound/validationError), UUID 정규식 패턴, zod 검증

### 2.2 Out-of-Scope (별도 SPEC)

- NOTICE-06 공지 상단 고정(P1) — API 동작 없음. `notices.is_pinned` 컬럼은 ERD 전방 호환성을 위해 존재하지만 본 SPEC은 노출하지 않음
- NOTICE-07 공지 카테고리 동적 관리(P1) — 카테고리 추가/수정/삭제 CRUD. 본 SPEC은 4종(일반/긴급/주차/시설) 고정 시드값으로 취급
- 첨부파일(attachments) — 본 SPEC에서 완전 제외. 파일 저장소 백엔드(S3/Railway Volumes 등) 결정은 별도 ADR/SPEC으로 이연
- 공지 조회수 추적/통계
- 공지 검색(전문 검색)
- 공지 알림(푸시/이메일) — P2
- 건의(SUGGEST) / 주차 추첨(PARKING) 도메인

---

## 3. 가정 및 사전 조건 (Dependencies)

본 SPEC은 다음 사전 조건이 충족되었다고 가정한다:

1. **SPEC-AUTH-001 P0 완료·병합**: `users`/`roles` 테이블 스키마(migration 001)와 JWT 인증(`verifyAccessToken`)이 이미 존재한다.
2. **SPEC-SETUP-001 P0 완료·병합**: RBAC 헬퍼 `src/lib/rbac.ts`(`requireAdmin`, `requirePrivileged`, 응답 빌더 `unauthorized`/`forbidden`/`badRequest`/`notFound`/`conflict`/`validationError`)가 이미 존재하며 본 SPEC이 재사용한다. NOTICE 쓰기 엔드포인트는 `requireAdmin()`을 재사용한다.
3. **DB 라이브러리 재사용 가능**: `src/lib/db.ts`(PostgreSQL 연결 풀, `query`)가 AUTH/SETUP P0에서 구현되어 있으며 본 SPEC이 재사용한다.
4. **AUTH 미들웨어 패턴 재사용**: `src/middleware.ts`의 matcher 구조와 인증 라우트 핸들러 패턴을 그대로 따른다. NOTICE 엔드포인트는 인증 사용자 전용이므로 기존 matcher(`/api/notices`)에 매칭된다 — 공개 엔드포인트 예외 없음.
5. **환경 변수**: AUTH/SETUP과 동일(`DATABASE_URL`, `JWT_SECRET` 등) — 신규 불필요.
6. **HTTPS 강제**: 모든 API는 HTTPS(Railway 자동 제공). 개발 환경 예외 허용.
7. **역할 5종 고정**: ADMIN(관리사무소)/CHAIR(회장)/REP(동대표)/AUDITOR(감사)/RESIDENT(일반 입주민) — NOTICE 열람은 5종 전부, NOTICE CRUD는 ADMIN만.

---

## 4. 기능 요구사항 (EARS)

### M1. 공지 등록 (NOTICE-01)

#### REQ-NOTICE-001 (Event-driven) — ADMIN 공지 등록

> **When** ADMIN이 신규 공지(title, category_id, content)를 포함하여 공지 등록을 요청하면, the system **shall** `notices` 테이블에 신규 레코드를 생성하고 `201 Created` 응답과 함께 공지 ID, 제목, 카테고리명, 내용, 작성자 ID, 생성 시각을 반환한다. `author_id`는 요청자(ADMIN)의 user id로 설정된다.

#### REQ-NOTICE-002 (Unwanted) — 미존재 category_id 공지 등록 금지

> **If** 공지 등록 요청의 `category_id`가 `notice_categories` 테이블에 존재하지 않으면, **then** the system **shall not** 공지를 생성하고 `422 Unprocessable Entity` 응답을 반환한다 (FK 위반 사전 차단).

#### REQ-NOTICE-003a (Unwanted) — 공지 등록 미인증 거부 (401)

> **If** 공지 등록(`POST`) 요청이 유효한 액세스 토큰 없이(누락/만료/변조) 수신되면, **then** the system **shall not** 로직을 실행하고 `401 Unauthorized` 응답을 반환한다 (인증 실패).

#### REQ-NOTICE-003b (State-driven) — ADMIN RBAC (공지 등록, 403)

> **While** 요청자가 유효한 액세스 토큰으로 인증되었으나 역할이 ADMIN이 아닌 상태(CHAIR/REP/AUDITOR/RESIDENT)에서 공지 등록(`POST`)을 시도하면, the system **shall** `403 Forbidden` 응답을 반환한다 (권한 없음).

---

### M2. 공지 수정 (NOTICE-02)

#### REQ-NOTICE-004 (Event-driven) — ADMIN 공지 수정

> **When** ADMIN이 특정 공지(id)의 title, category_id, content 중 변경된 필드를 포함하여 공지 수정을 요청하면, the system **shall** `notices` 테이블의 해당 레코드를 갱신하고 `200 OK` 응답과 함께 갱신된 공지 정보를 반환한다. `updated_at`은 자동으로 갱신된다.

#### REQ-NOTICE-005 (Unwanted) — 미존재 공지 수정 404

> **If** 공지 수정 요청의 공지 id가 DB에 존재하지 않으면, **then** the system **shall** `404 Not Found` 응답을 반환한다.

#### REQ-NOTICE-006 (Unwanted) — 미존재 category_id 공지 수정 금지

> **If** 공지 수정 요청의 `category_id`가 `notice_categories` 테이블에 존재하지 않으면, **then** the system **shall not** 공지를 갱신하고 `422 Unprocessable Entity` 응답을 반환한다.

#### REQ-NOTICE-007a (Unwanted) — 공지 수정 미인증 거부 (401)

> **If** 공지 수정(`PUT`) 요청이 유효한 액세스 토큰 없이(누락/만료/변조) 수신되면, **then** the system **shall not** 로직을 실행하고 `401 Unauthorized` 응답을 반환한다.

#### REQ-NOTICE-007b (State-driven) — ADMIN RBAC (공지 수정, 403)

> **While** 요청자가 유효한 액세스 토큰으로 인증되었으나 역할이 ADMIN이 아닌 상태에서 공지 수정(`PUT`)을 시도하면, the system **shall** `403 Forbidden` 응답을 반환한다.

---

### M3. 공지 삭제 (NOTICE-03)

#### REQ-NOTICE-008 (Event-driven) — ADMIN 공지 영구 삭제

> **When** ADMIN이 특정 공지(id)의 삭제를 요청하면, the system **shall** `notices` 테이블에서 해당 레코드를 영구 삭제(hard delete, `DELETE FROM`)하고 `200 OK` 응답을 반환한다 (소프트 삭제 아님 — 기획서 명시).

#### REQ-NOTICE-009 (Unwanted) — 미존재 공지 삭제 404

> **If** 공지 삭제 요청의 공지 id가 DB에 존재하지 않으면, **then** the system **shall** `404 Not Found` 응답을 반환한다.

#### REQ-NOTICE-010a (Unwanted) — 공지 삭제 미인증 거부 (401)

> **If** 공지 삭제(`DELETE`) 요청이 유효한 액세스 토큰 없이(누락/만료/변조) 수신되면, **then** the system **shall not** 로직을 실행하고 `401 Unauthorized` 응답을 반환한다.

#### REQ-NOTICE-010b (State-driven) — ADMIN RBAC (공지 삭제, 403)

> **While** 요청자가 유효한 액세스 토큰으로 인증되었으나 역할이 ADMIN이 아닌 상태에서 공지 삭제(`DELETE`)를 시도하면, the system **shall** `403 Forbidden` 응답을 반환한다.

---

### M4. 공지 목록 열람 (NOTICE-04)

#### REQ-NOTICE-011 (Event-driven) — 인증 사용자 공지 목록 열람

> **When** 인증된 사용자가 공지 목록 조회를 요청하면, the system **shall** `category_id` 쿼리 필터와 페이지네이션(`page`, `limit`)을 지원하고, `created_at DESC` 기본 정렬로 페이지네이션된 공지 목록을 `200 OK` 응답으로 반환한다. 응답의 각 공지는 id, title, category명, created_at을 포함한다.

#### REQ-NOTICE-012 (Ubiquitous) — 목록 응답 content 미포함

> **The system shall** 공지 목록 응답 본문의 각 공지 항목에 `content` 필드를 포함하지 않는다 (목록은 요약 정보만, 상세는 NOTICE-05 상세 엔드포인트에서만).

#### REQ-NOTICE-013a (Unwanted) — 공지 목록 조회 미인증 거부 (401)

> **If** 공지 목록 조회(`GET /api/notices`) 요청이 유효한 액세스 토큰 없이(누락/만료/변조) 수신되면, **then** the system **shall not** 목록을 반환하고 `401 Unauthorized` 응답을 반환한다.

---

### M5. 공지 상세 열람 (NOTICE-05)

#### REQ-NOTICE-014 (Event-driven) — 인증 사용자 공지 상세 열람

> **When** 인증된 사용자가 특정 공지(id)의 상세 조회를 요청하면, the system **shall** `200 OK` 응답과 함께 공지 id, title, content, category명, author_id, created_at, updated_at을 반환한다.

#### REQ-NOTICE-015 (Unwanted) — 미존재 공지 상세 404

> **If** 공지 상세 조회 요청의 공지 id가 DB에 존재하지 않으면, **then** the system **shall** `404 Not Found` 응답을 반환한다.

#### REQ-NOTICE-016a (Unwanted) — 공지 상세 조회 미인증 거부 (401)

> **If** 공지 상세 조회(`GET /api/notices/[id]`) 요청이 유효한 액세스 토큰 없이(누락/만료/변조) 수신되면, **then** the system **shall not** 상세를 반환하고 `401 Unauthorized` 응답을 반환한다.

---

### M6. 카테고리 시드 + notices 마이그레이션

#### REQ-NOTICE-017 (Ubiquitous) — notice_categories 시드 테이블

> **The system shall** `notice_categories` 테이블(id UUID PK, name VARCHAR, sort_order INT)을 생성하고 4종 고정 카테고리 시드(일반/긴급/주차/시설)를 migration 006으로 삽입한다. 동적 카테고리 CRUD(NOTICE-07)는 본 SPEC 범위 외.

#### REQ-NOTICE-018 (Ubiquitous) — notices 테이블 스키마

> **The system shall** `notices` 테이블을 ERD에 따라 생성한다: id UUID PK, author_id UUID FK→users.id, category_id UUID FK→notice_categories.id, title VARCHAR(100) NOT NULL, content TEXT NOT NULL, is_pinned BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(). 인덱스: category_id, is_pinned, created_at DESC. `is_pinned` 컬럼은 ERD 전방 호환성을 위해 존재하나 본 SPEC은 API 동작을 노출하지 않는다(디폴트 false).

---

## 5. Exclusions (What NOT to Build)

본 SPEC은 다음 항목을 구현하지 않는다 (별도 SPEC 또는 명시적 OUT):

1. **첨부파일 (attachments)** — 공지 등록/수정 시 파일 업로드, 공지 상세 시 첨부파일 URL 목록 반환은 본 SPEC에서 완전 제외. 기획서(기능명세서 NOTICE-01)에 `attachments: file[]` 필드가 명시되어 있으나, 파일 저장소 백엔드(S3/Railway Volumes/Supabase Storage 등) 결정이 선행되어야 하므로 별도 ADR/SPEC으로 이연한다. 본 SPEC의 API 요청/응답 스키마에는 attachments 필드가 존재하지 않는다. `@MX:TODO: 첨부파일 별도 SPEC`으로 연결 지점 표시.
2. **NOTICE-06 공지 상단 고정 (is_pinned API 동작, P1)** — `notices.is_pinned` 컬럼은 ERD 전방 호환성을 위해 존재하며 디폴트 false로 저장된다. 단, 본 SPEC은 is_pinned에 대한 어떠한 API 동작(등록/수정 시 is_pinned 설정, 목록 조회 시 pinned 우선 정렬)도 노출하지 않는다. 상단 고정 기능은 P1 별도 SPEC에서 구현한다. `@MX:TODO: NOTICE-06 상단 고정 P1 별도 SPEC`으로 표시.
3. **NOTICE-07 공지 카테고리 동적 관리 (P1)** — 카테고리 추가/수정/삭제 CRUD. 본 SPEC은 4종(일반/긴급/주차/시설) 고정 시드값으로 취급한다. `@MX:TODO: NOTICE-07 카테고리 CRUD P1 별도 SPEC`으로 표시.
4. **공지 조회수 추적/통계** — 본 SPEC 범위 아님.
5. **공지 검색(전문 검색)** — 제목/내용 키워드 검색은 본 SPEC 범위 아님. `category_id` 필터만 지원.
6. **공지 알림(푸시/이메일, P2)** — 공지 등록 시 입주민 알림 발송은 P2.
7. **소프트 삭제(soft delete)** — 공지 삭제는 영구 삭제(hard delete). 기획서(기능명세서/PRD)에 명시된 바에 따름. 소프트 삭제(archived 컬럼)는 건의(SUGGEST) 도메인 정책이며 공지에는 적용하지 않는다.
8. **공지 수정 이력 추적** — 이전 버전 보존 없음. 갱신 시 덮어쓰기.
9. **공지(SUGGEST/PARKING) 도메인** — 별도 SPEC.

---

## 6. 비기능 요구사항 (제약)

### 6.1 보안 (Security)

- **RBAC**: NOTICE 쓰기 API(POST/PUT/DELETE)는 서버 사이드 JWT 검증 + ADMIN role 체크 필수(`requireAdmin` 재사용). NOTICE 읽기 API(GET)는 인증 사용자 전용(역할 무관). 클라이언트 단독 신뢰 금지(AUTH/SETUP 패턴 동일).
- **SQL Injection 방어**: 모든 DB 쿼리는 Parameterized Query(`query` 함수). 문자열 결합 쿼리 금지.
- **입력 유효성 검증**: 서버 사이드 zod 스키마 필수. title `VARCHAR(100)` (1~100자), content `TEXT` (1~10000자, 기능명세서 NOTICE-01 명시), category_id UUID 형식, path param UUID 형식 검증(`UUID_RE` 패턴 재사용).
- **개인정보 최소화**: 공지 목록/상세 응답에 작성자 email/password_hash 미포함. author_id(UUID)만 노출.

### 6.2 성능 (Performance)

- 모든 NOTICE API 응답 시간: P95 500ms 이하 (PRD §5-1).
- 공지 목록 조회 페이지네이션: 기본 limit 20, 최대 100. `OFFSET`/`LIMIT` 기반.
- `created_at DESC` 인덱스 활용(ERD 명시).

### 6.3 가용성 (Availability)

- 단일 PostgreSQL 인스턴스 의존(Railway Managed DB, AUTH/SETUP과 공유).
- migration 006은 migration 005 이후 순차 적용. idempotent 하지 않으므로 한 번만 실행.

### 6.4 감사 (Auditability)

- 공지 등록/수정/삭제 이벤트는 애플리케이션 로그로 기록(단, PII는 로그에서 제외).
- 권한 오용 시도(비-ADMIN 쓰기 시도)는 경고 로그로 기록 권장(SETUP 동일 패턴 — 본 SPEC에서 로깅 구현은 필수 아님).

---

## 7. MX Tag Plan (코드 주석 계획)

Run Phase에서 다음 @MX 태그를 적용한다:

### @MX:ANCHOR (fan_in >= 3 또는 공개 API 경계)

- `notices` CRUD route handlers — 다수 클라이언트(관리사무소 화면, 입주민 공지 목록/상세 화면)에서 호출
- migration 006 스키마 불변 지점 — notices/notice_categories 테이블 정의

### @MX:WARN with @MX:REASON (위험 영역)

- 공지 영구 삭제(hard delete) — `@MX:REASON: 소프트 삭제 아님, 삭제 시 복구 불가. 기획서(기능명세서/PRD) 명시에 따른 결정`
- ADMIN RBAC 검사 — `@MX:REASON: 권한 우회 시 비-ADMIN 공지 변조 가능, requireAdmin 불변 계약`

### @MX:NOTE (도메인 의도 전달)

- `notices.is_pinned` 컬럼 — `@MX:NOTE: ERD 전방 호환성을 위해 존재, 본 SPEC은 API 동작 미노출(NOTICE-06 P1 별도 SPEC). 디폴트 false`
- `notice_categories` 시드 — `@MX:NOTE: 4종(일반/긴급/주차/시설) 고정 시드, 동적 CRUD는 NOTICE-07 P1 별도 SPEC`
- 첨부파일 제외 — `@MX:NOTE: attachments 본 SPEC 범위 외, 파일 저장소 백엔드 결정 후 별도 SPEC`

### @MX:TODO (후속 SPEC 연결 지점)

- NOTICE-06 상단 고정 — `@MX:TODO: P1 별도 SPEC, is_pinned API 동작 + 목록 우선 정렬`
- NOTICE-07 카테고리 CRUD — `@MX:TODO: P1 별도 SPEC, notice_categories 동적 관리`
- 첨부파일 — `@MX:TODO: 별도 ADR/SPEC, 파일 저장소 백엔드 결정 후`

---

## 8. 검증 기준 요약

상세 Given/When/Then 시나리오는 `acceptance.md`를 참조. 각 모듈당 최소 2개 시나리오, 총 18개 REQ-NOTICE-XXX 요구사항(001~018, a/b 서브 ID 포함)에 대한 검증 케이스를 정의한다. M6(notice_categories 시드 + notices 마이그레이션)은 migration 검증 테스트로 별도 검증한다.

---

## 9. 참조 문서

- `research.md` (본 디렉토리): NOTICE 도메인 기획 발췌 + 의사결정 근거
- `plan.md` (본 디렉토리): TDD 구현 계획, 파일 목록, migration 006
- `acceptance.md` (본 디렉토리): 검증 시나리오, 품질 게이트 기준
- `.moai/specs/SPEC-AUTH-001/spec.md`: AUTH 도메인 스펙(의존 SPEC, verifyAccessToken/JWT 인증)
- `.moai/specs/SPEC-SETUP-001/spec.md`: SETUP 도메인 스펙(의존 SPEC, rbac.ts requireAdmin/응답 빌더)
- 기획 문서(외부): `apt_02_PRD.md` §4-3 공지, §5 비기능; `apt_03_기능명세서.md` §3 공지(NOTICE-01 title 100자/content 10000자 명시); `apt_04_유저플로우.md` flow 3 공지 열람; `apt_05_ERD.md` notices/notice_categories 테이블; `apt_06_API명세서.md` §3 공지 엔드포인트

---

*본 SPEC의 NOTICE routes는 greenfield(미구현)이므로 Delta 마커 없이 작성되었다. 단, migration 006(notices/notice_categories 생성)은 기존 DB에 신규 테이블을 추가하며 AUTH/SETUP 스키마에 영향을 주지 않는다(독립 테이블).*

---

## Implementation Notes

**구현 완료일**: 2026-06-22
**상태**: ✅ 완료 (P0), develop 브랜치에 병합됨 (커밋 84b5923)
**테스트 커버리지**: 333/333 통과 (NOTICE route 93.45%)

### 생성 파일

| 파일 | 모듈 | 목적 |
|------|------|------|
| `migrations/006_notices.sql` | M6 | notice_categories 시드(일반/긴급/주차/시설) + notices 테이블 스키마 |
| `src/app/api/notices/route.ts` | M1/M4 | GET 목록(인증 사용자, 필터+페이지네이션) + POST 등록(ADMIN) |
| `src/app/api/notices/[id]/route.ts` | M2/M3/M5 | GET 상세(인증 사용자) + PUT 수정(ADMIN) + DELETE 삭제(ADMIN) |
| `src/lib/migration-006.test.ts` | M6 | migration 006 검증 (11 tests) |
| `src/app/api/notices/route.test.ts` | M1/M4 | 목록/등록 검증 (16 tests) |
| `src/app/api/notices/[id]/route.test.ts` | M2/M3/M5 | 상세/수정/삭제 검증 (16 tests) |

### 수정 파일

| 파일 | 수정 내용 |
|------|-----------|
| 없음 | 독립 테이블로 AUTH/SETUP 스키마 무영향 |

### 핵심 구현 결정

1. **route-level Bearer 강제** (REQ-NOTICE-013a, 016a): middleware.ts는 AT 쿠키(Edge/jose)만 검사하고 Authorization 헤더를 검사하지 않는다. GET 핸들러 내부에서 requireAuth() 함수로 verifyAccessToken 직접 호출 (AUTH verify-unit 패턴 일관, AC-NOTICE-018, AC-NOTICE-022).
2. **목록 content 구조적 배제** (REQ-NOTICE-012): GET /api/notices 응답의 각 공지 항목에 content 필드 미포함. 상세 GET에서만 content 반환.
3. **category_id FK 사전 차단** (REQ-NOTICE-002, REQ-NOTICE-006): 등록/수정 시 notice_categories 테이블에서 category_id 존재 확인 후 미존재 시 422 반환 (FK 에러 사전 방지).
4. **UUID path 검증** (EC-NOTICE-003): [id] path param에 UUID_REGEX 정규식 검증, 불일치 시 400 Bad Request 반환 (zod z.string().uuid() deprecated 패턴 일관).
5. **is_pinned 전방 호환성** (REQ-NOTICE-018, Exclusions #2): notices 테이블에 is_pinned 컬럼 존재(디폴트 false), 본 SPEC은 API 동작 미노출(NOTICE-06 P1 별도 SPEC). 등록/수정 시 본문 값 무시.
6. **영구 삭제(hard delete)** (REQ-NOTICE-008, Exclusions #7): DELETE FROM으로 영구 삭제. 기획서(기능명세서/PRD) 명시 정책. 소프트 삭제/archived 컬럼 없음.

### 알려진 제한사항

1. **첨부파일(attachments) 미구현**: 본 SPEC 범위 완전 제외 — 파일 저장소 백엔드(S3/Railway Volumes/Supabase Storage 등) 결정 후 별도 ADR/SPEC 필요 (Exclusions #1).
2. **NOTICE-06 상단 고정 미구현**: is_pinned 컬럼 존재(디폴트 false), API 동작(등록/수정 시 설정, 목록 pinned 우선 정렬) 없음 — P1 별도 SPEC 필요 (Exclusions #2).
3. **NOTICE-07 카테고리 동적 CRUD 미구현**: 4종(일반/긴급/주차/시설) 고정 시드, name UNIQUE로 멱등성 보장. 동적 카테고리 추가/수정/ 삭제는 P1 별도 SPEC 필요 (Exclusions #3).
4. **notices.author_id FK ON DELETE 미정의**: ADMIN 강제 탈퇴(AUTH deactivate) 시 author_id FK 위반 가능성 — 38세대 소규모로 본 범위 외, 후속 ADR 필요 (progress.md Known limitations 참조).

### 품질 검증 결과

- **테스트**: 333/333 통과 (기존 290 + 신규 43: migration 11, 목록/등록 16, 상세/수정/삭제 16)
- **타입**: `tsc --noEmit` 0 에러
- **린트**: ESLint 0 경고
- **보안**: OWASP CLEAN (manager-quality 합의, RBAC/SQL Injection/UUID 검증/Parameterized Query 전부 코드 레벨 확인)
- **커버리지**: NOTICE route 93.45% lines (임계 85% 충족)

### 의존성

- **SPEC-AUTH-001 P0**: `users` 스키마(FK author_id) 및 `src/lib` (db.ts query, auth.ts verifyAccessToken) 재사용
- **SPEC-SETUP-001 P0**: RBAC 헬퍼(rbac.ts requireAdmin, 응답 빌더 unauthorized/badRequest/notFound/validationError) 재사용

