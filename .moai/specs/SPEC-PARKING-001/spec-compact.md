# SPEC-PARKING-001 Compact Reference

주차 자리 번호 배정 추첨(회차생성/추첨/취소/자동배정/결과공개/열람/투명성) 도메인의 압축 참조 문서. 모든 REQ-PK-XXX 요구사항(001~027), 검증 기준, 생성 파일, 제외 항목을 추출.

---

## 1. 요구사항 요약 (REQ-PK-XXX)

| REQ ID | 모듈 | EARS 유형 | 핵심 요구사항 |
|--------|------|-----------|---------------|
| REQ-PK-001 | M1 회차 생성 | Event-driven | ADMIN/CHAIR 회차 생성 시 parking_rounds 생성 + 201 반환 (seed 자동 생성, status='OPEN') |
| REQ-PK-002 | M1 회차 생성 | Unwanted | application_start >= application_end 시 422 반환 (기간 유효성) |
| REQ-PK-003 | M1 회차 생성 | Unwanted | slot_pool 빈 배열 또는 세대수 미만 시 422 반환 (모든 세대 1자리 보장) |
| REQ-PK-004 | M1 회차 생성 | Unwanted | 회차 생성 미인증 시 401 반환 |
| REQ-PK-005 | M1 회차 생성 | State-driven | 비-ADMIN/비-CHAIR 회차 생성 시 403 반환 |
| REQ-PK-006 | M2 추첨(자리확정) | Event-driven | RESIDENT 이상 추첨 시 seed 순열에서 본인 slot 산출 + assignment 생성(DRAW) + 200 반환 |
| REQ-PK-007 | M2 추첨(자리확정) | Unwanted | 세대당 1회 (이미 assignment 존재 시) 409 반환 (UNIQUE 위반) |
| REQ-PK-008 | M2 추첨(자리확정) | Unwanted | OPEN 상태 외 추첨 시 409 반환 (상태머신 불변) |
| REQ-PK-009 | M2 추첨(자리확정) | Unwanted | 동/호수 미인증(unit_id NULL) 사용자 추첨 시 403 반환 |
| REQ-PK-010 | M2 추첨(자리확정) | Unwanted | 추첨 미인증 시 401 반환 |
| REQ-PK-011 | M3 추첨 취소 | Event-driven | 본인 DRAW assignment 취소 시 행 삭제 + 200 반환 (OPEN 상태만) |
| REQ-PK-012 | M3 추첨 취소 | Unwanted | OPEN 상태 외 취소 시 409 반환 |
| REQ-PK-013 | M3 추첨 취소 | Unwanted | 타인/AUTO assignment 취소 시 403 반환 (본인 DRAW만) |
| REQ-PK-014 | M3 추첨 취소 | Unwanted | 미존재 assignment 취소 시 404 반환 |
| REQ-PK-015 | M4 자동배정 | Event-driven | ADMIN 자동배정 실행 시 미참여 세대 일괄 배정(AUTO) + OPEN→ASSIGNED 전이 + 200 반환 (트랜잭션 원자) |
| REQ-PK-016 | M4 자동배정 | Unwanted | OPEN 상태 외 자동배정 시 409 반환 (OPEN→ASSIGNED 단방향) |
| REQ-PK-017 | M4 자동배정 | Ubiquitous | 동시 자동배정 실행 직렬화 — 단 한 건만 성공, 나머지 409 (세대당 1배정 + OPEN→ASSIGNED 단일 전이 불변 수호) |
| REQ-PK-018 | M4 자동배정 | Unwanted | 자리 부족 시 409 Conflict + 트랜잭션 전체 롤백 (부분 배정 금지 — 도메인 불변 "탈락자 없음" 강제; 정상 흐름에서는 도달 불가, 방어적 불변) |
| REQ-PK-019 | M4 자동배정 | State-driven | 비-ADMIN 자동배정 시 403 반환 (ADMIN 전용) |
| REQ-PK-020 | M5 결과 공개 | Event-driven | ADMIN 결과 공개 시 is_published=true + ASSIGNED→PUBLISHED 전이 + 200 반환 |
| REQ-PK-021 | M5 결과 공개 | Unwanted | ASSIGNED 상태 외 결과 공개 시 409 반환 (ASSIGNED→PUBLISHED 단방향) |
| REQ-PK-022 | M5 결과 공개 | State-driven | 비-ADMIN 결과 공개 시 403 반환 |
| REQ-PK-023 | M5 결과 열람 | Event-driven | 역할별 결과 열람 가시성 분기 (공개: RESIDENT 본인/REP 담당동/ADMIN 전체, 미공개: 본인만) + 200 반환 |
| REQ-PK-024 | M5 결과 열람 | Unwanted | 미공개 회차 비권한자 타인 결과 조회 시 본인 assignment만(없으면 빈 목록) 200 반환 — 타인 존재 여부 누출 금지 (정보은닉, enumeration 방어) |
| REQ-PK-025 | M5 결과 열람 | Unwanted | 결과 열람 미인증 시 401 반환 |
| REQ-PK-026 | M5 투명성 | Event-driven | 투명성 공개 시 seed+알고리즘(Fisher-Yates+HMAC-SHA256)+정렬 unit 목록 반환 + 200 반환 |
| REQ-PK-027 | M5 투명성 | Ubiquitous | 재현 검증 가능성 보장 (동일 seed+입력 → 동일 배정 결과, 결정론적 순열 불변 계약) |

---

## 2. 검증 기준 요약 (Acceptance Criteria)

상세 시나리오는 `acceptance.md` 참조. 총 AC-PK-001~044 (44개), EC-PK-001~008 (8개 엣지), CC-PK-001~003 (3개 동시성).

핵심 검증 축:
1. **재현 검증** (AC-PK-043, REQ-PK-027): 동일 seed + 동일 입력 → 동일 배정 결과 (공정성 입증)
2. **동시성 방어** (CC-PK-001, CC-PK-002): 동시 추첨 UNIQUE, 동시 자동배정 FOR UPDATE
3. **상태머신** (AC-PK-018, AC-PK-028, EC-PK-008): OPEN→ASSIGNED→PUBLISHED 단방향, 역방향 409
4. **역할별 가시성** (AC-PK-036~040): RESIDENT 본인, REP 담당동, CHAIR/ADMIN 전체

---

## 3. 생성 파일 (예정)

| 파일 | 모듈 | 설명 |
|------|------|------|
| `migrations/008_parking.sql` | M0 | parking_rounds + parking_assignments 테이블 (CHECK/UNIQUE/FK/인덱스) |
| `src/lib/parking-lottery.ts` | M0b | 결정론적 순열 (HMAC-SHA256 PRNG + Fisher-Yates), generateSeed |
| `src/lib/parking-rbac.ts` | M1~M5 | PARKING 도메인 로컬 requireAuthenticated (Option C, suggest-rbac.ts 패턴) |
| `src/app/api/parking/rounds/route.ts` | M1 | POST ADMIN/CHAIR (회차 생성) |
| `src/app/api/parking/rounds/[id]/draw/route.ts` | M2/M3 | POST 추첨, DELETE 취소 |
| `src/app/api/parking/rounds/[id]/auto-assign/route.ts` | M4 | POST ADMIN (자동배정 실행, FOR UPDATE 트랜잭션) |
| `src/app/api/parking/rounds/[id]/publish/route.ts` | M5 | PUT ADMIN (결과 공개) |
| `src/app/api/parking/rounds/[id]/allocations/route.ts` | M5 | GET 역할별 분기 (결과 열람) |
| `src/app/api/parking/rounds/[id]/verify/route.ts` | M5 | GET 투명성 공개 (seed+알고리즘+입력) |
| 각 route.test.ts | M1~M5 | 테스트 |
| `src/lib/migration-008.test.ts` | M0 | migration 008 검증 테스트 |
| `src/lib/parking-lottery.test.ts` | M0b | 순열 로직 + 재현 검증 테스트 |

### 수정 파일

**없음.** Option C — rbac.ts/db.ts/middleware.ts 무변경, parking-rbac.ts 신규 (AUTH/SETUP/NOTICE/SUGGEST 412 테스트 회귀 방지).

---

## 4. 제외 항목 (Exclusions)

1. **PARKING-08 추첨 이력 조회 (P1)** — 과거 회차 배정 이력/통계, 별도 SPEC
2. **주차 알림 (푸시/이메일, P2)** — 회차 생성/결과 공개 시 알림
3. **회차 수정/삭제** — 기간 변경, 자리풀 재입력, 회차 삭제는 P1 별도 SPEC (불변 seed 보장)
4. **자리 번호 체계 마스터 관리** — slot_pool은 회차별 동적 입력(JSONB), 전역 마스터 아님
5. **주차권 QR/바코드 발급** — 물리적 표식 발급 OUT
6. **주차위반 단속** — 규칙 위반 감지/단속 OUT
7. **관리소 수동 배정 API** — ADMIN 직접 slot 지정(assignment_source='ADMIN' 독립 API)은 P1 별도 SPEC
8. **공지(NOTICE) / 건의(SUGGEST) 도메인** — 별도 SPEC

---

## 5. 핵심 의사결정

| 결정 | 내용 | 근거 |
|------|------|------|
| 도메인 본질 | slot assignment (자리 번호 배정), win/lose 아님 | interview.md 사용자 정정, 모든 세대 1자리 보장 |
| 회차 상태머신 | OPEN→ASSIGNED→PUBLISHED→CLOSED 단방향 | 자동배정 실행(OPEN→ASSIGNED), 결과 공개(ASSIGNED→PUBLISHED), 역방향 409 |
| 자리풀 | 관리소 동적 입력 (JSONB, 문자열/숫자 혼합) | interview.md Q2, 시스템 고정 1~38 아님 |
| applications 통합 | parking_assignments 단일 테이블 (DRAW/AUTO/ADMIN) | 추첨=자리확정 동시 발생, 신청/배정 분리 불필요 |
| seed 순열 | HMAC-SHA256 PRNG + Fisher-Yates | Node crypto 내장, 결정론적(재현 가능), 외부 의존성 없음 |
| seed 공개 | 투명성 우선 (seed+알고리즘+입력 공개) | product.md "랜덤 시드와 당첨 결과 공개로 공정성 보장" (§154) |
| 동시성 추첨 | UNIQUE(round_id, unit_id) 1차 방어 | 순열 결정론적, 순서 무관, FOR UPDATE 불필요 |
| 동시성 자동배정 | FOR UPDATE load-bearing | SETUP role route:160-161 패턴, 두 관리자 동시 실행 직렬화 |
| RBAC | Option C (parking-rbac.ts 신규) | suggest-rbac.ts 선례, 공유 rbac.ts 무변경 (412 테스트 회귀 방지) |
| 역할 분기 | RESIDENT/AUDITOR=본인, REP=담당동, CHAIR/ADMIN=전체 | SUGGEST 패턴 동일 |
| AUDITOR 권한 | RESIDENT 동일 취급 (본인만) | apt_08 §7 미명시, 후속 정책 권장 |

---

## 6. 회차 상태머신

```
OPEN ──자동배정 실행(ADMIN)──→ ASSIGNED ──결과 공개(ADMIN)──→ PUBLISHED ──회차 종료(P1)──→ CLOSED
 │                               │                              │                            │
 └─ 추첨/취소 허용               └─ 읽기 전용(비공개)           └─ 역할별 열람 허용         └─ 최종 상태
```

불허 전이 (409):
- OPEN → PUBLISHED (자동배정 스킵 불가)
- 역방향 전부 (ASSIGNED→OPEN, PUBLISHED→ASSIGNED, CLOSED→*)

---

## 7. 모호점 (FLAG — plan.md §10 상세)

1. **Q2 자리풀 동적 입력 해석**: 관리소가 회차 생성 시 자리 번호 풀 직접 입력 (Plan Review 재확인 필요, interview.md 명시).
2. **DRAWING 중간 상태 생략**: 자동배정을 단일 트랜잭션으로 원자 처리하여 OPEN→ASSIGNED 직접 전이.
3. **applications 테이블 통합**: 추첨=자리확정 동시 발생으로 단일 테이블 (research.md 모델 정정).
4. **AUDITOR 권한**: RESIDENT 동일 취급 (apt_08 §7 미명시).
5. **PUBLISHED→CLOSED 전이**: 본 SPEC은 CLOSED 정의만, 전이 API는 P1 별도 SPEC.

---

*본 compact 문서는 `spec.md`의 WHAT/WHY를 빠르게 참조하기 위한 요약이다.*
