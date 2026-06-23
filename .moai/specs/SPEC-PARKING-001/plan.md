# SPEC-PARKING-001 Implementation Plan

주차 자리 번호 배정 추첨(회차생성/추첨/취소/자동배정/결과공개/열람/투명성) 도메인의 TDD 구현 계획. `spec.md`의 5개 모듈(M1~M5)과 27개 REQ-PK-XXX 요구사항을 RED-GREEN-REFACTOR 주기로 구현한다.

---

## 1. 구현 순서 (TDD Phase Decomposition)

구현 순서는 의존성 그래프 기반: 스키마(M0) → 순열 로직(M0b) → 회차 생성(M1) → 추첨/취소(M2/M3) → 자동배정(M4) → 공개/열람/투명성(M5).

### Phase 0: migration 008_parking.sql — parking_rounds + parking_assignments (M0, greenfield)

**범위**: 신규 테이블 2종 생성. migration 007(SUGGEST) 이후 순차 적용.

**파일**:
- `migrations/008_parking.sql` (신규)

**내용 (WHAT)**:
```sql
-- @MX:NOTE: [AUTO] PARKING 도메인 신규 테이블 — slot assignment (자리 번호 배정) 추첨.
--           win/lose 추첨 아님. 모든 세대 1자리 보장, 탈락자 없음.
--           회차 seed 기반 결정론적 순열로 unit→slot 배정.

-- 1. parking_rounds: 회차 (기간 + 자리풀 + seed + 상태)
CREATE TABLE IF NOT EXISTS parking_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  application_start TIMESTAMPTZ NOT NULL,
  application_end TIMESTAMPTZ NOT NULL,
  slot_pool JSONB NOT NULL,                            -- 자리 번호 풀 (관리소 동적 입력, 예: ["A-01",...,[1,2,...]])
  seed_value TEXT NOT NULL,                            -- 결정론적 순열 seed (회차 생성 시 확정, 불변)
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',          -- OPEN/ASSIGNED/PUBLISHED/CLOSED
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT parking_rounds_dates_check CHECK (application_start < application_end),
  CONSTRAINT parking_rounds_status_check CHECK (status IN ('OPEN', 'ASSIGNED', 'PUBLISHED', 'CLOSED'))
);

CREATE INDEX IF NOT EXISTS idx_parking_rounds_status ON parking_rounds(status);
CREATE INDEX IF NOT EXISTS idx_parking_rounds_created_at_desc ON parking_rounds(created_at DESC);

-- 2. parking_assignments: 배정 결과 (주민 추첨 + 자동배정 통합)
CREATE TABLE IF NOT EXISTS parking_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES parking_rounds(id),
  unit_id UUID NOT NULL REFERENCES units(id),
  assigned_slot JSONB NOT NULL,                        -- 배정된 자리 번호 (slot_pool 요소 중 하나)
  assignment_source VARCHAR(20) NOT NULL DEFAULT 'DRAW', -- DRAW(주민버튼)/AUTO(자동배정)/ADMIN(수동)
  drawn_at TIMESTAMPTZ,                                -- 주민 버튼 클릭 시각 (DRAW만)
  drawn_by UUID REFERENCES users(id),                  -- 주민 버튼 클릭자 (DRAW만)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT parking_assignments_source_check CHECK (assignment_source IN ('DRAW', 'AUTO', 'ADMIN')),
  CONSTRAINT parking_assignments_draw_check CHECK (
    (assignment_source = 'DRAW' AND drawn_at IS NOT NULL AND drawn_by IS NOT NULL)
    OR (assignment_source IN ('AUTO', 'ADMIN') AND drawn_at IS NULL AND drawn_by IS NULL)
  ),
  UNIQUE(round_id, unit_id)                            -- 회차별 세대 1배정 보장 (핵심 불변)
);

CREATE INDEX IF NOT EXISTS idx_parking_assignments_round ON parking_assignments(round_id);
CREATE INDEX IF NOT EXISTS idx_parking_assignments_unit ON parking_assignments(unit_id);
CREATE INDEX IF NOT EXISTS idx_parking_assignments_drawn_by ON parking_assignments(drawn_by);
```

**TDD 주기**:
- RED: `src/lib/migration-008.test.ts` 작성 (`migration-test-helpers.ts` 재사용). `beforeAll`에서 001→008 순차 적용. 어설션:
  - parking_rounds 컬럼 10종 존재 (id, name, application_start, application_end, slot_pool, seed_value, status, is_published, created_at, updated_at)
  - parking_rounds CHECK 제약 존재 (dates_check: application_start < application_end, status_check: OPEN/ASSIGNED/PUBLISHED/CLOSED)
  - parking_assignments 컬럼 8종 존재 (id, round_id, unit_id, assigned_slot, assignment_source, drawn_at, drawn_by, created_at)
  - parking_assignments CHECK 제약 존재 (source_check: DRAW/AUTO/ADMIN, draw_check: DRAW는 drawn_at+drawn_by 필수, AUTO/ADMIN은 NULL)
  - UNIQUE(round_id, unit_id) 제약 존재
  - FK 존재 (assignments.round_id→rounds, assignments.unit_id→units, assignments.drawn_by→users)
  - 인덱스 존재 (rounds.status, rounds.created_at_desc, assignments.round, assignments.unit, assignments.drawn_by)
  - 멱등성 (008 재적용 시 에러 없음)
  → 실패
- GREEN: `migrations/008_parking.sql` 적용 → 통과
- REFACTOR: 불필요 (단일 DDL)

---

### Phase 0b: parking-lottery.ts — 결정론적 순열 로직 (M0b, greenfield)

**범위**: HMAC-SHA256 PRNG + Fisher-Yates 셔플. 순수 함수, 외부 의존 없음.

**파일**:
- `src/lib/parking-lottery.ts` (신규)
- `src/lib/parking-lottery.test.ts` (신규)

**내용 (WHAT — 알고리즘 명세, 구현 디테일 아님)**:

```typescript
// @MX:ANCHOR: [AUTO] generatePermutation — fan_in=3 (M2 추첨, M4 자동배정, M5 재현검증).
//             동일 seed + 동일 units(정렬) + 동일 slot_pool → 동일 unit→slot 매핑 보장.
//             HMAC-SHA256 PRNG 결정론. 재현 검증 불변 계약.

import { createHmac, randomBytes } from 'node:crypto';

// HMAC-SHA256 기반 결정론적 PRNG (counter mode)
// seed를 키로 사용, counter를 입력으로 HMAC-SHA256 해시 산출 → [0,1) 난수
function createSeededPRNG(seed: string): () => number {
  let counter = 0;
  return () => {
    const hmac = createHmac('sha256', seed);
    hmac.update(Buffer.from([counter++]));
    const hash = hmac.digest();
    // hash 앞 8바이트 → uint64 → [0, 1)
    const view = new DataView(hash.buffer);
    return Number(view.getBigUint64(0, false) % BigInt(0xFFFFFFFF)) / 0xFFFFFFFF;
  };
}

// Fisher-Yates in-place shuffle (표준 알고리즘)
function fisherYatesInPlace<T>(array: T[], rng: () => number): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// unit→slot 순열 생성 (재현 가능)
export function generatePermutation(
  seed: string,
  sortedUnits: string[],    // 결정론적 정렬된 unit_id 목록
  slotPool: unknown[]       // 자리 번호 풀 (JSONB 파싱 결과)
): Array<{ unitId: string; slot: unknown }> {
  // @MX:NOTE: 정렬 기준 — building_name ASC, unit_number ASC (호출자 책임)
  const rng = createSeededPRNG(seed);
  const shuffled = fisherYatesInPlace([...sortedUnits], rng);
  return shuffled.map((unitId, i) => ({ unitId, slot: slotPool[i] }));
}

// seed 생성 (회차 생성용)
export function generateSeed(): string {
  return randomBytes(16).toString('base64');
}
```

**TDD 주기** (재현 검증 핵심):
- RED:
  - 동일 seed + 동일 입력 → 동일 순열 (10회 반복 동일 결과)
  - 상이 seed → 상이 순열 (확률적으로)
  - 단일 unit → 단일 slot
  - 빈 units 배열 → 빈 결과
  - units.length > slotPool.length → 에러 (자리 부족)
  - units.length < slotPool.length → units만큼만 배정 (여유 slot 무시)
  → 실패
- GREEN: parking-lottery.ts 구현 → 통과
- REFACTOR: 알고리즘 가독성 정리 (변경 없음 예상)

---

### Phase 1: 회차 생성 (M1, greenfield)

**범위**: PARKING-01 회차 생성 (POST ADMIN/CHAIR, 기간+자리풀+seed).

**파일**:
- `src/app/api/parking/rounds/route.ts` (신규 — POST ADMIN/CHAIR)
- `src/app/api/parking/rounds/route.test.ts` (신규)
- `src/lib/parking-rbac.ts` (신규 — Option C, suggest-rbac.ts 패턴. Bearer→verifyAccessToken→ACTIVE 조회 후 {callerId, callerRole, unitId, managedBuildingId} 반환)

**구현 디테일**:
- `POST /api/parking/rounds`: route-level Bearer 인증 (`requireAuthenticated` from parking-rbac.ts). 역할 확인 (ADMIN/CHAIR만, 아니면 403). zod 검증:
  - `name: string 1~100자`
  - `application_start: string ISO 8601`
  - `application_end: string ISO 8601`
  - `slot_pool: array 최소 1 요소` (문자열/숫자 혼합 허용)
- 기간 유효성 (application_start < application_end, 아니면 422)
- 자리풀 크기 검증 (slot_pool.length >= units 테이블 행 수, 아니면 422 — 모든 세대 1자리 보장)
- seed 생성 (`generateSeed()` from parking-lottery.ts)
- INSERT parking_rounds (status='OPEN', seed_value=생성된 seed)
- 201 응답 (회차 ID, 이름, 기간, 자리풀, 상태, seed_value, 생성 시각)

**TDD 주기** (REQ-PK-001~005):
- RED: 생성 201 / 비-ADMIN/비-CHAIR 403 / 기간 위반 422 / 자리풀 부족 422 / 미인증 401 / 빈 자리풀 422 테스트 작성 → 실패
- GREEN: route handler 구현 → 통과
- REFACTOR: 검증 로직 가독성 정리

---

### Phase 2: 추첨(자리 확정) + 취소 (M2, M3, greenfield)

**범위**: PARKING-02 추첨 (POST RESIDENT 이상, seed 순열 본인 slot 확정) + PARKING-03 취소 (DELETE 본인).

**파일**:
- `src/app/api/parking/rounds/[id]/draw/route.ts` (신규 — POST 추첨, DELETE 취소)
- `src/app/api/parking/rounds/[id]/draw/route.test.ts` (신규)

**구현 디테일**:
- `POST /api/parking/rounds/[id]/draw`: `requireAuthenticated`. UUID 검증. 회차 조회 → 미존재 404. status='OPEN' 확인 (아니면 409). 요청자 unit_id NOT NULL 확인 (NULL이면 403). 기존 assignment 확인 (UNIQUE 위반 시 409). seed_value + 정렬된 units + slot_pool으로 `generatePermutation` 산출 → 요청자 unit_id의 slot 확정. INSERT parking_assignments (assignment_source='DRAW', drawn_at=now(), drawn_by=callerId). 200 응답 (배정된 slot).
- `DELETE /api/parking/rounds/[id]/draw`: `requireAuthenticated`. UUID 검증. 회차 status='OPEN' 확인 (아니면 409). 요청자의 DRAW assignment 조회 (drawn_by=callerId, assignment_source='DRAW'). 미존재 404. AUTO/ADMIN assignment 403. DELETE assignment 행. 200 응답.

**TDD 주기** (REQ-PK-006~014):
- RED:
  - 추첨 200 (본인 slot 반환)
  - 세대당 1회 (중복 409)
  - OPEN 외 추첨 409 (ASSIGNED/PUBLISHED/CLOSED)
  - 미인증 사용자(unit_id NULL) 403
  - 미인증 401
  - 취소 200 (본인 DRAW assignment 삭제)
  - OPEN 외 취소 409
  - 타인/AUTO assignment 취소 403
  - 미존재 assignment 취소 404
  - 취소 후 재추첨 200 (같은 slot)
  → 실패
- GREEN: route handler 구현 → 통과
- REFACTOR: 순열 산출 로직 추출 (parking-lottery.ts 재사용)

---

### Phase 3: 자동배정 실행 (M4, greenfield)

**범위**: PARKING-04 자동배정 (POST ADMIN, 미참여 세대 일괄 배정, FOR UPDATE 트랜잭션).

**파일**:
- `src/app/api/parking/rounds/[id]/auto-assign/route.ts` (신규 — POST ADMIN)
- `src/app/api/parking/rounds/[id]/auto-assign/route.test.ts` (신규)

**구현 디테일**:
- `POST /api/parking/rounds/[id]/auto-assign`: `requireAdmin`. UUID 검증. **트랜잭션 시작** (`withTransaction`):
  1. 회차 row `SELECT ... FOR UPDATE` 잠금 (status 확인)
  2. status='OPEN' 확인 (아니면 409 — COMMIT 전 throw → ROLLBACK)
  3. seed_value + 정렬된 전체 units + slot_pool으로 `generatePermutation` 산출
  4. 기존 assignments 조회 (배정된 unit_id 집합)
  5. 미참여 units 필터링 (전체 units - 기존 assignments)
  6. 사용가능 slot 수 >= 미참여 units 수 확인 (아니면 throw → ROLLBACK, 409 Conflict — REQ-PK-018 도메인 불변 "탈락자 없음" 강제, 부분 배정 금지)
  7. 미참여 units에 slot 일괄 INSERT (assignment_source='AUTO', drawn_at=NULL, drawn_by=NULL)
  8. status OPEN→ASSIGNED 전이 (UPDATE)
  9. COMMIT
- 200 응답 (배정된 세대 수; 정상 흐름에서는 미배정 0건 — REQ-PK-003 사전 검증으로 자리 부족 도달 불가)

**@MX:WARN**: FOR UPDATE load-bearing (상단 블록 코멘트 + 인라인).

**TDD 주기** (REQ-PK-015~019):
- RED:
  - 자동배정 200 (미참여 세대 일괄 배정, AUTO source)
  - OPEN→ASSIGNED 전이 확인
  - OPEN 외 자동배정 409
  - 동시 자동배정 (FOR UPDATE — 첫 번째 COMMIT 후 두 번째 409) — 단위 테스트에서는 트랜잭션 격리 시뮬레이션
  - 비-ADMIN 403
  - 미인증 401
  - 자리풀 부족 시 409 Conflict + 트랜잭션 롤백 (REQ-PK-018 도메인 불변 수호, 부분 배정 금지, 회차 status OPEN 유지)
  - 기존 DRAW assignment 보존 (자동배정이 덮어쓰지 않음)
  → 실패
- GREEN: route handler 구현 → 통과
- REFACTOR: 트랜잭션 로직 가독성 정리

---

### Phase 4: 결과 공개 + 열람 + 투명성 (M5, greenfield)

**범위**: PARKING-05 공개 (PUT ADMIN, ASSIGNED→PUBLISHED) + PARKING-06 열람 (GET 역할별 분기) + PARKING-07 투명성 (GET seed+알고리즘+입력 공개).

**파일**:
- `src/app/api/parking/rounds/[id]/publish/route.ts` (신규 — PUT ADMIN)
- `src/app/api/parking/rounds/[id]/allocations/route.ts` (신규 — GET 역할별 분기)
- `src/app/api/parking/rounds/[id]/verify/route.ts` (신규 — GET 투명성)
- 각 route.test.ts (신규)

**구현 디테일**:
- `PUT /api/parking/rounds/[id]/publish`: `requireAdmin`. UUID 검증. 회차 status='ASSIGNED' 확인 (아니면 409). UPDATE parking_rounds (is_published=true, status='PUBLISHED'). 200 응답.
- `GET /api/parking/rounds/[id]/allocations`: `requireAuthenticated`. UUID 검증. 회차 조회. 역할별 가시성 분기:
  - is_published=true:
    - RESIDENT/AUDITOR: 본인 unit 배정만 (JOIN users → assignments.unit_id == callerUnitId)
    - REP: 담당동 배정 (JOIN units/buildings → building_id == managedBuildingId)
    - CHAIR/ADMIN: 전체
  - is_published=false:
    - RESIDENT/AUDITOR/REP: 본인 unit 배정만 (비공개 상태 본인 확인 허용)
    - CHAIR/ADMIN: 전체
  - 200 응답 (배정 목록: unit_id, building, unit_number, assigned_slot, assignment_source)
- `GET /api/parking/rounds/[id]/verify`: `requireAuthenticated`. UUID 검증. 회차 seed_value, 알고리즘 명칭('Fisher-Yates + HMAC-SHA256'), 정렬 기준('building_name ASC, unit_number ASC'), slot_pool, 정렬된 unit 목록 반환. 200 응답. (재현 검증용 — 클라이언트가 동일 알고리즘으로 재현 가능)

**TDD 주기** (REQ-PK-020~027):
- RED:
  - 공개 200 (ASSIGNED→PUBLISHED 전이, is_published=true)
  - ASSIGNED 외 공개 409
  - 비-ADMIN 공개 403
  - 미인증 공개 401
  - 열람 200 (is_published=true, 역할별: RESIDENT 본인, REP 담당동, CHAIR/ADMIN 전체)
  - 열람 200 (is_published=false, 본인만)
  - 미공개 타인 열람 200 빈 목록 (정보은닉, REQ-PK-024 / AC-PK-040)
  - 미인증 열람 401
  - 투명성 200 (seed + 알고리즘 + 정렬 기준 + 자리풀 + unit 목록 반환)
  - 재현 검증 (동일 seed+입력 → 동일 배정 결과 — parking-lottery.test.ts 연동)
  → 실패
- GREEN: route handler 구현 → 통과
- REFACTOR: 역할 분기 로직 가독성 정리

---

### Phase V: 최종 검증 + develop 머지 준비

**범위**: 전체 AC 통과, TRUST 5 게이트, AUTH/SETUP/NOTICE/SUGGEST 회귀 없음 확인.

---

## 2. 회차 상태머신 정의

회차 status 전이 규칙 (SUGGEST 상태전이 화이트리스트 패턴 준거):

```typescript
const PARKING_ROUND_TRANSITIONS: Record<string, Set<string>> = {
  OPEN: new Set(['ASSIGNED']),      // 자동배정 실행 (ADMIN 트리거)
  ASSIGNED: new Set(['PUBLISHED']), // 결과 공개 (ADMIN)
  PUBLISHED: new Set(['CLOSED']),   // 회차 종료 (ADMIN, P1 별도 SPEC)
  CLOSED: new Set(),                // 최종 상태 (역방향 전이 금지)
};
```

전이 트리거:
- OPEN → ASSIGNED: 자동배정 실행 (REQ-PK-015, POST /auto-assign, ADMIN)
- ASSIGNED → PUBLISHED: 결과 공개 (REQ-PK-020, PUT /publish, ADMIN)
- PUBLISHED → CLOSED: 회차 종료 (P1 별도 SPEC, 본 SPEC 범위 외 — CLOSED 상태 정의만 포함)

불허 전이 (409 Conflict):
- OPEN → PUBLISHED (자동배정 단계 스킵 불가 — 모든 세대 배정 보장)
- OPEN → CLOSED (ASSIGNED/PUBLISHED 단계 스킵 불가)
- 역방향 전이 전부 (ASSIGNED → OPEN, PUBLISHED → ASSIGNED 등)

추첨/취소 허용 상태:
- 추첨 (POST /draw): OPEN만 (REQ-PK-008)
- 취소 (DELETE /draw): OPEN만 (REQ-PK-012)

---

## 3. seed 순열 설계 (재현 검증 불변)

### 3.1 알고리즘 선택: HMAC-SHA256 PRNG + Fisher-Yates (옵션 A)

**근거** (research.md §10.1 trade-off):
- Node.js crypto 내장 (외부 의존성 없음)
- 결정론적 (동일 seed → 동일 결과) — 재현 검증 가능
- 암호학적으로 안전한 해시 (HMAC-SHA256)
- 단순 구조 (~50줄), 테스트 용이
- 38세대 소규모 → 성능 문제 없음 (~1ms)

### 3.2 순열 입력 (결정론 보장 조건)

1. **seed**: 회차 생성 시 `randomBytes(16).toString('base64')` 생성, 이후 불변
2. **정렬된 unit_id 목록**: `building_name ASC, unit_number ASC` 정렬 (결정론적)
3. **slot_pool**: 회차 생성 시 관리소 입력 (JSONB 배열, 입력 순서 보존)

동일 seed + 동일 정렬 units + 동일 slot_pool → 동일 unit→slot 매핑 (불변 계약).

### 3.3 seed 불변 보장 메커니즘

- `parking_rounds.seed_value`는 INSERT 시 한 번 설정
- UPDATE 쿼리에서 seed_value 컬럼 미포함 (트랜잭션 내 읽기 전용)
- @MX:WARN 주석으로 UPDATE 금지 명시
- 회차 수정/삭제 API는 본 SPEC 범위 외 (P1 별도 SPEC) — seed 불변 자동 보장

### 3.4 재현 검증 API (PARKING-07)

`GET /api/parking/rounds/[id]/verify` 응답:
- `seed_value`: 회차 seed (공개)
- `algorithm`: 'Fisher-Yates + HMAC-SHA256' (알고리즘 식별자)
- `sort_criteria`: 'building_name ASC, unit_number ASC' (정렬 기준)
- `slot_pool`: 자리풀 (공개)
- `sorted_units`: 정렬된 unit_id 목록 (공개 — 재현 입력)

클라이언트는 이 정보로 동일 알고리즘을 구현하여 배정 결과를 재현 검증할 수 있다.

---

## 4. 동시성 전략

### 4.1 추첨(자리확정) 동시성 — UNIQUE 제약 1차 방어

- 동일 unit의 동시 추첨 시도: 두 번째 INSERT는 UNIQUE(round_id, unit_id) 위반 → 409
- 회차 row FOR UPDATE 불필요 — 순열은 seed 기반 결정론적, 순서 무관 (동시에 계산해도 동일 slot)

### 4.2 자동배정 실행 동시성 — FOR UPDATE 필수 (load-bearing)

- 두 관리자 동시 자동배정 실행 시: 첫 번째 트랜잭션이 회차 row FOR UPDATE로 잠금
- 두 번째 트랜잭션은 대기 → 첫 번째 COMMIT 후 status='ASSIGNED' 확인 → 409
- @MX:WARN + @MX:REASON 필수 (SETUP role route:160-161 패턴 준거)

### 4.3 추첨 취소 동시성

- assignment row 삭제 시 동시 요청: 두 번째 DELETE는 0 row affected → 404
- 또는 FOR UPDATE로 잠금 (선택적 — 38세대 소규모이므로 UNIQUE 제약만으로 충분)

### 4.4 회차 전환 시 이전 배정 보존

- 회차별 assignments 독립 (round_id FK 분리)
- 상태 전이 화이트리스트로 역방향 전이 차단 (CLOSED 회차 수정 불가)

---

## 5. RBAC 구조 (Option C — suggest-rbac.ts 패턴)

### 5.1 parking-rbac.ts 신규 모듈

- 공통 `src/lib/rbac.ts` 수정 없음 (AUTH/SETUP/NOTICE/SUGGEST 412 테스트 회귀 방지)
- `requireAuthenticated`: Bearer → verifyAccessToken → ACTIVE 조회 → {callerId, callerRole, unitId, managedBuildingId} 반환
- fan_in >= 3 (M1 회차생성 권한, M2 추첨, M5 열람 등) → @MX:ANCHOR 후보

### 5.2 역할별 가시성 (PARKING-06)

| 역할 | is_published=true | is_published=false |
|------|-------------------|--------------------|
| RESIDENT | 본인 unit 배정만 | 본인 unit 배정만 |
| AUDITOR | 본인 unit 배정만 (RESIDENT 동일) | 본인 unit 배정만 |
| REP | 담당동 배정 (managed_building_id) | 본인 unit 배정만 |
| CHAIR | 전체 | 전체 |
| ADMIN | 전체 | 전체 |

---

## 6. migration 008 스키마 개요

### 6.1 parking_rounds (회차)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | UUID PK | DEFAULT gen_random_uuid() | 회차 ID |
| name | VARCHAR(100) | NOT NULL | 회차명 |
| application_start | TIMESTAMPTZ | NOT NULL | 추첨 기간 시작 |
| application_end | TIMESTAMPTZ | NOT NULL | 추첨 기간 종료 |
| slot_pool | JSONB | NOT NULL | 자리 번호 풀 (관리소 동적 입력) |
| seed_value | TEXT | NOT NULL | 결정론적 순열 seed (불변) |
| status | VARCHAR(20) | NOT NULL DEFAULT 'OPEN', CHECK enum | OPEN/ASSIGNED/PUBLISHED/CLOSED |
| is_published | BOOLEAN | NOT NULL DEFAULT false | 결과 공개 여부 |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

CHECK: application_start < application_end, status enum.

### 6.2 parking_assignments (배정)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | UUID PK | DEFAULT gen_random_uuid() | 배정 ID |
| round_id | UUID FK | NOT NULL → parking_rounds.id | 회차 참조 |
| unit_id | UUID FK | NOT NULL → units.id | 세대 참조 |
| assigned_slot | JSONB | NOT NULL | 배정된 자리 번호 |
| assignment_source | VARCHAR(20) | NOT NULL DEFAULT 'DRAW', CHECK enum | DRAW/AUTO/ADMIN |
| drawn_at | TIMESTAMPTZ | NULL (DRAW만 NOT NULL) | 주민 버튼 클릭 시각 |
| drawn_by | UUID FK | NULL (DRAW만 NOT NULL) → users.id | 주민 버튼 클릭자 |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

CHECK: source enum, DRAW는 drawn_at+drawn_by 필수 (조건부 CHECK).
UNIQUE: (round_id, unit_id) — 회차별 세대 1배정 불변.

### 6.3 인덱스

- parking_rounds: status, created_at DESC
- parking_assignments: round_id, unit_id, drawn_by, (round_id, unit_id) UNIQUE

---

## 7. 파일 목록 요약

### 신규 파일 (greenfield)

| 파일 | 모듈 | 설명 |
|------|------|------|
| `migrations/008_parking.sql` | M0 | parking_rounds + parking_assignments 테이블 (CHECK/UNIQUE/FK/인덱스) |
| `src/lib/parking-lottery.ts` | M0b | 결정론적 순열 (HMAC-SHA256 PRNG + Fisher-Yates), generateSeed |
| `src/lib/parking-rbac.ts` | M1~M5 | PARKING 도메인 로컬 requireAuthenticated 헬퍼 (Option C) |
| `src/app/api/parking/rounds/route.ts` | M1 | POST ADMIN/CHAIR (회차 생성) |
| `src/app/api/parking/rounds/[id]/draw/route.ts` | M2/M3 | POST 추첨, DELETE 취소 |
| `src/app/api/parking/rounds/[id]/auto-assign/route.ts` | M4 | POST ADMIN (자동배정 실행, FOR UPDATE 트랜잭션) |
| `src/app/api/parking/rounds/[id]/publish/route.ts` | M5 | PUT ADMIN (결과 공개, ASSIGNED→PUBLISHED) |
| `src/app/api/parking/rounds/[id]/allocations/route.ts` | M5 | GET 역할별 분기 (결과 열람) |
| `src/app/api/parking/rounds/[id]/verify/route.ts` | M5 | GET 투명성 공개 (seed+알고리즘+입력) |
| 각 route.test.ts | M1~M5 | 테스트 |
| `src/lib/migration-008.test.ts` | M0 | migration 008 검증 테스트 |
| `src/lib/parking-lottery.test.ts` | M0b | 순열 로직 + 재현 검증 테스트 |

### 수정 파일

**없음.** 공유 파일(`src/lib/rbac.ts`, `src/lib/db.ts`, `src/middleware.ts`, AUTH/SETUP/NOTICE/SUGGEST 산출물)은 일체 수정하지 않는다 (Maintain Scope Discipline). PARKING 역할 분기용 헬퍼는 `src/lib/parking-rbac.ts` 신규 파일로 격리한다 (Option C — suggest-rbac.ts 선례 준거).

### 재사용 파일 (AUTH/SETUP/NOTICE/SUGGEST 소유, 수정 없음)

- `src/lib/db.ts` (`query`, `withTransaction`)
- `src/lib/auth.ts` (`verifyAccessToken`)
- `src/lib/rbac.ts` (`requireAdmin`, 응답 빌더)
- `src/middleware.ts` (수정 불필요)
- UUID 검증 idiom — 각 라우트가 로컬 `const UUID_REGEX` 정의 (NOTICE/SUGGEST 패턴)

---

## 8. 기술 스택

- **Next.js 15.5.19** (App Router, Route Handlers)
- **pg ^8.22.0** (PostgreSQL, Pool/PoolClient)
- **zod ^4.4.3** (스키마 검증, `z.string().uuid()` 금지 — 정규식 refine)
- **vitest ^4.1.9** (테스트, coverage v8)
- **node:crypto** (createHmac, randomBytes — 외부 의존성 없음)

---

## 9. 리스크 및 완화 방안

| 리스크 | 설명 | 완화 방안 |
|--------|------|-----------|
| **동시 자동배정 실행** | 두 관리자 동시 실행 시 중복 배정 | FOR UPDATE로 회차 row 잠금 (SETUP role route:160-161 패턴). 첫 번째 COMMIT 후 두 번째 409. @MX:WARN 필수 |
| **동시 추첨 버튼 클릭** | 동일 unit 동시 추첨 시도 | UNIQUE(round_id, unit_id) 제약이 1차 방어 → 409. 회차 row 잠금 불필요 (순열 결정론적, 순서 무관) |
| **seed 조작** | 추첨 후 seed 변경 재추첨 | seed_value INSERT 시 한 번 설정, UPDATE 금지. 회차 수정 API는 본 SPEC 범위 외 (P1). @MX:WARN |
| **재현 불가** | Math.random() 사용으로 재현 불가 | HMAC-SHA256 PRNG + Fisher-Yates (결정론적). parking-lottery.test.ts에서 재현 검증 (동일 seed → 동일 결과) |
| **자리풀 부족** | slot_pool 크기 < 세대수 | 회차 생성 시 사전 검증 (REQ-PK-003, 422). 자동배정 실행 중 자리 부족 감지 시 409 Conflict + 트랜잭션 롤백, 부분 배정 금지 (REQ-PK-018 도메인 불변 "탈락자 없음" 강제) |
| **미공개 타인 결과 노출** | is_published=false 시 타인 배정 노출 | 역할별 서버 자동 필터링 (RESIDENT/AUDITOR/REP 본인 assignment만, 없으면 빈 목록 200). 타인 존재 여부를 응답 차이로 누출하지 않음(정보은닉, REQ-PK-024) |
| **회차 전환 시 이전 배정 손실** | 새 회차 생성 시 이전 배정 변경 | 회차별 assignments 독립 (round_id FK). 상태 전이 화이트리스트로 역방향 차단 |
| **AUDITOR 권한 모호** | apt_08 §7 매트릭스 미명시 | RESIDENT 동일 취급 (본인 배정만). 후속 보안 정책 명시 권장 |
| **JSONB slot_pool 검증** | 자리 번호 형식 자유 (문자열/숫자 혼합) | zod array 최소 1 요소 검증. 요소 타입은 제한 없음 (관리소 커스텀) |
| **middleware vs route-level 401** | middleware.ts는 AT 쿠키만 검사 | 모든 PARKING route handler 내부에서 route-level Bearer 인증 강제 (NOTICE/SUGGEST 패턴) |

---

## 10. 승인 게이트 — 사용자 재확인 필요 항목 (Decision Point 1)

1. **Q2 자리풀 동적 입력 해석 (interview.md 명시)**: 관리소가 회차 생성 시 자리 번호 풀(목록)을 직접 입력하는 동적 슬롯 모델. 시스템 고정 1~38 아님. slot_pool을 JSONB로 저장 (문자열/숫자 혼합 허용). 이 해석이 맞는지 Plan Review에서 사용자 재확인 필요.
2. **회차 상태머신 (OPEN→ASSIGNED→PUBLISHED→CLOSED)**: DRAWING 중간 상태를 생략하고 자동배정 실행을 단일 트랜잭션으로 원자 처리하여 OPEN에서 바로 ASSIGNED로 전이. 이 설계가 허용되는지 확인.
3. **applications 테이블 통합**: 신청(applications)과 배정(allocations)을 분리하지 않고 parking_assignments 단일 테이블로 통합 (추첨=자리확정 동시 발생). 이 설계가 맞는지 확인.
4. **AUDITOR 권한**: RESIDENT 동일 취급 (본인 배정만 열람). 후속 보안 정책 명시 권장.
5. **PUBLISHED→CLOSED 전이**: 본 SPEC은 CLOSED 상태 정의만 포함하고 전이 API는 P1 별도 SPEC으로 이연. 이 범위 분할이 맞는지 확인.

---

## 11. MX Tag 적용 계획

`spec.md` §7에 명시된 MX Tag Plan을 Run Phase에서 적용:

- `@MX:ANCHOR`: parking-lottery.ts generatePermutation (fan_in=3), parking-rbac.ts requireAuthenticated (fan_in>=3), migration 008 스키마 불변
- `@MX:WARN + @MX:REASON`: 자동배정 FOR UPDATE 구간 (load-bearing), seed 불변 보장, UNIQUE(round_id, unit_id) 중복 방어, 회차 상태머신 전이
- `@MX:NOTE`: slot assignment 도메인 본질, slot_pool 동적 입력, applications 통합, 재현 검증
- `@MX:TODO`: PARKING-08 이력 조회, 회차 수정/삭제, 관리소 수동 배정 API

---

## 12. 검증 게이트 (Quality Gates)

- **TRUST 5**: Tested(85%+ 커버리지), Readable(한국어 도메인 용어 주석), Unified(AUTH/SETUP/NOTICE/SUGGEST 패턴 일관), Secured(RBAC + 역할 분기 + zod + Parameterized Query + seed 불변 + FOR UPDATE), Trackable(SPEC-PARKING-001 참조 커밋)
- **LSP 게이트**: run 단계 — TypeScript 에러 0, ESLint 에러 0
- **테스트 커버리지**: 신규 route handlers 85% 이상, parking-lottery.ts 100% (재현 검증 핵심)
- **AUTH/SETUP/NOTICE/SUGGEST 회귀**: 기존 412 테스트 통과 유지

---

## 13. Definition of Done

- [ ] M0 마이그레이션: REQ-PK 스키마 구현 + migration 008 테스트 통과
- [ ] M0b 순열 로직: parking-lottery.ts 구현 + 재현 검증 테스트 통과 (동일 seed → 동일 결과)
- [ ] M1 회차 생성: REQ-PK-001~005 구현 + 테스트 통과
- [ ] M2 추첨(자리 확정): REQ-PK-006~010 구현 + 테스트 통과 (세대당 1회, OPEN만)
- [ ] M3 추첨 취소: REQ-PK-011~014 구현 + 테스트 통과
- [ ] M4 자동배정 실행: REQ-PK-015~019 구현 + 테스트 통과 (FOR UPDATE, OPEN→ASSIGNED)
- [ ] M5 공개/열람/투명성: REQ-PK-020~027 구현 + 테스트 통과 (역할별 분기, 재현 검증)
- [ ] PARKING-08 이력 / 회차 수정삭제 / 수동 배정 API 미구현 확인 (Exclusions 준수)
- [ ] MX 태그 적용 (ANCHOR/WARN+REASON/NOTE/TODO)
- [ ] TRUST 5 게이트 통과
- [ ] AUTH/SETUP/NOTICE/SUGGEST 회귀 없음 (기존 412 테스트 통과)

---

*본 plan.md는 구현 디테일(함수명/쿼리 구조/알고리즘)을 포함하나, 이는 Run Phase(manager-tdd)의 구현 가이드이며 spec.md의 WHAT/WHY에 대한 HOW를 정의한다.*
