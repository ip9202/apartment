# SPEC-SETUP-001 Acceptance Criteria

`spec.md`의 6개 모듈(M1~M6)과 20개 REQ-SETUP-XXX 요구사항(001~020, a/b 서브 ID 포함)에 대한 Given/When/Then 검증 시나리오. 각 모듈당 최소 2개 시나리오를 정의한다.

---

## M1. 동 관리 (SETUP-01) — REQ-SETUP-001 ~ REQ-SETUP-004b

### AC-SETUP-001: ADMIN 동 추가 성공 (REQ-SETUP-001)

**Given** AUTH 가입 완료 + `role='ADMIN'` 인증된 세션(AT 유효)
**When** `POST /api/setup/buildings` 요청 본문 `{ "name": "C동" }` 제출
**Then** 응답 `201 Created`, 본문 `{ "data": { "id": "<uuid>", "name": "C동" } }`, `buildings` 테이블에 신규 행 존재

### AC-SETUP-002: 동명 중복 409 (REQ-SETUP-002)

**Given** `buildings` 테이블에 `name='A동'` 행 존재 + ADMIN 세션
**When** `POST /api/setup/buildings` 요청 본문 `{ "name": "A동" }` 제출
**Then** 응답 `409 Conflict`, 본문 `{ "error": { "code": "CONFLICT", "message": "..." } }`, 신규 행 생성되지 않음

### AC-SETUP-003: 활성 입주민 있는 동 삭제 금지 409 (REQ-SETUP-003)

**Given** `buildings` A동 + A동 101호 + `users` 행 `unit_id=101호`, `status='ACTIVE'`, `verified_at IS NOT NULL` + ADMIN 세션
**When** `DELETE /api/setup/buildings/<A동_id>` 요청
**Then** 응답 `409 Conflict`, A동 및 101호 행 삭제되지 않음

### AC-SETUP-004: 비-ADMIN 동 추가 403 (REQ-SETUP-004)

**Given** AUTH 가입 + `role='CHAIR'`(또는 REP/AUDITOR/RESIDENT/미인증) 세션
**When** `POST /api/setup/buildings` 요청 본문 `{ "name": "C동" }` 제출
**Then** 응답 `403 Forbidden`, 신규 행 생성되지 않음

### AC-SETUP-005: 미존재 동 삭제 404 (REQ-SETUP-003)

**Given** ADMIN 세션 + DB에 존재하지 않는 UUID
**When** `DELETE /api/setup/buildings/<존재하지_않는_uuid>` 요청
**Then** 응답 `404 Not Found`

---

## M2. 호수 관리 (SETUP-02) — REQ-SETUP-005 ~ REQ-SETUP-008b

### AC-SETUP-006: 호수 일괄 업데이트 성공 200 (REQ-SETUP-005)

**Given** A동 존재 + 기존 호수 `["101", "102"]` + ADMIN 세션
**When** `PUT /api/setup/buildings/<A동_id>/units` 요청 본문 `{ "units": ["101", "102", "201"] }` 제출
**Then** 응답 `200 OK`, 본문 `{ "data": { "building_id": "<A동_id>", "units": ["101", "102", "201"] } }`, `units` 테이블에 201 행 추가됨

### AC-SETUP-007: 삭제 대상 호수 활성 입주민 409 (REQ-SETUP-006)

**Given** A동 + 기존 호수 `["101", "102", "201"]` + `users` 행 `unit_id=101호`, `status='ACTIVE'` + ADMIN 세션
**When** `PUT /api/setup/buildings/<A동_id>/units` 요청 본문 `{ "units": ["102", "201"] }` 제출(101 삭제 시도)
**Then** 응답 `409 Conflict`, `units` 테이블 변경 없음(트랜잭션 롤백)

### AC-SETUP-008: 미존재 building_id 호수 업데이트 404 (REQ-SETUP-007)

**Given** ADMIN 세션 + DB에 존재하지 않는 building UUID
**When** `PUT /api/setup/buildings/<존재하지_않는_uuid>/units` 요청 본문 `{ "units": ["101"] }` 제출
**Then** 응답 `404 Not Found`

### AC-SETUP-009a: 호수 업데이트 미인증 401 (REQ-SETUP-008a)

**Given** 액세스 토큰 없는(미인증) 상태
**When** `PUT /api/setup/buildings/<A동_id>/units` 요청 본문 `{ "units": ["101"] }` 제출
**Then** 응답 `401 Unauthorized`

### AC-SETUP-009b: 비-ADMIN 호수 업데이트 403 (REQ-SETUP-008b)

**Given** `role='REP'`(또는 CHAIR/AUDITOR/RESIDENT) 유효한 AT 세션
**When** `PUT /api/setup/buildings/<A동_id>/units` 요청 본문 `{ "units": ["101"] }` 제출
**Then** 응답 `403 Forbidden`

---

## M3. 직책 부여/변경/회수 (SETUP-04) — REQ-SETUP-009 ~ REQ-SETUP-013b

### AC-SETUP-010: RESIDENT→REP 부여 + managed_building_id 갱신 200 (REQ-SETUP-009)

**Given** `users` 행 X, `role='RESIDENT'`, `managed_building_id=NULL` + ADMIN 세션
**When** `PUT /api/setup/users/<X_id>/role` 요청 본문 `{ "role": "REP", "managed_building_id": "<A동_id>" }` 제출
**Then** 응답 `200 OK`, 본문 `{ "data": { "id": "<X_id>", "role": "REP", "managed_building_id": "<A동_id>" } }`, `users.role_id` = REP, `users.managed_building_id` = A동_id

### AC-SETUP-011: 회장 부여 시 기존 회장 자동 회수 (원자) (REQ-SETUP-010)

**Given** `users` 행 Y, `role='CHAIR'`(현재 회장) + `users` 행 Z, `role='RESIDENT'` + ADMIN 세션
**When** `PUT /api/setup/users/<Z_id>/role` 요청 본문 `{ "role": "CHAIR" }` 제출
**Then** 응답 `200 OK`; `users` 행 Y 는 `role='RESIDENT'`, `managed_building_id=NULL` 로 갱신; `users` 행 Z 는 `role='CHAIR'`; 단일 트랜잭션으로 원자적 처리(중간 상태 관측 불가)

### AC-SETUP-012: REP 부여 managed_building_id 누락 422 (REQ-SETUP-011)

**Given** `users` 행 X, `role='RESIDENT'` + ADMIN 세션
**When** `PUT /api/setup/users/<X_id>/role` 요청 본문 `{ "role": "REP" }` 제출(`managed_building_id` 누락)
**Then** 응답 `422 Unprocessable Entity`, `users` 행 X 변경 없음

### AC-SETUP-013: CHAIR 의 ADMIN 부여 403 (REQ-SETUP-012)

**Given** 호출자 `role='CHAIR'` + `users` 행 X, `role='RESIDENT'`
**When** `PUT /api/setup/users/<X_id>/role` 요청 본문 `{ "role": "ADMIN" }` 제출(CHAIR 권한 범위 초과)
**Then** 응답 `403 Forbidden`, `users` 행 X 변경 없음

### AC-SETUP-014: 직책 회수→RESIDENT 200 (REQ-SETUP-009)

**Given** `users` 행 X, `role='REP'`, `managed_building_id=<A동_id>` + ADMIN 세션
**When** `PUT /api/setup/users/<X_id>/role` 요청 본문 `{ "role": "RESIDENT" }` 제출
**Then** 응답 `200 OK`, `users.role_id` = RESIDENT, `users.managed_building_id` = NULL

### AC-SETUP-015a: 직책 부여 미인증 401 (REQ-SETUP-013a)

**Given** 액세스 토큰 없는(미인증) 상태
**When** `PUT /api/setup/users/<X_id>/role` 요청 본문 `{ "role": "AUDITOR" }` 제출
**Then** 응답 `401 Unauthorized`

### AC-SETUP-015b: 비-ADMIN/비-CHAIR 직책 부여 403 (REQ-SETUP-013b)

**Given** 호출자 `role='REP'`(또는 AUDITOR/RESIDENT) 유효한 AT 세션
**When** `PUT /api/setup/users/<X_id>/role` 요청 본문 `{ "role": "AUDITOR" }` 제출
**Then** 응답 `403 Forbidden`, `users` 행 X 변경 없음

---

## M4. 회원 목록 조회 (SETUP-05) — REQ-SETUP-014 ~ REQ-SETUP-017

### AC-SETUP-016: 회원 목록 조회 + 필터 200 (REQ-SETUP-014)

**Given** `users` 행 12개(다양한 role/building) + ADMIN 세션
**When** `GET /api/setup/users?building=A동&role=RESIDENT&page=1&limit=20` 요청
**Then** 응답 `200 OK`, 본문 `{ "data": { "users": [...], "total": <N> } }`, 결과는 A동 + RESIDENT 필터링됨, `created_at DESC` 정렬

### AC-SETUP-017: password_hash 미포함 (REQ-SETUP-015)

**Given** `users` 행들 존재(`password_hash` NOT NULL) + ADMIN 세션
**When** `GET /api/setup/users` 요청
**Then** 응답 본문의 각 user 객체에 `password_hash` 필드 부재(직렬화에서 제외)

### AC-SETUP-018a: 회원 목록 미인증 401 (REQ-SETUP-016a)

**Given** 액세스 토큰 없는(미인증) 상태
**When** `GET /api/setup/users` 요청
**Then** 응답 `401 Unauthorized`

### AC-SETUP-018b: 비-ADMIN 회원 목록 403 (REQ-SETUP-016b)

**Given** 호출자 `role='CHAIR'`(또는 REP/AUDITOR/RESIDENT) 유효한 AT 세션
**When** `GET /api/setup/users` 요청
**Then** 응답 `403 Forbidden`

### AC-SETUP-019: INACTIVE 회원 기본 제외 (REQ-SETUP-017)

**Given** `users` 행 10개(ACTIVE) + 2개(INACTIVE) + ADMIN 세션
**When** `GET /api/setup/users` 요청(`status` 파라미터 생략)
**Then** 응답 본문의 users 배열에 ACTIVE 10개만 포함, INACTIVE 2개 제외; `?status=INACTIVE` 명시 시 INACTIVE 만 반환

---

## M5. managed_building_id 단일 출처 통일 (roles.managed_building_id 제거) — REQ-SETUP-018 ~ REQ-SETUP-019

### AC-SETUP-020: roles.managed_building_id 컬럼 부재 (REQ-SETUP-018)

**Given** migration 001~005 순차 적용된 DB
**When** `information_schema.columns` 조회(`table_name='roles'`)
**Then** `roles.managed_building_id` 컬럼 부재; 기존 roles 5종 행(ADMIN/CHAIR/REP/AUDITOR/RESIDENT) 데이터 손실 없음

### AC-SETUP-021: users.managed_building_id 존재 + FK 유효 (REQ-SETUP-019)

**Given** migration 001~005 적용된 DB
**When** `information_schema.columns` + `information_schema.table_constraints` 조회
**Then** `users.managed_building_id` 컬럼 존재; FK `users_managed_building_id_fkey` → `buildings.id` 존재

### AC-SETUP-022: AUTH verify-unit REP 인증 회귀 (AC-AUTH-015 통과) (REQ-SETUP-019)

**Given** roles.managed_building_id 제거 마이그레이션 적용 + AUTH verify-unit 테스트 환경
**When** AUTH AC-AUTH-015(REP 인증 시 `users.managed_building_id` 자동 연결) 시나리오 실행
**Then** AC-AUTH-015 통과(AUTH 코드는 이미 `users.managed_building_id` 기반이므로 회귀 없음)

### AC-SETUP-023: AUTH migration-001.test.ts roles 블록 업데이트 통과 (REQ-SETUP-018)

**Given** roles.managed_building_id 제거 마이그레이션 적용 + AUTH `migration-001.test.ts:90` 의 `assertColumnsExist` roles 블록에서 `{ table: 'roles', column: 'managed_building_id', ... }` 항목 제거
**When** AUTH `migration-001.test.ts` 실행
**Then** `assertColumnsExist` roles 블록 통과(해당 항목 제거됨); `migration-001.test.ts:142-145` 의 `users_managed_building_id_fkey` 검증도 통과(`users` 기반, 영향 없음); AUTH 테스트 전체 녹색

---

## M6. 동/호수 공개 조회 — REQ-SETUP-020

### AC-SETUP-024: GET buildings 비인증 200 (REQ-SETUP-020)

**Given** 미인증 상태(AT 없음) + `buildings`/`units` 시드 데이터 존재
**When** `GET /api/setup/buildings` 요청
**Then** 응답 `200 OK`, 본문에 동 목록과 종속 호수(`unit_number` 배열) 포함; 회원 데이터(email/password_hash/role 등) 미포함; middleware matcher 예외로 비인증 허용

---

## Edge Cases (경계 케이스)

### EC-SETUP-001: 동 추가 name 길이 초과 422 (REQ-SETUP-007a)

**Given** ADMIN 세션
**When** `POST /api/setup/buildings` 본문 `{ "name": "AAAAAAAAAAAAAAAAAAAAA" }` (21자)
**Then** 응답 `422 Unprocessable Entity`(VARCHAR(20) 초과)

### EC-SETUP-002: 동 삭제 UUID 형식 오류 400 (REQ-SETUP-007a)

**Given** ADMIN 세션
**When** `DELETE /api/setup/buildings/not-a-uuid` 요청
**Then** 응답 `400 Bad Request`(`UUID_RE` 불일치)

### EC-SETUP-003: 호수 업데이트 빈 배열 (REQ-SETUP-005)

**Given** A동 + 기존 호수 `["101"]` (활성 입주민 없음) + ADMIN 세션
**When** `PUT /api/setup/buildings/<A동_id>/units` 본문 `{ "units": [] }` 제출
**Then** 응답 `200 OK`, `units` 테이블에서 A동 호수 전체 삭제(빈 배열 = 전체 삭제, 활성 입주민 없으므로 허용)

### EC-SETUP-004: 회장 부여 동시성 (race condition) (REQ-SETUP-010)

**Given** `users` 행 Y(현재 CHAIR) + 두 클라이언트 동시에 Z 와 W 에 CHAIR 부여 시도
**When** 두 `PUT /api/setup/users/<Z_id>/role` + `PUT /api/setup/users/<W_id>/role` 동시 요청
**Then** 단 하나만 성공(회장 단일성 보장); 다른 하나는 직렬화 후 기존 회장(Z 또는 W)을 RESIDENT 로 회수. `withTransaction` 원자성으로 단일성 위반 없음.

### EC-SETUP-005: CHAIR 의 REP 부여는 허용 (REQ-SETUP-009, REQ-SETUP-012)

**Given** 호출자 `role='CHAIR'` + `users` 행 X, `role='RESIDENT'`
**When** `PUT /api/setup/users/<X_id>/role` 본문 `{ "role": "REP", "managed_building_id": "<A동_id>" }` 제출
**Then** 응답 `200 OK`(CHAIR 권한 범위 내: RESIDENT/REP/AUDITOR 부여 허용)

### EC-SETUP-006: GET buildings 비인증 허용 (REQ-SETUP-020)

**Given** 미인증 상태(AT 없음)
**When** `GET /api/setup/buildings` 요청
**Then** 응답 `200 OK`, 본문에 동/호수 목록 포함(회원 데이터 미포함); middleware matcher 예외로 비인증 허용

### EC-SETUP-007: POST buildings 비인증 401 (REQ-SETUP-004a)

**Given** 미인증 상태
**When** `POST /api/setup/buildings` 본문 `{ "name": "C동" }` 제출
**Then** 응답 `401 Unauthorized`(matcher 예외는 GET 만, POST 는 route handler 내부 `verifyAccessToken` 강제)

---

## Quality Gates

### TRUST 5

- **Tested**: 신규 route handlers 테스트 커버리지 85% 이상; AUTH 회귀 테스트(`AC-AUTH-015`, 업데이트된 `migration-001.test.ts:90` roles 블록) 통과
- **Readable**: 한국어 도메인 용어(관리사무소/동대표/회장/감사/일반 입주민) 주석 유지; 영어 함수/변수명
- **Unified**: AUTH 패턴(route handler RBAC, zod, Parameterized Query, UUID_RE) 일관 적용
- **Secured**: RBAC(ADMIN/CHAIR 권한 범위), zod 입력 검증, Parameterized Query, password_hash 미노출
- **Trackable**: 커밋 메시지에 `SPEC-SETUP-001` + `REQ-SETUP-XXX` 참조

### LSP 게이트

- TypeScript 에러 0
- ESLint 에러 0
- migration 005 SQL 문법 검증(pass)

### 호환성 게이트

- AUTH verify-unit(REQ-AUTH-010/010a/011/012) 회귀 없음
- AUTH 강제 탈퇴(REQ-AUTH-014) 회귀 없음(SETUP 미구현이므로 영향 없음)
- AUTH RBAC(REQ-AUTH-016) 회귀 없음

---

## Definition of Done

- [ ] AC-SETUP-001 ~ AC-SETUP-024 (24개 시나리오, a/b 서브 포함) 전체 통과
- [ ] EC-SETUP-001 ~ EC-SETUP-007 (7개 경계 케이스) 전체 통과
- [ ] TRUST 5 게이트 통과(커버리지 85%+)
- [ ] AUTH 회귀 테스트(AC-AUTH-015 + `migration-001.test.ts:90` roles 블록 업데이트) 통과
- [ ] LSP 게이트(에러 0) 통과
- [ ] MX 태그 적용 완료
- [ ] `spec.md`의 20개 REQ-SETUP-XXX(001~020, a/b 서브 포함) 전부 구현 검증

---

*본 acceptance.md 는 `spec.md`의 WHAT/WHY 를 관측 가능한 증거(HTTP 응답 코드, DB 상태, 테스트 통과)로 변환한다.*
