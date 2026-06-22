# SPEC-NOTICE-001 Acceptance Criteria

`spec.md`의 6개 모듈(M1~M6)과 18개 REQ-NOTICE-XXX 요구사항(001~018, a/b 서브 ID 포함)에 대한 Given/When/Then 검증 시나리오. 각 모듈당 최소 2개 시나리오를 정의한다.

---

## M6. 카테고리 시드 + notices 마이그레이션 — REQ-NOTICE-017, 018

### AC-NOTICE-001: notice_categories 테이블 + 4종 시드 (REQ-NOTICE-017)

**Given** migration 001~006 순차 적용된 DB
**When** `notice_categories` 테이블 조회
**Then** 4종 카테고리 행 존재(일반/긴급/주차/시설), 각각 id/name/sort_order 컬럼 보유

### AC-NOTICE-002: notices 테이블 스키마 (REQ-NOTICE-018)

**Given** migration 006 적용된 DB
**When** `information_schema.columns` 조회(`table_name='notices'`)
**Then** 컬럼 존재: id(UUID PK), author_id(UUID FK→users.id), category_id(UUID FK→notice_categories.id), title(VARCHAR(100) NOT NULL), content(TEXT NOT NULL), is_pinned(BOOLEAN DEFAULT false), created_at(TIMESTAMPTZ), updated_at(TIMESTAMPTZ); 인덱스 존재: category_id, is_pinned, created_at DESC

---

## M1. 공지 등록 (NOTICE-01) — REQ-NOTICE-001 ~ 003b

### AC-NOTICE-003: ADMIN 공지 등록 성공 201 (REQ-NOTICE-001)

**Given** AUTH 인증 완료 + `role='ADMIN'` 세션(AT 유효) + `notice_categories` 시드 존재
**When** `POST /api/notices` 요청 본문 `{ "title": "엘리베이터 점검 안내", "content": "...", "category_id": "<시설_id>" }` 제출
**Then** 응답 `201 Created`, 본문에 id/title/category명/content/author_id/created_at 포함; `notices` 테이블에 신규 행 존재; `author_id` = 요청자 ADMIN user id; `is_pinned` = false(디폴트)

### AC-NOTICE-004: 미존재 category_id 등록 422 (REQ-NOTICE-002)

**Given** ADMIN 세션 + DB에 존재하지 않는 category UUID
**When** `POST /api/notices` 요청 본문 `{ "title": "...", "content": "...", "category_id": "<존재하지_않는_uuid>" }` 제출
**Then** 응답 `422 Unprocessable Entity`; 신규 행 생성되지 않음

### AC-NOTICE-005: 공지 등록 미인증 401 (REQ-NOTICE-003a)

**Given** 액세스 토큰 없는(미인증) 상태
**When** `POST /api/notices` 요청 본문 `{ "title": "...", "content": "...", "category_id": "<id>" }` 제출
**Then** 응답 `401 Unauthorized`

### AC-NOTICE-006: 비-ADMIN 공지 등록 403 (REQ-NOTICE-003b)

**Given** `role='CHAIR'`(또는 REP/AUDITOR/RESIDENT) 유효한 AT 세션
**When** `POST /api/notices` 요청 본문 제출
**Then** 응답 `403 Forbidden`; 신규 행 생성되지 않음

---

## M2. 공지 수정 (NOTICE-02) — REQ-NOTICE-004 ~ 007b

### AC-NOTICE-007: ADMIN 공지 수정 성공 200 (REQ-NOTICE-004)

**Given** ADMIN 세션 + 기존 공지 행 존재(id=X)
**When** `PUT /api/notices/X` 요청 본문 `{ "title": "수정된 제목", "content": "수정된 내용", "category_id": "<일반_id>" }` 제출
**Then** 응답 `200 OK`, 본문에 갱신된 공지 정보; `notices` 테이블의 해당 행 title/content/category_id 갱신됨; `updated_at` 갱신됨

### AC-NOTICE-008: 미존재 공지 수정 404 (REQ-NOTICE-005)

**Given** ADMIN 세션 + DB에 존재하지 않는 공지 UUID
**When** `PUT /api/notices/<존재하지_않는_uuid>` 요청
**Then** 응답 `404 Not Found`

### AC-NOTICE-009: 미존재 category_id 수정 422 (REQ-NOTICE-006)

**Given** ADMIN 세션 + 기존 공지 행 + DB에 존재하지 않는 category UUID
**When** `PUT /api/notices/<id>` 요청 본문에 미존재 category_id 제출
**Then** 응답 `422 Unprocessable Entity`; 공지 행 변경 없음

### AC-NOTICE-010: 공지 수정 미인증 401 (REQ-NOTICE-007a)

**Given** 액세스 토큰 없는 상태 + 기존 공지 행
**When** `PUT /api/notices/<id>` 요청
**Then** 응답 `401 Unauthorized`

### AC-NOTICE-011: 비-ADMIN 공지 수정 403 (REQ-NOTICE-007b)

**Given** `role='RESIDENT'`(또는 CHAIR/REP/AUDITOR) 유효한 AT 세션
**When** `PUT /api/notices/<id>` 요청
**Then** 응답 `403 Forbidden`; 공지 행 변경 없음

---

## M3. 공지 삭제 (NOTICE-03) — REQ-NOTICE-008 ~ 010b

### AC-NOTICE-012: ADMIN 공지 영구 삭제 200 (REQ-NOTICE-008)

**Given** ADMIN 세션 + 기존 공지 행 존재(id=X)
**When** `DELETE /api/notices/X` 요청
**Then** 응답 `200 OK`; `notices` 테이블에서 해당 행 완전 삭제(hard delete, `SELECT * FROM notices WHERE id=X` 빈 결과)

### AC-NOTICE-013: 미존재 공지 삭제 404 (REQ-NOTICE-009)

**Given** ADMIN 세션 + DB에 존재하지 않는 공지 UUID
**When** `DELETE /api/notices/<존재하지_않는_uuid>` 요청
**Then** 응답 `404 Not Found`

### AC-NOTICE-014: 공지 삭제 미인증 401 (REQ-NOTICE-010a)

**Given** 액세스 토큰 없는 상태 + 기존 공지 행
**When** `DELETE /api/notices/<id>` 요청
**Then** 응답 `401 Unauthorized`

### AC-NOTICE-015: 비-ADMIN 공지 삭제 403 (REQ-NOTICE-010b)

**Given** `role='REP'`(또는 CHAIR/AUDITOR/RESIDENT) 유효한 AT 세션
**When** `DELETE /api/notices/<id>` 요청
**Then** 응답 `403 Forbidden`; 공지 행 삭제되지 않음

---

## M4. 공지 목록 열람 (NOTICE-04) — REQ-NOTICE-011 ~ 013a

### AC-NOTICE-016: 인증 사용자 목록 조회 + 필터 200 (REQ-NOTICE-011)

**Given** `notices` 행 5개(다양한 category) + RESIDENT 세션
**When** `GET /api/notices?category_id=<시설_id>&page=1&limit=20` 요청
**Then** 응답 `200 OK`, 본문 `{ "data": { "notices": [...], "total": <N> } }`; 결과는 시설 category 필터링됨; `created_at DESC` 정렬; 각 공지에 id/title/category명/created_at 포함

### AC-NOTICE-017: 목록 응답 content 미포함 (REQ-NOTICE-012)

**Given** `notices` 행들 존재(content NOT NULL) + RESIDENT 세션
**When** `GET /api/notices` 요청
**Then** 응답 본문의 각 notice 객체에 `content` 필드 부재

### AC-NOTICE-018: 목록 조회 미인증 401 (REQ-NOTICE-013a)

**Given** 액세스 토큰 없는 상태
**When** `GET /api/notices` 요청
**Then** 응답 `401 Unauthorized`

### AC-NOTICE-019: 전체 역할 목록 조회 허용 (REQ-NOTICE-011)

**Given** RESIDENT/REP/AUDITOR/CHAIR/ADMIN 각각의 세션 + notices 행 존재
**When** 각 역할로 `GET /api/notices` 요청
**Then** 모든 역할에 대해 `200 OK` 응답(읽기는 역할 무관, 인증만 필요)

---

## M5. 공지 상세 열람 (NOTICE-05) — REQ-NOTICE-014 ~ 016a

### AC-NOTICE-020: 인증 사용자 공지 상세 200 (REQ-NOTICE-014)

**Given** 기존 공지 행 존재(id=X) + RESIDENT 세션
**When** `GET /api/notices/X` 요청
**Then** 응답 `200 OK`, 본문에 id/title/content/category명/author_id/created_at/updated_at 포함

### AC-NOTICE-021: 미존재 공지 상세 404 (REQ-NOTICE-015)

**Given** RESIDENT 세션 + DB에 존재하지 않는 공지 UUID
**When** `GET /api/notices/<존재하지_않는_uuid>` 요청
**Then** 응답 `404 Not Found`

### AC-NOTICE-022: 공지 상세 미인증 401 (REQ-NOTICE-016a)

**Given** 액세스 토큰 없는 상태 + 기존 공지 행
**When** `GET /api/notices/<id>` 요청
**Then** 응답 `401 Unauthorized`

---

## Edge Cases (경계 케이스)

### EC-NOTICE-001: title 길이 초과 422

**Given** ADMIN 세션
**When** `POST /api/notices` 본문 `{ "title": "a".repeat(101), "content": "...", "category_id": "<id>" }` 제출(101자)
**Then** 응답 `422 Unprocessable Entity`(VARCHAR(100) 초과)

### EC-NOTICE-002: content 길이 초과 422

**Given** ADMIN 세션
**When** `POST /api/notices` 본문 `{ "title": "...", "content": "a".repeat(10001), "category_id": "<id>" }` 제출(10001자)
**Then** 응답 `422 Unprocessable Entity`(10000자 초과)

### EC-NOTICE-003: path param UUID 형식 오류 400

**Given** ADMIN 세션
**When** `GET /api/notices/not-a-uuid` 요청
**Then** 응답 `400 Bad Request`(UUID_RE 불일치)

### EC-NOTICE-004: title 빈 문자열 422

**Given** ADMIN 세션
**When** `POST /api/notices` 본문 `{ "title": "", "content": "...", "category_id": "<id>" }` 제출
**Then** 응답 `422 Unprocessable Entity`(최소 1자)

### EC-NOTICE-005: 페이지네이션 기본값/최대값

**Given** notices 행 25개 + RESIDENT 세션
**When** `GET /api/notices` 요청(page/limit 생략)
**Then** 응답에 첫 20개(limit 기본 20), total=25; `?limit=100` 시 최대 100개 허용; `?limit=200` 시 100으로 제한

### EC-NOTICE-006: is_pinned 요청 본문 무시

**Given** ADMIN 세션
**When** `POST /api/notices` 본문에 `is_pinned: true` 포함 제출
**Then** 응답 `201 Created`; 저장된 행의 `is_pinned` = false(본 SPEC은 is_pinned API 동작 미노출, 요청 값 무시)

---

## Quality Gates

### TRUST 5

- **Tested**: 신규 route handlers 테스트 커버리지 85% 이상; 기존 AUTH/SETUP 290 테스트 회귀 없음
- **Readable**: 한국어 도메인 용어(공지/카테고리/관리사무소) 주석 유지; 영어 함수/변수명
- **Unified**: AUTH/SETUP 패턴(requireAdmin, RBAC 응답 빌더, zod, Parameterized Query, UUID_RE) 일관 적용
- **Secured**: RBAC(ADMIN 쓰기, 인증 사용자 읽기), zod 입력 검증(title 100자/content 10000자/category_id UUID), Parameterized Query
- **Trackable**: 커밋 메시지에 `SPEC-NOTICE-001` + `REQ-NOTICE-XXX` 참조

### LSP 게이트

- TypeScript 에러 0
- ESLint 에러 0
- migration 006 SQL 문법 검증(pass)

### 호환성 게이트

- AUTH 290 테스트 회귀 없음
- SETUP 290 테스트 회귀 없음(middleware 수정 없음, 독립 도메인)

---

## Definition of Done

- [ ] AC-NOTICE-001 ~ AC-NOTICE-022 (22개 시나리오) 전체 통과
- [ ] EC-NOTICE-001 ~ EC-NOTICE-006 (6개 경계 케이스) 전체 통과
- [ ] TRUST 5 게이트 통과(커버리지 85%+)
- [ ] 기존 290 테스트 회귀 없음
- [ ] LSP 게이트(에러 0) 통과
- [ ] MX 태그 적용 완료
- [ ] `spec.md`의 18개 REQ-NOTICE-XXX(001~018, a/b 서브 포함) 전부 구현 검증
- [ ] 첨부파일 / is_pinned API 동작 / 카테고리 CRUD 미구현 확인(Exclusions 준수)

---

*본 acceptance.md는 `spec.md`의 WHAT/WHY를 관측 가능한 증거(HTTP 응답 코드, DB 상태, 테스트 통과)로 변환한다.*
