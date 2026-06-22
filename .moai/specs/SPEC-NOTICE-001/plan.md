# SPEC-NOTICE-001 Implementation Plan

공지사항(등록/수정/삭제/열람) 도메인의 TDD 구현 계획. `spec.md`의 6개 모듈(M1~M6)과 18개 REQ-NOTICE-XXX 요구사항(001~018, a/b 서브 ID 포함)을 RED-GREEN-REFACTOR 주기로 구현한다.

---

## 1. 구현 순서 (TDD Phase Decomposition)

구현 순서는 의존성 그래프 기반: 스키마/시드(M6) → 등록(M1) → 목록(M4) → 상세(M5) → 수정(M2) → 삭제(M3).

### Phase A: notice_categories 시드 + notices 마이그레이션 (M6, greenfield)

**범위**: 신규 테이블 2종 생성. migration 005 이후 순차 적용.

**파일**:
- `migrations/006_notices.sql` (신규)

**내용 (WHAT)**:
```sql
-- notice_categories: 4종 고정 시드
CREATE TABLE IF NOT EXISTS notice_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(30) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
);

INSERT INTO notice_categories (name, sort_order) VALUES
  ('일반', 1),
  ('긴급', 2),
  ('주차', 3),
  ('시설', 4)
ON CONFLICT DO NOTHING;

-- notices: ERD 준거
CREATE TABLE IF NOT EXISTS notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES users(id),
  category_id UUID NOT NULL REFERENCES notice_categories(id),
  title VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notices_category_id ON notices(category_id);
CREATE INDEX idx_notices_is_pinned ON notices(is_pinned);
CREATE INDEX idx_notices_created_at_desc ON notices(created_at DESC);
```

**TDD 주기**:
- RED: `migrations/006.test.ts` 작성(notice_categories 테이블 존재 + 4종 시드 행 존재 / notices 컬럼 존재 + 인덱스 존재 어설션) → 실패
- GREEN: `006_notices.sql` 적용 → 통과
- REFACTOR: 불필요(단일 DDL)

---

### Phase B: 공지 등록 + 목록 열람 (M1, M4, greenfield)

**범위**: NOTICE-01 등록(POST ADMIN) + NOTICE-04 목록(GET 인증).

**파일**:
- `src/app/api/notices/route.ts` (신규 — `GET` 인증 + `POST` ADMIN)
- `src/app/api/notices/route.test.ts` (신규)

**구현 디테일**:
- `GET /api/notices`: `verifyAccessToken` 인증(역할 무관). 쿼리 필터(`category_id` optional UUID, `page` 기본 1, `limit` 기본 20 최대 100). `notice_categories` JOIN으로 category명 반환. `created_at DESC` 정렬. 응답에 content 미포함(REQ-NOTICE-012). 총 total과 함께 반환.
- `POST /api/notices`: `requireAdmin` 재사용. zod 검증(`title: string 1~100자`, `content: string 1~10000자`, `category_id: uuid`). category_id 존재 확인(없으면 422, REQ-NOTICE-002). `author_id` = 요청자(ADMIN) user id. `is_pinned`는 요청 본문에서 받지 않음(디폴트 false). 201 응답.

**TDD 주기** (REQ-NOTICE-001, 002, 003a, 003b, 011, 012, 013a):
- RED: 등록 201 / 미존재 category_id 422 / 등록 미인증 401 / 비-ADMIN 등록 403 / 목록 200 + 필터 / 목록 content 미포함 / 목록 미인증 401 테스트 작성 → 실패
- GREEN: route handler 구현 → 통과
- REFACTOR: RBAC 응답 빌더 재사용 확인

---

### Phase C: 공지 상세 열람 (M5, greenfield)

**범위**: NOTICE-05 상세(GET 인증).

**파일**:
- `src/app/api/notices/[id]/route.ts` (신규 — `GET` 인증, Phase D/E에서 PUT/DELETE 추가)
- `src/app/api/notices/[id]/route.test.ts` (신규)

**구현 디테일**:
- `GET /api/notices/[id]`: `verifyAccessToken` 인증. UUID path param 검증. 공지 조회(id, title, content, category명, author_id, created_at, updated_at). 미존재 시 404(REQ-NOTICE-015).

**TDD 주기** (REQ-NOTICE-014, 015, 016a):
- RED: 상세 200 / 미존재 404 / 상세 미인증 401 테스트 작성 → 실패
- GREEN: route handler 구현 → 통과
- REFACTOR: 없음

---

### Phase D: 공지 수정 (M2, greenfield)

**범위**: NOTICE-02 수정(PUT ADMIN).

**파일**:
- `src/app/api/notices/[id]/route.ts` (수정 — `PUT` ADMIN 추가)
- `src/app/api/notices/[id]/route.test.ts` (수정 — PUT 테스트 추가)

**구현 디테일**:
- `PUT /api/notices/[id]`: `requireAdmin`. UUID 검증. zod 검증(`title`, `content`, `category_id` — 모두 optional 또는 필수, 결정 필요: 전체 교체 방식 권장). 공지 존재 확인(없으면 404, REQ-NOTICE-005). category_id 존재 확인(없으면 422, REQ-NOTICE-006). `updated_at` 자동 갱신. `is_pinned`는 갱신하지 않음.

**TDD 주기** (REQ-NOTICE-004, 005, 006, 007a, 007b):
- RED: 수정 200 / 미존재 404 / 미존재 category_id 422 / 수정 미인증 401 / 비-ADMIN 수정 403 테스트 작성 → 실패
- GREEN: PUT handler 추가 → 통과
- REFACTOR: 없음

---

### Phase E: 공지 삭제 (M3, greenfield)

**범위**: NOTICE-03 삭제(DELETE ADMIN, hard delete).

**파일**:
- `src/app/api/notices/[id]/route.ts` (수정 — `DELETE` ADMIN 추가)
- `src/app/api/notices/[id]/route.test.ts` (수정 — DELETE 테스트 추가)

**구현 디테일**:
- `DELETE /api/notices/[id]`: `requireAdmin`. UUID 검증. 공지 존재 확인(없으면 404, REQ-NOTICE-009). `DELETE FROM notices WHERE id = $1`(hard delete, REQ-NOTICE-008). 200 응답. `@MX:WARN: 소프트 삭제 아님, 복구 불가`.

**TDD 주기** (REQ-NOTICE-008, 009, 010a, 010b):
- RED: 삭제 200 + 행 제거 확인 / 미존재 404 / 삭제 미인증 401 / 비-ADMIN 삭제 403 테스트 작성 → 실패
- GREEN: DELETE handler 추가 → 통과
- REFACTOR: 없음

---

### Phase V: 최종 검증 + develop 머지 준비

**범위**: 전체 AC 통과, TRUST 5 게이트, AUTH/SETUP 회귀 없음 확인.

---

## 2. 파일 목록 요약

### 신규 파일 (greenfield)

| 파일 | 모듈 | 설명 |
|------|------|------|
| `migrations/006_notices.sql` | M6 | notice_categories(시드) + notices 테이블 + 인덱스 |
| `src/app/api/notices/route.ts` | M1/M4 | GET 인증(목록), POST ADMIN(등록) |
| `src/app/api/notices/[id]/route.ts` | M2/M3/M5 | GET 인증(상세), PUT ADMIN(수정), DELETE ADMIN(삭제) |
| `src/app/api/notices/route.test.ts` | M1/M4 | 테스트 |
| `src/app/api/notices/[id]/route.test.ts` | M2/M3/M5 | 테스트 |
| `migrations/006.test.ts` | M6 | migration 검증 테스트 |

### 수정 파일

없음. 본 SPEC은 AUTH/SETUP 소유 파일을 수정하지 않는다. `src/middleware.ts`도 수정 불필요(NOTICE는 공개 엔드포인트 아님, 기존 matcher가 `/api/notices`에 인증 적용).

### 재사용 파일 (AUTH/SETUP 소유, 수정 없음)

- `src/lib/db.ts` (`query`)
- `src/lib/auth.ts` (`verifyAccessToken`)
- `src/lib/rbac.ts` (`requireAdmin`, `unauthorized`, `forbidden`, `badRequest`, `notFound`, `validationError`)
- `src/lib/validators.ts` (UUID 검증 idiom) — `[id]` 라우트(M2/M3/M5)의 `:id` 파라미터 검증은 `validators.ts`의 `UUID_REGEX` + `z.string().refine()` idiom 사용. **`z.string().uuid()` 사용 금지** — zod 4에서 deprecated (현재 SETUP `setup/users/route.ts:31`, `setup/users/[id]/role/route.ts:63`에서 동일 경고 발생 중). `verify-unit/route.ts:32-42`가 이 idiom의 정석 구현 예시.

---

## 3. 리스크 및 완화 방안

| 리스크 | 설명 | 완화 방안 |
|--------|------|-----------|
| **Hard delete 복구 불가** | 공지 삭제 시 데이터 영구 소실 | `@MX:WARN` 명시; 기획서 명시된 정책이므로 소프트 삭제 미도입 |
| **category_id FK 위반 런타임 에러** | 등록/수정 시 미존재 category_id → DB FK 에러 | 사전 존재 확인(REQ-NOTICE-002, 006)으로 422 반환, DB 에러 핸들러 불필요 |
| **content 10000자 제한 초과** | 대용량 텍스트 입력 | zod `string().max(10000)` 애플리케이션 레벨 검증(ERD TEXT는 무제한) |
| **페이지네이션 OFFSET 성능** | 대량 공지 시 OFFSET 비용 | 38세대 소규모 커뮤니티 → 병목 아님. `created_at DESC` 인덱스 활용 |
| **is_pinned 컬럼 혼란** | 컬럼 존재하나 API 미노출로 기여자 혼란 | `@MX:NOTE` 로 전방 호환성 결정 명시; 등록/수정 시 is_pinned 무시 |
| **zod `.uuid()` deprecation** | NOTICE `/[id]` 라우트 UUID 검증 시 `z.string().uuid()` 사용하면 TS 진단 [6385] 발생 | `validators.ts`의 `UUID_REGEX` + `.refine()` idiom 사용 (`verify-unit/route.ts` 정석). 동일 진단이 SETUP 2개 라우트에 잔존 → 별도 기술 부채 정리 |

---

## 4. MX Tag 적용 계획

`spec.md` §7에 명시된 MX Tag Plan을 Run Phase에서 적용:

- `@MX:ANCHOR`: notices CRUD route handlers, migration 006 스키마 불변 지점
- `@MX:WARN + @MX:REASON`: hard delete 로직, ADMIN RBAC 검사
- `@MX:NOTE`: is_pinned 컬럼 전방 호환성, notice_categories 시드, 첨부파일 제외
- `@MX:TODO`: NOTICE-06 상단 고정, NOTICE-07 카테고리 CRUD, 첨부파일

---

## 5. 검증 게이트 (Quality Gates)

- **TRUST 5**: Tested(85%+ 커버리지), Readable(한국어 도메인 용어 주석), Unified(AUTH/SETUP 패턴 일관), Secured(RBAC + zod + Parameterized Query), Trackable(SPEC-NOTICE-001 참조 커밋)
- **LSP 게이트**: run 단계 — TypeScript 에러 0, ESLint 에러 0
- **테스트 커버리지**: 신규 route handlers 85% 이상
- **AUTH/SETUP 회귀**: 기존 290 테스트 통과 유지

---

## 6. Definition of Done

- [ ] M6 마이그레이션: REQ-NOTICE-017, 018 구현 + migration 006 테스트 통과
- [ ] M1 공지 등록: REQ-NOTICE-001, 002, 003a, 003b 구현 + 테스트 통과
- [ ] M2 공지 수정: REQ-NOTICE-004, 005, 006, 007a, 007b 구현 + 테스트 통과
- [ ] M3 공지 삭제: REQ-NOTICE-008, 009, 010a, 010b 구현 + 테스트 통과
- [ ] M4 공지 목록: REQ-NOTICE-011, 012, 013a 구현 + 테스트 통과
- [ ] M5 공지 상세: REQ-NOTICE-014, 015, 016a 구현 + 테스트 통과
- [ ] 첨부파일 / is_pinned API 동작 / 카테고리 CRUD 미구현 확인(Exclusions 준수)
- [ ] MX 태그 적용(ANCHOR/WARN+REASON/NOTE/TODO)
- [ ] TRUST 5 게이트 통과
- [ ] AUTH/SETUP 회귀 없음(기존 290 테스트 통과)

---

*본 plan.md는 구현 디테일(함수명/쿼리 구조)을 포함하나, 이는 Run Phase(manager-tdd)의 구현 가이드이며 spec.md의 WHAT/WHY에 대한 HOW를 정의한다.*
