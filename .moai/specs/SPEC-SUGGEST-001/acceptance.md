# SPEC-SUGGEST-001 Acceptance Criteria

`spec.md`의 8개 모듈(M1~M8)과 40개 REQ-SUGGEST-XXX 요구사항(001~040, a/b 서브 ID 포함)에 대한 Given/When/Then 검증 시나리오. 각 모듈당 최소 2개 시나리오를 정의한다.

---

## M8b. suggestion_categories 시드 + suggestions ALTER + suggestion_replies 마이그레이션 — REQ-SUGGEST-038, 039, 040

### AC-SUGGEST-001: suggestion_categories 테이블 + 4종 시드 (REQ-SUGGEST-038)

**Given** migration 001~007 순차 적용된 DB
**When** `suggestion_categories` 테이블 조회
**Then** 4종 카테고리 행 존재(시설/주차/소음/기타), 각각 id/name/sort_order 컬럼 보유, name UNIQUE 제약 존재

### AC-SUGGEST-002: suggestions 테이블 ALTER 확장 (REQ-SUGGEST-039)

**Given** migration 007 적용된 DB
**When** `information_schema.columns` 조회(`table_name='suggestions'`)
**Then** 컬럼 13종 존재: 004 기존 6종(id, author_id, author_label, archived, unit_id, created_at) + 007 추가 7종(category_id, title, content, is_public, status, updated_at, archived_at); 신규 인덱스 존재: category_id, is_public, status, archived(004 기존 unit_id, author_id 인덱스 유지)

### AC-SUGGEST-003: 004 기존 데이터 보존 (REQ-SUGGEST-039, AUTH 호환성)

**Given** migration 001~004 적용 후 suggestions 행 INSERT(AUTH deactivate 테스트 데이터)
**When** migration 005~007 추가 적용
**Then** 기존 suggestions 행 잔존; 기존 컬럼(id, author_id, author_label, archived, unit_id, created_at) 값 보존; 신규 컬럼 디폴트값(category_id는 NULL 허용이나 NOT NULL DEFAULT 추가이므로 기존 행은 보존, title='', content='', is_public=false, status='접수', updated_at=now(), archived_at=NULL)

### AC-SUGGEST-004: suggestion_replies 테이블 스키마 (REQ-SUGGEST-040)

**Given** migration 007 적용된 DB
**When** `information_schema.columns` 조회(`table_name='suggestion_replies'`)
**Then** 컬럼 존재: id(UUID PK), suggestion_id(UUID FK→suggestions.id), author_id(UUID FK→users.id), content(TEXT), created_at(TIMESTAMPTZ), updated_at(TIMESTAMPTZ); 인덱스 존재: suggestion_id

---

## M1. 건의 등록 (SUGGEST-01) — REQ-SUGGEST-001 ~ 005

### AC-SUGGEST-005: RESIDENT 건의 등록 성공 201 (REQ-SUGGEST-001)

**Given** AUTH 인증 완료 + `role='RESIDENT'` 세션(AT 유효) + `users.unit_id` NOT NULL(동/호수 인증 완료) + `suggestion_categories` 시드 존재
**When** `POST /api/suggestions` 요청 본문 `{ "title": "주차장 조명 교체", "content": "...", "category_id": "<시설_id>", "is_public": true }` 제출
**Then** 응답 `201 Created`, 본문에 id/title/category명/content/is_public/status/author_label/building/unit/created_at 포함; `suggestions` 테이블에 신규 행 존재; `author_id` = 요청자 user id; `unit_id` = 요청자 users.unit_id; `status` = '접수'; `archived` = false; `author_label` = '입주민'

### AC-SUGGEST-006: ADMIN 건의 등록 403 (REQ-SUGGEST-002)

**Given** `role='ADMIN'` 유효한 AT 세션
**When** `POST /api/suggestions` 요청 본문 제출
**Then** 응답 `403 Forbidden`; 신규 행 생성되지 않음

### AC-SUGGEST-007: 미존재 category_id 등록 422 (REQ-SUGGEST-003)

**Given** RESIDENT 세션 + DB에 존재하지 않는 category UUID
**When** `POST /api/suggestions` 요청 본문에 미존재 category_id 제출
**Then** 응답 `422 Unprocessable Entity`; 신규 행 생성되지 않음

### AC-SUGGEST-008: 건의 등록 미인증 401 (REQ-SUGGEST-004)

**Given** 액세스 토큰 없는(미인증) 상태
**When** `POST /api/suggestions` 요청 본문 제출
**Then** 응답 `401 Unauthorized`

### AC-SUGGEST-009: 동/호수 미인증 사용자 등록 403 (REQ-SUGGEST-005)

**Given** `role='RESIDENT'` 세션이나 `users.unit_id`가 NULL(동/호수 미인증)
**When** `POST /api/suggestions` 요청 본문 제출
**Then** 응답 `403 Forbidden`; 신규 행 생성되지 않음

---

## M2. 건의 수정 (SUGGEST-02) — REQ-SUGGEST-006 ~ 011

### AC-SUGGEST-010: 작성자 본인 건의 수정 성공 200 (REQ-SUGGEST-006)

**Given** 기존 건의 행 존재(id=X, author_id=요청자) + RESIDENT 세션
**When** `PUT /api/suggestions/X` 요청 본문 `{ "title": "수정된 제목", "content": "수정된 내용", "category_id": "<주차_id>", "is_public": false }` 제출
**Then** 응답 `200 OK`, 본문에 갱신된 건의 정보; `suggestions` 테이블 해당 행 갱신됨; `updated_at` 갱신됨

### AC-SUGGEST-011: 타인 건의 수정 403 (REQ-SUGGEST-007)

**Given** 기존 건의 행 존재(author_id=타인) + RESIDENT 세션(요청자 ≠ 작성자)
**When** `PUT /api/suggestions/<id>` 요청
**Then** 응답 `403 Forbidden`; 건의 행 변경 없음

### AC-SUGGEST-012: ADMIN 타인 건의 수정 403 (REQ-SUGGEST-007)

**Given** 기존 건의 행 존재(author_id=타인) + ADMIN 세션
**When** `PUT /api/suggestions/<id>` 요청
**Then** 응답 `403 Forbidden` (ADMIN도 작성자 본인 아니면 수정 불가); 건의 행 변경 없음

### AC-SUGGEST-013: 아카이브 건의 수정 409 (REQ-SUGGEST-008)

**Given** 기존 건의 행 존재(archived=true, author_id=요청자) + 작성자 세션
**When** `PUT /api/suggestions/<id>` 요청
**Then** 응답 `409 Conflict`; 건의 행 변경 없음

### AC-SUGGEST-014: 완료 상태 건의 수정 409 (REQ-SUGGEST-008)

**Given** 기존 건의 행 존재(status='완료', author_id=요청자) + 작성자 세션
**When** `PUT /api/suggestions/<id>` 요청
**Then** 응답 `409 Conflict`; 건의 행 변경 없음

### AC-SUGGEST-015: 미존재 건의 수정 404 (REQ-SUGGEST-009)

**Given** RESIDENT 세션 + DB에 존재하지 않는 건의 UUID
**When** `PUT /api/suggestions/<존재하지_않는_uuid>` 요청
**Then** 응답 `404 Not Found`

### AC-SUGGEST-016: 미존재 category_id 수정 422 (REQ-SUGGEST-010)

**Given** 작성자 세션 + 기존 건의 행 + DB에 존재하지 않는 category UUID
**When** `PUT /api/suggestions/<id>` 요청 본문에 미존재 category_id 제출
**Then** 응답 `422 Unprocessable Entity`; 건의 행 변경 없음

### AC-SUGGEST-017: 건의 수정 미인증 401 (REQ-SUGGEST-011)

**Given** 액세스 토큰 없는 상태 + 기존 건의 행
**When** `PUT /api/suggestions/<id>` 요청
**Then** 응답 `401 Unauthorized`

---

## M3. 건의 아카이브 (SUGGEST-03/04) — REQ-SUGGEST-012 ~ 017

### AC-SUGGEST-018: 작성자 본인 아카이브 성공 200 (REQ-SUGGEST-012)

**Given** 기존 건의 행 존재(id=X, author_id=요청자, archived=false, unit_id=U) + 작성자 세션
**When** `DELETE /api/suggestions/X` 요청
**Then** 응답 `200 OK`; `suggestions` 테이블 해당 행의 `archived`=true, `author_id`=NULL, `author_label`='전 입주민', `archived_at`=NOT NULL 갱신됨; **`unit_id`=U 보존됨(변경 없음)**; `title`/`content` 보존됨; 행 삭제되지 않음(SELECT 시 잔존)

### AC-SUGGEST-019: ADMIN 아카이브 성공 200 (REQ-SUGGEST-013)

**Given** 기존 건의 행 존재(id=X, author_id=타인, archived=false) + ADMIN 세션
**When** `DELETE /api/suggestions/X` 요청
**Then** 응답 `200 OK`; REQ-SUGGEST-012와 동일 익명화 절차 수행; unit_id 보존

### AC-SUGGEST-020: 타인(비-ADMIN) 아카이브 403 (REQ-SUGGEST-014)

**Given** 기존 건의 행 존재(author_id=타인) + RESIDENT 세션(요청자 ≠ 작성자, 비-ADMIN)
**When** `DELETE /api/suggestions/<id>` 요청
**Then** 응답 `403 Forbidden`; 건의 행 변경 없음

### AC-SUGGEST-021: 이미 아카이브된 건의 재아카이브 409 (REQ-SUGGEST-015)

**Given** 기존 건의 행 존재(archived=true, author_id=NULL) + ADMIN 세션
**When** `DELETE /api/suggestions/<id>` 요청
**Then** 응답 `409 Conflict`; 건의 행 변경 없음(멱등성)

### AC-SUGGEST-022: 미존재 건의 아카이브 404 (REQ-SUGGEST-016)

**Given** ADMIN 세션 + DB에 존재하지 않는 건의 UUID
**When** `DELETE /api/suggestions/<존재하지_않는_uuid>` 요청
**Then** 응답 `404 Not Found`

### AC-SUGGEST-023: 건의 아카이브 미인증 401 (REQ-SUGGEST-017)

**Given** 액세스 토큰 없는 상태 + 기존 건의 행
**When** `DELETE /api/suggestions/<id>` 요청
**Then** 응답 `401 Unauthorized`

---

## M4. 건의 목록 열람 — 역할별 분기 (SUGGEST-05~08) — REQ-SUGGEST-018 ~ 022

### AC-SUGGEST-024: RESIDENT 목록 조회 — 공개+본인비공개 (REQ-SUGGEST-018, 022)

**Given** suggestions 행 5개(공개 3 + 본인 비공개 1 + 타인 비공개 1) + RESIDENT 세션(요청자)
**When** `GET /api/suggestions` 요청
**Then** 응답 `200 OK`, 본문 `{ "data": { "suggestions": [...], "total": 4 } }`; 공개 3 + 본인 비공개 1 = 4개 반환; 타인 비공개 1은 제외됨; 각 건의에 id/title/category명/is_public/status/author_label/building/unit/created_at 포함; content 미포함

### AC-SUGGEST-025: REP 목록 조회 — 공개+본인+담당동비공개 (REQ-SUGGEST-018, 021)

**Given** suggestions 행 6개(공개 2 + 본인 비공개 1 + 담당 동 타인 비공개 1 + 타 동 타인 비공개 1 + 타 동 공개 1) + REP 세션(managed_building_id=A동)
**When** `GET /api/suggestions` 요청
**Then** 응답 `200 OK`; 공개 3(담당 동+타 동) + 본인 비공개 1 + 담당 동 타인 비공개 1 = 5개 반환; **타 동 타인 비공개 1은 제외됨**

### AC-SUGGEST-026: CHAIR/ADMIN 목록 조회 — 전체 (REQ-SUGGEST-018)

**Given** suggestions 행 N개(공개/비공개 혼합, 다양한 동/작성자) + CHAIR(또는 ADMIN) 세션
**When** `GET /api/suggestions` 요청
**Then** 응답 `200 OK`; 전체 N개 반환(비공개 분기 없이 전체 노출)

### AC-SUGGEST-027: 목록 쿼리 필터 + 페이지네이션 (REQ-SUGGEST-018)

**Given** suggestions 행 25개(다양한 status/category) + RESIDENT 세션
**When** `GET /api/suggestions?status=접수&category_id=<시설_id>&page=1&limit=10` 요청
**Then** 응답 `200 OK`; 결과는 status='접수' + category=시설 필터링됨; 최대 10개(limit); `created_at DESC` 정렬; total은 필터링된 전체 수

### AC-SUGGEST-028: 목록 응답 content 미포함 (REQ-SUGGEST-019)

**Given** suggestions 행들 존재(content NOT NULL) + RESIDENT 세션
**When** `GET /api/suggestions` 요청
**Then** 응답 본문의 각 suggestion 객체에 `content` 필드 부재

### AC-SUGGEST-029: 목록 조회 미인증 401 (REQ-SUGGEST-020)

**Given** 액세스 토큰 없는 상태
**When** `GET /api/suggestions` 요청
**Then** 응답 `401 Unauthorized`

---

## M5. 건의 상세 열람 (SUGGEST-12) — REQ-SUGGEST-023 ~ 026

### AC-SUGGEST-030: 공개 건의 상세 열람 200 (REQ-SUGGEST-023)

**Given** 기존 공개 건의 행 존재(id=X, is_public=true) + RESIDENT 세션
**When** `GET /api/suggestions/X` 요청
**Then** 응답 `200 OK`, 본문에 id/title/content/category명/is_public/status/author_label/building/unit/author_id/created_at/updated_at 포함

### AC-SUGGEST-031: 비공개 건의 본인 상세 200 (REQ-SUGGEST-023)

**Given** 기존 비공개 건의 행 존재(id=X, is_public=false, author_id=요청자) + 작성자 세션
**When** `GET /api/suggestions/X` 요청
**Then** 응답 `200 OK`, 본문에 전체 필드 포함

### AC-SUGGEST-032: 비공개 건의 무권한 403 (REQ-SUGGEST-024)

**Given** 기존 비공개 건의 행 존재(id=X, is_public=false, author_id=타인, unit=타 동) + RESIDENT 세션(요청자 ≠ 작성자, 타 동)
**When** `GET /api/suggestions/X` 요청
**Then** 응답 `403 Forbidden` (404가 아님 — 존재 여부 누출 방지)

### AC-SUGGEST-033: 미존재 건의 상세 404 (REQ-SUGGEST-025)

**Given** RESIDENT 세션 + DB에 존재하지 않는 건의 UUID
**When** `GET /api/suggestions/<존재하지_않는_uuid>` 요청
**Then** 응답 `404 Not Found`

### AC-SUGGEST-034: 건의 상세 미인증 401 (REQ-SUGGEST-026)

**Given** 액세스 토큰 없는 상태 + 기존 건의 행
**When** `GET /api/suggestions/<id>` 요청
**Then** 응답 `401 Unauthorized`

---

## M6. 건의 답변 등록 (SUGGEST-10) — REQ-SUGGEST-027 ~ 029b

### AC-SUGGEST-035: ADMIN 답변 등록 성공 201 (REQ-SUGGEST-027)

**Given** 기존 건의 행 존재(id=X) + ADMIN 세션
**When** `POST /api/suggestions/X/replies` 요청 본문 `{ "content": "확인 후 처리하겠습니다." }` 제출
**Then** 응답 `201 Created`, 본문에 id/suggestion_id/author_id/content/created_at 포함; `suggestion_replies` 테이블에 신규 행 존재; `author_id` = 요청자 ADMIN user id

### AC-SUGGEST-036: 미존재 건의 답변 등록 404 (REQ-SUGGEST-028)

**Given** ADMIN 세션 + DB에 존재하지 않는 건의 UUID
**When** `POST /api/suggestions/<존재하지_않는_uuid>/replies` 요청
**Then** 응답 `404 Not Found`

### AC-SUGGEST-037: 답변 등록 미인증 401 (REQ-SUGGEST-029a)

**Given** 액세스 토큰 없는 상태 + 기존 건의 행
**When** `POST /api/suggestions/<id>/replies` 요청
**Then** 응답 `401 Unauthorized`

### AC-SUGGEST-038: 비-ADMIN 답변 등록 403 (REQ-SUGGEST-029b)

**Given** `role='CHAIR'`(또는 RESIDENT/REP/AUDITOR) 유효한 AT 세션 + 기존 건의 행
**When** `POST /api/suggestions/<id>/replies` 요청
**Then** 응답 `403 Forbidden`; 신규 행 생성되지 않음

---

## M7. 처리 상태 변경 (SUGGEST-11) — REQ-SUGGEST-030 ~ 034b

### AC-SUGGEST-039: ADMIN 상태 변경 성공 200 (REQ-SUGGEST-030, 031)

**Given** 기존 건의 행 존재(id=X, status='접수') + ADMIN 세션
**When** `PUT /api/suggestions/X/status` 요청 본문 `{ "status": "처리중" }` 제출
**Then** 응답 `200 OK`, 본문에 갱신된 status='처리중' 포함; `suggestions` 테이블 해당 행 status 갱신됨; `updated_at` 갱신됨

### AC-SUGGEST-040: 불가능한 상태 전이 409 (REQ-SUGGEST-031, 032)

**Given** 기존 건의 행 존재(id=X, status='접수') + ADMIN 세션
**When** `PUT /api/suggestions/X/status` 요청 본문 `{ "status": "완료" }` 제출 (접수→완료 스킵 불허)
**Then** 응답 `409 Conflict`, 본문에 현재 status='접수'와 요청 status='완료' 포함; 건의 행 변경 없음

### AC-SUGGEST-041: 완료→재오픈 200 (REQ-SUGGEST-031)

**Given** 기존 건의 행 존재(id=X, status='완료') + ADMIN 세션
**When** `PUT /api/suggestions/X/status` 요청 본문 `{ "status": "접수", "reason": "재발" }` 제출
**Then** 응답 `200 OK`, status='접수'로 갱신; reason 제공된 경우 로그 기록

### AC-SUGGEST-042: 보류 전이 200 (REQ-SUGGEST-031)

**Given** 기존 건의 행 존재(id=X, status='처리중') + ADMIN 세션
**When** `PUT /api/suggestions/X/status` 요청 본문 `{ "status": "보류", "reason": "외부 업체 대기" }` 제출
**Then** 응답 `200 OK`, status='보류'로 갱신

### AC-SUGGEST-043: 미존재 건의 상태 변경 404 (REQ-SUGGEST-033)

**Given** ADMIN 세션 + DB에 존재하지 않는 건의 UUID
**When** `PUT /api/suggestions/<존재하지_않는_uuid>/status` 요청
**Then** 응답 `404 Not Found`

### AC-SUGGEST-044: 상태 변경 미인증 401 (REQ-SUGGEST-034a)

**Given** 액세스 토큰 없는 상태 + 기존 건의 행
**When** `PUT /api/suggestions/<id>/status` 요청
**Then** 응답 `401 Unauthorized`

### AC-SUGGEST-045: 비-ADMIN 상태 변경 403 (REQ-SUGGEST-034b)

**Given** `role='CHAIR'`(또는 RESIDENT/REP/AUDITOR) 유효한 AT 세션 + 기존 건의 행
**When** `PUT /api/suggestions/<id>/status` 요청
**Then** 응답 `403 Forbidden`; 건의 행 변경 없음

---

## M8a. 호수별 건의 이력 조회 (SUGGEST-09) — REQ-SUGGEST-035 ~ 037b

### AC-SUGGEST-046: ADMIN 호수별 이력 조회 200 (REQ-SUGGEST-035)

**Given** 특정 unit_id(U)에 귀속된 suggestions 행 5개(활성 3 + 아카이브 2, 공개/비공개 혼합) + ADMIN 세션
**When** `GET /api/suggestions/units/<building_id>/<unit_number>` 요청
**Then** 응답 `200 OK`, 본문에 해당 호수의 전체 5개 건의(아카이브 포함, 비공개 포함) 반환; `created_at ASC` 시간순 정렬; 각 건의에 id/title/category명/is_public/status/author_label/created_at/archived/archived_at 포함

### AC-SUGGEST-047: CHAIR 호수별 이력 조회 200 (REQ-SUGGEST-035)

**Given** 특정 unit_id(U)에 귀속된 suggestions 행들 + CHAIR 세션
**When** `GET /api/suggestions/units/<building_id>/<unit_number>` 요청
**Then** 응답 `200 OK`; ADMIN과 동일하게 전체 이력 반환

### AC-SUGGEST-048: 미존재 building/unit 조합 404 (REQ-SUGGEST-036)

**Given** ADMIN 세션 + DB에 존재하지 않는 building_id + unit_number 조합
**When** `GET /api/suggestions/units/<존재하지_않는_building_id>/<unit_number>` 요청
**Then** 응답 `404 Not Found`

### AC-SUGGEST-049: 호수별 이력 조회 미인증 401 (REQ-SUGGEST-037a)

**Given** 액세스 토큰 없는 상태
**When** `GET /api/suggestions/units/<building_id>/<unit_number>` 요청
**Then** 응답 `401 Unauthorized`

### AC-SUGGEST-050: 비-ADMIN/비-CHAIR 호수별 이력 조회 403 (REQ-SUGGEST-037b)

**Given** `role='REP'`(또는 RESIDENT/AUDITOR) 유효한 AT 세션
**When** `GET /api/suggestions/units/<building_id>/<unit_number>` 요청
**Then** 응답 `403 Forbidden`

---

## Edge Cases (경계 케이스)

### EC-SUGGEST-001: title 길이 초과 422

**Given** RESIDENT 세션
**When** `POST /api/suggestions` 본문 `{ "title": "a".repeat(101), "content": "...", "category_id": "<id>", "is_public": true }` 제출(101자)
**Then** 응답 `422 Unprocessable Entity`(VARCHAR(100) 초과)

### EC-SUGGEST-002: content 길이 초과 422 (5000자 — NOTICE 10000자와 상이)

**Given** RESIDENT 세션
**When** `POST /api/suggestions` 본문 `{ "title": "...", "content": "a".repeat(5001), "category_id": "<id>", "is_public": true }` 제출(5001자)
**Then** 응답 `422 Unprocessable Entity`(5000자 초과 — SUGGEST는 5000자 제한)

### EC-SUGGEST-003: path param UUID 형식 오류 400

**Given** RESIDENT 세션
**When** `GET /api/suggestions/not-a-uuid` 요청
**Then** 응답 `400 Bad Request`(UUID_RE 불일치)

### EC-SUGGEST-004: title 빈 문자열 422

**Given** RESIDENT 세션
**When** `POST /api/suggestions` 본문 `{ "title": "", "content": "...", "category_id": "<id>", "is_public": true }` 제출
**Then** 응답 `422 Unprocessable Entity`(최소 1자)

### EC-SUGGEST-005: 페이지네이션 기본값/최대값

**Given** suggestions 행 25개 + RESIDENT 세션
**When** `GET /api/suggestions` 요청(page/limit 생략)
**Then** 응답에 첫 20개(limit 기본 20), total=25; `?limit=100` 시 최대 100개 허용; `?limit=200` 시 100으로 제한

### EC-SUGGEST-006: 아카이브 후 unit_id 보존 (ADR-005 핵심)

**Given** 기존 건의 행 존재(id=X, author_id=A, unit_id=U, archived=false) + 작성자 A 세션
**When** `DELETE /api/suggestions/X` 요청
**Then** 응답 `200 OK`; 해당 행의 `author_id`=NULL, `author_label`='전 입주민', `archived`=true 갱신; **`unit_id`=U 보존(변경 없음)**; 이후 `GET /api/suggestions/units/<building>/<unit>`(U에 해당) 요청 시 해당 건의가 아카이브 상태로 잔존 조회됨

### EC-SUGGEST-007: status enum 외 값 422

**Given** ADMIN 세션 + 기존 건의 행
**When** `PUT /api/suggestions/<id>/status` 본문 `{ "status": "취소" }` 제출(허용 enum 외)
**Then** 응답 `422 Unprocessable Entity`(status enum: 접수/처리중/완료/보류만 허용)

### EC-SUGGEST-008: REP 비-담당동 비공개 건의 상세 403

**Given** 기존 비공개 건의 행 존재(unit=타 동, author_id=타인) + REP 세션(managed_building_id=본인 동 ≠ 건의 동)
**When** `GET /api/suggestions/<id>` 요청
**Then** 응답 `403 Forbidden` (REP는 담당 동 비공개만, 타 동 비공개는 403)

---

## Quality Gates

### TRUST 5

- **Tested**: 신규 route handlers 테스트 커버리지 85% 이상; 기존 AUTH/SETUP/NOTICE 333 테스트 회귀 없음(AUTH deactivate 사이드이펙트 포함)
- **Readable**: 한국어 도메인 용어(건의/카테고리/아카이브/답변/상태전이) 주석 유지; 영어 함수/변수명
- **Unified**: AUTH/SETUP/NOTICE 패턴(requireAdmin/requirePrivileged, RBAC 응답 빌더, zod, Parameterized Query, UUID_RE, route-level Bearer) 일관 적용
- **Secured**: RBAC + 역할별 비공개 분기(RESIDENT 본인 / REP 담당동 / CHAIR·ADMIN 전체), ADR-005 호수 귀속(unit_id 영구 보존), zod 입력 검증(title 100자/content 5000자/category_id UUID/status enum), Parameterized Query, 비공개 무권한 403(404 아님)
- **Trackable**: 커밋 메시지에 `SPEC-SUGGEST-001` + `REQ-SUGGEST-XXX` 참조

### LSP 게이트

- TypeScript 에러 0
- ESLint 에러 0
- migration 007 SQL 문법 검증(pass)

### 호환성 게이트

- AUTH 333 테스트 회귀 없음(deactivate 사이드이펙트 포함)
- SETUP 333 테스트 회귀 없음
- NOTICE 333 테스트 회귀 없음(middleware 수정 없음, 독립 도메인)
- 기존 004 suggestions 데이터 보존(ALTER ADD만, 재생성 아님)

---

## Definition of Done

- [ ] AC-SUGGEST-001 ~ AC-SUGGEST-050 (50개 시나리오) 전체 통과
- [ ] EC-SUGGEST-001 ~ EC-SUGGEST-008 (8개 경계 케이스) 전체 통과
- [ ] TRUST 5 게이트 통과(커버리지 85%+)
- [ ] 기존 333 테스트 회귀 없음
- [ ] LSP 게이트(에러 0) 통과
- [ ] MX 태그 적용 완료
- [ ] `spec.md`의 40개 REQ-SUGGEST-XXX(001~040, a/b 서브 포함) 전부 구현 검증
- [ ] 첨부파일 / 카테고리 CRUD / 영구 삭제 / 답변 수정·삭제 미구현 확인(Exclusions 준수)
- [ ] ADR-005 호수 귀속 검증(unit_id 영구 보존, 아카이브 후에도 유지)

---

*본 acceptance.md는 `spec.md`의 WHAT/WHY를 관측 가능한 증거(HTTP 응답 코드, DB 상태, 테스트 통과)로 변환한다.*
