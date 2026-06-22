---
spec_id: SPEC-SUGGEST-001
title: 건의/문의 (등록/수정/아카이브/열람/답변/상태/호수이력)
phase: research
status: draft
created: 2026-06-22
author: manager-spec
depends_on:
  - SPEC-AUTH-001
  - SPEC-SETUP-001
  - SPEC-NOTICE-001
source_docs:
  - apt_02_PRD.md
  - apt_03_기능명세서.md
  - apt_04_유저플로우.md
  - apt_05_ERD.md
  - apt_06_API명세서.md
  - apt_08_보안설계.md
  - apt_09_ADR.md
---

# SPEC-SUGGEST-001 Deep Research — 건의/문의 (등록/수정/아카이브/열람/답변/상태/호수이력)

본 문서는 7개 기획 문서와 AUTH/SETUP/NOTICE P0 구현 산출물에서 SUGGEST 도메인(건의 등록/수정/아카이브/열람/답변/상태/호수이력)에 관련된 모든 사실을 추출한 연구 결과입니다. SPEC 작성의 기반이 되며, 구현 디테일(함수명/클래스 구조/API 스키마)은 포함하지 않습니다 — "무엇(WHAT)/왜(WHY)"에 집중합니다.

---

## 1. SUGGEST 요구사항 요약 (SUGGEST-01 ~ SUGGEST-13)

| ID | 기능 | 우선순위 | 대상 역할 | 핵심 설명 | 본 SPEC |
|----|------|:--------:|-----------|-----------|---------|
| SUGGEST-01 | 건의 등록 (공개/비공개 선택) | **P0** | RESIDENT 이상(ADMIN ❌) | 제목·내용·카테고리·공개여부 | In-Scope |
| SUGGEST-02 | 건의 수정 | **P0** | 작성자 본인 | archived/완료 상태 수정 불가 | In-Scope |
| SUGGEST-03 | 건의 아카이브 처리 (작성자) | **P0** | 작성자 본인 | archived=true, 익명화, unit_id 보존 | In-Scope |
| SUGGEST-04 | 건의 아카이브 처리 (관리자) | **P0** | ADMIN | 부적절한 내용 아카이브 | In-Scope |
| SUGGEST-05 | 건의 목록 열람 — 공개 | **P0** | RESIDENT 이상 | 공개 건의 전체 열람 | In-Scope |
| SUGGEST-06 | 건의 목록 열람 — 비공개 (본인) | **P0** | 작성자 본인 | | In-Scope |
| SUGGEST-07 | 건의 목록 열람 — 비공개 (담당 동) | **P0** | REP | 동대표 담당 동만 | In-Scope |
| SUGGEST-08 | 건의 목록 열람 — 비공개 (전체) | **P0** | CHAIR·ADMIN | | In-Scope |
| SUGGEST-09 | 호수별 건의 이력 조회 | **P0** | ADMIN·CHAIR | 아카이브 포함, 시간순 | In-Scope |
| SUGGEST-10 | 건의 답변 등록/수정 | **P0** | ADMIN | | In-Scope (등록만, 수정 OUT) |
| SUGGEST-11 | 처리 상태 변경 | **P0** | ADMIN | 접수→처리중→완료→보류 | In-Scope |
| SUGGEST-12 | 처리 상태 확인 | **P0** | 작성자 본인·상위 역할 | | In-Scope (상세 열람으로 흡수) |
| SUGGEST-13 | 건의 카테고리 관리 | P1 | ADMIN | 시설·주차·소음·기타 등 | **OUT** (별도 SPEC) |

출처: `apt_02_PRD.md` §4-4 건의, `apt_03_기능명세서.md` §4 건의.

---

## 2. DB 스키마 (ERD 준거 + 기존 004 베이스라인)

출처: `apt_05_ERD.md` suggestions/suggestion_categories/suggestion_replies 테이블 정의 + `migrations/004_suggestions_minimal.sql`(AUTH 사이드이펙트용 최소 스키마).

### 2.1 기존 004 베이스라인 (AUTH 소유, 보존 필수)

`migrations/004_suggestions_minimal.sql` 현재 컬럼:

| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| author_id | UUID | NULL REFERENCES users(id) |
| author_label | VARCHAR(30) | NOT NULL DEFAULT '입주민' |
| archived | BOOLEAN | NOT NULL DEFAULT false |
| unit_id | UUID | NOT NULL REFERENCES units(id) |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() |

인덱스: `idx_suggestions_author_id`, `idx_suggestions_unit_id`.

**참고**: 004는 AUTH 강제 탈퇴(AUTH-07, REQ-AUTH-014) 사이드이펙트용 최소 스키마이다. AUTH deactivate route는 이 테이블의 `author_id`, `author_label`, `archived` 컬럼을 갱신한다. 본 SPEC의 migration 007은 이 컬럼들을 보존하고 ALTER ADD로 확장해야 한다.

### 2.2 ERD 목표 스키마 (migration 007 ALTER 결과)

| 컬럼 | 타입 | 제약 | 출처 |
|------|------|------|------|
| id | UUID | PK | 004 보존 |
| author_id | UUID | FK → users.id, NULLABLE | 004 보존 (ADR-005: 탈퇴 시 NULL) |
| unit_id | UUID | FK → units.id, NOT NULL | 004 보존 (ADR-005: 호수 귀속, 영구 보존) |
| author_label | VARCHAR(30) | DEFAULT '입주민' → '전 입주민' | 004 보존 |
| archived | BOOLEAN | DEFAULT false | 004 보존 |
| created_at | TIMESTAMPTZ | DEFAULT now() | 004 보존 |
| **category_id** | UUID | FK → suggestion_categories.id, NOT NULL | **007 ADD** |
| **title** | VARCHAR(100) | NOT NULL | **007 ADD** |
| **content** | TEXT | NOT NULL | **007 ADD** |
| **is_public** | BOOLEAN | NOT NULL DEFAULT false | **007 ADD** |
| **status** | VARCHAR(20) | NOT NULL DEFAULT '접수' | **007 ADD** |
| **updated_at** | TIMESTAMPTZ | NOT NULL DEFAULT now() | **007 ADD** |
| **archived_at** | TIMESTAMPTZ | NULLABLE | **007 ADD** |

인덱스(최종): unit_id(004), author_id(004), is_public(007), status(007), archived(007), category_id(007).

### 2.3 `suggestion_categories` (건의 카테고리, 007 신규)

| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| name | VARCHAR | NOT NULL, UNIQUE (멱등성) |
| sort_order | INT | |

시드값(4종 고정): 시설, 주차, 소음, 기타.

### 2.4 `suggestion_replies` (건의 답변, 007 신규)

| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| suggestion_id | UUID | FK → suggestions.id, NOT NULL |
| author_id | UUID | FK → users.id, NOT NULL |
| content | TEXT | NOT NULL |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

인덱스: suggestion_id.

---

## 3. API 엔드포인트 (기획서 발췌)

출처: `apt_06_API명세서.md` §4 건의.

### 3.1 GET /suggestions — 건의 목록 (역할별 자동 필터링)

- 인증: 필요 (인증된 전체 사용자)
- Query: `?is_public=true&status=접수&category_id=uuid&unit_id=uuid&page=1&limit=20`
- 역할별 서버 자동 필터링(기획서 명시):
  - RESIDENT: 공개 전체 + 본인 비공개
  - REP: 공개 전체 + 담당 동 비공개
  - CHAIR·ADMIN: 전체
- 응답 예시:
```json
{
  "data": {
    "suggestions": [
      {
        "id": "uuid", "title": "...", "category": "시설",
        "is_public": true, "status": "처리중", "author_label": "입주민",
        "building": "A동", "unit": "101", "created_at": "..."
      }
    ],
    "total": 8
  }
}
```
- 본 SPEC 조정: AUDITOR는 apt_08 §7 매트릭스에 미명시 → RESIDENT 동일 취급(공개 전체 + 본인 비공개). 응답에서 content 미포함(REQ-SUGGEST-019).

### 3.2 GET /suggestions/:id — 건의 상세 (권한 검사 포함)

- 인증: 필요
- 권한: 비공개 시 역할 분기(REQ-SUGGEST-021/022) 적용, 무권한 시 403(404 아님)
- 응답: id, title, content, category명, is_public, status, author_label, building, unit, author_id(아카이브 시 NULL), created_at, updated_at, archived_at(아카이브 시)

### 3.3 POST /suggestions — 건의 등록

- 인증: 필요 (RESIDENT 이상, **ADMIN ❌** — apt_08 §7 매트릭스 명시)
- 요청 본문:
```json
{
  "title": "주차장 조명 교체 요청",
  "content": "B동 지하주차장 입구 조명이 나갔습니다.",
  "category_id": "uuid",
  "is_public": true
}
```
- 처리 로직(apt_03 SUGGEST-01):
  1. 작성자의 building, unit을 건의에 귀속(회원 탈퇴 후에도 유지)
  2. 초기 상태: '접수'
  3. author_id, building, unit, is_public, archived=false 저장
- 본 SPEC 조정: building/unit은 `users.unit_id`에서 파생(units JOIN으로 building 획득). ADMIN 등록 시도 시 403(REQ-SUGGEST-002).

### 3.4 PUT /suggestions/:id — 건의 수정 (작성자 본인)

- 인증: 필요
- 권한: 작성자 본인 only (ADMIN도 수정 불가 — apt_03 SUGGEST-02 명시)
- 제약: archived=true 또는 status='완료' 시 수정 불가 (409 Conflict)
- 요청 본문: title, content, category_id, is_public (부분 갱신 또는 전체 교체)

### 3.5 DELETE /suggestions/:id — 건의 아카이브 (작성자 본인·ADMIN)

- 인증: 필요
- 권한: 작성자 본인 OR ADMIN
- **실제 삭제 아님. archived=true 처리** (기획서 명시)
- 익명화 절차(apt_03 SUGGEST-03/04):
  1. archived=true 상태로 변경
  2. author_label="전 입주민"으로 변경
  3. author_id=null 처리 (개인정보 보호)
  4. building, unit 귀속 정보는 유지 (이력 보존 핵심)
  5. archived_at=now() 기록

### 3.6 POST /suggestions/:id/replies — 답변 등록 (ADMIN)

- 인증: ADMIN
- 요청 본문: `{ "content": "확인 후 처리하겠습니다." }`
- 본 SPEC 조정: 답변 수정(PUT)과 삭제(DELETE)는 OUT(별도 SPEC).

### 3.7 PUT /suggestions/:id/status — 처리 상태 변경 (ADMIN)

- 인증: ADMIN
- 요청 본문: `{ "status": "처리중", "reason": "(선택)" }`
- 상태 전이 규칙(apt_03 §처리상태전이):
```
접수 → 처리중 → 완료
  ↓              ↑
보류 ───────────→
```
- 완료 → 재오픈 가능('접수'로 복귀, 사유 기재)
- 본 SPEC 조정: reason 필드는 선택값. 불가능한 전이(예: 접수→완료 스킵) 시 409 Conflict.

### 3.8 GET /suggestions/units/:building/:unit — 호수별 건의 이력 (ADMIN·CHAIR)

- 인증: ADMIN·CHAIR
- 응답: 해당 호수 전체 건의(아카이브 포함, 비공개 포함), 시간순
- **path param 해석 모호점**: apt_06 표기 `/units/:building/:unit`이 building을 동명("A동") 또는 UUID 중 어느 것으로 해석할지 불분명. 본 SPEC은 building_id(UUID) + unit_number(String) 조합으로 해석, `units` 테이블 JOIN으로 unit_id 해석(모호점 #2 참조).

---

## 4. 접근 제어 매트릭스

출처: `apt_08_보안설계.md` §7 접근 제어 매트릭스 + `apt_05_ERD.md` §4.

| 기능 | RESIDENT | REP | AUDITOR | CHAIR | ADMIN |
|------|:--------:|:---:|:-------:|:-----:|:-----:|
| 건의 등록 (SUGGEST-01) | ✅ | ✅ | ✅* | ✅ | ❌ |
| 건의 열람 (공개) (SUGGEST-05) | ✅ | ✅ | ✅* | ✅ | ✅ |
| 건의 열람 (비공개 본인) (SUGGEST-06) | ✅ | ✅ | ✅* | ✅ | ✅ |
| 건의 열람 (비공개 담당 동) (SUGGEST-07) | ❌ | ✅ | ❌* | ❌ | — |
| 건의 열람 (비공개 전체) (SUGGEST-08) | ❌ | ❌ | ❌* | ✅ | ✅ |
| 건의 수정 (SUGGEST-02) | 작성자 only | 작성자 only | 작성자 only | 작성자 only | 작성자 only |
| 건의 아카이브 (SUGGEST-03/04) | 작성자 | 작성자 | 작성자 | 작성자 | ✅ (전체) |
| 건의 답변 등록 (SUGGEST-10) | ❌ | ❌ | ❌ | ❌ | ✅ |
| 처리 상태 변경 (SUGGEST-11) | ❌ | ❌ | ❌ | ❌ | ✅ |
| 호수별 이력 (SUGGEST-09) | ❌ | ❌ | ❌ | ✅ | ✅ |

`*` AUDITOR는 apt_08 §7 매트릭스에 미명시. 본 SPEC은 RESIDENT 동일 취급(공개 전체 + 본인 비공개 열람, 등록 가능). 모호점 #1 참조.

**주목**: ADMIN은 건의 등록 권한이 없다(apt_08 §7 명시 ❌). 이는 PRD SUGGEST-01의 "RESIDENT 이상" 표기와 충돌(모호점 #1). 본 SPEC은 apt_08 우선으로 ADMIN 등록 시 403 반환.

---

## 5. 유저플로우

출처: `apt_04_유저플로우.md` flow 4, 5, 8.

### 5.1 flow 4 — 건의 등록 플로우 (입주민)

```
건의 등록 버튼 → 카테고리 선택 → 제목 입력 → 내용 입력
→ 공개 여부 선택 {공개 | 비공개} → 접수 상태로 저장 → 내 건의 목록으로 이동
```

### 5.2 flow 5 — 건의 처리 플로우 (관리사무소)

```
건의 관리 화면 → 건의 목록 조회 → 필터(상태/카테고리/동) → 건의 선택
→ 건의 상세 확인 → 처리 유형 {처리 시작 | 답변 등록 | 완료 처리 | 보류}
→ 목록으로 복귀
```

### 5.3 flow 8 — 호수별 이력 조회 플로우 (관리사무소/회장)

```
호수 이력 조회 → 동 선택 → 호수 선택 → 해당 호수 건의 전체 이력
→ 상태 필터 → 필터링 결과 → 건의 상세 열람
→ 추가 작업 {답변 | 상태변경 | 없음} → 종료
```

---

## 6. 건의 보존 정책 (ADR-005 핵심)

출처: `apt_02_PRD.md` §4-4 건의 보존 정책, `apt_09_ADR.md` ADR-005.

### 6.1 핵심 원칙

1. **건의/문의는 절대 영구 삭제되지 않는다.** 작성자가 삭제하거나 회원 탈퇴 시 아카이브 상태로 전환된다.
2. **건의는 작성자(회원)가 아닌 동/호수에 귀속된다.** 전출 후 신규 입주민이 들어와도 해당 호수의 과거 건의 이력이 유지된다.
3. **목적**: 호수별 하자·유지보수 이력 관리. 동일 문제의 재발 여부를 관리사무소가 추적할 수 있어야 한다.

### 6.2 아카이브 절차 (ADR-005 준거)

아카이브 시(작성자 DELETE 또는 ADMIN DELETE 또는 AUTH 강제 탈퇴):

| 컬럼 | 아카이브 전 | 아카이브 후 |
|------|------------|------------|
| archived | false | **true** |
| author_id | 작성자 UUID | **NULL** |
| author_label | '입주민' | **'전 입주민'** |
| archived_at | NULL | **now()** |
| unit_id | 호수 UUID | **변경 없음 (영구 보존)** |
| title, content | 원본 | **변경 없음 (내용 보존)** |
| status | 현재 상태 | **변경 없음** |

**주의**: AUTH 강제 탈퇴(AUTH-07, REQ-AUTH-014)는 기존 004 최소 스키마에 대해 이 절차를 이미 수행하고 있다. 본 SPEC의 migration 007 ALTER는 AUTH deactivate route의 호환성을 유지해야 한다(기존 컬럼 보존, 신규 컬럼 추가만).

### 6.3 ADR-005 트레이드오프

- 탈퇴 회원의 건의 내용이 영구 보존됨 → 개인정보처리방침에 명시 필요(apt_14).
- author_label 비정규화(ERD §3) — 탈퇴 후 작성자 정보 보존을 위한 의도적 설계.

---

## 7. 처리 상태 정의 및 전이

출처: `apt_02_PRD.md` §4-4 건의 상태 정의, `apt_03_기능명세서.md` §처리상태전이.

### 7.1 상태 정의

| 상태 | 설명 |
|------|------|
| `접수` | 등록 직후 기본 상태 |
| `처리중` | 관리사무소가 확인·처리 진행 중 |
| `완료` | 처리 완료 |
| `보류` | 일시 보류 (이유 기재) |

**주의**: `아카이브`는 상태(status)가 아니라 별도 불리언(archived)이다. PRD §4-4 상태 표에 '아카이브'가 포함되어 있으나, ERD는 status와 archived를 분리한다. 본 SPEC은 ERD 준거(archived 별도 컬럼).

### 7.2 전이 규칙

```
접수 → 처리중 → 완료
  ↓              ↑
보류 ───────────→
```

허용 전이:
- 접수 → 처리중 (진행)
- 처리중 → 완료 (완료)
- 접수 → 보류 (사유)
- 처리중 → 보류 (사유)
- 보류 → 처리중 (재개)
- 보류 → 접수 (재접수)
- 완료 → 접수 (재오픈, 사유 기재)

불허 전이(예):
- 접수 → 완료 (스킵)
- 완료 → 처리중 (되돌리기)
- 완료 → 보류 (의미 없음)

사유(reason) 필드: 보류 및 재오픈 시 권장, 선택값. 본 SPEC은 hard 422가 아닌 로깅만 수행(모호점 #3).

---

## 8. 핵심 의사결정 근거 (WHY)

### 8.1 FULL P0 범위 결정 이유

사용자 확정 결정 #1: 본 SPEC은 SUGGEST P0 전체(SUGGEST-01~12)를 단일 SPEC으로 구현한다.
- 역할별 비공개 분기(RESIDENT/REP/CHAIR/ADMIN)는 본 SPEC의 핵심 복잡도이나, 분리 시 데이터 일관성(archived/unit_id 귀속) 검증이 분산되어 회귀 위험 증가.
- 호수별 이력(SUGGEST-09)은 아카이브 정책(ADR-005)과 직결되므로 동일 SPEC에서 구현.
- 답변(SUGGEST-10)과 상태 변경(SUGGEST-11)은 ADMIN 처리 플로우(flow 5)의 핵심이므로 동일 SPEC.

### 8.2 첨부파일 제외 이유

사용자 확정 결정 #4: attachments는 본 SPEC에서 완전 제외(NOTICE-001 동일 정책).
- 기능명세서에 attachments 필드 명시가 없음(NOTICE와 상이).
- 파일 저장소 백엔드 결정이 선행되어야 함.
- 별도 ADR에서 파일 저장소 백엔드를 결정한 후, 후속 SPEC에서 첨부파일 기능을 구현.

### 8.3 카테고리 고정 시드 결정 이유

사용자 확정 결정 #2: 카테고리는 4종 고정 시드(시설/주차/소음/기타).
- SUGGEST-13(카테고리 동적 CRUD)은 PRD에서 P1.
- 4종은 PRD SUGGEST-13에 예시로 명시.
- 시드 테이블(suggestion_categories)로 관리하여 향후 P1 CRUD 확장 용이.

### 8.4 ALTER 기반 마이그레이션 결정 이유

사용자 확정 결정 #3: 기존 004를 ALTER로 확장(CREATE TABLE 아님).
- 004는 AUTH 강제 탈퇴 사이드이펙트용 최소 스키마로 이미 데이터가 존재할 수 있음(테스트/스테이징 환경).
- CREATE TABLE로 재생성 시 기존 데이터 손상 및 AUTH deactivate route 호환성 깨짐.
- ALTER ADD COLUMN으로 7개 컬럼 추가, 기존 6개 컬럼(id, author_id, author_label, archived, unit_id, created_at) 보존.
- AUTH deactivate route는 기존 컬럼만 갱신하므로 본 SPEC 확장 후에도 호환성 유지.

### 8.5 archive-only 정책 결정 이유

ADR-005 + 사용자 확정 결정 #5: 건의는 절대 영구 삭제되지 않는다.
- 호수별 하자·유지보수 이력 추적이 핵심 목적.
- DELETE 엔드포인트는 archived=true 전환(익명화)이며 행 삭제가 아님.
- 이는 NOTICE(hard delete)와 대조되는 SUGGEST 고유 정책.

### 8.6 ADMIN 건의 등록 권한 없음 결정 이유

apt_08 §7 매트릭스 명시: "건의 등록 ADMIN ❌".
- 관리사무소는 건의 처리 주체이므로 등록 권한이 없음(이해상충 방지).
- PRD SUGGEST-01의 "RESIDENT 이상" 표기와 충돌하나, apt_08이 더 구체적 보안 문서이므로 우선.
- 본 SPEC은 ADMIN 등록 시도 시 403 반환(REQ-SUGGEST-002).

---

## 9. 재사용 산출물 (AUTH/SETUP/NOTICE)

본 SPEC은 다음을 재사용하며 신규 패턴을 도입하지 않는다:

- `src/lib/db.ts`: `query` (Parameterized Query)
- `src/lib/auth.ts`: `verifyAccessToken`
- `src/lib/rbac.ts`: `requireAdmin` (SUGGEST 답변/상태변경/아카이브 ADMIN), `requirePrivileged` (SUGGEST 호수이력 ADMIN/CHAIR), 응답 빌더(unauthorized/forbidden/badRequest/notFound/conflict/validationError)
- `src/middleware.ts`: 인증 라우트 매칭 패턴 (SUGGEST는 공개 엔드포인트 아님, 기존 matcher 적용)
- migration 번호: 007 (006까지 AUTH/SETUP/NOTICE 사용)
- zod 검증 패턴, UUID_RE 정규식 (SETUP/NOTICE 재사용)
- route-level Bearer 인증 패턴 (NOTICE GET 준거, `verify-unit/route.ts:46-63`)
- notice_categories 시드 패턴 (migration 006) — suggestion_categories 동일 패턴 적용

### 9.1 RBAC 헬퍼 확장 필요성 (FLAG)

SUGGEST의 역할별 비공개 분기(M4 목록, M5 상세)는 `requireAdmin`/`requirePrivileged`의 단순 허용/거부 로직을 넘어선다. 목록 엔드포인트는 모든 인증 사용자를 허용하되 역할에 따라 WHERE 절이 분기되어야 한다.

**접근**: route handler 내부에서 역할을 조회한 후 비공개 필터링 분기를 적용(비즈니스 로직). rbac.ts에 새 헬퍼(`requireAuthenticated`)를 추가하여 {callerId, callerRole, managedBuildingId}를 반환하도록 확장 — 단, 기존 requireAdmin/requirePrivileged 패턴을 따르고 새 아키텍처를 도입하지 않는다. REP의 managed_building_id는 SUGGEST-07 담당 동 필터링에 필요. 이 확장은 plan.md에서 상세 결정.

---

## 10. 모호점 / 후속 확인 사항 (FLAGS)

### 10.1 ADMIN 건의 등록 권한 충돌 (해결됨 — apt_08 우선)

- apt_08 §7 매트릭스: "건의 등록 ADMIN ❌"
- PRD SUGGEST-01: "RESIDENT 이상" (ADMIN 포함 해석 가능)
- **해결**: apt_08(구체적 보안 문서) 우선. ADMIN 등록 시 403(REQ-SUGGEST-002). 본 SPEC에 명시 반영.

### 10.2 AUDITOR 건의 권한 미명시 (해결됨 — RESIDENT 동일 취급)

- apt_08 §7 매트릭스에 AUDITOR 열 부재(RESIDENT/REP/CHAIR/ADMIN만).
- **해결**: AUDITOR는 RESIDENT 동일 취급(공개 전체 + 본인 비공개 열람, 건의 등록 가능). 권한 매트릭스상 감사 역할이므로 열람 권한 확대 불필요. 본 SPEC에 명시 반영.

### 10.3 호수별 이력 path param 해석 모호 (해결됨 — building_id + unit_number)

- apt_06 표기: `GET /suggestions/units/:building/:unit`
- building이 동명("A동")인지 UUID인지, unit이 호수("101")인지 UUID인지 불분명.
- **해결**: building_id(UUID) + unit_number(String) 조합으로 해석. `units` 테이블 JOIN으로 unit_id 해석. 동명 기반 조회는 SETUP buildings 테이블을 거쳐야 하므로 복잡도 증가 — UUID 직접 전달이 단순. plan.md에서 route handler 디테일 결정.

### 10.4 보류/재오픈 reason 필드 (해결됨 — 선택값, 로깅만)

- apt_03 §처리상태전이: "완료 상태에서 재오픈 가능 (`접수`로 복귀, 사유 기재)", 보류 "(이유 기재)"
- **해결**: reason 필드는 요청 본문에서 선택값(optional). 제공된 경우 애플리케이션 로그에 기록. 별도 컬럼(status_reason 등) 저장은 OUT(스키마 단순화). hard 422가 아님.

### 10.5 migration 007 vs 007+008 분리 (매니저 판단)

- 사용자 지시: "migration 007(또는 007+008 분리 — 매니저 판단)".
- **기본**: 007에 전부(suggestions ALTER + suggestion_categories + suggestion_replies) 포함. 단일 트랜잭션으로 원자성 보장.
- **대안**: 007(suggestions ALTER + categories) + 008(replies) 분리. 분리 시 테스트 파일 2개(migration-007.test.ts, migration-008.test.ts) 필요.
- 본 SPEC은 007 단일 마이그레이션을 기본으로 명시. 매니저 판단 시 008 분리 허용.

### 10.6 답변 수정/삭제 범위 (해결됨 — OUT)

- apt_06은 답변 등록(POST)만 명시, 수정(PUT)/삭제(DELETE) 명시 없음.
- PRD SUGGEST-10 "건의 답변 등록/수정" 표기.
- **해결**: 본 SPEC은 등록(POST)만 In-Scope. 수정/삭제는 OUT(별도 SPEC). 답변 수정 필요 시 새 답변 추가 정책(이력 누적).

---

## 11. content 길이 제한 (NOTICE와 상이)

출처: `apt_03_기능명세서.md` §4 SUGGEST-01.

| 필드 | SUGGEST 제한 | NOTICE 제한 | 비고 |
|------|-------------|-------------|------|
| title | 100자 | 100자 | 동일 |
| content | **5000자** | 10000자 | **상이** — SUGGEST가 더 짧음 |

ERD는 `content TEXT`(무제한)이므로 애플리케이션 레벨(zod)에서 5000자 제한. NOTICE의 10000자 제한과 혼동 주의.

---

*본 research.md는 기획서 사실 추출 및 의사결정 근거를 문서화한다. 구현 디테일은 plan.md에서 다룬다.*
