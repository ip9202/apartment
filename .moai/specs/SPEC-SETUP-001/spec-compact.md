# SPEC-SETUP-001 Compact Reference

단지 설정(동/호수/직책/회원 관리) 도메인의 압축 참조 문서. 모든 REQ-SETUP-XXX 요구사항(001~020, a/b 서브 ID 포함, 총 20개), 검증 기준, 생성 파일, 제외 항목을 추출. overview/approach 제외.

---

## 1. 요구사항 요약 (REQ-SETUP-XXX)

| REQ ID | 모듈 | EARS 유형 | 핵심 요구사항 |
|--------|------|-----------|---------------|
| REQ-SETUP-001 | M1 동 관리 | Event-driven | ADMIN 동 추가 시 buildings 테이블 생성 + 201 반환 |
| REQ-SETUP-002 | M1 동 관리 | Unwanted | 동명 중복 시 409 반환 (UNIQUE 제약) |
| REQ-SETUP-003 | M1 동 관리 | Unwanted | 활성 입주민 있는 동 삭제 시 409; 미존재 building_id 삭제 시 404 반환 |
| REQ-SETUP-004a | M1 동 관리 | Unwanted | 동 추가/삭제 미인증(토큰 없음) 시 401 반환 |
| REQ-SETUP-004b | M1 동 관리 | State-driven | 인증됨-비-ADMIN 동 추가/삭제 시 403 반환 |
| REQ-SETUP-005 | M2 호수 관리 | Event-driven | ADMIN 호수 일괄 업데이트 시 diff 트랜잭션 적용 + 200; 빈 배열 = 전체 삭제 |
| REQ-SETUP-006 | M2 호수 관리 | Unwanted | 삭제 대상 호수 활성 입주민 시 409 반환 |
| REQ-SETUP-007 | M2 호수 관리 | Unwanted | 미존재 building_id 호수 업데이트 시 404 반환 |
| REQ-SETUP-007a | M1/M2 입력 검증 | Unwanted | name 초과 422 / UUID 불일치 400 (NFR §6.1) |
| REQ-SETUP-008a | M2 호수 관리 | Unwanted | 호수 업데이트 미인증 시 401 반환 |
| REQ-SETUP-008b | M2 호수 관리 | State-driven | 인증됨-비-ADMIN 호수 업데이트 시 403 반환 |
| REQ-SETUP-009 | M3 직책 부여 | Event-driven | ADMIN/CHAIR 직책 부여/회수 시 users.role_id 갱신 + 200; REP 시 managed_building_id 갱신 |
| REQ-SETUP-010 | M3 직책 부여 | Complex/While | 회장 부여 시 기존 회장 원자적 자동 회수 (단일성 보장) |
| REQ-SETUP-011 | M3 직책 부여 | Unwanted | REP 부여 시 managed_building_id 누락 시 422 반환 |
| REQ-SETUP-012 | M3 직책 부여 | Unwanted | CHAIR 의 ADMIN 부여 시 403 반환 (CHAIR 권한 범위) |
| REQ-SETUP-013a | M3 직책 부여 | Unwanted | 직책 부여 미인증 시 401 반환 |
| REQ-SETUP-013b | M3 직책 부여 | State-driven | 인증됨-비-ADMIN/비-CHAIR 직책 부여 시 403 반환 |
| REQ-SETUP-014 | M4 회원 목록 | State-driven | ADMIN 회원 목록 조회 시 building/role/page/limit 필터 + 200 반환 |
| REQ-SETUP-015 | M4 회원 목록 | Ubiquitous | 회원 목록 응답에 password_hash 절대 미포함 |
| REQ-SETUP-016a | M4 회원 목록 | Unwanted | 회원 목록 조회 미인증 시 401 반환 |
| REQ-SETUP-016b | M4 회원 목록 | State-driven | 인증됨-비-ADMIN 회원 목록 조회 시 403 반환 |
| REQ-SETUP-017 | M4 회원 목록 | Optional | status 생략 시 ACTIVE 만; ?status=INACTIVE/ALL 지원 |
| REQ-SETUP-018 | M5 통일 | Ubiquitous | roles.managed_building_id 컬럼 및 종속 FK 제거 |
| REQ-SETUP-019 | M5 통일 | Ubiquitous | users.managed_building_id 를 REP 담당 동 단일 출처로 확정 |
| REQ-SETUP-020 | M6 공개 조회 | Event-driven | GET /api/setup/buildings 비인증 허용, 동/호수만 반환(회원 데이터 미포함) |

---

## 2. 검증 기준 요약 (Acceptance Criteria)

### M1 동 관리 (5개)
- AC-SETUP-001: ADMIN 동 추가 201 (REQ-SETUP-001)
- AC-SETUP-002: 동명 중복 409 (REQ-SETUP-002)
- AC-SETUP-003: 활성 입주민 동 삭제 409 (REQ-SETUP-003)
- AC-SETUP-004: 비-ADMIN 동 추가 403 (REQ-SETUP-004b)
- AC-SETUP-005: 미존재 동 삭제 404 (REQ-SETUP-003)

### M2 호수 관리 (5개)
- AC-SETUP-006: 호수 일괄 업데이트 200 (REQ-SETUP-005)
- AC-SETUP-007: 삭제 호수 활성 입주민 409 (REQ-SETUP-006)
- AC-SETUP-008: 미존재 building 404 (REQ-SETUP-007)
- AC-SETUP-009a: 호수 업데이트 미인증 401 (REQ-SETUP-008a)
- AC-SETUP-009b: 비-ADMIN 호수 업데이트 403 (REQ-SETUP-008b)

### M3 직책 부여 (7개)
- AC-SETUP-010: RESIDENT→REP 부여 + managed_building_id 갱신 200 (REQ-SETUP-009)
- AC-SETUP-011: 회장 부여 시 기존 회장 자동 회수 원자 (REQ-SETUP-010)
- AC-SETUP-012: REP 부여 managed_building_id 누락 422 (REQ-SETUP-011)
- AC-SETUP-013: CHAIR 의 ADMIN 부여 403 (REQ-SETUP-012)
- AC-SETUP-014: 직책 회수→RESIDENT 200 (REQ-SETUP-009)
- AC-SETUP-015a: 직책 부여 미인증 401 (REQ-SETUP-013a)
- AC-SETUP-015b: 비-ADMIN/비-CHAIR 직책 부여 403 (REQ-SETUP-013b)

### M4 회원 목록 (5개)
- AC-SETUP-016: 회원 목록 조회 + 필터 200 (REQ-SETUP-014)
- AC-SETUP-017: password_hash 미포함 (REQ-SETUP-015)
- AC-SETUP-018a: 회원 목록 미인증 401 (REQ-SETUP-016a)
- AC-SETUP-018b: 비-ADMIN 회원 목록 403 (REQ-SETUP-016b)
- AC-SETUP-019: INACTIVE 회원 기본 제외 + status 파라미터 (REQ-SETUP-017)

### M5 managed_building_id 통일 (4개)
- AC-SETUP-020: roles.managed_building_id 컬럼 부재 (REQ-SETUP-018)
- AC-SETUP-021: users.managed_building_id 존재 + FK 유효 (REQ-SETUP-019)
- AC-SETUP-022: AUTH verify-unit REP 인증 회귀 (AC-AUTH-015 통과) (REQ-SETUP-019)
- AC-SETUP-023: AUTH migration-001.test.ts:90 roles 블록 업데이트 통과 (REQ-SETUP-018)

### M6 동/호수 공개 조회 (1개)
- AC-SETUP-024: GET buildings 비인증 200 (REQ-SETUP-020)

### Edge Cases (7개)
- EC-SETUP-001: 동 추가 name 길이 초과 422 (REQ-SETUP-007a)
- EC-SETUP-002: 동 삭제 UUID 형식 오류 400 (REQ-SETUP-007a)
- EC-SETUP-003: 호수 업데이트 빈 배열 (전체 삭제, 활성 입주민 없을 때 허용) (REQ-SETUP-005)
- EC-SETUP-004: 회장 부여 동시성 (race condition, 단일성 보장) (REQ-SETUP-010)
- EC-SETUP-005: CHAIR 의 REP 부여는 허용 (REQ-SETUP-009, REQ-SETUP-012)
- EC-SETUP-006: GET buildings 비인증 허용 (REQ-SETUP-020)
- EC-SETUP-007: POST buildings 비인증 401 (REQ-SETUP-004a)

---

## 3. 생성 파일 목록

### 신규 파일 (greenfield)

| 파일 | 모듈 |
|------|------|
| `migrations/005_managed_building_unify.sql` | M5 (brownfield — 기존 roles 수정) |
| `src/app/api/setup/buildings/route.ts` | M1/M2/M6 (GET 공개 + POST ADMIN) |
| `src/app/api/setup/buildings/[id]/route.ts` | M1 (DELETE ADMIN) |
| `src/app/api/setup/buildings/[id]/units/route.ts` | M2 (PUT ADMIN) |
| `src/app/api/setup/users/route.ts` | M4 (GET ADMIN) |
| `src/app/api/setup/users/[id]/role/route.ts` | M3 (PUT ADMIN/CHAIR) |
| 각 route handler 별 `.test.ts` 파일 | M1~M4, M6 |
| `migrations/005.test.ts` | M5 |

### 수정 파일 (brownfield)

| 파일 | 모듈 | 수정 내용 |
|------|------|-----------|
| `src/middleware.ts` | M1/M6 | matcher 예외 추가 (`api/setup/buildings` GET 공개; POST/DELETE 는 route handler 내부 인증 강제) |
| AUTH `src/lib/migration-001.test.ts` | M5 | `assertColumnsExist` roles 블록(`migration-001.test.ts:90`)에서 `{ table: 'roles', column: 'managed_building_id', ... }` 항목 제거. `migration-001.test.ts:142-145` 의 `users_managed_building_id_fkey` 검증은 변경 없음(`users` 기반). |

### 재사용 파일 (AUTH 소유, 수정 없음)

- `src/lib/db.ts` (`query`, `withTransaction`)
- `src/lib/auth.ts` (`verifyAccessToken`)
- `src/lib/cookies.ts`
- AUTH RBAC route handler 패턴 (`src/app/api/auth/users/[id]/deactivate/route.ts`)

---

## 4. 제외 항목 (Exclusions)

1. **SETUP-03 직책 종류 CRUD (P1)** — 역할 5종(ADMIN/CHAIR/REP/AUDITOR/RESIDENT) 시드 고정. 별도 SPEC.
2. **강제 탈퇴 (`DELETE /api/setup/users/:id`)** — AUTH `/api/auth/users/[id]/deactivate` (REQ-AUTH-014) 소유. SETUP-05 삭제 버튼은 클라이언트가 AUTH 엔드포인트 직접 호출.
3. **공지(NOTICE) / 건의(SUGGEST) / 주차 추첨(PARKING) 도메인** — 별도 SPEC.
4. **AUTH verify-unit (`POST /api/auth/verify-unit`)** — AUTH 소유. SETUP 은 buildings/units 읽기 전용 제공만.
5. **마이페이지 / 프로필 편집** — 별도 SPEC.
6. **호수 unit_number rename** — 삭제+추가 조합으로 취급, rename 지원 OUT.
7. **2단계 인증(2FA) / 이메일 인증 링크** — 현재 범위 아님.

---

## 5. 핵심 결정 (Plan Review 확정)

1. **강제 탈퇴 → AUTH 위임**: SETUP 미구현, AUTH `/api/auth/users/[id]/deactivate` 호출 (의존성 문서화)
2. **SETUP-03 OUT**: 역할 5종 고정, 직책 종류 CRUD 는 P1 별도 SPEC
3. **CHAIR 권한 범위**: RESIDENT/REP/AUDITOR 부여만 가능, ADMIN 부여 시 403
4. **GET buildings 공개**: middleware matcher 예외 (인증 목적, 비인증 허용; POST/DELETE 는 인증 유지)
5. **401 vs 403 구분**: 미인증(토큰 누락/만료/변조) = 401 Unauthorized; 인증됨-권한 없음(역할 불일치) = 403 Forbidden. 모든 SETUP RBAC REQ에 일관 적용.

---

## 6. 의존성 (Dependencies)

- **SPEC-AUTH-001 P0 완료** (buildings/units/roles/users 스키마, src/lib, src/middleware, RBAC 패턴)
- **AUTH 회귀**: roles.managed_building_id 제거 마이그레이션 적용 후 AC-AUTH-015 (REP 인증) + `migration-001.test.ts:90` roles 블록 업데이트 통과 필요. (`migration-001.test.ts:142-145` 의 `users_managed_building_id_fkey` 검증은 영향 없음.)

---

*본 spec-compact.md 는 Run Phase(manager-ddd/tdd)에서 빠른 참조용이다. 상세는 spec.md/plan.md/acceptance.md 참조.*
