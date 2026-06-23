---
spec_id: SPEC-PARKING-001
title: 주차 자리 번호 배정 추첨 (회차생성/신청/추첨/결과공개/열람/관리소자동배정)
phase: research
status: draft
created: 2026-06-23
author: manager-spec (Phase 0.5 Deep Research)
depends_on:
  - SPEC-AUTH-001
  - SPEC-SETUP-001
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

# SPEC-PARKING-001 Deep Research — 주차 자리 번호 배정 추첨

## HISTORY: 본 문서는 Phase 0.5 Deep Research 산출물로 구 모델을 포함합니다. 도메인 정정 후 `spec.md` §HISTORY(2026-06-23)로 최종 확정되었습니다.

**구 모델 vs 확정 모델 차이 (구현 시 `spec.md`/`plan.md`를 따를 것):**
- **상태머신**: 구 `OPEN → DRAWING → CLOSED → PUBLISHED` → 확정 `OPEN → ASSIGNED → PUBLISHED → CLOSED` (ASSIGNED 추가, DRAWING 제거, CLOSED 마지막)
- **테이블**: 구 `parking_applications` + `parking_allocations` 분리 + `total_spaces INT`/`allocated_number INT` → 확정 단일 `parking_assignments` 테이블 + `slot_pool JSONB`/`assigned_slot JSONB`
- 본 문서의 상태머신/스키마 관련 섹션은 구 모델 기준이며, 참고용입니다. 구현 시 `spec.md` §4 REQ-PK-XXX와 `plan.md` §2/§6 확정 스키마를 따르세요.

---

본 문서는 9개 기획 문서와 AUTH/SETUP/NOTICE/SUGGEST P0 구현 산출물에서 PARKING 도메인(주차 자리 번호 배정 추첨)에 관련된 모든 사실을 추출한 연구 결과입니다. SPEC 작성의 기반이 되며, 구현 디테일(함수명/클래스 구조/API 스키마)은 포함하지 않습니다 — "무엇(WHAT)/왜(WHY)"에 집중합니다.

---

## 1. PARKING 요구사항 요약 (PARKING-01 ~ PARKING-07)

| ID | 기능 | 우선순위 | 대상 역할 | 핵심 설명 | 본 SPEC |
|----|------|:--------:|-----------|-----------|---------|
| PARKING-01 | 추첨 회차 생성 | **P0** | ADMIN | 회차명/신청기간/추첨일/주차면수 설정 | In-Scope |
| PARKING-02 | 주차 신청 (추첨) | **P0** | RESIDENT 이상 | 회차별 단일 신청, 중복 금지 | In-Scope |
| PARKING-03 | 주차 신청 취소 | **P0** | 작성자 본인 | 추첨 실행 전까지만 취소 가능 | In-Scope |
| PARKING-04 | 추첨 실행 | **P0** | ADMIN | 회차 seed 기반 결정론적 순열 생성 | In-Scope |
| PARKING-05 | 추첨 결과 공개 | **P0** | ADMIN | 추첨 완료 후 공개 토글 ON/OFF | In-Scope |
| PARKING-06 | 추첨 결과 열람 | **P0** | RESIDENT 이상 | 본인 결과 확인, 공개 전 비공개 | In-Scope |
| PARKING-07 | 관리소 자동 배정 | **P0** | ADMIN | 미납종자/수동배정 자리 관리소 지정 | In-Scope |

출처: `apt_02_PRD.md` §4-2 주차, `apt_03_기능명세서.md` §5 주차.

---

## 2. 동시성 제어 선행 패턴 (가장 중요)

### 2.1 회장 단일성 FOR UPDATE 패턴 — SETUP/role route

**파일**: `/Users/ip9202/develop/vibe/apartment/src/app/api/setup/users/[id]/role/route.ts:21-26, 158-167`

**패턴 설명**:
```typescript
// @MX:WARN: [AUTO] 회장(CHAIR) 단일성 보장을 위한 SELECT ... FOR UPDATE — load-bearing 동시성 방어.
// @MX:REASON: FOR UPDATE 가 없으면 두 개의 동시 CHAIR 부여 트랜잭션이 같은 스냅샷을 읽어
//             기존 CHAIR 가 없다고 판단하고 둘 다 커밋될 수 있다. FOR UPDATE 로 기존 CHAIR 행을
//             잡으면 두 번째 트랜잭션은 첫 번째가 커밋할 때까지 대기(serialization)하므로
//             커밋 후 항상 CHAIR 는 정확히 1명이 된다. 이 잠금을 제거/변경하면 EC-004 가 깨진다.
```

**구현**:
```typescript
// 회장(CHAIR) 단일성 — 기존 CHAIR 행을 잠그고 RESIDENT 로 회수 (REQ-010, AC-011, EC-004)
if (requestedRole === 'CHAIR' && chairRoleId) {
  // @MX:WARN: FOR UPDATE load-bearing (상단 블록 코멘트 참조)
  await client.query('SELECT id FROM users WHERE role_id = $1 FOR UPDATE', [chairRoleId]);
  await client.query(
    `UPDATE users SET role_id = $1, managed_building_id = NULL
     WHERE role_id = $2 AND id <> $3`,
    [residentRoleId, chairRoleId, targetUserId],
  );
}
```

**PARKING 적용 시사점**:
- 추첨 실행(PARKING-04) 시 여러 관리자가 동시에 추첨 버튼 클릭 가능
- FOR UPDATE로 회차 row를 잠그고 상태 전이(OPEN→DRAWING)를 원자적으로 보장 필요
- 동시 추첨 시 중복 배정 방지를 위해 `parking_rounds.is_drawing` 플래그와 FOR UPDATE 결합 필요

### 2.2 selectColumns 패턴 — password_hash 노출 방지

**파일**: 전체적으로 적용된 패턴 (AUTH 도메인)

**패턴**: 쿼리 시 명시적으로 컬럼 지정, `SELECT *` 회피
- `signupSchema`: `password_hash` 제외 응답 타입 정의
- 응답 본문에서 `password_hash` 절대 포함 금지 (AC-AUTH-025)

**PARKING 적용 시사점**:
- 추첨 결과 조회 시 `parking_allocations.seed_value` 등 내부 컬럼 노출 주의
- 공개/비공개 분기에서 컬럼 선택 분리 필요

### 2.3 pg 트랜잭션 사용 방식 — db.ts withTransaction

**파일**: `/Users/ip9202/develop/vibe/apartment/src/lib/db.ts:37-56`

**구조**:
```typescript
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ROLLBACK 실패는 이미 치명적 상태 — 원본 에러를 보존.
    }
    throw err;
  } finally {
    client.release();
  }
}
```

**사용 예**: SETUP role route (role 변경 + 회장 단일성 보장을 원자적으로 실행)

**PARKING 적용 시사점**:
- 추첨 실행(PARKING-04): 회차 상태 변경 + 배정 생성 + seed 저장을 원자적 트랜잭션으로 실행 필요
- 관리소 자동 배정(PARKING-07): 배정 갱신 + 회차 상태 변경을 원자적으로 실행

### 2.4 상태 전이 화이트리스트 패턴 — SUGGEST status route

**파일**: `/Users/ip9202/develop/vibe/apartment/src/app/api/suggestions/[id]/status/route.ts:38-44, 95-99`

**구현**:
```typescript
/** 상태 전이 화이트리스트 맵. */
const ALLOWED_TRANSITIONS: Record<SuggestionStatus, Set<SuggestionStatus>> = {
  접수: new Set<SuggestionStatus>(['처리중', '보류']),
  처리중: new Set<SuggestionStatus>(['완료', '보류']),
  보류: new Set<SuggestionStatus>(['처리중', '접수']),
  완료: new Set<SuggestionStatus>(['접수']), // 재오픈
};

// 전이 규칙 검증 — 불허 시 409 (REQ-SUGGEST-032)
if (!ALLOWED_TRANSITIONS[currentStatus]?.has(requestedStatus)) {
  return conflict(
    `현재 상태(${currentStatus})에서 요청 상태(${requestedStatus})로 전이할 수 없습니다`,
  );
}
```

**PARKING 적용 시사점**:
- 회차 상태: `OPEN → DRAWING → CLOSED → PUBLISHED` (역방향 전이 금지) — [구 모델 — 확정 모델은 `OPEN → ASSIGNED → PUBLISHED → CLOSED`, `spec.md` §HISTORY 참조]
- 추첨 전: 취소 가능 / 추첨 후: 상태 변경 불가
- 409 Conflict로 불허 전이 거부

---

## 3. 결정론적 시드 셔플 설계 단서

### 3.1 프로젝트 내 난수/셔플/seed 관련 코드 조사

**검색 결과** (`grep -r "shuffle|random|seed|crypto|Math.random"`):

**발견된 패턴**:
1. **`randomUUID` 사용** (`src/lib/auth.ts:16`, `src/app/api/auth/refresh/route.ts`):
   - `import { randomUUID } from 'node:crypto'`
   - JWT `jti` 클레임 생성용
   
2. **`createHash` 사용** (`src/app/api/auth/refresh/route.ts`, `src/app/api/auth/logout/route.ts`):
   - `import { createHash } from 'node:crypto'`
   - 토큰 무효화를 위한 해시 생성

3. **시드 데이터** (`scripts/seed.ts`):
   - 건물/호수/역할 초기 데이터
   - 멱등성 보장: `ON CONFLICT DO NOTHING`

**미발견 패턴**:
- `Math.random` 사용 없음
- 셔플 알고리즘 구현 없음
- 결정론적 PRNG 사용 선례 없음

### 3.2 Node.js crypto 기반 결정론적 PRNG 옵션

**옵션 A: Fisher-Yates + crypto.randomFillSync (권장)**
- **장점**: 
  - `crypto.randomFillSync(buffer)`는 해시 기반 PRNG로 seed 가능
  - 단순한 구조, 테스트 용이
  - Node.js built-in (외부 의존 없음)
- **단점**:
  - `randomFillSync`는 기본적으로 OS 난수 사용하지만, seed 가능한 래퍼 구현 필요
  - 성능: 동기 호출 (추첨 규모가 작으면 문제 없음)

**옵션 B: 외부 라이브러리 (seedrandom, chance.js)**
- **장점**: 검증된 알고리즘, API 간편
- **단점**: 의존성 추가, 프로젝트 정책(`package.json` 현재 최소 의존성) 위반 가능

**권장 구조**:
```typescript
// parking-lottery.ts (신규 모듈)
import { createHash, randomBytes } from 'node:crypto';

interface SeededPRNG {
  next(): number; // [0, 1)
  seed: string;
}

function createSeededPRNG(seed: string): SeededPRNG {
  // seed → HMAC-SHA256 → 상태 → next() 호출마다 상태 갱신
  // 구현: Simple Counter Mode 또는 LCG (Linear Congruential Generator)
}

function fisherYatesInPlace<T>(array: T[], prng: SeededPRNG): T[] {
  // standard Fisher-Yates with prng.next()
}
```

### 3.3 seed 생성/보관/공개 설계

**seed 생성 시점**: 회차 생성 시점(PARKING-01)
- ADMIN이 회차 생성 시 `seed_value` 자동 생성
- 생성 방법: `randomBytes(16).toString('base64')` (고유성 보장)

**seed 보관**: `parking_rounds.seed_value` 컬럼
- 타입: `TEXT NOT NULL`
- 제약: 회차 생성 후 불변 (UPDATE 금지)
- 보안: ADMIN/CHAIR만 조회 가능 (비-ADMIN 403)

**seed 공개**: 추첨 결과 공개 시점(PARKING-05)
- 옵션 A: **공개** (투명성 우선) — seed를 결과와 함께 공개
- 옵션 B: **비공개** (보안 우선) — seed는 내부 관리용, 결과만 공개

**권고**: 옵션 A (공개)
- 이유: 입주민이 재현 검증 가능 (공정성 입증)
- 구현: `parking_allocations` 조회 시 ADMIN/CHAIR는 `seed_value` 포함, 그 외는 제외

### 3.4 재현 검증 설계

**검증 API** (PARKING-06 확장):
```
GET /api/parking/rounds/{roundId}/verify
Authorization: Bearer AT
Response: {
  success: true,
  data: {
    round_id: "...",
    seed_value: "...",
    applicants: [
      { user_id: "...", unit: "A동 101호", allocated_number: 42 },
      ...
    ],
    verification_timestamp: "2026-06-23T10:00:00Z"
  }
}
```

**검증 로직**:
1. 회차 `seed_value` 조회
2. 동일 seed로 PRNG 재현
3. 신청자 목록을 seed 순서로 정렬
4. 배정 번호 일치 여부 확인

**리스크 완화**:
- timestamp 기록: "재현 검증은 YYYY-MM-DD HH:MM:SS 기준으로 유효합니다"
- 배정 확정 후 freeze: 추첨 실행 커밋 후 `seed_value` 불변 (트랜잭션 내에서만 변경 가능)

---

## 4. migration 패턴

### 4.1 마이그레이션 구조 — 006_notices.sql, 007_suggestions_expand.sql

**공통 패턴**:
```sql
-- 1. CREATE TABLE IF NOT EXISTS (시드 테이블)
CREATE TABLE IF NOT EXISTS notice_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(30) NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 0
);

-- 2. INSERT ... ON CONFLICT (name) DO NOTHING (시드 데이터)
INSERT INTO notice_categories (name, sort_order) VALUES
  ('일반', 1), ('긴급', 2), ('주차', 3), ('시설', 4)
ON CONFLICT (name) DO NOTHING;

-- 3. ALTER TABLE ... ADD COLUMN IF NOT EXISTS (확장)
ALTER TABLE notices
  ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;

-- 4. CREATE INDEX IF NOT EXISTS (인덱스)
CREATE INDEX IF NOT EXISTS idx_notices_created_at_desc 
ON notices(created_at DESC);
```

**PARKING migration 구조 (migration 008_parking.sql)**:
```sql
-- 1. parking_rounds (회차)
CREATE TABLE IF NOT EXISTS parking_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  application_start TIMESTAMPTZ NOT NULL,
  application_end TIMESTAMPTZ NOT NULL,
  draw_date TIMESTAMPTZ NOT NULL,
  total_spaces INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- OPEN/DRAWING/CLOSED/PUBLISHED — [구 모델 — 확정 모델은 slot_pool JSONB / status OPEN/ASSIGNED/PUBLISHED/CLOSED, spec.md §4/plan.md §6 참조]
  seed_value TEXT NOT NULL, -- 추첨 seed (회차 생성 시 생성)
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. parking_applications (신청)
CREATE TABLE IF NOT EXISTS parking_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES parking_rounds(id),
  user_id UUID NOT NULL REFERENCES users(id),
  unit_id UUID NOT NULL REFERENCES units(id),
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(round_id, user_id) -- 회차별 단일 신청
);

-- 3. parking_allocations (배정)
CREATE TABLE IF NOT EXISTS parking_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES parking_rounds(id),
  user_id UUID NOT NULL REFERENCES users(id),
  unit_id UUID NOT NULL REFERENCES units(id),
  allocated_number INT NOT NULL,
  is_admin_assigned BOOLEAN NOT NULL DEFAULT false, -- 관리소 자동 배정 플래그
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(round_id, user_id)
);

-- 4. 인덱스
CREATE INDEX IF NOT EXISTS idx_parking_applications_round_user 
ON parking_applications(round_id, user_id);
CREATE INDEX IF NOT EXISTS idx_parking_allocations_round_number 
ON parking_allocations(round_id, allocated_number);
```

### 4.2 migration 테스트 패턴 — migration-007.test.ts

**구조**:
```typescript
describe('마이그레이션 007 — suggestion_categories 시드', () => {
  it('suggestion_categories 4종 시드 행이 존재한다', async () => {
    const res = await pool.query<{ name: string }>(
      'SELECT name FROM suggestion_categories ORDER BY sort_order',
    );
    expect(res.rowCount).toBe(4);
    expect(res.rows.map((r) => r.name)).toEqual(['시설', '주차', '소음', '기타']);
  });
});
```

**PARKING migration 테스트 항목**:
1. `parking_rounds` 컬럼 존재 (seed_value 포함)
2. `parking_applications` UNIQUE 제약 (회차별 단일 신청)
3. `parking_allocations` FK (round → rounds, user → users, unit → units)
4. 인덱스 존재
5. 멱등성 (재적용 후 에러 없음)

### 4.3 CHECK 제약, 부분 인덱스, 유니크 제약 사용례

**CHECK 제약** (사용 예 없음, 추가 가능):
```sql
ALTER TABLE parking_rounds
ADD CONSTRAINT parking_rounds_status_check 
CHECK (status IN ('OPEN', 'DRAWING', 'CLOSED', 'PUBLISHED')); -- [구 모델 — 확정은 OPEN/ASSIGNED/PUBLISHED/CLOSED, spec.md 참조]

ALTER TABLE parking_rounds
ADD CONSTRAINT parking_rounds_dates_check 
CHECK (application_end < draw_date);

ALTER TABLE parking_allocations
ADD CONSTRAINT parking_allocations_number_positive 
CHECK (allocated_number > 0);
```

**부분 인덱스** (사용 예 없음, 추가 가능):
```sql
CREATE INDEX idx_parking_applications_active 
ON parking_applications(round_id, user_id) 
WHERE cancelled_at IS NULL;
```

**유니크 제약** (이미 사용):
```sql
UNIQUE(round_id, user_id) -- parking_applications
UNIQUE(round_id, user_id) -- parking_allocations
```

---

## 5. validators / rbac / 미들웨어 패턴

### 5.1 validators.ts — UUID idiom

**파일**: `/Users/ip9202/develop/vibe/apartment/src/lib/validators.ts:19-20, 26-28`

**패턴**:
```typescript
/** 이메일 형식 정규식 — zod 4 에서는 deprecated 된 z.string().email() 대신 사용. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const loginSchema = z.object({
  email: z
    .string()
    .max(255, '이메일은 255자 이하여야 합니다')
    .refine((v) => EMAIL_REGEX.test(v), '올바른 이메일 형식이 아닙니다'),
  password: z.string().min(1, '비밀번호를 입력해주세요'),
});
```

**UUID 정규식** (각 route에서 정의):
```typescript
/** UUID v4 정규식. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

**zod 4 변화**: `z.string().uuid()` deprecated → `.refine((v) => UUID_REGEX.test(v))` 사용

**PARKING 적용**:
- 회차 ID, 신청 ID, 배정 ID 검증에 동일 패턴 사용
- `roundIdSchema`, `applicationIdSchema` 정의하여 재사용

### 5.2 suggest-rbac.ts — Option C 패턴

**파일**: `/Users/ip9202/develop/vibe/apartment/src/lib/suggest-rbac.ts`

**특징**:
- 도메인 로컬 RBAC 헬퍼 (공통 rbac.ts 수정 없음)
- `requireAuthenticated`: Bearer → verifyAccessToken → ACTIVE 조회 → `{callerId, callerRole, unitId, managedBuildingId}` 반환
- fan_in=3 (M1 create, M4 list, M5 detail)

**PARKING 적용**:
- `parking-rbac.ts` 신규 모듈 권장
- `requireAuthenticated`: RESIDENT 이상 인증 (공통)
- `requireAdmin`: ADMIN 전용 (회차 생성, 추첨 실행, 결과 공개)
- `canAccessRound`: 역할별 회차 접근 권한 분기

### 5.3 rbac.ts — Bearer 검증, 역할 분기

**파일**: `/Users/ip9202/develop/vibe/apartment/src/lib/rbac.ts:44-79, 91-128`

**구조**:
```typescript
export async function requireAdmin(request: Request): Promise<RequireAdminOk | RequireAdminErr> {
  const authHeader = request.headers.get('authorization') ?? '';
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!bearerMatch) {
    return { response: unauthorized() };
  }
  let atClaims: { sub?: string };
  try {
    atClaims = verifyAccessToken(bearerMatch[1]);
  } catch {
    return { response: unauthorized() };
  }
  const callerId = atClaims.sub;
  if (!callerId) {
    return { response: unauthorized() };
  }
  // ... ACTIVE + role 조회
  if (caller.role !== 'ADMIN') {
    return { response: forbidden('관리자만 접근할 수 있습니다') };
  }
  return { callerId };
}
```

**공통 응답 헬퍼**:
- `unauthorized()`: 401
- `forbidden(message)`: 403
- `badRequest(message)`: 400
- `notFound(message)`: 404
- `conflict(message)`: 409
- `validationError(message)`: 422

### 5.4 middleware.ts — Bearer 검증

**파일**: `/Users/ip9202/develop/vibe/apartment/src/middleware.ts:81-94`

**특징**:
- AT 쿠키만 검사, Bearer 헤더 미검사
- route-level Bearer 검증 필요 (각 route에서 `requireAuth`/`requireAdmin` 호출)

**PARKING API 적용**:
- 모든 PARKING route에서 route-level Bearer 검증 필요
- middleware는 경로 예외 처리 필요 (`/api/parking/*` 제외 or 포함)

---

## 6. 아카이브/상태/이력 패턴

### 6.1 SUGGEST ADR-005 아카이브 패턴

**파일**: `/Users/ip9202/develop/vibe/apartment/src/app/api/suggestions/[id]/route.ts:229-283`

**구현**:
```typescript
/**
 * DELETE /api/suggestions/[id] — 건의 아카이브 (REQ-SUGGEST-012~017).
 *
 * @MX:WARN: [AUTO] DELETE = archive semantics, NOT row deletion (ADR-005 호수 귀속)
 * @MX:REASON:  행 삭제 시 호수 이력(M8a) 단절. archived=true + 익명화(author_id NULL,
 *             author_label='전 입주민', archived_at=now) 전환. unit_id 영구 보존.
 */
export async function DELETE(request: Request, ctx: SuggestionParams): Promise<Response> {
  // ... 권한 검사 ...
  
  // 아카이브 전환 — 익명화 + archived=true + archived_at=now. unit_id 미건드림 (ADR-005)
  await query(
    `UPDATE suggestions
     SET archived = true, author_id = NULL, author_label = '전 입주민', archived_at = now()
     WHERE id = $1`,
    [suggestionId],
  );
  
  return NextResponse.json({ success: true, data: null }, { status: 200 });
}
```

**PARKING 적용 시사점**:
- 주차 신청 취소(PARKING-03): `parking_applications.cancelled_at = now()` (소프트 삭제)
- 배정은 영구 보존 (이력 조회용)
- 회차 삭제 불가 (하드 삭제 금지)

### 6.2 NOTICE hard delete 패턴

**파일**: `/Users/ip9202/develop/vibe/apartment/src/app/api/notices/[id]/route.ts:200-235`

**구현**:
```typescript
/**
 * DELETE /api/notices/[id] — ADMIN 공지 영구 삭제 (REQ-NOTICE-008, 009, 010a, 010b).
 *
 * @MX:WARN: [AUTO] Hard delete — DELETE FROM, 영구 삭제. 복구 불가.
 * @MX:REASON:  기획서(기능명세서/PRD) 명시 정책. 소프트 삭제/archived 는 건의(SUGGEST) 도메인만.
 *             삭제된 공지는 데이터베이스에서 완전히 제거된다.
 */
export async function DELETE(request: Request, ctx: NoticeParams): Promise<Response> {
  // ... 존재 확인 ...
  
  // Hard delete — 영구 삭제 (REQ-NOTICE-008)
  await query('DELETE FROM notices WHERE id = $1', [noticeId]);
  
  return NextResponse.json({ success: true, data: null }, { status: 200 });
}
```

**PARKING 적용 시사점**:
- 회차는 하드 삭제 불가 (역사 보존)
- 신청 취소는 소프트 삭제 (`cancelled_at`)
- 배정 이력은 영구 보존

### 6.3 호수 이력 조회 패턴 — suggestions/units/[building]/[unit]

**파일**: `/Users/ip9202/develop/vibe/apartment/src/app/api/suggestions/units/[building]/[unit]/route.ts`

**구조**:
```typescript
export async function GET(request: Request, ctx: UnitParams): Promise<Response> {
  // ... 인증 ...
  
  const { building, unit } = await ctx.params;
  
  // 호수별 건의 이력 (아카이브 포함)
  const rows = await query<{
    id: string;
    title: string;
    status: string;
    author_label: string;
    created_at: string;
    archived_at: string | null;
  }>(
    `SELECT s.id, s.title, s.status, s.author_label, s.created_at, s.archived_at
     FROM suggestions s
     JOIN units u ON u.id = s.unit_id
     JOIN buildings b ON b.id = u.building_id
     WHERE b.name = $1 AND u.unit_number = $2
     ORDER BY s.created_at DESC`,
    [building, unit],
  );
  
  return NextResponse.json({ success: true, data: { suggestions: rows.rows } }, { status: 200 });
}
```

**PARKING 적용**:
- 호수별 주차 배정 이력 조회 (PARKING-06 확장)
- `/api/parking/units/{building}/{unit}/history`
- 회차명/배정번호/관리소여부 포함

---

## 7. DB 스키마 기반

### 7.1 users, units, buildings 테이블 구조

**buildings** (동):
- `id`: UUID PK
- `name`: VARCHAR(20) NOT NULL UNIQUE ("A동", "B동")
- `created_at`: TIMESTAMPTZ

**units** (호수):
- `id`: UUID PK
- `building_id`: UUID FK → buildings.id
- `unit_number`: VARCHAR(10) NOT NULL
- `created_at`: TIMESTAMPTZ
- UNIQUE(building_id, unit_number)

**users** (회원):
- `id`: UUID PK
- `email`: VARCHAR(255) NOT NULL UNIQUE
- `password_hash`: VARCHAR(255) NULL
- `provider`: VARCHAR(20) NOT NULL DEFAULT 'email'
- `provider_id`: VARCHAR(255) NULL
- `role_id`: UUID FK → roles.id
- `unit_id`: UUID FK → units.id (NULL 가능)
- `managed_building_id`: UUID FK → buildings.id (NULL 가능, REP 담당동)
- `status`: VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
- `verified_at`: TIMESTAMPTZ NULL
- `created_at`: TIMESTAMPTZ
- `updated_at`: TIMESTAMPTZ

**인덱스**: `idx_users_email`, `idx_users_unit_id`, `idx_users_role_id`

### 7.2 역할 종류 (roles 테이블 시드)

**시드 데이터** (`scripts/seed.ts:44-50`):
```typescript
const ROLES = [
  { code: 'ADMIN', name: '관리사무소', sort_order: 1 },
  { code: 'CHAIR', name: '회장', sort_order: 2 },
  { code: 'REP', name: '동대표', sort_order: 3 },
  { code: 'AUDITOR', name: '감사', sort_order: 4 },
  { code: 'RESIDENT', name: '일반 입주민', sort_order: 5 },
];
```

**PARKING 역할 권한**:
- `ADMIN`: 회차 생성, 추첨 실행, 결과 공개, 관리소 자동 배정
- `CHAIR`: 회차 생성, 추첨 실행, 결과 공개, 관리소 자동 배정
- `REP`: 추첨 결과 열람 (담당동), 신청/취소
- `AUDITOR`: 추첨 결과 열람, 신청/취소
- `RESIDENT`: 추첨 결과 열람 (본인), 신청/취소

### 7.3 seed 데이터 — 38세대, 5 roles

**시드 상태**:
- A동: 26세대 (1·2층 2호, 3층 이후 4호, 4층 없음)
- B동: 12세대 (2~8층, 1층 없음)
- 총 38세대

**PARKING 적용**:
- 주차 면수 설정 시 38세대 기준
- 예: 40면 (2면 여유) / 35면 (3면 부족)

---

## 8. 테스트 패턴

### 8.1 vitest 설정, TEST_DATABASE_URL 사용법

**파일**: `/Users/ip9202/develop/vibe/apartment/vitest.config.ts:1-25`

**구조**:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    fileParallelism: false, // DB 통합 테스트는 단일 fork 에서 직렬 실행
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['**/*.test.ts', 'src/lib/migration-test-helpers.ts', 'src/types/**'],
      reporter: ['text', 'text-summary', 'html', 'json-summary'],
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 85,
        branches: 70,
      },
    },
  },
});
```

**TEST_DATABASE_URL**:
- `.env.local` 또는 환경변수 설정
- migration 테스트에서 `createTestPool()` 사용

**PARKING 테스트 설정**:
- 동일 패턴 사용 (`pool.end()` 헬퍼)
- 회차/신청/배정 생성 단위 테스트
- 추첨 로직 단위 테스트 (seed 재현 검증)

### 8.2 기존 도메인 테스트 파일 구조

**AUTH 예** (`src/app/api/auth/login/route.test.ts`):
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { POST } from './route';
import { setPool } from '../../../../../lib/db';
import { runSeed } from '../../../../../scripts/seed';
import { createTestPool } from '../../../../../lib/migration-test-helpers';

const pool = createTestPool();

beforeAll(async () => {
  setPool(pool);
  await runSeed(pool);
});

afterAll(async () => {
  await pool.end();
});

describe('POST /api/auth/login', () => {
  it('로그인 성공', async () => {
    // ... 테스트 케이스 ...
  });
});
```

**PARKING 테스트 파일 구조**:
- `src/app/api/parking/rounds/route.test.ts` (회차 생성)
- `src/app/api/parking/applications/route.test.ts` (신청/취소)
- `src/app/api/parking/draw/route.test.ts` (추첨 실행)
- `src/lib/parking-lottery.test.ts` (셔플 로직)

### 8.3 커버리지 93%+ 달성 방식

**전략**:
1. **단위 테스트**: 순수 함수 (validators, rbac, lottery)
2. **통합 테스트**: route handler + DB (겸용)
3. **edge case**: 401/403/404/409/422 분기

**PARKING 커버리지 목표**:
- `parking-lottery.ts`: Fisher-Yates + seed 재현 (100%)
- `parking-rbac.ts`: 권한 분기 (95%+)
- route handlers: 200/400/401/403/404/409/422 (90%+)

---

## 9. 기술 스택 확인

### 9.1 package.json — 버전 확인

**파일**: `/Users/ip9202/develop/vibe/apartment/package.json`

**주요 의존성**:
```json
{
  "dependencies": {
    "bcryptjs": "^3.0.3",
    "jose": "^6.2.3",
    "jsonwebtoken": "^9.0.3",
    "next": "15.5.19",
    "pg": "^8.22.0",
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^4.1.9",
    "vitest": "^4.1.9"
  }
}
```

**PARKING 추가 의존성 고려**:
- **없음** (Node.js built-in `crypto`로 충분)
- 외부 PRNG 라이브러리 비권장 (프로젝트 정책 위반)

### 9.2 tsconfig, vitest.config

**tsconfig.json**:
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

**PARKING 타입 전략**:
- `parking_rounds.status`: `'OPEN' | 'DRAWING' | 'CLOSED' | 'PUBLISHED'` (union type)
- `parking_allocations.is_admin_assigned`: `boolean`
- Zod 스키마와 동기화

---

## 10. "회차 seed 기반 결정론적 순열" 구현을 위한 기술 옵션과 trade-off

### 10.1 옵션 A: Fisher-Yates + HMAC-SHA256 PRNG (권장)

**구조**:
```typescript
// parking-lottery.ts
import { createHmac, randomBytes } from 'node:crypto';

interface SeededPRNGState {
  seed: string;
  counter: number;
}

function createSeededPRNG(seed: string): SeededPRNG {
  let state: SeededPRNGState = { seed, counter: 0 };
  
  return {
    next(): number {
      const hmac = createHmac('sha256', state.seed);
      hmac.update(Buffer.from([state.counter]));
      const hash = hmac.digest();
      state.counter++;
      // hash 前 8 bytes → uint64 → [0, 1)
      const view = new DataView(hash.buffer);
      const uint64 = view.getBigUint64(0, false); // big-endian
      return Number(uint64 % BigInt(0xFFFFFFFF)) / 0xFFFFFFFF;
    },
    get seed() { return state.seed; },
  };
}

function fisherYatesInPlace<T>(array: T[], prng: SeededPRNG): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(prng.next() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
```

**장점**:
- **투명성**: seed 공개 시 재현 가능
- **안정성**: HMAC-SHA256은 암호학적으로 안전한 해시
- **단순성**: 50줄 이내 구현, 테스트 용이
- **의존성 없음**: Node.js built-in

**단점**:
- **성능**: HMAC는 계산 비용 있음 (신청자 100명 기준 ~1ms)
- **구현 복잡도**: PRNG 직접 구현 필요

**권장 사유**:
- 추첨 규모가 38세대로 작아 성능 문제 없음
- 재현 검증이 핵심 요구사항 (투명성)
- 프로젝트 의존성 최소화 정책 준수

### 10.2 옵션 B: 외부 라이브러리 (seedrandom)

**구조**:
```bash
npm install seedrandom
```

```typescript
import seedrandom from 'seedrandom';

function createSeededPRNG(seed: string): () => number {
  const rng = seedrandom(seed);
  return () => rng();
}

function fisherYatesInPlace<T>(array: T[], rng: () => number): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
```

**장점**:
- **검증됨**: 오랜 기간 사용, 안정적
- **API 간편**: `rng()`로 바로 사용
- **다양한 알고리즘**: `seedrandom.alea` (Mulberry32), `seedrandom.xor4096`

**단점**:
- **의존성 추가**: 프로젝트 정책 위반 가능
- **타입 정의**: `@types/seedrandom` 필요
- **보안**: Mulberry32는 암호학적으로 안전하지 않음 (재현 검증용으로는 충분)

**비권장 사유**:
- Node.js built-in `crypto`로 충분
- 프로젝트 의존성 최소화 정책

### 10.3 옵션 C: Math.random + seed 저장 (비권장)

**구조**:
```typescript
// 회차 생성 시
const shuffleOrder = Array.from({ length: applicantCount }, (_, i) => i);
for (let i = shuffleOrder.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [shuffleOrder[i], shuffleOrder[j]] = [shuffleOrder[j], shuffleOrder[i]];
}
// shuffle_order 컬럼에 JSON으로 저장
INSERT INTO parking_rounds (shuffle_order) VALUES ($1) 
-- [$1 = '[3, 1, 4, 1, 5, 9, ...]']
```

**장점**:
- **구현 단순**: Math.random() 사용

**단점**:
- **비재현성**: OS 난수 소스에 의존, 재현 불가
- **불투명성**: 결과만으로는 공정성 입증 불가
- **저장 공간**: shuffle_order가 크면 저장 비용

**비권장 사유**:
- 재현 검증 불가 (투명성 요구사항 위반)
- 투명성 없으면 추첨 신뢰도 저하

---

## 11. seed 공정성 설계

### 11.1 seed는 배정 순서 확정 전 freeze되어야 함

**문제**:
- ADMIN이 추첨 실행 후 → 결과를 보고 마음에 안 들면 → seed 변경 재추첨 가능
- 이 경우 seed를 조작하여 원하는 결과 얻기 가능

**해결**:
1. **회차 생성 시점에 seed 확정**:
   - `INSERT INTO parking_rounds (seed_value) VALUES ($1)` 시점에 `randomBytes(16).toString('base64')`로 생성
   - `UPDATE parking_rounds SET seed_value = ...` 금지 (트리거 또는 CHECK 제약으로 방지)

2. **추첨 실행 중 seed 불변 보장**:
   - 트랜잭션 내에서만 `seed_value` 읽기
   - 회차 상태 `OPEN → DRAWING` 전이 시 `seed_value` 불변 단정

3. **투명성 공개**:
   - 추첨 결과 공개(PARKING-05) 시 `seed_value` 함께 공개
   - 입주민이 재현 검증 가능

### 11.2 commit 시점 논의

**트랜잭션 구조**:
```typescript
await withTransaction(async (client) => {
  // 1. 회차 상태 변경 (OPEN → DRAWING)
  await client.query(
    `UPDATE parking_rounds SET status = 'DRAWING', updated_at = now()
     WHERE id = $1 AND status = 'OPEN'`,
    [roundId],
  );
  
  // 2. 신청자 목록 조회 (FOR UPDATE로 잠금)
  const applicants = await client.query(
    `SELECT user_id, unit_id FROM parking_applications
     WHERE round_id = $1 AND cancelled_at IS NULL
     FOR UPDATE`,
    [roundId],
  );
  
  // 3. seed 조회 (불변)
  const { seed_value } = await client.query(
    `SELECT seed_value FROM parking_rounds WHERE id = $1`,
    [roundId],
  );
  
  // 4. 셔플 실행
  const prng = createSeededPRNG(seed_value);
  const shuffled = fisherYatesInPlace(applicants.rows, prng);
  
  // 5. 배정 생성
  for (let i = 0; i < shuffled.length; i++) {
    await client.query(
      `INSERT INTO parking_allocations (round_id, user_id, unit_id, allocated_number)
       VALUES ($1, $2, $3, $4)`,
      [roundId, shuffled[i].user_id, shuffled[i].unit_id, i + 1],
    );
  }
  
  // 6. 회차 상태 변경 (DRAWING → CLOSED)
  await client.query(
    `UPDATE parking_rounds SET status = 'CLOSED', updated_at = now()
     WHERE id = $1 AND status = 'DRAWING'`,
    [roundId],
  );
  
  // COMMIT (자동)
});
```

**중요 지점**:
- `FOR UPDATE`로 신청자 목록 잠금 (동시 추첨 실행 방지)
- seed는 트랜잭션 내에서 불변 (회차 생성 시점 확정)
- 배정 생성 후 상태 전이 (원자성 보장)

---

## 12. 리스크, 제약, 암묵적 계약

### 12.1 리스크

**동시성 리스크**:
1. **동시 추첨 실행**:
   - 위험: 두 관리자가 동시에 추첨 버튼 클릭 시 중복 배정
   - 완화: `parking_rounds.is_drawing` 플래그 + `FOR UPDATE` 잠금

2. **관리소 자동 배정 중 충돌**:
   - 위험: 자동 배정 실행 중 사용자 신청 시 경합
   - 완화: 트랜잭션 + FK 제약

3. **회차 전환 시 이전 배정 보존**:
   - 위험: 회차 상태 변경 시 이전 배정 변경
   - 완화: 상태 전이 화이트리스트 + 409 거부

**공정성 리스크**:
1. **seed 조작**:
   - 위험: 추첨 후 seed 변경 재추첨
   - 완화: 회차 생성 시점 seed 확정 + UPDATE 금지

2. **재현 불가**:
   - 위험: Math.random() 사용으로 재현 불가
   - 완화: HMAC-SHA256 PRNG 사용 + seed 공개

**보안 리스크**:
1. **비-ADMIN seed 노출**:
   - 위험: 입주민이 seed를 알면 조작 가능성
   - 완화: `seed_value` 조회 권한 분리 (ADMIN/CHAIR만 포함)
   - [주: 본 우려는 seed 가변 전제하에서만 성립. 확정 모델에서 seed는 회차 생성 시 확정 후 불변이므로 공개되어도 사후 조작 불가 — spec.md §6.1 seed 공개 근거 참조. 본 섹션의 보안 우려는 확정 설계에서 무효화됨]

### 12.2 제약

**DB 제약**:
- `parking_rounds.status`: CHECK 제약 (`OPEN`, `DRAWING`, `CLOSED`, `PUBLISHED`) — [구 모델 — 확정은 `OPEN/ASSIGNED/PUBLISHED/CLOSED`, spec.md 참조]
- `parking_applications`: UNIQUE(round_id, user_id)
- `parking_allocations`: UNIQUE(round_id, user_id)
- FK 제약: round_id → parking_rounds.id, user_id → users.id, unit_id → units.id

**API 제약**:
- 추첨 실행 전 신청 취소 가능 (409로 거부)
- 추첨 실행 후 상태 변경 불가 (409로 거부)
- 회차별 단일 신청 (UNIQUE 제약)

**RBAC 제약**:
- 회차 생성/추첨/공개: ADMIN/CHAIR
- 신청/취소/열람: RESIDENT 이상
- 관리소 자동 배정: ADMIN

### 12.3 암묵적 계약

**AUTH/SETPTION 의존**:
- `users.unit_id`: 호수 인증 완료된 사용자만 신청 가능
- `users.role_id`: 역할별 권한 분기 기반
- `units.building_id`: 동별 담당 REP 분리

**SUGGEST 패턴 의존**:
- 상태 전이 화이트리스트 (PARKING 회차 상태)
- route-level Bearer 검증
- 아카이브 패턴 (신청 취소 소프트 삭제)

**NOTICE 패턴 의존**:
- UUID 정규식 검증 (zod 4 호환)
- selectColumns 패턴 (응답 본문 필터)

---

## 13. 구현 접근 권장사항 (PARKING-01~07 매핑)

### 13.1 PARKING-01: 회차 생성

**API**: `POST /api/parking/rounds`
**RBAC**: ADMIN/CHAIR
**구현**:
1. 요청 본문 검증 (name, application_start, application_end, draw_date, total_spaces)
2. seed 생성: `randomBytes(16).toString('base64')`
3. INSERT parking_rounds (status='OPEN', seed_value=생성된 seed)
4. 201 응답

**테스트 케이스**:
- 미인증 401
- 비-ADMIN/비-CHAIR 403
- 날짜 유효성 (application_end < draw_date)
- 중복 이름

### 13.2 PARKING-02: 주차 신청 (추첨)

**API**: `POST /api/parking/applications`
**RBAC**: RESIDENT 이상
**구현**:
1. requireAuthenticated (unit_id NULL 체크)
2. 요청 본문 검증 (round_id)
3. 회차 상태 확인 (OPEN만 허용, 아니면 409)
4. UNIQUE 제약 위반 시 409 (이미 신청함)
5. INSERT parking_applications
6. 201 응답

**테스트 케이스**:
- 미인증 401
- unit_id NULL 403
- 회차 상태가 OPEN이 아닌 경우 409
- 중복 신청 409

### 13.3 PARKING-03: 주차 신청 취소

**API**: `DELETE /api/parking/applications/{applicationId}`
**RBAC**: 작성자 본인
**구현**:
1. requireAuthenticated
2. 신청 존재 확인 + author_id 확인 (본인 검증)
3. 회차 상태 확인 (OPEN만 허용, 아니면 409)
4. UPDATE parking_applications (cancelled_at=now)
5. 200 응답

**테스트 케이스**:
- 미인증 401
- 비-본인 403
- 회차 상태가 OPEN이 아닌 경우 409
- 이미 취소된 경우 409

### 13.4 PARKING-04: 추첨 실행

**API**: `POST /api/parking/rounds/{roundId}/draw`
**RBAC**: ADMIN/CHAIR
**구현**:
1. requireAdmin (또는 requirePrivileged(['ADMIN', 'CHAIR']))
2. 회차 상태 확인 (OPEN만 DRAWING으로 전이, 아니면 409)
3. **트랜잭션 시작** (withTransaction)
   1. 회차 상태 변경 (OPEN → DRAWING)
   2. 신청자 목록 조회 (FOR UPDATE 잠금)
   3. seed 조회
   4. 셔플 실행 (fisherYatesInPlace + createSeededPRNG)
   5. 배정 생성 (INSERT parking_allocations)
   6. 회차 상태 변경 (DRAWING → CLOSED)
4. 200 응답

**테스트 케이스**:
- 미인증 401
- 비-ADMIN/비-CHAIR 403
- 회차 상태가 OPEN이 아닌 경우 409
- 신청자 0명일 경우
- 동시 추첨 실행 (FOR UPDATE 검증)

### 13.5 PARKING-05: 추첨 결과 공개

**API**: `PUT /api/parking/rounds/{roundId}/publish`
**RBAC**: ADMIN/CHAIR
**구현**:
1. requireAdmin
2. 회차 존재 확인
3. 회차 상태 확인 (CLOSED만 PUBLISHED로 전이, 아니면 409)
4. UPDATE parking_rounds (is_published=true, status='PUBLISHED')
5. 200 응답

**테스트 케이스**:
- 미인증 401
- 비-ADMIN/비-CHAIR 403
- 회차 상태가 CLOSED가 아닌 경우 409
- 이미 공개된 경우 409

### 13.6 PARKING-06: 추첨 결과 열람

**API**: `GET /api/parking/allocations?round_id={roundId}`
**RBAC**: RESIDENT 이상
**구현**:
1. requireAuthenticated
2. 회차 상태 확인 (PUBLISHED만 열람, 아니면 비-ADMIN/비-CHAIR 403)
3. 역할별 분기:
   - RESIDENT/AUDITOR: 본인 배정만
   - REP: 담당동 배정
   - CHAIR/ADMIN: 전체
4. SELECT parking_allocations JOIN users/units/buildings
5. 200 응답

**테스트 케이스**:
- 미인증 401
- 비-PUBLISHED 403 (비-ADMIN/비-CHAIR)
- 역할별 가시성 분기

### 13.7 PARKING-07: 관리소 자동 배정

**API**: `POST /api/parking/allocations/auto-assign`
**RBAC**: ADMIN
**구현**:
1. requireAdmin
2. 요청 본문 검증 (round_id, user_ids[])
3. **트랜잭션 시작**
   1. 회차 상태 확인 (CLOSED/PUBLISHED만 허용)
   2. 배정되지 않은 자리 조회 (allocated_number IS NULL)
   3. user_ids와 자리 매핑
   4. INSERT/UPDATE parking_allocations (is_admin_assigned=true)
5. 200 응답

**테스트 케이스**:
- 미인증 401
- 비-ADMIN 403
- 회차 상태가 CLOSED/PUBLISHED가 아닌 경우 409
- 자리 부족 시 409

---

## 14. 동시성 시나리오

### 14.1 동시 추첨 버튼 클릭

**시나리오**:
1. 관리자 A가 회차 X 추첨 실행 클릭
2. 관리자 B가 동시에 회차 X 추첨 실행 클릭

**예상 동작**:
- A의 트랜잭션이 먼저 `parking_rounds` row를 `FOR UPDATE`로 잠금
- B의 트랜잭션은 A가 COMMIT할 때까지 대기
- A가 COMMIT 후 B가 진행하지만, 상태가 이미 `CLOSED`로 변경되어 409 반환

**구현**:
```typescript
// 관리자 A
await withTransaction(async (client) => {
  await client.query(
    `UPDATE parking_rounds SET status = 'DRAWING' WHERE id = $1 AND status = 'OPEN'`,
    [roundId],
  );
  // ... 추첨 로직 ...
  await client.query(
    `UPDATE parking_rounds SET status = 'CLOSED' WHERE id = $1 AND status = 'DRAWING'`,
    [roundId],
  );
});

// 관리자 B (대기 후 실행)
const currentStatus = await query(
  `SELECT status FROM parking_rounds WHERE id = $1`,
  [roundId],
);
if (currentStatus !== 'OPEN') {
  return conflict('이미 추첨이 완료된 회차입니다');
}
```

### 14.2 자동배정 중 충돌

**시나리오**:
1. 관리자가 회차 X 자동 배정 실행 (미납종자 5명)
2. 동시에 입주민이 회차 X 신청

**예상 동작**:
- 관리자 트랜잭션이 `parking_applications`를 `FOR UPDATE`로 잠금
- 입주민 신청은 대기 후 COMMIT
- 자동 배정은 신청 건 제외하고 실행

**구현**:
```typescript
// 관리자
await withTransaction(async (client) => {
  const applicants = await client.query(
    `SELECT user_id FROM parking_applications 
     WHERE round_id = $1 AND cancelled_at IS NULL
     FOR UPDATE`,
    [roundId],
  );
  // ... 자동 배정 로직 ...
});

// 입주민 (대기 후 실행)
await query(
  `INSERT INTO parking_applications (round_id, user_id, unit_id) VALUES ($1, $2, $3)`,
  [roundId, userId, unitId],
);
```

### 14.3 회차 전환 시 이전 배정 보존

**시나리오**:
1. 회차 X 추첨 완료 (status='CLOSED', allocations 생성)
2. 관리자가 회차 Y 생성

**예상 동작**:
- 회차 X의 allocations은 불변
- 회차 Y는 새로운 seed로 추첨
- 두 회차의 allocations은 독립적

**구현**:
- `parking_allocations.round_id` FK로 분리
- 회차별 상태 전이 화이트리스트로 역방향 전이 방지

---

## 15. 종합 권장사항

### 15.1 아키텍처

**모듈 구조**:
```
src/lib/parking-rbac.ts (도메인 로컬 RBAC)
src/lib/parking-lottery.ts (셔플 로직)
src/app/api/parking/rounds/route.ts (회차 CRUD)
src/app/api/parking/applications/route.ts (신청/취소)
src/app/api/parking/draw/route.ts (추첨 실행)
src/app/api/parking/allocations/route.ts (결과 열람/자동배정)
```

**의존성 방향**:
- `parking-rbac.ts` → `rbac.ts` (공통 응답 헬퍼 재사용)
- `parking-lottery.ts` → `crypto` (Node.js built-in)
- route handlers → `parking-rbac.ts` + `parking-lottery.ts` + `db.ts`

### 15.2 테스트 전략

**단위 테스트**:
1. `parking-lottery.test.ts`:
   - seed 재현 검증
   - Fisher-Yates 정확성
   - 경계값 (0명, 1명, 100명)

2. `parking-rbac.test.ts`:
   - 권한 분기 (RESIDENT/REP/AUDITOR/CHAIR/ADMIN)
   - 401/403 반환

**통합 테스트**:
1. `rounds/route.test.ts`: 회차 생성
2. `applications/route.test.ts`: 신청/취소
3. `draw/route.test.ts`: 추첨 실행
4. `allocations/route.test.ts`: 결과 열람/자동배정

**커버리지 목표**: 93%+ (SUGGEST/NOTICE 기준)

### 15.3 구현 순서

**Phase 1: 기반** (P0)
1. migration 008_parking.sql
2. `parking-lottery.ts` (셔플 로직)
3. `parking-rbac.ts` (RBAC 헬퍼)

**Phase 2: 회차/신청** (P0)
4. `POST /api/parking/rounds` (회차 생성)
5. `POST /api/parking/applications` (신청)
6. `DELETE /api/parking/applications/{id}` (취소)

**Phase 3: 추첨** (P0)
7. `POST /api/parking/rounds/{id}/draw` (추첨 실행)
8. `PUT /api/parking/rounds/{id}/publish` (결과 공개)

**Phase 4: 열람/관리** (P0)
9. `GET /api/parking/allocations` (결과 열람)
10. `POST /api/parking/allocations/auto-assign` (관리소 자동 배정)

### 15.4 리스크 완화 요약

| 리스크 | 완화 방법 |
|-------|----------|
| 동시 추첨 실행 | FOR UPDATE + 상태 전이 화이트리스트 |
| seed 조작 | 회차 생성 시점 확정 + UPDATE 금지 |
| 재현 불가 | HMAC-SHA256 PRNG + seed 공개 |
| 비-ADMIN seed 노출 | 조회 권한 분리 (응답 필터) |
| 신청자 0명 | 빈 배열 처리 (404 아닌 200 빈 결과) |
| 자리 부족 | 409로 거부 (관리소 확인 후 재시도) |

---

## 16. 참조 구현 (내부 코드베이스)

### 16.1 동시성 FOR UPDATE — SETUP/role/route.ts:158-167

**인용**:
```typescript
// 회장(CHAIR) 단일성 — 기존 CHAIR 행을 잠그고 RESIDENT 로 회수
if (requestedRole === 'CHAIR' && chairRoleId) {
  // @MX:WARN: FOR UPDATE load-bearing (상단 블록 코멘트 참조)
  await client.query('SELECT id FROM users WHERE role_id = $1 FOR UPDATE', [chairRoleId]);
  await client.query(
    `UPDATE users SET role_id = $1, managed_building_id = NULL
     WHERE role_id = $2 AND id <> $3`,
    [residentRoleId, chairRoleId, targetUserId],
  );
}
```

**PARKING 적용**:
- 추첨 실행 시 회차 row를 `FOR UPDATE`로 잠금
- 상태 전이와 배정 생성을 원자적으로 실행

### 16.2 상태전이 화이트리스트 — SUGGEST/status/route.ts:38-44

**인용**:
```typescript
/** 상태 전이 화이트리스트 맵. */
const ALLOWED_TRANSITIONS: Record<SuggestionStatus, Set<SuggestionStatus>> = {
  접수: new Set<SuggestionStatus>(['처리중', '보류']),
  처리중: new Set<SuggestionStatus>(['완료', '보류']),
  보류: new Set<SuggestionStatus>(['처리중', '접수']),
  완료: new Set<SuggestionStatus>(['접수']), // 재오픈
};
```

**PARKING 적용**:
```typescript
// [구 모델 — 확정 모델은 OPEN→ASSIGNED→PUBLISHED→CLOSED, spec.md §HISTORY/plan.md §2 참조]
const PARKING_ROUND_TRANSITIONS: Record<RoundStatus, Set<RoundStatus>> = {
  OPEN: new Set(['DRAWING']),
  DRAWING: new Set(['CLOSED']),
  CLOSED: new Set(['PUBLISHED']),
  PUBLISHED: new Set(), // 최종 상태
};
```

### 16.3 RBAC 헬퍼 — suggest-rbac.ts:42-84

**인용**:
```typescript
export async function requireAuthenticated(
  request: Request,
): Promise<RequireAuthenticatedOk | RequireAuthenticatedErr> {
  const authHeader = request.headers.get('authorization') ?? '';
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!bearerMatch) {
    return { response: unauthorized() };
  }
  
  let atClaims: { sub?: string };
  try {
    atClaims = verifyAccessToken(bearerMatch[1]);
  } catch {
    return { response: unauthorized() };
  }
  
  // 호출자 조회 — ACTIVE 상태 + role 코드 + unit_id + managed_building_id
  const callerRes = await query<{
    role: string;
    unit_id: string | null;
    managed_building_id: string | null;
  }>(
    `SELECT r.code AS role, u.unit_id, u.managed_building_id
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.status = 'ACTIVE'`,
    [callerId],
  );
  // ...
}
```

**PARKING 적용**:
- 동일 패턴으로 `parking-rbac.ts` 구현
- `requireParkingAuthenticated`: RESIDENT 이상 인증
- `requireAdmin`: ADMIN 전용 (회차 생성, 추첨, 공개)

---

**연구 종료** — 본 문서는 SPEC-PARKING-001 작성을 위한 기반 자료입니다. 구현 디테일은 Phase 1B SPEC Planning에서 결정합니다.

---
작성일: 2026-06-23
작성자: manager-spec (Phase 0.5 Deep Research)
