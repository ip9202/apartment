---
spec_id: SPEC-NOTICE-001
title: 공지사항 (등록/수정/삭제/열람)
phase: research
status: draft
created: 2026-06-22
author: manager-spec
depends_on:
  - SPEC-AUTH-001
  - SPEC-SETUP-001
source_docs:
  - apt_02_PRD.md
  - apt_03_기능명세서.md
  - apt_04_유저플로우.md
  - apt_05_ERD.md
  - apt_06_API명세서.md
---

# SPEC-NOTICE-001 Deep Research — 공지사항 (등록/수정/삭제/열람)

본 문서는 5개 기획 문서와 AUTH/SETUP P0 구현 산출물에서 NOTICE 도메인(공지 등록/수정/삭제/열람)에 관련된 모든 사실을 추출한 연구 결과입니다. SPEC 작성의 기반이 되며, 구현 디테일(함수명/클래스 구조/API 스키마)은 포함하지 않습니다 — "무엇(WHAT)/왜(WHY)"에 집중합니다.

---

## 1. NOTICE 요구사항 요약 (NOTICE-01 ~ NOTICE-07)

| ID | 기능 | 우선순위 | 대상 역할 | 핵심 설명 | 본 SPEC |
|----|------|:--------:|-----------|-----------|---------|
| NOTICE-01 | 공지 등록 | **P0** | ADMIN | 제목·내용·카테고리·(첨부파일) | In-Scope (첨부파일 제외) |
| NOTICE-02 | 공지 수정 | **P0** | ADMIN | | In-Scope |
| NOTICE-03 | 공지 삭제 | **P0** | ADMIN | | In-Scope (hard delete) |
| NOTICE-04 | 공지 목록 열람 | **P0** | 전체 | 카테고리 필터, 최신순 정렬 | In-Scope |
| NOTICE-05 | 공지 상세 열람 | **P0** | 전체 | | In-Scope |
| NOTICE-06 | 공지 상단 고정 | P1 | ADMIN | 중요 공지 상단 고정 | **OUT** (별도 SPEC) |
| NOTICE-07 | 공지 카테고리 관리 | P1 | ADMIN | 일반·긴급·주차·시설 등 | **OUT** (별도 SPEC) |

출처: `apt_02_PRD.md` §4-3 공지, `apt_03_기능명세서.md` §3 공지.

---

## 2. DB 스키마 (ERD 준거)

출처: `apt_05_ERD.md` notices/notice_categories 테이블 정의.

### 2.1 `notice_categories` (공지 카테고리)

| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| name | VARCHAR | NOT NULL |
| sort_order | INT | |

시드값(4종 고정): 일반, 긴급, 주차, 시설.

### 2.2 `notices` (공지)

| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| author_id | UUID | FK → users.id |
| category_id | UUID | FK → notice_categories.id |
| title | VARCHAR(100) | NOT NULL |
| content | TEXT | NOT NULL |
| is_pinned | BOOLEAN | DEFAULT false |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

인덱스: category_id, is_pinned, created_at DESC.

### 2.3 is_pinned 컬럼 전방 호환성 결정

ERD에 `is_pinned` 컬럼이 존재하나, 본 SPEC(P0)은 이 컬럼에 대한 API 동작을 노출하지 않는다.

**이유**:
- NOTICE-06(상단 고정)은 PRD에서 P1로 분류됨.
- 사용자 확정 결정 #4: is_pinned API 동작은 본 SPEC에서 제외.
- 단, 테이블 생성 시 ERD 준거를 위해 컬럼을 포함한다(디폴트 false). 이는 향후 NOTICE-06 P1 SPEC 구현 시 마이그레이션 없이 컬럼을 재사용하기 위한 전방 호환성 조치이다.
- 본 SPEC의 등록/수정 API는 is_pinned를 요청 본문에서 받지 않으며, 항상 false로 저장된다(등록 시). 수정 시에도 is_pinned를 변경하지 않는다.

---

## 3. API 엔드포인트 (기획서 발췌)

출처: `apt_06_API명세서.md` §3 공지.

### 3.1 GET /notices — 공지 목록

- 인증: 필요 (인증된 전체 사용자)
- Query: `?category_id=uuid&pinned=true&page=1&limit=20` (기획서)
- 본 SPEC 범위: `category_id`, `page`, `limit`만 지원. `pinned` 쿼리는 OUT(NOTICE-06).
- 응답 예시:
```json
{
  "data": {
    "notices": [
      { "id": "uuid", "title": "...", "category": "시설", "is_pinned": true, "created_at": "..." }
    ],
    "total": 5
  }
}
```
- 본 SPEC 조정: 응답에서 `is_pinned`는 노출하지 않음(API 동작 미노출 결정에 따라). 목록은 id, title, category명, created_at만. content 미포함(REQ-NOTICE-012).

### 3.2 GET /notices/:id — 공지 상세

- 인증: 필요
- 응답: id, title, content, category명, is_pinned, attachments, created_at (기획서)
- 본 SPEC 조정: `attachments` 제외(첨부파일 OUT), `is_pinned` 제외(API 동작 미노출). author_id, updated_at 추가.

### 3.3 POST /notices — 공지 등록

- 인증: ADMIN
- 요청 본문(기획서): title, content, category_id, is_pinned, attachments
- 본 SPEC 조정: `is_pinned`, `attachments` 제외. title, content, category_id만.

### 3.4 PUT /notices/:id — 공지 수정 (ADMIN)

- 본 SPEC: title, content, category_id 갱신.

### 3.5 DELETE /notices/:id — 공지 삭제 (ADMIN)

- 본 SPEC: 영구 삭제(hard delete).

---

## 4. 입력 제약 (기능명세서 준거)

출처: `apt_03_기능명세서.md` §3 NOTICE-01.

| 필드 | 타입 | 필수 | 제약 |
|------|------|:----:|------|
| title | string | ✅ | 최대 100자 |
| content | string | ✅ | 최대 10,000자 |
| category_id | uuid | ✅ | notice_categories.id 존재 |
| is_pinned | boolean | — | 기본값: false (본 SPEC API 미노출) |
| attachments | file[] | — | 최대 5개, 파일당 10MB (본 SPEC OUT) |

**확정**: title ≤ 100자, content ≤ 10,000자. 이는 ERD `title VARCHAR(100)`, `content TEXT`와 일치한다.

---

## 5. 접근 제어 매트릭스

출처: `apt_05_ERD.md` §4 접근 제어 정책, `apt_02_PRD.md` §4-3.

| 리소스 | 읽기 | 쓰기 |
|--------|------|------|
| notices | 인증된 전체 | ADMIN만 |
| notice_categories | (간접 — notices.category JOIN) | ADMIN만 (본 SPEC OUT, 시드만) |

- 공지 열람(목록/상세): 모든 인증 사용자 (RESIDENT/REP/AUDITOR/CHAIR/ADMIN)
- 공지 CRUD: ADMIN only

사용자 지시에 apt_08_보안설계 section 7 교차 확인이 언급되었으나, 본 research 단계에서 해당 문서 접근이 제한되어 PRD §4-3 + ERD §4를 권위 출처로 채택. 매트릭스는 양 출처 일치.

---

## 6. 유저플로우 (공지 열람)

출처: `apt_04_유저플로우.md` flow 3.

```
홈/공지 탭 → 공지 목록 → {카테고리 필터} → 필터링된 목록 → 공지 클릭 → 공지 상세 → {첨부파일?} → (다운로드) → 종료
```

본 SPEC 조정:
- 카테고리 필터: 지원 (REQ-NOTICE-011)
- 첨부파일 다운로드: OUT (첨부파일 기능 제외)

---

## 7. 핵심 의사결정 근거 (WHY)

### 7.1 P0 범위 한정 이유

사용자 확정 결정 #1: 본 SPEC은 NOTICE-01~05(P0)만 구현한다.
- NOTICE-06(상단 고정), NOTICE-07(카테고리 CRUD)은 PRD에서 P1으로 분류됨.
- MVP 출시를 위해 P0 최소 기능(등록/수정/삭제/열람)에 집중.

### 7.2 첨부파일 제외 이유

사용자 확정 결정 #3: attachments는 본 SPEC에서 완전 제외.
- 기능명세서 NOTICE-01에 `attachments: file[]` 필드가 명시되어 있으나, 파일 저장소 백엔드(S3/Railway Volumes/Supabase Storage 등) 결정이 선행되어야 함.
- 백엔드 미결정 상태에서 스펙에 포함하면 구현 중 아키텍처 정체 발생.
- 별도 ADR에서 파일 저장소 백엔드를 결정한 후, 후속 SPEC에서 첨부파일 기능을 구현.
- 본 SPEC의 API 요청/응답 스키마에는 attachments 필드가 존재하지 않는다(명시적 제외).

### 7.3 is_pinned API 동작 미노출 이유

사용자 확정 결정 #4: is_pinned 컬럼은 존재하되 API 동작은 노출하지 않음.
- NOTICE-06(상단 고정)은 P1.
- 컬럼을 미리 생성(ERD 준거)하면 향후 P1 SPEC에서 마이그레이션 없이 재사용 가능.
- 본 SPEC 등록 API는 is_pinned를 요청 본문에서 받지 않음 → 디폴트 false 저장.
- 본 SPEC 수정 API는 is_pinned를 갱신하지 않음.
- 본 SPEC 목록/상세 응답은 is_pinned를 노출하지 않음.

### 7.4 Hard delete 결정 이유

사용자 지시: "기획서 says 영구 삭제 — follow it (NOT soft delete)."
- 공지는 관리사무소 운영 기록이지만, 건의(SUGGEST)와 달리 호수 귀속/법적 보존 의무가 없음.
- 기능명세서/PRD에 "영구 삭제" 명시.
- 소프트 삭제(archived)는 건의 도메인 정책(호수별 이력 보존 목적). 공지는 동일 정책 필요 없음.
- 따라서 `DELETE FROM notices WHERE id = $1` hard delete.

### 7.5 카테고리 고정 시드 결정 이유

사용자 확정 결정 #2: 카테고리는 4종 고정 enum 시드.
- NOTICE-07(카테고리 동적 CRUD)은 P1.
- 4종(일반/긴급/주차/시설)은 PRD/기능명세서에 예시로 명시.
- 시드 테이블(notice_categories)로 관리하여 향후 P1 CRUD 확장 용이.
- 본 SPEC은 INSERT 시드만 수행, CRUD API는 미구현.

---

## 8. 재사용 산출물 (AUTH/SETUP)

본 SPEC은 다음을 재사용하며 신규 패턴을 도입하지 않는다:

- `src/lib/db.ts`: `query` (Parameterized Query)
- `src/lib/auth.ts`: `verifyAccessToken`
- `src/lib/rbac.ts`: `requireAdmin` (NOTICE 쓰기), 응답 빌더(unauthorized/forbidden/badRequest/notFound/validationError)
- `src/middleware.ts`: 인증 라우트 매칭 패턴 (NOTICE는 공개 엔드포인트 아님, 기존 matcher 적용)
- migration 번호: 006 (005까지 AUTH/SETUP 사용)
- zod 검증 패턴, UUID_RE 정규식 (SETUP 재사용)

---

## 9. 모호점 / 후속 확인 사항

1. **apt_08_보안설계 접근**: 본 research에서 apt_08 문서 접근 제한. PRD §4-3 + ERD §4로 권한 매트릭스 확정(양 출처 일치). 후속 검증 권장이나 블로커 아님.
2. **content 길이 제한**: 기능명세서 NOTICE-01 "최대 10,000자" 명시 확인. ERD `content TEXT` (무제한)와 충돌 없음 — 애플리케이션 레벨(zod)에서 10,000자 제한.
3. **목록 응답 is_pinned 노출 여부**: 기획서 API 응답 예시에 is_pinned 포함. 본 SPEC은 API 동작 미노출 결정에 따라 응답에서도 제외. 후속 NOTICE-06 P1 SPEC에서 응답에 is_pinned 추가 예정.

---

*본 research.md는 기획서 사실 추출 및 의사결정 근거를 문서화한다. 구현 디테일은 plan.md에서 다룬다.*
