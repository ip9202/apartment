---
spec_id: SPEC-SETUP-001
title: 단지 설정 (동/호수/직책 관리)
phase: research
status: draft
created: 2026-06-21
author: manager-spec (Phase 0.5 Deep Research)
depends_on:
  - SPEC-AUTH-001
source_docs:
  - apt_01_서비스기획서.md
  - apt_02_PRD.md
  - apt_03_기능명세서.md
  - apt_04_유저플로우.md
  - apt_05_ERD.md
  - apt_06_API명세서.md
  - apt_07_시스템아키텍처.md
  - apt_08_보안설계.md
  - apt_09_ADR.md
---

# SPEC-SETUP-001 Deep Research — 단지 설정 (동/호수/직책 관리)

본 문서는 9개 기획 문서와 AUTH P0 구현 산출물(migrations/001~004, seed.ts, src/lib/*, src/middleware.ts, src/app/api/auth/*)에서 SETUP 도메인(동·호수·직책·회원 관리)에 관련된 모든 사실을 추출한 연구 결과입니다.
SPEC 작성 전 Plan Review 게이트의 기반이 되며, 구현 디테일(함수명/클래스 구조/API 스키마)은 포함하지 않습니다 — "무엇(WHAT)/왜(WHY)"에 집중합니다.

핵심 인지: AUTH P0 가 완료·병합됨에 따라 buildings/units/roles 테이블 스키마와 시드 데이터가 이미 마이그레이션 001 + seed.ts 로 존재합니다. 본 SPEC은 이를 **소유권 이관받아 확장·관리**하며, 동시에 `managed_building_id` 단일 출처 통일(roles → users)이라는 cross-SPEC 스키마 정리 책임을 집니다.

---

## 1. SETUP 요구사항 요약 (SETUP-01 ~ SETUP-05)

| ID | 기능 | 우선순위 | 대상 역할 | 핵심 설명 |
|----|------|:--------:|-----------|-----------|
| SETUP-01 | 동(building) 추가/삭제 | **P0** | ADMIN | A동·B동 초기 등록 및 신규 동 추가. 삭제 시 해당 동에 ACTIVE 입주민이 있으면 금지 |
| SETUP-02 | 동별 호수(unit) 목록 관리 | **P0** | ADMIN | 비정형 구조(4층 제외, A동 3·4호 라인, B동 1층 없음) 지원. 일괄 업데이트 방식. 호수 삭제 시 해당 호수에 ACTIVE 입주민이 있으면 금지 |
| SETUP-03 | 직책(role) 종류 추가/삭제 | **P1** | ADMIN | 회장·동대표·감사 기본 제공. 커스텀 직책 추가. 본 SPEC **OUT 후보** (§10 권고 참조) |
| SETUP-04 | 입주민 직책 부여/변경/회수 | **P0** | ADMIN·CHAIR | user_id + role_code(+ REP 시 managed_building_id) 부여. 회장은 단지당 1명(기존 회장 있으면 먼저 회수 후 부여). 직책 회수 = role→RESIDENT. 동대표 지정 시 담당 동 필수 |
| SETUP-05 | 입주민 목록 조회 | **P0** | ADMIN | 동/호수·역할·가입일·verified_at 표시. building/role/page/limit 쿼리 필터 |

### 본 SPEC P0 범위 권고 (구현 대상)

- SETUP-01, SETUP-02, SETUP-04, SETUP-05

### 본 SPEC OUT (별도 SPEC 또는 P1)

- SETUP-03 (직책 종류 CRUD, P1) — 본 SPEC OUT 권고 (§10 참조)

---

## 2. DB 스키마 (정확) — ERD vs AUTH migration 001 비교

PostgreSQL 15. UUID PK. 모든 타임스탬프 `TIMESTAMPTZ`.

### 2.1 `buildings` (동 목록)

| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| name | VARCHAR(20) | NOT NULL, UNIQUE ("A동", "B동") |
| created_at | TIMESTAMPTZ | DEFAULT now() |

**ERD vs AUTH migration 001**: 완전 일치. 드리프트 없음.

**현재 시드 상태 (seed.ts)**: A동, B동 2개 레코드 존재.

### 2.2 `units` (호수 목록)

| 컬럼 | 타입 | 제약 |
|------|------|------|
| id | UUID | PK, DEFAULT gen_random_uuid() |
| building_id | UUID | NOT NULL, FK → buildings.id |
| unit_number | VARCHAR(10) | NOT NULL |
| created_at | TIMESTAMPTZ | DEFAULT now() |

**유니크 제약**: `UNIQUE (building_id, unit_number)` (migration 001 `units_building_id_unit_number_key`)

**ERD vs AUTH migration 001**: 완전 일치.

**현재 시드 상태**: A동 26세대(1·2층 2호, 3층 이후 4호, 4층 없음), B동 12세대(2~8층, 1층 없음) = 총 38세대.

### 2.3 `roles` (직책)

| 컬럼 | 타입 | 제약 | 상태 |
|------|------|------|------|
| id | UUID | PK | |
| code | VARCHAR(20) | NOT NULL, UNIQUE | ADMIN/CHAIR/REP/AUDITOR/RESIDENT |
| name | VARCHAR(30) | NOT NULL | 표시명 |
| **managed_building_id** | UUID | FK → buildings.id, NULLABLE | **SETUP migration 005 에서 DROP 예정 (§5)** |
| sort_order | INT | DEFAULT 0 | 표시 순서 |
| created_at | TIMESTAMPTZ | DEFAULT now() | |

**ERD vs AUTH migration 001 — 컬럼 존재 여부**: 둘 다 `managed_building_id` 컬럼을 정의한다. (ERD §roles 테이블에도 동일 컬럼 존재.)

**drift 소스**: ERD 설계 의도는 `roles.managed_building_id` 로 "REP 역할이 담당 동을 갖는다"를 표현. 그러나 이 모델은 **2개 동 × 복수 REP 표현 불가** (한 role row는 한 building 만 가리킬 수 있음). AUTH P0 (plan-auditor iteration 1 MAJOR-2)에서 이미 결정된 사항:

> `managed_building_id` 는 **회원 단위(`users.managed_building_id`)**에서 읽는다. SETUP 마이그레이션(005)이 `roles.managed_building_id` 를 제거하고 `users.managed_building_id` 를 단일 출처로 확정.

**SETUP 의 책임 (migration 005)**: `roles.managed_building_id` 컬럼 및 FK 제거.

**현재 시드 상태 (seed.ts)**: roles INSERT 는 `(code, name, sort_order)` 만 기입 → **모든 roles 행의 managed_building_id 는 NULL**. 따라서 migration 005 DROP COLUMN 은 데이터 손실 없이 안전.

### 2.4 `users` (회원) — AUTH 핵심 테이블

| 컬럼 | 타입 | 제약 | SETUP 관계 |
|------|------|------|-----------|
| id | UUID | PK | |
| email | VARCHAR(255) | NOT NULL, UNIQUE | SETUP-05 목록 조회 |
| password_hash | VARCHAR(255) | NULLABLE | |
| provider | VARCHAR(20) | DEFAULT 'email' | |
| provider_id | VARCHAR(255) | NULLABLE | |
| role_id | UUID | NOT NULL, FK → roles.id | SETUP-04 직책 부여/회수 대상 |
| unit_id | UUID | NULLABLE, FK → units.id | SETUP-01/02 삭제 금지 조건 체크용 |
| **managed_building_id** | UUID | NULLABLE, FK → buildings.id | **REP 담당 동 단일 출처 (SETUP-04 부여/회수)** |
| status | VARCHAR(20) | DEFAULT 'ACTIVE' | SETUP-05 필터 (ACTIVE 만) |
| verified_at | TIMESTAMPTZ | NULLABLE | SETUP-05 표시 |
| created_at | TIMESTAMPTZ | DEFAULT now() | SETUP-05 정렬 |
| updated_at | TIMESTAMPTZ | DEFAULT now() | SETUP-04 부여 시 갱신 |

**인덱스 (migration 001)**: email, unit_id, role_id

**SETUP-04 시 쓰기 대상**: `role_id`, `managed_building_id`, `updated_at`. 직책 회수 시 role_id → RESIDENT, managed_building_id → NULL.

**ERD vs AUTH migration 001 — 드리프트**: ERD(apt_05)의 users 테이블에는 `managed_building_id` 컬럼이 **명시되어 있지 않다**. AUTH 가 REQ-AUTH-011(REP 동대표 자동 연결) 구현을 위해 추가한 컬럼. ERD 문서와의 드리프트이나, **의도적 확장** (AUTH research.md §7 에서 사전 명시). SETUP은 이 컬럼을 단일 출처로 채택.

---

## 3. API 계약 (정확 — apt_06 기준 + AUTH 구현 경로 매핑)

공통:
- 프로젝트 구현 경로: `/api/setup/*` (apt_06 문서는 `/api/v1/setup/*` 표기이나 structure.md / AUTH 구현 일관성 적용)
- 인증: `Authorization: Bearer <AT>` (AUTH의 `verifyAccessToken` 재사용)
- 응답 형식: `{ "success": bool, "data": obj|null, "error": {code, message}|null }`
- 공통 에러 코드: 400 BAD_REQUEST / 401 UNAUTHORIZED / 403 FORBIDDEN / 404 NOT_FOUND / 409 CONFLICT / 422 VALIDATION_ERROR / 429 TOO_MANY_REQUESTS / 500 INTERNAL_ERROR

### 3.1 `GET /api/setup/buildings` — 동 목록 + 호수 (전체 공개, 인증 목적)

> **중요**: 본 엔드포인트는 AUTH verify-unit (REQ-AUTH-010a) 클라이언트가 소비. **인증 없이 접근 가능** (공개). 단, 공개 범위는 동/호수 목록(인증 목적)에 한정 — 회원 데이터 미포함.

**Query**: 없음

**Response `200`**
```json
{
  "data": [
    { "id": "uuid", "name": "A동", "units": ["101", "102", "201", "202"] }
  ]
}
```

**권한**: 전체 공개 (인증 목적). AUTH 미들웨어 matcher 예외 처리 필요 (§4).

---

### 3.2 `POST /api/setup/buildings` — 동 추가 🔒 ADMIN

**Request**
```json
{ "name": "C동" }
```
유효성: name 필수, VARCHAR(20), UNIQUE.

**Response `201`**
```json
{ "data": { "id": "uuid", "name": "C동" } }
```

**에러 케이스**
- `409 CONFLICT` — 동명 중복
- `422 VALIDATION_ERROR` — name 누락/길이 초과
- `403 FORBIDDEN` — ADMIN 아님

---

### 3.3 `DELETE /api/setup/buildings/:id` — 동 삭제 🔒 ADMIN

**Path**: `id` (UUID)

**처리 로직 (apt_03 SETUP-01/02)**: 해당 동의 모든 호수(units) 중 **ACTIVE 입주민이 인증한 호수가 하나라도 있으면** 삭제 금지 → 409.

**Response `200`**: `{ "success": true }` (동 + 종속 units CASCADE 또는 트랜잭션 일괄 삭제)

**에러 케이스**
- `404 NOT_FOUND` — 존재하지 않는 id
- `409 CONFLICT` — 활성 입주민 존재 (units JOIN users WHERE status='ACTIVE')
- `400 BAD_REQUEST` — id UUID 형식 오류 (AC 패턴: AUTH deactivate route.ts 와 동일)
- `403 FORBIDDEN` — ADMIN 아님

> **제약**: 동 삭제는 종속 units 까지 함께 제거해야 FK 무결성 유지. CASCADE 또는 사전 units 삭제 + 동 삭제를 단일 트랜잭션으로.

---

### 3.4 `PUT /api/setup/buildings/:id/units` — 호수 목록 업데이트 🔒 ADMIN

> 일괄 업데이트 방식 (apt_06/03). 전체 units 배열을 받아 diff(추가/삭제) 적용.

**Path**: `id` (UUID, building_id)

**Request**
```json
{ "units": ["101", "102", "201", "202"] }
```
유효성: units 는 문자열 배열, 각 원소 VARCHAR(10) 패턴(숫자/영문 혼합 가능 — "101", "201A" 등).

**처리 로직**
1. building_id 존재 확인 → 없으면 404
2. 기존 units 조회 → 신규 배열과 diff
3. **삭제 대상 호수에 ACTIVE 입주민이 있으면** 409 (삭제 금지)
4. 추가 대상 호수는 INSERT (ON CONFLICT DO NOTHING)
5. 단일 트랜잭션

**Response `200`**
```json
{ "data": { "building_id": "uuid", "units": ["101", "102", ...] } }
```

**에러 케이스**
- `404 NOT_FOUND` — 존재하지 않는 building_id
- `409 CONFLICT` — 삭제 대상 호수에 ACTIVE 회원 존재
- `422 VALIDATION_ERROR` — units 형식 오류
- `403 FORBIDDEN` — ADMIN 아님

> **참고**: 호수 "수정"(unit_number 변경)은 apt_06 에 명시 없음 → 본 SPEC은 삭제+추가 조합으로 취급. unit rename 지원은 OUT.

---

### 3.5 `GET /api/setup/users` — 입주민 목록 조회 🔒 ADMIN

**Query**: `?building=A동&role=RESIDENT&page=1&limit=20`

**Response `200`**
```json
{
  "data": {
    "users": [
      {
        "id": "uuid",
        "email": "user@example.com",
        "role": "RESIDENT",
        "building": "A동",
        "unit": "101",
        "verified_at": "2026-06-20T09:00:00Z",
        "created_at": "...",
        "status": "ACTIVE"
      }
    ],
    "total": 12
  }
}
```

**권한**: ADMIN 만 (CHAIR 는 본 API 없이 개별 직책 부여 API 만 사용).

**필터링 규칙**
- building: units JOIN buildings WHERE name = building
- role: roles JOIN WHERE code = role
- 기본 정렬: created_at DESC
- status='ACTIVE' 만 기본 (INACTIVE 회원은 회원 관리 화면에서 별도 표시 또는 제외 — 본 SPEC 권고: ACTIVE 만 기본, query `?status=INACTIVE` 선택)

> **개인정보 최소화**: email 만 노출. password_hash 절대 미포함 (AUTH AC-AUTH-025 패턴 동일).

---

### 3.6 `PUT /api/setup/users/:id/role` — 직책 부여/변경/회수 🔒 ADMIN·CHAIR

**Path**: `id` (UUID, user_id)

**Request**
```json
{
  "role": "REP",
  "managed_building_id": "uuid"
}
```
유효성:
- role: 필수, {ADMIN, CHAIR, REP, AUDITOR, RESIDENT} 중 하나
- managed_building_id: `role="REP"` 인 경우 필수(UUID); 그 외 역할에서는 무시 또는 NULL 강제

**처리 로직 (apt_03 SETUP-04)**
1. 대상 user_id 존재 + ACTIVE 확인 → 404/422
2. **CHAIR 단일성**: role="CHAIR" 부여 시 기존 CHAIR 회원이 있으면 **먼저 기존 CHAIR 를 RESIDENT 로 회수** 후 신규 부여 (단일 트랜잭션)
3. **REP 담당 동**: role="REP" + managed_building_id 필수 → users.managed_building_id 갱신
4. 직책 회수(role="RESIDENT"): managed_building_id → NULL
5. ADMIN 부여는 본 SPEC 범위 외 권고 (ADMIN 은 운영자 잠금 — SETUP-04 로 ADMIN 부여/회수 허용 여부는 §6/AUTH 경계 참조)

**Response `200`**: `{ "data": { "id": "uuid", "role": "REP", "managed_building_id": "uuid" } }`

**에러 케이스**
- `404 NOT_FOUND` — 대상 회원 없음
- `403 FORBIDDEN` — ADMIN·CHAIR 아님 (REP/AUDITOR/RESIDENT 호출 시)
- `422 VALIDATION_ERROR` — role 미허용값 / REP 인데 managed_building_id 누락
- `400 BAD_REQUEST` — id/managed_building_id UUID 형식 오류

**CHAIR 호출자 제약**: apt_08 §7 접근 제어 매트릭스는 "직책 부여" 에 ADMIN·CHAIR 모두 표시. 단 CHAIR 가 ADMIN 직책을 부여할 수 있는지는 비즈니스 의사결정 필요 — **본 SPEC 권고: CHAIR 는 RESIDENT/REP/AUDITOR 부여만 가능, ADMIN 부여/회수는 ADMIN 전용** (§6).

---

### 3.7 `DELETE /api/setup/users/:id` — 회원 강제 탈퇴 🔒 ADMIN

> **핵심 경계 결정 (§6 상세)**: AUTH P0 가 이미 `POST /api/auth/users/[id]/deactivate` (REQ-AUTH-014, 5단계 원자적 트랜잭션: status=INACTIVE + 건의 아카이브 + role 환원 + unit/verified 해제 + RT 갱신 차단) 을 **소유**.

**연구 권고 (§6 결론)**: apt_06 이 `DELETE /setup/users/:id` 경로를 정의하나, AUTH-07 요구사항의 비즈니스 로직은 AUTH 소유. **두 옵션**:

- **옵션 A (권고)**: 본 SETUP SPEC 은 `DELETE /setup/users/:id` 를 구현하지 않고, **AUTH deactivate 엔드포인트로 위임 안내** (클라이언트가 `/api/auth/users/:id/deactivate` 호출). SETUP API 는 존재하지 않음. Exclusion 명시.
- **옵션 B**: SETUP 이 `DELETE /setup/users/:id` 를 thin wrapper 로 구현 — 내부적으로 AUTH deactivate 로직을 호출(또는 공유 도메인 함수로 재사용). 중복 구현 회피.

**본 research.md 권고**: **옵션 A** (강제 탈퇴 = AUTH 단일 소유). 이유:
1. AUTH deactivate 가 이미 REQ-AUTH-014 의 5단계 원자성을 withTransaction 으로 보장
2. SETUP 이 재구현하면 ADR-005 호수 귀속 정책·RT 무효화·건의 아카이브 로직이 중복 → 드리프트 위험
3. apt_06 경로는 클라이언트-서버 매핑 시사일관성이며, AUTH 경로(`/auth/users/:id/deactivate`)가 더 정확한 의미 (AUTH 도메인 사이드이펙트 포함)

→ Plan Review 게이트에서 최종 결정.

---

## 4. 권한 매트릭스 (AUTH role code 기준)

AUTH role seed (migration 001 + seed.ts): `ADMIN`, `CHAIR`, `REP`, `AUDITOR`, `RESIDENT`.

| SETUP 기능 | ADMIN | CHAIR | REP | AUDITOR | RESIDENT | 미인증 |
|-----------|:-----:|:-----:|:---:|:-------:|:--------:|:------:|
| GET /setup/buildings (동/호수 조회, 인증 목적) | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** (공개) |
| POST /setup/buildings (동 추가) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| DELETE /setup/buildings/:id (동 삭제) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| PUT /setup/buildings/:id/units (호수 관리) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| GET /setup/users (회원 목록) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| PUT /setup/users/:id/role (직책 부여/변경) | ✅ | ✅* | ❌ | ❌ | ❌ | ❌ |
| DELETE /setup/users/:id (강제 탈퇴) | ✅** | ❌ | ❌ | ❌ | ❌ | ❌ |

**주석**:
- `*` CHAIR 직책 부여: RESIDENT/REP/AUDITOR 부여만 가능 권고 (ADMIN 부여·회수는 ADMIN 전용)
- `**` AUTH deactivate 엔드포인트로 위임 권고 (§6)

**AUTH 미들웨어 연동 (src/middleware.ts)**:
- 현재 matcher: `/((?!api/auth/login|api/auth/signup|api/auth/refresh|api/auth/verify-unit|login|signup|verify|_next/...).*)` — `/api/setup/*` 는 matcher 에 걸리나 middleware 본체는 verified 체크만 (RBAC 없음).
- SETUP 은 route handler 내부에서 `verifyAccessToken` + role 조회 후 RBAC 검사 (AUTH deactivate route.ts 패턴 재사용).
- `GET /api/setup/buildings` 공개 허용을 위해 **middleware matcher 에 예외 추가 필요** (예: `api/setup/buildings` GET 한정 — 단 matcher 는 메서드 구분 불가 → 전체 `/api/setup/buildings` 예외 또는 route handler 내부에서 AT optional 처리). **본 SPEC 구현 디테일** (plan.md 단계).

---

## 5. managed_building_id 마이그레이션 (SETUP 소유 — migration 005)

### 5.1 배경

AUTH P0 (plan-auditor iteration 1 MAJOR-2 결정): `managed_building` 은 **회원 단위(`users.managed_building_id`)** 로 표현되어야 함. 이유:
- 공유 `roles` 룩업 테이블 배치 시 2개 동 × 복수 REP 표현 불가 (한 role row = 한 building)
- AUTH verify-unit (REQ-AUTH-011) 은 이미 `users.managed_building_id` 에 쓰고 있음 (verify-unit/route.ts line 122-128)
- `roles.managed_building_id` 는 migration 001 에서 호환성 목적으로 보존됨 → **SETUP 이 정리 책임**

### 5.2 migration 005 (본 SPEC 소유)

**파일**: `migrations/005_managed_building_unify.sql`

**내용 (WHAT)**:
1. `ALTER TABLE roles DROP COLUMN managed_building_id` (및 종속 FK `roles_managed_building_id_fkey` 자동 제거)

**데이터 안전성 (검증 완료)**:
- seed.ts 의 roles INSERT 는 `(code, name, sort_order)` 만 기입 → **모든 roles 행의 managed_building_id = NULL**
- AUTH 가 추가한 users 행 역시 REP 인 경우에만 `users.managed_building_id` 에 값 (verify-unit 에서만 설정)
- 따라서 DROP COLUMN 은 데이터 손실 없음

**영향 받는 코드**:
- AUTH 코드(`roles.managed_building_id` 읽기): grep 결과 AUTH 코드는 `users.managed_building_id` 만 사용 (verify-unit/route.ts, deactivate/route.ts, signup/route.ts, refresh test). **roles.managed_building_id 를 읽는 AUTH 코드 없음** → migration 005 적용 후 AUTH 코드 회귀 없음.
- AUTH migration-001.test.ts (MAJOR-2 검증): `roles.managed_building_id` FK 존재 검증 (`foreignKeyExists(pool, 'roles_managed_building_id_fkey')`) — migration 005 적용 시 이 테스트가 실패할 수 있음 → **SETUP 은 AUTH 의 migration-001.test.ts 를 업데이트하거나 migration 005 전용 테스트로 대체 검증 추가** (plan.md 단계에서 처리 권고).

### 5.3 단일 출처 확정

migration 005 적용 후:
- **REP 담당 동 단일 출처 = `users.managed_building_id`**
- AUTH verify-unit (REQ-AUTH-011) 호환성 유지: 변경 없음
- SETUP-04 (직책 부여/회수) 는 `users.managed_building_id` 에 쓰기

---

## 6. AUTH 와의 경계 (소유권 명확화)

### 6.1 강제 탈퇴 (AUTH-07) 소유권

| 측면 | AUTH (`POST /api/auth/users/[id]/deactivate`) | SETUP (`DELETE /api/setup/users/:id`) |
|------|------------------------------------------------|----------------------------------------|
| 요구사항 | AUTH-07 (REQ-AUTH-014, P0) | apt_06 §2 경로 정의 |
| 구현 상태 | **이미 구현됨** (withTransaction 5단계) | 미구현 |
| 사이드이펙트 | status=INACTIVE + 건의 아카이브(author_id=NULL, author_label="전 입주민", archived=true, ADR-005 unit_id 보존) + role 환원 + unit/verified 해제 + RT 갱신 차단 | (미정) |
| RBAC | ADMIN 전용 (REQ-AUTH-016) | apt_06: ADMIN 전용 |

**권고 (옵션 A)**: SETUP 은 `DELETE /setup/users/:id` 를 **구현하지 않음**. 클라이언트는 AUTH deactivate 엔드포인트(`/api/auth/users/:id/deactivate`) 호출. 본 SPEC Exclusion 명시.

**대안 (옵션 B)**: SETUP 이 thin wrapper 구현 — `DELETE /setup/users/:id` → 내부 AUTH deactivate 도메인 함수 호출. 단, AUTH deactivate 는 route handler 내에 인라인되어 있어 도메인 함수 분리 필요 (리팩터링 비용). 권고하지 않음.

### 6.2 verify-unit (REQ-AUTH-010/010a/011/012) 경계

| 측면 | AUTH | SETUP |
|------|------|-------|
| POST /api/auth/verify-unit | **소유** (회원 인증 상태 변경) | 소비 안 함 |
| GET /api/setup/buildings (동/호수 목록) | 클라이언트 소비 | **소유** (CRUD 읽기 공개 엔드포인트) |

경계 명확: AUTH verify-unit 은 SETUP buildings/units 데이터를 읽기만. SETUP 은 AUTH 의 인증 흐름에 관여하지 않음.

### 6.3 RBAC 미들웨어

- AUTH `src/middleware.ts` 는 verified 리다이렉트만 담당 (RBAC 없음)
- AUTH route handler 내부 RBAC (deactivate route.ts line 70-84 패턴)
- SETUP 도 동일 패턴 재사용: route handler 내부에서 `verifyAccessToken` + role 조회 + RBAC 검사

---

## 7. 관리사무소 회원 관리 플로우 (apt_04 §7)

```
관리사무소 → 회원 관리 화면 → 입주민 목록 (SETUP-05 GET /setup/users)
  ├── 필터 (building/role/page)
  └── 작업 선택:
        ├── 직책 부여 (SETUP-04 PUT /setup/users/:id/role)
        │     ├── 일반 입주민 → REP/AUDITOR/CHAIR 선택
        │     ├── REP 선택 → 담당 동 필수 (managed_building_id)
        │     └── 저장
        └── 강제 탈퇴 → AUTH deactivate 엔드포인트 (옵션 A)
              ├── 확인 다이얼로그
              └── 계정 비활성화 + 건의 아카이브 + 직책 회수 (AUTH 5단계)
```

(출처: apt_04 §7 관리사무소 회원 관리 플로우)

---

## 8. 보안 설계 (SETUP 도메인 관련)

### 8.1 RBAC (apt_08 §3, §7)

- 모든 SETUP API (단 GET buildings 공개 제외) 서버 사이드 JWT 검증 + role 체크 필수
- 클라이언트 단독 신뢰 금지 (AUTH 패턴 동일)
- ADMIN 전용: 동 추가/삭제, 호수 관리, 회원 목록
- ADMIN·CHAIR: 직책 부여/변경/회수

### 8.2 입력 유효성 검증 (apt_08 §4)

- 서버 사이드 필수 (zod, AUTH verify-unit route.ts 패턴 재사용)
- SQL Injection: Parameterized Query (AUTH AC-AUTH-026 패턴)
- 문자열 길이: building name VARCHAR(20), unit_number VARCHAR(10)
- UUID path param 형식 검증 (AUTH deactivate route.ts `UUID_RE` 패턴)

### 8.3 개인정보 최소화 (apt_08 §5)

- SETUP-05 회원 목록 노출: email + role + building + unit + verified_at + status
- **password_hash 절대 미포함** (AUTH AC-AUTH-025 패턴)
- 이름/전화번호 미수집 정책 유지

### 8.4 삭제 안전성 (apt_03 SETUP-01/02)

- 동/호수 삭제 전 **활성 입주민 존재 여부 확인** → 있으면 409
- 이유: 인증된 입주민의 unit_id 가 dangling FK 가 되는 것 방지

---

## 9. 리스크 및 제약

| 리스크/제약 | 설명 | 완화 방안 |
|-------------|------|-----------|
| **roles.managed_building_id 제거 시 AUTH 테스트 회귀** | migration-001.test.ts MAJOR-2 가 FK 존재 검증 | migration 005 전용 테스트 추가 + AUTH migration-001.test.ts 업데이트 (또는 조건부 스킵) |
| **강제 탈퇴 API 경로 불일치** | apt_06 `DELETE /setup/users/:id` vs AUTH `/auth/users/:id/deactivate` | 옵션 A (SETUP 미구현, AUTH 위임) 권고 — Plan Review 결정 |
| **CHAIR 의 ADMIN 부여 권한 모호** | apt_08 매트릭스는 "직책 부여" ADMIN·CHAIR 표시이나 ADMIN 부여 범위 불명확 | CHAIR 는 RESIDENT/REP/AUDITOR 부여만, ADMIN 부여·회수는 ADMIN 전용 권고 |
| **GET /setup/buildings 공개 처리** | AUTH middleware matcher 예외 필요 | route handler 내부 AT optional 처리 또는 matcher 예외 — 구현 디테일 |
| **회장(CHAIR) 단일성 보장** | 동시 다중 CHAIR 부여 시 race condition | withTransaction 내 기존 CHAIR 회수 + 신규 부여 원자적 처리 |
| **seed.ts 소유권 이관** | AUTH 가 작성한 seed.ts (`scripts/seed.ts`) 가 SETUP 데이터 시드 | 소유권 이관: SETUP SPEC 구현 시 seed.ts 주석/책임 SETUP 명시 (코드 자체는 유지, `@MX:NOTE` 업데이트) |
| **호수 unit_number 패턴 검증** | "101", "201A" 등 비정형 가능 | VARCHAR(10) + 최소 1자 이상, 엄격한 정규식 비적용 (비정형 구조 허용) |
| **SETUP-03 (직책 종류 CRUD) 범위 결정** | P1 이나 본 SPEC 포함 여부 | OUT 권고 — 역할 종류는 ADMIN/CHAIR/REP/AUDITOR/RESIDENT 5종 고정이 아이뜨락 요구에 충분 |
| **HTTPS 강제** | 모든 API HTTPS (apt_08 §6) | Railway 자동 HTTPS; 개발 환경 예외 |
| **환경 변수** | AUTH 와 동일 (DATABASE_URL, JWT_SECRET 등) | 재사용, 신규 불필요 |

---

## 10. 연구 결론 (SPEC 작성을 위한 핵심 관찰)

1. **P0 범위 명확**: SETUP-01(동 관리), SETUP-02(호수 관리), SETUP-04(직책 부여/변경/회수), SETUP-05(회원 목록). SETUP-03(직책 종류 CRUD, P1)은 OUT 권고.

2. **managed_building_id 단일 출처 통일 (SETUP 소유)**: migration 005 로 `roles.managed_building_id` 제거, `users.managed_building_id` 를 REP 담당 동 단일 출처로 확정. AUTH 코드 영향 없음 (이미 users 기반).

3. **AUTH P0 산출물 재사용**: `src/lib/{db,auth,cookies}.ts`, `verifyAccessToken`, `withTransaction`, `query`, RBAC route handler 패턴(deactivate route.ts), UUID 정규식, zod 검증 — 모두 재사용. 신규 라이브러리 최소.

4. **강제 탈퇴 소유권 = AUTH 단일**: `DELETE /setup/users/:id` 는 SETUP 미구현 권고(옵션 A). AUTH `/auth/users/:id/deactivate` 가 ADR-005 호수 귀속 + RT 무효화 + 건의 아카이브 포함 5단계 원자적 처리를 이미 소유.

5. **GET /setup/buildings 공개 엔드포인트**: AUTH verify-unit 클라이언트 소비 목적. 미들웨어 예외 처리 필요.

6. **권한 매트릭스 3계층**: ADMIN(전체), CHAIR(직책 부여—RESIDENT/REP/AUDITOR 한정 권고), 그 외(읽기-동/호수만).

7. **삭제 안전성**: 동/호수 삭제 시 활성 입주민 존재 확인 → 409.

8. **회장 단일성**: withTransaction 으로 기존 CHAIR 회수 + 신규 부여 원자적 처리.

9. **개인정보 최소화 유지**: SETUP-05 회원 목록 email 만 노출, password_hash 미포함.

10. **총 5개 모듈 (≤5)**: 동 관리 / 호수 관리 / 직책 관리(부여/변경/회수) / 회원 목록 조회 / managed_building_id 통일(migration 005).

---

## 11. Reference (기획 문서 파일 경로)

| 항목 | 파일 경로 |
|------|-----------|
| 서비스 기획 (관리사무소 컨텍스트) | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_01_서비스기획서.md` |
| PRD (SETUP-01~05, P0/P1) | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_02_PRD.md` |
| 기능 명세서 (SETUP 입출력/예외, 회원 관리 플로우) | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_03_기능명세서.md` |
| 유저 플로우 (apt_04 §7 관리사무소 회원 관리) | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_04_유저플로우.md` |
| ERD (buildings/units/roles/users 스키마) | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_05_ERD.md` |
| API 명세서 (/setup/* 엔드포인트) | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_06_API명세서.md` |
| 시스템 아키텍처 | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_07_시스템아키텍처.md` |
| 보안 설계 (RBAC, 접근 제어 매트릭스) | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_08_보안설계.md` |
| ADR (ADR-005 호수 귀속 등) | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_09_ADR.md` |
| AUTH migration 001 (buildings/units/roles/users 스키마) | `/Users/ip9202/develop/vibe/apartment/migrations/001_init_users_buildings_units_roles.sql` |
| AUTH seed.ts (초기 데이터) | `/Users/ip9202/develop/vibe/apartment/scripts/seed.ts` |
| AUTH middleware.ts (RBAC/verified 패턴) | `/Users/ip9202/develop/vibe/apartment/src/middleware.ts` |
| AUTH deactivate route.ts (ADMIN RBAC + withTransaction 패턴) | `/Users/ip9202/develop/vibe/apartment/src/app/api/auth/users/[id]/deactivate/route.ts` |
| AUTH verify-unit route.ts (managed_building_id 사용 패턴) | `/Users/ip9202/develop/vibe/apartment/src/app/api/auth/verify-unit/route.ts` |
| AUTH research.md (의존성 경계 원형) | `/Users/ip9202/develop/vibe/apartment/.moai/specs/SPEC-AUTH-001/research.md` |
| AUTH spec-compact.md (EARS/AC 패턴 원형) | `/Users/ip9202/develop/vibe/apartment/.moai/specs/SPEC-AUTH-001/spec-compact.md` |
| 프로젝트 product.md | `/Users/ip9202/develop/vibe/apartment/.moai/project/product.md` |
| 프로젝트 tech.md | `/Users/ip9202/develop/vibe/apartment/.moai/project/tech.md` |
| 프로젝트 structure.md | `/Users/ip9202/develop/vibe/apartment/.moai/project/structure.md` |

---

*본 research.md는 Plan Review 게이트 통과 후 spec.md/plan.md/acceptance.md 작성의 기반이 됩니다. 구현 디테일(함수명/클래스/API 스키마)은 plan.md 단계에서 결정합니다.*
