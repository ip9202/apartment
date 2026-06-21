# SPEC-SETUP-001 Implementation Plan

단지 설정(동/호수/직책/회원 관리) 도메인의 TDD 구현 계획. `spec.md`의 6개 모듈(M1~M6)과 20개 REQ-SETUP-XXX 요구사항(001~020, a/b 서브 ID 포함)을 RED-GREEN-REFACTOR 주기로 구현한다.

---

## 1. 구현 순서 (TDD Phase Decomposition)

구현 순서는 의존성 그래프 기반: roles 스키마 정리(M5) → buildings CRUD(M1) + 공개 조회(M6) → units CRUD(M2) → role assignment(M3) → users list(M4).

### Phase 0: roles.managed_building_id 제거 — managed_building_id 단일 출처 (M5, brownfield)

**범위**: 기존 `roles` 테이블 수정. AUTH migration 001 이후 순차 적용.

**파일**:
- `migrations/005_managed_building_unify.sql` (신규)

**내용 (WHAT)**:
```sql
ALTER TABLE roles DROP COLUMN managed_building_id;
```
- 종속 FK `roles_managed_building_id_fkey` 자동 제거
- seed.ts 의 roles INSERT 는 `managed_building_id` 미기입(모든 행 NULL) → 데이터 손실 없음

**AUTH 회귀 테스트 업데이트 (brownfield note — C1 정정)**:

AUTH `src/lib/migration-001.test.ts` 의 실제 깨지는 어설션은 `assertColumnsExist` roles 블록(`migration-001.test.ts:85-93`) 내의 `{ table: 'roles', column: 'managed_building_id', dataType: 'uuid', isNullable: true }` 항목(`migration-001.test.ts:90`)이다. 마이그레이션 005(`ALTER TABLE roles DROP COLUMN managed_building_id`) 적용 후 이 컬럼 존재 검증이 실패한다.

주의: `migration-001.test.ts:142-145` 의 `foreignKeyExists(pool, 'users_managed_building_id_fkey')` 어설션은 `users` 테이블 기반이므로 **영향 없음**(수정 불필요). 이전 계획이 참조한 `roles_managed_building_id_fkey` FK 존재 어설션은 AUTH 테스트 파일에 존재하지 않는다.

**업데이트 방침**:
1. AUTH `migration-001.test.ts:90` 의 `assertColumnsExist` roles 블록에서 `{ table: 'roles', column: 'managed_building_id', ... }` 항목을 제거(컬럼이 005 적용 후 더 이상 존재하지 않음).
2. `migration-001.test.ts:142-145` 의 `users_managed_building_id_fkey` 검증은 **변경 없음**(`users` 기반, 회귀 없음).
3. SETUP 신규 테스트 `migrations/005.test.ts` 추가:
   - `roles.managed_building_id` 컬럼 **부재** 검증(`information_schema.columns` 조회 시 해당 행 없음)
   - `users.managed_building_id` 컬럼 **존재** 검증
   - `users_managed_building_id_fkey` → `buildings.id` FK 존재 검증
   - 기존 roles 5종 행(ADMIN/CHAIR/REP/AUDITOR/RESIDENT) 데이터 손실 없음 검증
4. AUTH AC-AUTH-015(REP 인증 시 `users.managed_building_id` 자동 연결) 회귀 테스트 재실행 → 통과 확인

**TDD 주기**:
- RED: `migrations/005.test.ts` 작성(`roles.managed_building_id` 부재 / `users.managed_building_id` 존재 어설션) → 실패
- GREEN: `005_managed_building_unify.sql` 적용 → AUTH `migration-001.test.ts:90` roles 블록 업데이트(해당 항목 제거) → 통과
- REFACTOR: 불필요(단일 ALTER 문)

---

### Phase 1: 동 관리 (M1, greenfield)

**범위**: SETUP-01 동 추가/삭제.

**파일**:
- `src/app/api/setup/buildings/route.ts` (신규 — `GET` 공개 + `POST` ADMIN)
- `src/app/api/setup/buildings/[id]/route.ts` (신규 — `DELETE` ADMIN)
- `src/app/api/setup/buildings/route.test.ts` (신규)
- `src/app/api/setup/buildings/[id]/route.test.ts` (신규)
- `src/middleware.ts` (수정 — matcher 예외 추가: `api/setup/buildings` GET 한정 공개)

**구현 디테일**:
- `GET /api/setup/buildings`: 미들웨어 matcher 예외(비인증 허용). buildings + 종속 units 조회, `{ id, name, units: [unit_number, ...] }` 배열 반환. 회원 데이터 미포함.
- `POST /api/setup/buildings`: `verifyAccessToken` + ADMIN RBAC. zod 검증(`name: string, 1~20자`). UNIQUE 제약 위반 시 409.
- `DELETE /api/setup/buildings/[id]`: `verifyAccessToken` + ADMIN RBAC. UUID path param 검증(`UUID_RE`). 종속 units 중 활성 입주민(`users.status='ACTIVE'`, `unit_id IS NOT NULL`) 존재 시 409. 단일 트랜잭션으로 동 + 종속 units CASCADE 삭제.

**미들웨어 matcher 예외 처리**:
- matcher 는 메서드 구분 불가 → 전체 `/api/setup/buildings` 경로 예외 추가(또는 route handler 내부에서 AT optional 처리)
- 권고: matcher 에 `api/setup/buildings` 추가 후, `POST`/`DELETE` route handler 내부에서 `verifyAccessToken` 강제(401 on missing). `GET` 만 비인증 허용.

**TDD 주기** (REQ-SETUP-001~004b, REQ-SETUP-007a, REQ-SETUP-020):
- RED: 동 추가 201 / 동명 중복 409 / 활성 입주민 동 삭제 409 / 미존재 동 삭제 404 / 동 추가 미인증 401 / 비-ADMIN 동 추가 403 / name 초과 422 / UUID 불일치 400 / GET buildings 비인증 200 테스트 작성 → 실패
- GREEN: route handlers 구현(GET 공개 + POST/DELETE ADMIN) → 통과
- REFACTOR: RBAC 헬퍼 추출(AUTH deactivate 패턴 재사용)

---

### Phase 2: 호수 관리 (M2, greenfield)

**범위**: SETUP-02 호수 일괄 업데이트.

**파일**:
- `src/app/api/setup/buildings/[id]/units/route.ts` (신규 — `PUT` ADMIN)
- `src/app/api/setup/buildings/[id]/units/route.test.ts` (신규)

**구현 디테일**:
- `PUT /api/setup/buildings/[id]/units`: `verifyAccessToken` + ADMIN RBAC. zod 검증(`units: string[], 각 원소 1~10자`). building_id 존재 확인(없으면 404). 기존 units 조회 → 신규 배열과 diff. 삭제 대상 호수 중 활성 입주민 존재 시 409(트랜잭션 전체 롤백). `withTransaction` 내 추가(INSERT ON CONFLICT DO NOTHING) + 삭제 적용.

**TDD 주기** (REQ-SETUP-005~008b):
- RED: 호수 일괄 업데이트 200 / 빈 배열 = 전체 삭제 200 / 삭제 호수 활성 입주민 409 / 미존재 building 404 / 호수 업데이트 미인증 401 / 비-ADMIN 403 테스트 작성 → 실패
- GREEN: route handler 구현 → 통과
- REFACTOR: diff 계산 로직 추출

---

### Phase 3: 직책 부여/변경/회수 (M3, greenfield)

**범위**: SETUP-04.

**파일**:
- `src/app/api/setup/users/[id]/role/route.ts` (신규 — `PUT` ADMIN/CHAIR)
- `src/app/api/setup/users/[id]/role/route.test.ts` (신규)

**구현 디테일**:
- `PUT /api/setup/users/[id]/role`: `verifyAccessToken` + RBAC(ADMIN 또는 CHAIR). zod 검증(`role: enum[ADMIN,CHAIR,REP,AUDITOR,RESIDENT]`, `managed_building_id: uuid optional`).
- **CHAIR 권한 범위 검사 (REQ-SETUP-012)**: 호출자 역할이 CHAIR 이고 요청 `role='ADMIN'` 인 경우 403. CHAIR 는 RESIDENT/REP/AUDITOR 부여만 가능.
- **REP managed_building_id 필수 (REQ-SETUP-011)**: `role='REP'` 인데 `managed_building_id` 누락 시 422.
- **회장 단일성 (REQ-SETUP-010)**: `role='CHAIR'` 부여 시 `withTransaction` 내에서 기존 CHAIR 회원 조회 → 있으면 `role_id` 를 RESIDENT 로 갱신(`managed_building_id=NULL`) → 신규 부여. 원자적 처리.
- **직책 회수**: `role='RESIDENT'` 인 경우 `managed_building_id=NULL` 설정.

**TDD 주기** (REQ-SETUP-009~013b):
- RED: RESIDENT→REP 부여 + managed_building_id 갱신 200 / 회장 부여 시 기존 회장 자동 회수(원자) / REP 부여 managed_building_id 누락 422 / CHAIR 의 ADMIN 부여 403 / 직책 회수→RESIDENT 200 / 직책 부여 미인증 401 / 비-ADMIN·비-CHAIR 403 테스트 작성 → 실패
- GREEN: route handler 구현 → 통과
- REFACTOR: 회장 단일성 로직 별도 함수 추출

---

### Phase 4: 회원 목록 조회 (M4, greenfield)

**범위**: SETUP-05.

**파일**:
- `src/app/api/setup/users/route.ts` (신규 — `GET` ADMIN)
- `src/app/api/setup/users/route.test.ts` (신규)

**구현 디테일**:
- `GET /api/setup/users`: `verifyAccessToken` + ADMIN RBAC. 쿼리 필터(`building`, `role`, `page`, `limit`, optional `status`). 기본 `status='ACTIVE'`(REQ-SETUP-017). `password_hash` 절대 미포함(REQ-SETUP-015). JOIN: users + roles(code) + units(unit_number) + buildings(name). 페이지네이션(`OFFSET`/`LIMIT`, 기본 limit 20, 최대 100). `created_at DESC` 기본 정렬.

**TDD 주기** (REQ-SETUP-014~017):
- RED: 목록 조회 + 필터(building/role/page) 200 / password_hash 미포함 / 회원 목록 미인증 401 / 비-ADMIN 403 / INACTIVE 기본 제외 + status 파라미터 테스트 작성 → 실패
- GREEN: route handler 구현 → 통과
- REFACTOR: 필터 빌더 헬퍼 추출

---

## 2. 파일 목록 요약

### 신규 파일 (greenfield routes)

| 파일 | 모듈 | 설명 |
|------|------|------|
| `migrations/005_managed_building_unify.sql` | M5 | roles.managed_building_id DROP (brownfield) |
| `src/app/api/setup/buildings/route.ts` | M1/M2 | GET 공개 + POST ADMIN |
| `src/app/api/setup/buildings/[id]/route.ts` | M1 | DELETE ADMIN |
| `src/app/api/setup/buildings/[id]/units/route.ts` | M2 | PUT ADMIN |
| `src/app/api/setup/users/route.ts` | M4 | GET ADMIN |
| `src/app/api/setup/users/[id]/role/route.ts` | M3 | PUT ADMIN/CHAIR |
| `src/app/api/setup/buildings/route.test.ts` | M1 | 테스트 |
| `src/app/api/setup/buildings/[id]/route.test.ts` | M1 | 테스트 |
| `src/app/api/setup/buildings/[id]/units/route.test.ts` | M2 | 테스트 |
| `src/app/api/setup/users/route.test.ts` | M4 | 테스트 |
| `src/app/api/setup/users/[id]/role/route.test.ts` | M3 | 테스트 |
| `migrations/005.test.ts` (또는 `migration-005.test.ts`) | M5 | migration 검증 테스트 |

### 수정 파일 (brownfield)

| 파일 | 모듈 | 설명 |
|------|------|------|
| `src/middleware.ts` | M1 | matcher 예외 추가(`api/setup/buildings` GET 공개) |
| `src/lib/migration-001.test.ts` (AUTH 소유) | M5 | `assertColumnsExist` roles 블록(`migration-001.test.ts:90`)에서 `{ table: 'roles', column: 'managed_building_id', ... }` 항목 제거. `migration-001.test.ts:142-145` 의 `users_managed_building_id_fkey` 검증은 변경 없음(`users` 기반). |

### 재사용 파일 (AUTH 소유, 수정 없음)

- `src/lib/db.ts` (`query`, `withTransaction`)
- `src/lib/auth.ts` (`verifyAccessToken`)
- `src/lib/cookies.ts`
- AUTH RBAC route handler 패턴(`src/app/api/auth/users/[id]/deactivate/route.ts` line 70-84)

---

## 3. 리스크 및 완화 방안

| 리스크 | 설명 | 완화 방안 |
|--------|------|-----------|
| **AUTH 회귀 (roles.managed_building_id 제거)** | `roles.managed_building_id` 제거 시 AUTH `migration-001.test.ts:90` `assertColumnsExist` roles 블록이 실패 | Phase 0 에서 `migration-001.test.ts:90` roles 블록 업데이트(해당 항목 제거) + `AC-AUTH-015`(REP 인증) 회귀 재실행 |
| **삭제 안전성 race condition** | 동/호수 삭제 중 동시에 신규 입주민 인증 시 활성 입주민 누락 | `withTransaction` 내 활성 입주민 카운트 + 삭제를 원자적 수행; `READ COMMITTED` 격리 수준에서 체크 |
| **회장 단일성 동시성** | 두 클라이언트 동시 CHAIR 부여 시 단일성 위반 | `withTransaction` 내 기존 CHAIR 회수 + 신규 부여 원자 처리; 직렬화 가능 트랜잭션 격리(SERIALIZABLE) 또는 row-level lock 고려 |
| **GET buildings 공개 처리 보안** | matcher 예외로 POST/DELETE 도 우회될 위험 | route handler 내부에서 `verifyAccessToken` 강제(GET 만 비인증 허용); 통합 테스트로 POST/DELETE 401 검증 |
| **CHAIR 권한 상승** | CHAIR 가 ADMIN 부여 시도 우회 | REQ-SETUP-012 검증을 route handler 최상단에 배치; 단위 테스트로 403 케이스 커버 |
| **seed.ts 소유권 이관** | AUTH 가 작성한 `scripts/seed.ts` 가 SETUP 데이터 시드 | 코드 자체 유지, `@MX:NOTE` 로 SETUP 책임 명시 (리팩터링 최소화) |
| **unit_number 비정형 패턴** | "101", "201A" 등 비정형 허용 시 검증 느슨 | `VARCHAR(10)` + 최소 1자 이상, 엄격 정규식 비적용(비정형 구조 허용); zod 는 `string().min(1).max(10)` 만 |

---

## 4. MX Tag 적용 계획

`spec.md` §7 에 명시된 MX Tag Plan 을 Run Phase 에서 적용:

- `@MX:ANCHOR`: buildings/units/roles CRUD route handlers, migration 005 스키마 불변 지점
- `@MX:WARN + @MX:REASON`: 삭제 안전성 체크, 회장 단일성 트랜잭션, CHAIR 권한 범위 검사
- `@MX:NOTE`: `users.managed_building_id` 단일 출처, GET buildings 공개, 강제 탈퇴 AUTH 위임
- `@MX:TODO`: SETUP-03 직책 종류 CRUD, 호수 rename

---

## 5. 검증 게이트 (Quality Gates)

- **TRUST 5**: Tested(85%+ 커버리지), Readable(한국어 도메인 용어 주석), Unified(AUTH 패턴 일관), Secured(RBAC + zod + Parameterized Query), Trackable(SPEC-SETUP-001 참조 커밋)
- **LSP 게이트**: run 단계 — TypeScript 에러 0, ESLint 에러 0
- **테스트 커버리지**: 신규 route handlers 85% 이상
- **AUTH 회귀**: `AC-AUTH-015`(REP 인증) + 업데이트된 `migration-001.test.ts:90` roles 블록 통과

---

## 6. Definition of Done

- [ ] roles.managed_building_id 제거 마이그레이션 적용 + AUTH `migration-001.test.ts:90` roles 블록 업데이트 통과
- [ ] M1 동 관리: REQ-SETUP-001~004b 구현 + 테스트 통과
- [ ] M2 호수 관리: REQ-SETUP-005~008b 구현 + 테스트 통과
- [ ] M3 직책 부여: REQ-SETUP-009~013b 구현 + 테스트 통과
- [ ] M4 회원 목록: REQ-SETUP-014~017 구현 + 테스트 통과
- [ ] M5 managed_building_id 통일: REQ-SETUP-018~019 구현 + AUTH 회귀 통과
- [ ] M6 동/호수 공개 조회: REQ-SETUP-020 구현 + 테스트 통과
- [ ] 미들웨어 matcher 예외 적용(GET buildings 공개, POST/DELETE 인증 유지)
- [ ] 강제 탈퇴 AUTH 위임 문서화(SETUP 미구현 확인)
- [ ] MX 태그 적용(ANCHOR/WARN+REASON/NOTE/TODO)
- [ ] TRUST 5 게이트 통과

---

*본 plan.md 는 구현 디테일(함수명/클래스 구조/API 스키마)을 포함하나, 이는 Run Phase(manager-ddd/tdd)의 구현 가이드이며 spec.md 의 WHAT/WHHY 에 대한 HOW 를 정의한다.*
