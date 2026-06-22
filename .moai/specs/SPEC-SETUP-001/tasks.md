## Task Decomposition
SPEC: SPEC-SETUP-001

개발 방법론: TDD (RED-GREEN-REFACTOR), quality.yaml development_mode=tdd.
실행 모드: Standard Mode (sub-agent, manager-tdd). Phase별 순차 진행.

Resume 기준: Phase A(M5 통일 + AUTH 회귀)는 이전 세션 완료(커밋 0608777).
본 tasks.md는 Phase B-E + M6 (신규 route handlers) 범위.

| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| T-SETUP-A | M5 managed_building_id 통일 + AUTH 회귀 | REQ-018,019, AC-020,021,022,023 | - | migrations/005_managed_building_unify.sql, src/lib/migration-001.test.ts, src/lib/migration-005.test.ts | done (0608777) |
| T-SETUP-B | M1 동 관리 CRUD + M6 공개 조회 | REQ-001,002,003,004a,004b,020, AC-001~005,024, EC-001,002,006,007 | T-SETUP-A | src/app/api/setup/buildings/route.ts, src/app/api/setup/buildings/[id]/route.ts, src/app/api/setup/buildings/route.test.ts, src/app/api/setup/buildings/[id]/route.test.ts, src/middleware.ts (matcher 예외) | pending |
| T-SETUP-C | M2 호수 일괄 업데이트 | REQ-005,006,007,007a,008a,008b, AC-006~009b, EC-003 | T-SETUP-B | src/app/api/setup/buildings/[id]/units/route.ts, src/app/api/setup/buildings/[id]/units/route.test.ts | pending |
| T-SETUP-D | M3 직책 부여/회수 | REQ-009,010,011,012,013a,013b, AC-010~015b, EC-004,005 | T-SETUP-B | src/app/api/setup/users/[id]/role/route.ts, src/app/api/setup/users/[id]/role/route.test.ts | pending |
| T-SETUP-E | M4 회원 목록 조회 | REQ-014,015,016a,016b,017, AC-016~019 | T-SETUP-D | src/app/api/setup/users/route.ts, src/app/api/setup/users/route.test.ts | pending |
| T-SETUP-V | 최종 검증 + develop 머지 준비 | 전체 AC | T-SETUP-B,C,D,E | - | pending |

## 재사용 파일 (AUTH 소유, 수정 없음)
- src/lib/db.ts (query, withTransaction)
- src/lib/auth.ts (verifyAccessToken)
- src/lib/cookies.ts (ACCESS_COOKIE_NAME)
- AUTH RBAC 패턴: src/app/api/auth/users/[id]/deactivate/route.ts

## 정책 결정 (Plan Review 확정)
1. GET /api/setup/buildings 공개: middleware matcher 예외. POST/DELETE 인증은 route handler 내부 verifyAccessToken 강제.
2. 401 vs 403: 미인증(토큰 누락/만료/변조)=401; 인증됨-권한불일치=403. 모든 SETUP RBAC 일관 적용.
3. 회장 단일성: withTransaction + SELECT ... FOR UPDATE 로 원자적 기존 회장 회수 (EC-004 race 방어).
4. CHAIR 권한 범위: RESIDENT/REP/AUDITOR 부여만 허용; ADMIN 부여 시 403 (REQ-012).
5. REP 부여 시 managed_building_id 필수 누락 422 (REQ-011).
6. password_hash 미노출: SELECT 절에서 명시적 컬럼 열거 (REQ-015).
