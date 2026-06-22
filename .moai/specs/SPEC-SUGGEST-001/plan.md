# SPEC-SUGGEST-001 Implementation Plan

건의/문의(등록/수정/아카이브/열람/답변/상태/호수이력) 도메인의 TDD 구현 계획. `spec.md`의 8개 모듈(M1~M8)과 40개 REQ-SUGGEST-XXX 요구사항(001~040, a/b 서브 ID 포함)을 RED-GREEN-REFACTOR 주기로 구현한다.

---

## 1. 구현 순서 (TDD Phase Decomposition)

구현 순서는 의존성 그래프 기반: 스키마(M8b) → 등록+목록(M1/M4) → 상세(M5) → 수정(M2) → 아카이브(M3) → 답변(M6) → 상태전이(M7) → 호수이력(M8a).

### Phase A: suggestion_categories 시드 + suggestions ALTER + suggestion_replies 마이그레이션 (M8b, brownfield)

**범위**: 기존 004 suggestions 테이블 ALTER 확장 + 신규 테이블 2종 생성. migration 006(NOTICE) 이후 순차 적용.

**파일**:
- `migrations/007_suggestions_expand.sql` (신규)

**내용 (WHAT)**:
```sql
-- suggestion_categories: 4종 고정 시드 (NOTICE 006 패턴 준거)
CREATE TABLE IF NOT EXISTS suggestion_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(30) NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO suggestion_categories (name, sort_order) VALUES
  ('시설', 1),
  ('주차', 2),
  ('소음', 3),
  ('기타', 4)
ON CONFLICT (name) DO NOTHING;

-- @MX:NOTE: [AUTO] suggestions ALTER — 기존 004(AUTH 사이드이펙트 최소 스키마) 확장.
--           기존 컬럼(id, author_id, author_label, archived, unit_id, created_at) 보존 필수.
--           AUTH deactivate route 호환성 유지.
ALTER TABLE suggestions
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES suggestion_categories(id),
  ADD COLUMN IF NOT EXISTS title VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT '접수',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_suggestions_category_id ON suggestions(category_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_is_public   ON suggestions(is_public);
CREATE INDEX IF NOT EXISTS idx_suggestions_status      ON suggestions(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_archived    ON suggestions(archived);

-- suggestion_replies: 신규 (ERD 준거)
CREATE TABLE IF NOT EXISTS suggestion_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id UUID NOT NULL REFERENCES suggestions(id),
  author_id UUID NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_suggestion_replies_suggestion_id
  ON suggestion_replies(suggestion_id);
```

**TDD 주기**:
- RED: `src/lib/migration-007.test.ts` 작성 (기존 5+1 migration 테스트 파일명 규칙 준거 — `src/lib/migration-00X.test.ts`, `migration-test-helpers.ts` 재사용). `beforeAll`에서 (1) suggestion_replies/suggestion_categories/suggestions 로컬 DROP, (2) `dropAllAuthTables` + `dropAllNoticeTables` 호출, (3) 001→007 순차 `applySql(readMigration(...))` 적용. 어설션: suggestion_categories 4종 시드 행 존재 / suggestions 컬럼 13종 존장(004 기존 6종 + 007 추가 7종, assertColumnsExist) / 인덱스 존재 / FK 존재 / suggestion_replies 컬럼 존재 / **기존 004 데이터 보존 검증**(001→004 적용 후 suggestions 행 INSERT → 007 적용 → 행 잔존 및 신규 컬럼 디폴트값 확인). → 실패
- GREEN: `migrations/007_suggestions_expand.sql` 적용 → 통과
- REFACTOR: 불필요(단일 DDL + ALTER)

**주의 (idempotency)**: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 사용으로 멱등성 보장. `suggestion_categories.name UNIQUE` + `ON CONFLICT (name) DO NOTHING`으로 시드 멱등성 보장(NOTICE 006 패턴 동일).

**주의 (AUTH 호환성)**: 기존 004의 `author_id NULL`, `author_label DEFAULT '입주민'`, `archived DEFAULT false`, `unit_id NOT NULL` 제약은 유지. AUTH deactivate route가 갱신하는 컬럼(author_id, author_label, archived)은 본 SPEC이 건드리지 않음.

---

### Phase B: 건의 등록 + 목록 열람 (M1, M4, greenfield)

**범위**: SUGGEST-01 등록(POST RESIDENT 이상, ADMIN 403) + SUGGEST-05~08 목록(GET 인증, 역할별 분기).

**파일**:
- `src/app/api/suggestions/route.ts` (신규 — `GET` 인증 + `POST` RESIDENT 이상)
- `src/app/api/suggestions/route.test.ts` (신규)
- `src/lib/rbac.ts` (수정 — `requireAuthenticated` 헬퍼 추가, {callerId, callerRole, managedBuildingId} 반환)

**구현 디테일**:
- `GET /api/suggestions`: **route-level Bearer 인증 필수** (NOTICE GET 패턴 준거, `verify-unit/route.ts:46-63`). `requireAuthenticated` 호출 → {callerId, callerRole, managedBuildingId} 획득. 역할별 WHERE 절 분기:
  - RESIDENT/AUDITOR: `is_public=true OR author_id=$callerId`
  - REP: `is_public=true OR author_id=$callerId OR (is_public=false AND unit.building_id=$managedBuildingId)`
  - CHAIR/ADMIN: 조건 없음(전체)
  - 쿼리 필터(`is_public`, `status`, `category_id`, `unit_id` optional, `page` 기본 1, `limit` 기본 20 최대 100). `suggestion_categories` JOIN으로 category명, `units`+`buildings` JOIN으로 building명/unit_number 반환. `created_at DESC` 정렬. 응답에 content 미포함(REQ-SUGGEST-019). 총 total과 함께 반환.
- `POST /api/suggestions`: `requireAuthenticated` 호출 → 역할 확인. **ADMIN인 경우 403**(REQ-SUGGEST-002). `users.unit_id` NULL 확인(미인증 사용자, REQ-SUGGEST-005 → 403). zod 검증(`title: string 1~100자`, `content: string 1~5000자`, `category_id: uuid 형식`, `is_public: boolean`). category_id 존재 확인(없으면 422, REQ-SUGGEST-003). `author_id` = callerId, `unit_id` = users.unit_id, `author_label` = '입주민', `status` = '접수', `archived` = false. 201 응답.

**TDD 주기** (REQ-SUGGEST-001~005, 018~022):
- RED: 등록 201 / ADMIN 등록 403 / 미존재 category_id 422 / 미인증 401 / 미인증 사용자(unit_id NULL) 403 / 목록 200(역할별 필터링: RESIDENT 공개+본인비공개, REP 담당동, CHAIR/ADMIN 전체) / 목록 content 미포함 / 목록 미인증 401 테스트 작성 → 실패
- GREEN: route handler 구현 → 통과
- REFACTOR: 역할 분기 로직 가독성 정리

---

### Phase C: 건의 상세 열람 (M5, greenfield)

**범위**: SUGGEST-12 상세(GET 인증, 권한 검사).

**파일**:
- `src/app/api/suggestions/[id]/route.ts` (신규 — `GET` 인증, Phase D/E에서 PUT/DELETE 추가)
- `src/app/api/suggestions/[id]/route.test.ts` (신규)

**구현 디테일**:
- `GET /api/suggestions/[id]`: **route-level Bearer 인증 필수**. UUID path param 검증(로컬 `const UUID_REGEX`, NOTICE 패턴). 불일치 시 400. 건의 조회 → 미존재 시 404(REQ-SUGGEST-025). 권한 검사: 공개(is_public=true)는 모든 인증 사용자 허용; 비공개 시 REQ-SUGGEST-021/022 역할 분기 적용 → 무권한 시 **403**(REQ-SUGGEST-024, 404 아님 — 존재 누출 방지). 응답에 id, title, content, category명, is_public, status, author_label, building, unit, author_id(아카이브 시 NULL), created_at, updated_at, archived_at(아카이브 시) 포함.

**TDD 주기** (REQ-SUGGEST-023~026):
- RED: 상세 200 / 비공개 무권한 403 / 미존재 404 / 상세 미인증 401 테스트 작성 → 실패
- GREEN: route handler 구현 → 통과
- REFACTOR: 권한 검사 로직 가독성 정리

---

### Phase D: 건의 수정 (M2, greenfield)

**범위**: SUGGEST-02 수정(PUT 작성자 본인).

**파일**:
- `src/app/api/suggestions/[id]/route.ts` (수정 — `PUT` 작성자 본인 추가)
- `src/app/api/suggestions/[id]/route.test.ts` (수정 — PUT 테스트 추가)

**구현 디테일**:
- `PUT /api/suggestions/[id]`: `requireAuthenticated`. UUID 검증. 건의 조회 → 미존재 시 404(REQ-SUGGEST-009). **작성자 본인 확인**(author_id == callerId) → 아니면 403(REQ-SUGGEST-007, ADMIN 포함). **archived=true 또는 status='완료' 확인** → 해당 시 409(REQ-SUGGEST-008). zod 검증(`title`, `content`, `category_id`, `is_public`). category_id 존재 확인(없으면 422, REQ-SUGGEST-010). `updated_at` 자동 갱신. 200 응답.

**TDD 주기** (REQ-SUGGEST-006~011):
- RED: 수정 200 / 타인 수정 403 / archived 수정 409 / 완료 수정 409 / 미존재 404 / 미존재 category_id 422 / 수정 미인증 401 테스트 작성 → 실패
- GREEN: PUT handler 추가 → 통과
- REFACTOR: 없음

---

### Phase E: 건의 아카이브 (M3, greenfield)

**범위**: SUGGEST-03/04 아카이브(DELETE 작성자 본인 OR ADMIN).

**파일**:
- `src/app/api/suggestions/[id]/route.ts` (수정 — `DELETE` 작성자/ADMIN 추가)
- `src/app/api/suggestions/[id]/route.test.ts` (수정 — DELETE 테스트 추가)

**구현 디테일**:
- `DELETE /api/suggestions/[id]`: `requireAuthenticated`. UUID 검증. 건의 조회 → 미존재 시 404(REQ-SUGGEST-016). 권한 확인: 작성자 본인(author_id == callerId) OR ADMIN → 아니면 403(REQ-SUGGEST-014). **이미 archived=true 확인** → 409(REQ-SUGGEST-015, 멱등성). 아카이브 전환:
  ```sql
  UPDATE suggestions
  SET archived=true, author_id=NULL, author_label='전 입주민', archived_at=now()
  WHERE id=$1
  ```
  `unit_id`는 건드리지 않음(ADR-005 영구 보존). 200 응답. `@MX:WARN: DELETE = archive semantics, NOT row deletion. ADR-005 호수 귀속`.

**TDD 주기** (REQ-SUGGEST-012~017):
- RED: 작성자 아카이브 200 + 익명화 확인(author_id NULL, author_label '전 입주민', unit_id 보존) / ADMIN 아카이브 200 / 타인 아카이브 403 / 이미 아카이브 409 / 미존재 404 / 아카이브 미인증 401 테스트 작성 → 실패
- GREEN: DELETE handler 추가 → 통과
- REFACTOR: 없음

---

### Phase F: 건의 답변 등록 (M6, greenfield)

**범위**: SUGGEST-10 답변 등록(POST ADMIN).

**파일**:
- `src/app/api/suggestions/[id]/replies/route.ts` (신규 — `POST` ADMIN)
- `src/app/api/suggestions/[id]/replies/route.test.ts` (신규)

**구현 디테일**:
- `POST /api/suggestions/[id]/replies`: `requireAdmin`. UUID 검증. 건의 존재 확인(없으면 404, REQ-SUGGEST-028). zod 검증(`content: string 1~N자`, 최대 길이는 매니저 판단 — 5000자 권장). `suggestion_replies` INSERT. 201 응답.

**TDD 주기** (REQ-SUGGEST-027~029b):
- RED: 답변 등록 201 / 미존재 건의 404 / 미인증 401 / 비-ADMIN 403 테스트 작성 → 실패
- GREEN: route handler 구현 → 통과
- REFACTOR: 없음

---

### Phase G: 처리 상태 변경 (M7, greenfield)

**범위**: SUGGEST-11 상태 변경(PUT ADMIN, 전이 검증).

**파일**:
- `src/app/api/suggestions/[id]/status/route.ts` (신규 — `PUT` ADMIN)
- `src/app/api/suggestions/[id]/status/route.test.ts` (신규)

**구현 디테일**:
- `PUT /api/suggestions/[id]/status`: `requireAdmin`. UUID 검증. 건의 존재 확인(없으면 404, REQ-SUGGEST-033). zod 검증(`status: enum('접수','처리중','완료','보류')`, `reason: string optional`). 현재 status 조회 → 전이 규칙(REQ-SUGGEST-031) 검증 → 위반 시 409(REQ-SUGGEST-032, 현재/요청 상태 응답 포함). 허용 전이 시 `suggestions.status` 갱신, `updated_at` 갱신. reason 제공된 경우 로그 기록. 200 응답.

**전이 규칙 맵** (구현 디테일):
```typescript
const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  '접수':   new Set(['처리중', '보류']),
  '처리중': new Set(['완료', '보류']),
  '보류':   new Set(['처리중', '접수']),
  '완료':   new Set(['접수']),  // 재오픈
};
```

**TDD 주기** (REQ-SUGGEST-030~034b):
- RED: 상태 변경 200(접수→처리중) / 불가능 전이 409(접수→완료) / 재오픈 200(완료→접수) / 보류 200(처리중→보류) / 미존재 404 / 미인증 401 / 비-ADMIN 403 테스트 작성 → 실패
- GREEN: route handler 구현 → 통과
- REFACTOR: 전이 규칙 맵 가독성 정리

---

### Phase H: 호수별 건의 이력 조회 (M8a, greenfield)

**범위**: SUGGEST-09 호수별 이력(GET ADMIN/CHAIR).

**파일**:
- `src/app/api/suggestions/units/[building]/[unit]/route.ts` (신규 — `GET` ADMIN/CHAIR)
- `src/app/api/suggestions/units/[building]/[unit]/route.test.ts` (신규)

**구현 디테일**:
- `GET /api/suggestions/units/[building]/[unit]`: `requirePrivileged(['ADMIN', 'CHAIR'])`. path param: `[building]` = building_id(UUID), `[unit]` = unit_number(String). UUID 검증(building_id). `units` JOIN `buildings`로 unit_id 해석(`WHERE b.id=$buildingId AND u.unit_number=$unitNumber`) → 미존재 시 404(REQ-SUGGEST-036). 해당 unit_id의 모든 건의(archived 포함, 비공개 포함)를 `created_at ASC` 시간순 정렬. 응답에 id, title, category명, is_public, status, author_label, created_at, archived, archived_at 포함. 총 total과 함께 반환.

**TDD 주기** (REQ-SUGGEST-035~037b):
- RED: ADMIN 호수별 이력 200(아카이브 포함, 시간순) / CHAIR 200 / 미존재 building/unit 404 / 미인증 401 / 비-ADMIN/비-CHAIR 403 테스트 작성 → 실패
- GREEN: route handler 구현 → 통과
- REFACTOR: 없음

---

### Phase V: 최종 검증 + develop 머지 준비

**범위**: 전체 AC 통과, TRUST 5 게이트, AUTH/SETUP/NOTICE 회귀 없음 확인.

---

## 2. 파일 목록 요약

### 신규 파일 (greenfield)

| 파일 | 모듈 | 설명 |
|------|------|------|
| `migrations/007_suggestions_expand.sql` | M8b | suggestion_categories(시드, name UNIQUE) + suggestions ALTER(컬럼 7종, IF NOT EXISTS) + suggestion_replies 테이블 + 인덱스 |
| `src/app/api/suggestions/route.ts` | M1/M4 | GET 인증(목록, 역할별 분기, route-level Bearer), POST RESIDENT 이상(등록, ADMIN 403) |
| `src/app/api/suggestions/[id]/route.ts` | M2/M3/M5 | GET 인증(상세, 권한 검사, 비공개 403), PUT 작성자(수정, archived/완료 409), DELETE 작성자/ADMIN(아카이브, 익명화) |
| `src/app/api/suggestions/[id]/replies/route.ts` | M6 | POST ADMIN(답변 등록) |
| `src/app/api/suggestions/[id]/status/route.ts` | M7 | PUT ADMIN(상태 변경, 전이 검증, 409) |
| `src/app/api/suggestions/units/[building]/[unit]/route.ts` | M8a | GET ADMIN/CHAIR(호수별 이력, 아카이브 포함 시간순) |
| `src/app/api/suggestions/route.test.ts` | M1/M4 | 테스트 |
| `src/app/api/suggestions/[id]/route.test.ts` | M2/M3/M5 | 테스트 |
| `src/app/api/suggestions/[id]/replies/route.test.ts` | M6 | 테스트 |
| `src/app/api/suggestions/[id]/status/route.test.ts` | M7 | 테스트 |
| `src/app/api/suggestions/units/[building]/[unit]/route.test.ts` | M8a | 테스트 |
| `src/lib/migration-007.test.ts` | M8b | migration 007 검증 테스트 (기존 `src/lib/migration-00X.test.ts` 규칙 준거, `migration-test-helpers.ts` 재사용, **004 데이터 보존 검증 포함**) |

### 수정 파일

| 파일 | 수정 내용 |
|------|-----------|
| `src/lib/rbac.ts` | `requireAuthenticated` 헬퍼 추가 — {callerId, callerRole, managedBuildingId} 반환. 기존 requireAdmin/requirePrivileged 패턴 준거, Bearer→verify→ACTIVE 흐름 동일. SUGGEST 역할 분기(M4/M5)용. 단, `managed_building_id`는 REP만 보유(비-REP는 undefined). |

### 재사용 파일 (AUTH/SETUP/NOTICE 소유, 수정 없음)

- `src/lib/db.ts` (`query`)
- `src/lib/auth.ts` (`verifyAccessToken`)
- `src/lib/rbac.ts` (`requireAdmin`, `requirePrivileged`, `unauthorized`, `forbidden`, `badRequest`, `notFound`, `conflict`, `validationError`)
- `src/middleware.ts` (수정 불필요 — `/api/suggestions`는 기존 matcher로 인증 적용, 공개 엔드포인트 아님)
- UUID 검증 idiom — 각 라우트가 로컬 `const UUID_REGEX = /^[0-9a-f]{8}-...$/i` 정의 (NOTICE/SETUP 패턴). `z.string().uuid()` 사용 금지 (zod 4 deprecated).

---

## 3. 리스크 및 완화 방안

| 리스크 | 설명 | 완화 방안 |
|--------|------|-----------|
| **ALTER 중 데이터 손실** | 기존 004 suggestions 데이터가 ALTER 중 손실 | `ADD COLUMN IF NOT EXISTS` 사용, 기존 컬럼/데이터 보존. migration-007.test.ts에서 004 데이터 보존 검증(Phase A RED) |
| **AUTH deactivate 호환성 깨짐** | AUTH route가 갱신하는 author_id/author_label/archived 컬럼이 ALTER 후에도 존재/동작해야 | 기존 004 컬럼 보존(ALTER ADD만), AUTH deactivate route는 신규 컬럼(title/content/is_public/status/updated_at/archived_at)을 건드리지 않음. AUTH 회귀 테스트(REQ-AUTH-014 deactivate) 통과 확인 |
| **역할 분기 쿼리 복잡도** | REP 담당 동 분기(managed_building_id JOIN) 쿼리가 복잡, 성능/정확성 위험 | Parameterized Query, 인덱스(is_public, unit_id, author_id) 활용. 38세대 소규모 → 병목 아님. 역할별 테스트 케이스(RESIDENT/REP/CHAIR/ADMIN)로 검증 |
| **비공개 403 vs 404 누출** | 무권한 비공개 건의 접근 시 404 반환하면 존재 여부 누출 | REQ-SUGGEST-024: 비공개 무권한 시 403(404 아님). 단, 미존재 건의는 404. 순서: 존재 확인(404) → 권한 확인(403) |
| **상태 전이 검증 누락** | 접수→완료 스킵 등 불허 전이가 통과되면 데이터 무결성 위반 | REQ-SUGGEST-031 전이 규칙 맵으로 화이트리스트 검증. 위반 시 409. 테스트 케이스로 모든 불허 전이 검증 |
| **아카이브 익명화 누락** | DELETE 시 author_id=NULL 갱신 누락 시 개인정보 보호 위반 | `@MX:WARN` 명시, 단일 UPDATE 문으로 원자 갱신. 테스트 케이스로 author_id NULL + author_label '전 입주민' + unit_id 보존 확인 |
| **이미 아카이브된 건의 재아카이브** | 중복 DELETE 시 중복 익명화 또는 에러 | REQ-SUGGEST-015: archived=true 확인 후 409 반환(멱등성) |
| **content 5000자 제한 (NOTICE 10000자와 상이)** | NOTICE 패턴 복사 시 10000자로 잘못 설정 | zod `string().max(5000)` — SUGGEST는 5000자(apt_03 SUGGEST-01 명시). NOTICE 10000자와 혼동 주의 |
| **ADMIN 건의 등록 403** | ADMIN이 등록 시도 시 403 (apt_08 §7) — PRD "RESIDENT 이상"과 충돌 | REQ-SUGGEST-002: ADMIN 403 명시. research.md 모호점 #1 해결 근거 문서화 |
| **middleware vs route-level 401** | middleware.ts는 AT 쿠키만 검사, Bearer 미검사. API 통합 테스트는 Bearer 사용 → middleware만으로 401 미발생 | 모든 SUGGET route handler 내부에서 route-level Bearer 인증 강제(NOTICE GET 패턴, `verify-unit/route.ts:46-63`). `requireAuthenticated`/`requireAdmin`/`requirePrivileged` 헬퍼가 Bearer 추출+verify 수행 |
| **migration 007 멱등성** | 재실행 시 중복 컬럼/인덱스 에러 | `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS` 사용. suggestion_categories.name UNIQUE + ON CONFLICT DO NOTHING |
| **suggestion_replies 답변 수정/삭제 미구현** | 본 SPEC은 등록만, 수정/삭제 OUT | Exclusions #5 명시, `@MX:TODO: 답변 수정/삭제 별도 SPEC` |

---

## 4. MX Tag 적용 계획

`spec.md` §7에 명시된 MX Tag Plan을 Run Phase에서 적용:

- `@MX:ANCHOR`: suggestions CRUD route handlers, migration 007 스키마 불변 지점, rbac.ts requireAuthenticated 헬퍼
- `@MX:WARN + @MX:REASON`: DELETE = archive semantics(ADR-005), 역할별 비공개 필터링, 상태 전이 검증, 비공개 403(404 아님)
- `@MX:NOTE`: suggestions ALTER 기반 마이그레이션(004 보존), suggestion_categories 시드, unit_id NOT NULL(ADR-005), ADMIN 등록 권한 없음
- `@MX:TODO`: SUGGEST-13 카테고리 CRUD, 첨부파일, 답변 수정/삭제

---

## 5. 검증 게이트 (Quality Gates)

- **TRUST 5**: Tested(85%+ 커버리지), Readable(한국어 도메인 용어 주석), Unified(AUTH/SETUP/NOTICE 패턴 일관), Secured(RBAC + 역할 분기 + zod + Parameterized Query + ADR-005 호수 귀속), Trackable(SPEC-SUGGEST-001 참조 커밋)
- **LSP 게이트**: run 단계 — TypeScript 에러 0, ESLint 에러 0
- **테스트 커버리지**: 신규 route handlers 85% 이상
- **AUTH/SETUP/NOTICE 회귀**: 기존 333 테스트 통과 유지(AUTH deactivate 사이드이펙트 포함)

---

## 6. Definition of Done

- [ ] M8b 마이그레이션: REQ-SUGGEST-038, 039, 040 구현 + migration 007 테스트 통과(004 데이터 보존 검증 포함)
- [ ] M1 건의 등록: REQ-SUGGEST-001~005 구현 + 테스트 통과(ADMIN 403 포함)
- [ ] M2 건의 수정: REQ-SUGGEST-006~011 구현 + 테스트 통과(archived/완료 409 포함)
- [ ] M3 건의 아카이브: REQ-SUGGEST-012~017 구현 + 테스트 통과(익명화, unit_id 보존)
- [ ] M4 건의 목록: REQ-SUGGEST-018~022 구현 + 테스트 통과(역할별 분기: RESIDENT/REP/CHAIR/ADMIN)
- [ ] M5 건의 상세: REQ-SUGGEST-023~026 구현 + 테스트 통과(비공개 403)
- [ ] M6 건의 답변: REQ-SUGGEST-027~029b 구현 + 테스트 통과
- [ ] M7 상태 변경: REQ-SUGGEST-030~034b 구현 + 테스트 통과(전이 규칙 409)
- [ ] M8a 호수별 이력: REQ-SUGGEST-035~037b 구현 + 테스트 통과
- [ ] 첨부파일 / 카테고리 CRUD / 영구 삭제 / 답변 수정·삭제 미구현 확인(Exclusions 준수)
- [ ] MX 태그 적용(ANCHOR/WARN+REASON/NOTE/TODO)
- [ ] TRUST 5 게이트 통과
- [ ] AUTH/SETUP/NOTICE 회귀 없음(기존 333 테스트 통과)

---

*본 plan.md는 구현 디테일(함수명/쿼리 구조)을 포함하나, 이는 Run Phase(manager-tdd)의 구현 가이드이며 spec.md의 WHAT/WHY에 대한 HOW를 정의한다.*
