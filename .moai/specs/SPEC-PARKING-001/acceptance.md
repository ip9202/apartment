# SPEC-PARKING-001 Acceptance Criteria

`spec.md`의 5개 모듈(M1~M5)과 27개 REQ-PK-XXX 요구사항에 대한 Given/When/Then 검증 시나리오. 각 모듈당 최소 2개 시나리오, 동시성 시나리오, 투명성 검증(재현 가능성), 엣지케이스를 정의한다.

---

## M0. migration 008 — parking_rounds + parking_assignments

### AC-PK-001: parking_rounds 테이블 스키마

**Given** migration 001~008 순차 적용된 DB
**When** `information_schema.columns` 조회(`table_name='parking_rounds'`)
**Then** 컬럼 10종 존재: id(UUID PK), name(VARCHAR 100), application_start(TIMESTAMPTZ), application_end(TIMESTAMPTZ), slot_pool(JSONB), seed_value(TEXT), status(VARCHAR 20), is_published(BOOLEAN), created_at(TIMESTAMPTZ), updated_at(TIMESTAMPTZ); CHECK 제약 존재: dates_check(application_start < application_end), status_check(OPEN/ASSIGNED/PUBLISHED/CLOSED); 인덱스 존재: status, created_at DESC

### AC-PK-002: parking_assignments 테이블 스키마

**Given** migration 008 적용된 DB
**When** `information_schema.columns` 조회(`table_name='parking_assignments'`)
**Then** 컬럼 8종 존재: id(UUID PK), round_id(UUID FK→parking_rounds.id), unit_id(UUID FK→units.id), assigned_slot(JSONB), assignment_source(VARCHAR 20), drawn_at(TIMESTAMPTZ NULL), drawn_by(UUID FK→users.id NULL), created_at(TIMESTAMPTZ); CHECK 제약: source_check(DRAW/AUTO/ADMIN), draw_check(DRAW는 drawn_at+drawn_by 필수, AUTO/ADMIN은 NULL); UNIQUE(round_id, unit_id) 제약 존재; 인덱스: round_id, unit_id, drawn_by

### AC-PK-003: migration 멱등성

**Given** migration 008 이미 적용된 DB
**When** migration 008 재적용
**Then** 에러 없음 (CREATE TABLE IF NOT EXISTS)

---

## M0b. parking-lottery.ts — 결정론적 순열

### AC-PK-004: 동일 seed + 동일 입력 → 동일 순열 (재현 검증 핵심)

**Given** seed='abc123', sortedUnits=['unit-A','unit-B','unit-C'], slotPool=['slot-1','slot-2','slot-3']
**When** `generatePermutation(seed, sortedUnits, slotPool)` 10회 호출
**Then** 10회 모두 동일한 unit→slot 매핑 반환 (결정론 보장)

### AC-PK-005: 상이 seed → 상이 순열 (이진 판정)

**Given** seed1='abc', seed2='xyz', 동일 sortedUnits, 동일 slotPool
**When** 각 seed로 generatePermutation 호출
**Then** 두 회차의 unit→slot 매핑이 상이함 (diff > 0 — 매핑이 하나라도 다르면 충족). 두 결과가 완전히 동일하면 테스트 실패.

### AC-PK-006: units.length > slotPool.length 에러

**Given** sortedUnits 5개, slotPool 3개
**When** `generatePermutation(seed, sortedUnits, slotPool)` 호출
**Then** 에러 발생 (자리 부족 — REQ-PK-003 회차 생성 시 사전 검증으로 방어)

### AC-PK-007: 빈 units 배열

**Given** sortedUnits=[], slotPool=[]
**When** `generatePermutation(seed, [], [])` 호출
**Then** 빈 배열 반환 (에러 아님)

---

## M1. 회차 생성 (PARKING-01) — REQ-PK-001 ~ 005

### AC-PK-008: ADMIN 회차 생성 성공 201 (REQ-PK-001)

**Given** AUTH 인증 완료 + `role='ADMIN'` 세션(AT 유효) + units 테이블에 38세대 존재
**When** `POST /api/parking/rounds` 요청 본문 `{ "name": "2026년 상반기", "application_start": "2026-07-01T00:00:00Z", "application_end": "2026-07-15T23:59:59Z", "slot_pool": ["A-01","A-02",...(40개)] }` 제출
**Then** 응답 `201 Created`, 본문에 id/name/application_start/application_end/slot_pool/status='OPEN'/seed_value/created_at 포함; `parking_rounds` 테이블에 신규 행 존재; `status`='OPEN'; `is_published`=false; `seed_value`는 base64 인코딩 22자 (randomBytes(16))

### AC-PK-009: CHAIR 회차 생성 성공 201 (REQ-PK-001)

**Given** `role='CHAIR'` 유효한 AT 세션
**When** `POST /api/parking/rounds` 요청 본문 제출
**Then** 응답 `201 Created` (CHAIR도 회차 생성 권한 있음)

### AC-PK-010: 기간 유효성 위반 422 (REQ-PK-002)

**Given** ADMIN 세션
**When** `POST /api/parking/rounds` 본문 `{ "application_start": "2026-07-15T00:00:00Z", "application_end": "2026-07-01T00:00:00Z", ... }` 제출 (start >= end)
**Then** 응답 `422 Unprocessable Entity`; 신규 행 생성되지 않음

### AC-PK-011: 자리풀 부족 422 (REQ-PK-003)

**Given** ADMIN 세션 + units 테이블에 38세대 존재
**When** `POST /api/parking/rounds` 본문 `slot_pool`에 30개 자리만 제출 (< 38세대)
**Then** 응답 `422 Unprocessable Entity` (모든 세대 1자리 보장 불가)

### AC-PK-012: 빈 자리풀 422 (REQ-PK-003)

**Given** ADMIN 세션
**When** `POST /api/parking/rounds` 본문 `slot_pool`에 빈 배열 `[]` 제출
**Then** 응답 `422 Unprocessable Entity`

### AC-PK-013: 회차 생성 미인증 401 (REQ-PK-004)

**Given** 액세스 토큰 없는 상태
**When** `POST /api/parking/rounds` 요청
**Then** 응답 `401 Unauthorized`

### AC-PK-014: 비-ADMIN/비-CHAIR 회차 생성 403 (REQ-PK-005)

**Given** `role='RESIDENT'` (또는 REP/AUDITOR) 유효한 AT 세션
**When** `POST /api/parking/rounds` 요청
**Then** 응답 `403 Forbidden`

---

## M2. 추첨(자리 확정) (PARKING-02) — REQ-PK-006 ~ 010

### AC-PK-015: RESIDENT 추첨(자리 확정) 성공 200 (REQ-PK-006)

**Given** 회차 R 생성됨(status='OPEN', seed_value=S, slot_pool 40개) + `role='RESIDENT'` 세션 + `users.unit_id`=U NOT NULL + unit U에 대한 assignment 없음
**When** `POST /api/parking/rounds/R/draw` 요청
**Then** 응답 `200 OK`, 본문에 assigned_slot 포함; `parking_assignments` 테이블에 신규 행 존재; `assignment_source`='DRAW'; `drawn_at`=NOT NULL; `drawn_by`=요청자 user id; `unit_id`=U; `assigned_slot`은 slot_pool 요소 중 하나

### AC-PK-016: 추첨 순서 무관 — 동일 결과 (REQ-PK-006, 도메인 본질)

**Given** 회차 R 생성됨(seed_value=S) + 두 RESIDENT 사용자 A(unit=UA), B(unit=UB)
**When** A가 먼저 추첨, B가 나중에 추첨 (시나리오 1); B가 먼저, A가 나중에 (시나리오 2)
**Then** 두 시나리오에서 A와 B의 assigned_slot이 동일 (seed 순열 결정론적, 순서 무관)

### AC-PK-017: 세대당 1회 추첨 중복 409 (REQ-PK-007)

**Given** 회차 R(status='OPEN') + 요청자 unit U에 이미 DRAW assignment 존재
**When** `POST /api/parking/rounds/R/draw` 재요청
**Then** 응답 `409 Conflict`; 신규 assignment 생성되지 않음 (UNIQUE(round_id, unit_id) 위반)

### AC-PK-018: OPEN 상태 외 추첨 409 (REQ-PK-008)

**Given** 회차 R(status='ASSIGNED', 자동배정 완료) + 요청자 unit U에 AUTO assignment 존재
**When** `POST /api/parking/rounds/R/draw` 요청
**Then** 응답 `409 Conflict` (OPEN 상태에서만 추첨 가능)

### AC-PK-019: 동/호수 미인증 사용자 추첨 403 (REQ-PK-009)

**Given** `role='RESIDENT'` 세션이나 `users.unit_id`가 NULL(동/호수 미인증) + 회차 status='OPEN'
**When** `POST /api/parking/rounds/R/draw` 요청
**Then** 응답 `403 Forbidden`; assignment 생성되지 않음

### AC-PK-020: 추첨 미인증 401 (REQ-PK-010)

**Given** 액세스 토큰 없는 상태 + 회차 status='OPEN'
**When** `POST /api/parking/rounds/R/draw` 요청
**Then** 응답 `401 Unauthorized`

---

## M3. 추첨 취소/반납 (PARKING-03) — REQ-PK-011 ~ 014

### AC-PK-021: 본인 추첨 취소 성공 200 (REQ-PK-011)

**Given** 회차 R(status='OPEN') + 요청자 unit U에 DRAW assignment 존재(drawn_by=요청자)
**When** `DELETE /api/parking/rounds/R/draw` 요청
**Then** 응답 `200 OK`; 해당 assignment 행 삭제됨; 이후 동일 회차 재추첨 가능 (POST /draw → 200, 같은 slot)

### AC-PK-022: OPEN 상태 외 취소 409 (REQ-PK-012)

**Given** 회차 R(status='ASSIGNED') + 요청자 unit U에 DRAW assignment 존재
**When** `DELETE /api/parking/rounds/R/draw` 요청
**Then** 응답 `409 Conflict` (OPEN 상태에서만 취소 가능)

### AC-PK-023: 타인 assignment 취소 403 (REQ-PK-013)

**Given** 회차 R(status='OPEN') + 요청자 A + unit U에 DRAW assignment 존재(drawn_by=B, 타인)
**When** A가 `DELETE /api/parking/rounds/R/draw` 요청
**Then** 응답 `403 Forbidden`; assignment 행 변경 없음

### AC-PK-024: AUTO assignment 취소 403 (REQ-PK-013)

**Given** 회차 R(status='OPEN' — 예외적 시나리오) + 요청자 unit U에 AUTO assignment 존재(drawn_by=NULL)
**When** `DELETE /api/parking/rounds/R/draw` 요청
**Then** 응답 `403 Forbidden` (AUTO assignment는 본인 DRAW가 아니므로 취소 불가)

### AC-PK-025: 미존재 assignment 취소 404 (REQ-PK-014)

**Given** 회차 R(status='OPEN') + 요청자 unit U에 assignment 없음 (추첨 안 함)
**When** `DELETE /api/parking/rounds/R/draw` 요청
**Then** 응답 `404 Not Found`

---

## M4. 자동배정 실행 (PARKING-04) — REQ-PK-015 ~ 019

### AC-PK-026: ADMIN 자동배정 실행 성공 200 (REQ-PK-015)

**Given** 회차 R(status='OPEN', seed_value=S, slot_pool 40개) + 38세대 중 20세대가 DRAW assignment 보유, 18세대 미참여 + ADMIN 세션
**When** `POST /api/parking/rounds/R/auto-assign` 요청
**Then** 응답 `200 OK`, 본문에 `{ assigned_count: 18, unassigned_count: 0 }` 포함; 미참여 18세대에 AUTO assignment 생성됨; 기존 20세대 DRAW assignment 보존됨; 회차 R status='ASSIGNED'로 전이됨

### AC-PK-027: 자동배정 같은 순열 보장 (REQ-PK-015, 도메인 본질)

**Given** 회차 R(seed_value=S) + 미참여 세대 unit UB
**When** 자동배정 실행
**Then** UB의 assigned_slot은 seed S로 산출한 순열에서 UB에 해당하는 slot과 동일 (만약 UB가 추첨 버튼을 눌렀을 때 받았을 slot과 동일) — seed 순열 결정론적, 추첨/자동배정 동일 순열

### AC-PK-028: OPEN 상태 외 자동배정 409 (REQ-PK-016)

**Given** 회차 R(status='ASSIGNED', 이미 자동배정 완료) + ADMIN 세션
**When** `POST /api/parking/rounds/R/auto-assign` 재요청
**Then** 응답 `409 Conflict`

### AC-PK-029: 동시 자동배정 실행 — FOR UPDATE 방어 (REQ-PK-017)

**Given** 회차 R(status='OPEN') + 두 ADMIN A, B가 동시에 자동배정 실행 요청
**When** A와 B가 동시에 `POST /api/parking/rounds/R/auto-assign` 호출 (트랜잭션 경합)
**Then** A의 트랜잭션이 회차 row FOR UPDATE로 잠금; B는 A의 COMMIT까지 대기; A COMMIT 후 status='ASSIGNED'; B는 status='ASSIGNED' 확인 후 `409 Conflict` 반환; 중복 배정 발생하지 않음

### AC-PK-030: 자리풀 부족 시 409 + 롤백 (REQ-PK-018 도메인 불변 수호)

**Given** 회차 R(status='OPEN', slot_pool 30개 — 예외적, REQ-PK-003 사전 검증을 우회한 상황) + 38세대 중 5세대만 DRAW assignment, 33세대 미참여 + ADMIN 세션
**When** `POST /api/parking/rounds/R/auto-assign` 요청
**Then** 응답 `409 Conflict` (사용가능 slot 25개 < 미참여 33세대 — 자리 부족); 자동배정 트랜잭션 전체 롤백 (부분 배정 없음 — 기존 5세대 DRAW assignment는 보존, 신규 AUTO assignment 생성 없음); 회차 status는 'OPEN' 유지 (ASSIGNED로 전이하지 않음)

### AC-PK-031: 비-ADMIN 자동배정 403 (REQ-PK-019)

**Given** `role='CHAIR'` (또는 RESIDENT/REP/AUDITOR) 유효한 AT 세션 + 회차 status='OPEN'
**When** `POST /api/parking/rounds/R/auto-assign` 요청
**Then** 응답 `403 Forbidden`

### AC-PK-032: 자동배정 미인증 401

**Given** 액세스 토큰 없는 상태 + 회차 status='OPEN'
**When** `POST /api/parking/rounds/R/auto-assign` 요청
**Then** 응답 `401 Unauthorized`

---

## M5. 결과 공개 (PARKING-05) — REQ-PK-020 ~ 022

### AC-PK-033: ADMIN 결과 공개 성공 200 (REQ-PK-020)

**Given** 회차 R(status='ASSIGNED', is_published=false) + ADMIN 세션
**When** `PUT /api/parking/rounds/R/publish` 요청
**Then** 응답 `200 OK`; 회차 R `is_published`=true, `status`='PUBLISHED'로 전이됨

### AC-PK-034: ASSIGNED 상태 외 결과 공개 409 (REQ-PK-021)

**Given** 회차 R(status='OPEN', 아직 자동배정 전) + ADMIN 세션
**When** `PUT /api/parking/rounds/R/publish` 요청
**Then** 응답 `409 Conflict` (ASSIGNED→PUBLISHED 전이만 허용)

### AC-PK-035: 비-ADMIN 결과 공개 403 (REQ-PK-022)

**Given** `role='CHAIR'` (또는 RESIDENT/REP/AUDITOR) 유효한 AT 세션 + 회차 status='ASSIGNED'
**When** `PUT /api/parking/rounds/R/publish` 요청
**Then** 응답 `403 Forbidden`

---

## M5. 결과 열람 (PARKING-06) — REQ-PK-023 ~ 025

### AC-PK-036: 공개 회차 RESIDENT 본인 결과 열람 200 (REQ-PK-023)

**Given** 회차 R(status='PUBLISHED', is_published=true) + 38세대 전체 배정 완료 + `role='RESIDENT'` 세션(unit=U)
**When** `GET /api/parking/rounds/R/allocations` 요청
**Then** 응답 `200 OK`; 본인 unit U의 배정 1건만 반환 (타인 배정 제외); 응답에 unit_id/building/unit_number/assigned_slot/assignment_source 포함

### AC-PK-037: 공개 회차 REP 담당동 결과 열람 200 (REQ-PK-023)

**Given** 회차 R(status='PUBLISHED') + REP 세션(managed_building_id=A동)
**When** `GET /api/parking/rounds/R/allocations` 요청
**Then** 응답 `200 OK`; A동 세대 배정 전체 반환 (B동 제외)

### AC-PK-038: 공개 회차 ADMIN 전체 결과 열람 200 (REQ-PK-023)

**Given** 회차 R(status='PUBLISHED') + ADMIN 세션
**When** `GET /api/parking/rounds/R/allocations` 요청
**Then** 응답 `200 OK`; 38세대 전체 배정 반환

### AC-PK-039: 미공개 회차 본인 결과 열람 200 (REQ-PK-023)

**Given** 회차 R(status='ASSIGNED', is_published=false) + RESIDENT 세션(unit=U, U에 DRAW assignment 존재)
**When** `GET /api/parking/rounds/R/allocations` 요청
**Then** 응답 `200 OK`; 본인 unit U 배정 1건만 반환 (비공개 상태에서 본인 확인 허용)

### AC-PK-040: 미공개 회차 타인 결과 조회 — 정보은닉 (REQ-PK-024)

**Given** 회차 R(status='ASSIGNED', is_published=false, 38세대 중 타인/타동 배정 다수 존재) + RESIDENT 세션(unit=U, U에 assignment 없음 — 미참여)
**When** `GET /api/parking/rounds/R/allocations` 요청
**Then** 응답 `200 OK`, 빈 목록 반환 (본인 assignment만 반환하므로 없으면 빈 목록). 응답 코드가 403이 아님 — 타인 결과 존재 여부를 응답 차이(200 vs 403, 빈 vs 비어있지 않음)로 누출하지 않음 (정보은닉, enumeration 공격 방어).

### AC-PK-041: 결과 열람 미인증 401 (REQ-PK-025)

**Given** 액세스 토큰 없는 상태 + 회차 status='PUBLISHED'
**When** `GET /api/parking/rounds/R/allocations` 요청
**Then** 응답 `401 Unauthorized`

---

## M5. 투명성 공개 (PARKING-07) — REQ-PK-026 ~ 027

### AC-PK-042: 투명성 공개 — seed+알고리즘+입력 반환 200 (REQ-PK-026)

**Given** 회차 R(status='PUBLISHED', seed_value=S, slot_pool=40개) + RESIDENT 세션
**When** `GET /api/parking/rounds/R/verify` 요청
**Then** 응답 `200 OK`, 본문에 `seed_value`=S, `algorithm`='Fisher-Yates + HMAC-SHA256', `sort_criteria`='building_name ASC, unit_number ASC', `slot_pool`=40개 자리, `sorted_units`=정렬된 38개 unit_id 포함

### AC-PK-043: 재현 검증 — 동일 입력 동일 결과 (REQ-PK-027, 핵심 불변)

**Given** 회차 R의 verify 응답(seed=S, sorted_units, slot_pool) 획득
**When** 클라이언트가 동일 알고리즘(Fisher-Yates + HMAC-SHA256)으로 generatePermutation(S, sorted_units, slot_pool) 실행
**Then** 산출된 unit→slot 매핑이 회차 R의 실제 parking_assignments와 정확히 일치 (재현 검증 성공 — 공정성 입증)

### AC-PK-044: 투명성 공개 미인증 401

**Given** 액세스 토큰 없는 상태 + 회차 status='PUBLISHED'
**When** `GET /api/parking/rounds/R/verify` 요청
**Then** 응답 `401 Unauthorized`

---

## Edge Cases (경계 케이스)

### EC-PK-001: 회차명 길이 초과 422

**Given** ADMIN 세션
**When** `POST /api/parking/rounds` 본문 `name`에 101자 제출
**Then** 응답 `422 Unprocessable Entity` (VARCHAR(100) 초과)

### EC-PK-002: path param UUID 형식 오류 400

**Given** RESIDENT 세션
**When** `GET /api/parking/rounds/not-a-uuid/allocations` 요청
**Then** 응답 `400 Bad Request` (UUID_RE 불일치)

### EC-PK-003: 미존재 회차 조회 404

**Given** RESIDENT 세션 + DB에 존재하지 않는 회차 UUID
**When** `GET /api/parking/rounds/<존재하지_않는_uuid>/allocations` 요청
**Then** 응답 `404 Not Found`

### EC-PK-004: 회차 전환 시 이전 배정 보존

**Given** 회차 R1(status='CLOSED', 38세대 배정 완료) + 신규 회차 R2 생성(status='OPEN')
**When** R2에서 추첨/자동배정 실행
**Then** R1의 parking_assignments는 불변 (round_id FK로 분리); R2는 새로운 seed로 독립 추첨; 두 회차 assignments 독립적

### EC-PK-005: 취소 후 재추첨 — 같은 slot (도메인 본질)

**Given** 회차 R(status='OPEN', seed=S) + 요청자 unit U 추첨 → slot X 배정 → 취소 → 재추첨
**When** 재추첨 `POST /api/parking/rounds/R/draw` 요청
**Then** 응답 `200 OK`; assigned_slot은 동일 X (seed 순열 결정론적 — 취소/재추첨해도 본인 slot 불변)

### EC-PK-006: slot_pool 문자열/숫자 혼합 허용

**Given** ADMIN 세션
**When** `POST /api/parking/rounds` 본문 `slot_pool`에 `["A-01", 5, "B-12", 7, ...]` 혼합 제출 (문자열+숫자)
**Then** 응답 `201 Created` (자리 번호 형식 자유 — JSONB 저장)

### EC-PK-007: 자동배정 후 미참여 세대 0건 (전원 추첨 참여)

**Given** 회차 R(status='OPEN') + 38세대 전원 DRAW assignment 보유 + ADMIN 세션
**When** `POST /api/parking/rounds/R/auto-assign` 요청
**Then** 응답 `200 OK`, `{ assigned_count: 0, unassigned_count: 0 }`; 회차 status='ASSIGNED' 전이 (미참여 0건이어도 전이 실행 — 모든 세대 배정 확정)

### EC-PK-008: 회차 상태머신 역방향 전이 금지

**Given** 회차 R(status='PUBLISHED') + ADMIN 세션
**When** `POST /api/parking/rounds/R/auto-assign` 요청 (PUBLISHED → ASSIGNED 역방향 시도)
**Then** 응답 `409 Conflict` (역방향 전이 불허)

---

## 동시성 시나리오 (상세)

### CC-PK-001: 동시 추첨 버튼 클릭 (같은 세대)

**Given** 회차 R(status='OPEN') + 동일 unit U를 공유하는 두 세션 (예: 세대원 2명 같은 호수) 이 동시에 추첨 요청
**When** 두 세션이 동시에 `POST /api/parking/rounds/R/draw` 호출
**Then** 첫 번째 INSERT 성공 (200); 두 번째 INSERT는 UNIQUE(round_id, unit_id) 위반 → `409 Conflict`; 동일 slot에 대한 중복 배정 발생하지 않음

### CC-PK-002: 동시 자동배정 실행 (두 관리자)

**Given** 회차 R(status='OPEN') + 두 ADMIN A, B
**When** A와 B가 동시에 `POST /api/parking/rounds/R/auto-assign` 호출
**Then** A 트랜잭션이 `SELECT ... FOR UPDATE`로 회차 row 잠금; B는 대기; A COMMIT 후 status='ASSIGNED'; B는 status='ASSIGNED' 확인 후 `409 Conflict`; 중복 배정 없음

### CC-PK-003: 자동배정 중 추첨 버튼 클릭

**Given** 회차 R(status='OPEN') + ADMIN이 자동배정 실행 중 (트랜잭션 진행) + RESIDENT가 동시에 추첨 요청
**When** 자동배정 트랜잭션 진행 중 RESIDENT가 `POST /api/parking/rounds/R/draw` 호출
**Then** 최종적으로 `409 Conflict` 반환; 해당 unit의 assignment는 최대 1건 (0 또는 1 — 중복 배정 없음). 자동배정 트랜잭션이 COMMIT 후 status='ASSIGNED'이면 추첨은 status 위반 409; 자동배정이 해당 unit에 AUTO assignment를 생성했다면 UNIQUE(round_id, unit_id) 위반 409.

---

## Quality Gates

### TRUST 5

- **Tested**: 신규 route handlers 테스트 커버리지 85% 이상; parking-lottery.ts 100% (재현 검증 핵심); 기존 AUTH/SETUP/NOTICE/SUGGEST 412 테스트 회귀 없음
- **Readable**: 한국어 도메인 용어(회차/추첨/자동배정/자리풀/투명성) 주석 유지; 영어 함수/변수명
- **Unified**: AUTH/SETUP/NOTICE/SUGGEST 패턴(requireAdmin, RBAC 응답 빌더, zod, Parameterized Query, UUID_RE, route-level Bearer, withTransaction, FOR UPDATE, 상태전이 화이트리스트) 일관 적용
- **Secured**: RBAC + 역할별 결과 분기(RESIDENT 본인 / REP 담당동 / CHAIR·ADMIN 전체), seed 불변 보장, FOR UPDATE 동시성 방어, UNIQUE(round_id, unit_id) 세대당 1배정 불변, zod 입력 검증, 재현 검증 가능(공정성)
- **Trackable**: 커밋 메시지에 `SPEC-PARKING-001` + `REQ-PK-XXX` 참조

### LSP 게이트

- TypeScript 에러 0
- ESLint 에러 0
- migration 008 SQL 문법 검증 (pass)

### 호환성 게이트

- AUTH 412 테스트 회귀 없음
- SETUP 412 테스트 회귀 없음
- NOTICE 412 테스트 회귀 없음
- SUGGEST 412 테스트 회귀 없음 (Option C — rbac.ts 무변경, parking-rbac.ts 신규)
- migration 008 신규 테이블이므로 기존 데이터 영향 없음

---

## Definition of Done

- [ ] AC-PK-001 ~ AC-PK-044 (44개 시나리오) 전체 통과
- [ ] EC-PK-001 ~ EC-PK-008 (8개 경계 케이스) 전체 통과
- [ ] CC-PK-001 ~ CC-PK-003 (3개 동시성 시나리오) 전체 통과
- [ ] TRUST 5 게이트 통과 (커버리지 85%+, parking-lottery.ts 100%)
- [ ] 기존 412 테스트 회귀 없음
- [ ] LSP 게이트 (에러 0) 통과
- [ ] MX 태그 적용 완료 (ANCHOR/WARN+REASON/NOTE/TODO)
- [ ] `spec.md`의 27개 REQ-PK-XXX 전부 구현 검증
- [ ] PARKING-08 이력 / 회차 수정삭제 / 수동 배정 API 미구현 확인 (Exclusions 준수)
- [ ] 재현 검증 통과 (동일 seed + 동일 입력 → 동일 배정 결과 — AC-PK-043)
- [ ] 동시성 방어 통과 (동시 추첨 UNIQUE, 동시 자동배정 FOR UPDATE — CC-PK-001, CC-PK-002)

---

*본 acceptance.md는 `spec.md`의 WHAT/WHY를 관측 가능한 증거(HTTP 응답 코드, DB 상태, 테스트 통과, 재현 검증)로 변환한다.*
