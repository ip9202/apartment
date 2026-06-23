# SPEC-INTEGRATION-AUTH-001 Task Decomposition

Phase 1.5 Output - Generated: 2026-06-23
Mode: TDD (RED-GREEN-REFACTOR)

## Executive Summary

Total Tasks: 10
Backend: 2 | Frontend: 8
New Files: 4 | Modified Files: 7

## Task List (Execution Order)

### Phase 1: Backend Foundation (Tasks 1-2)

**Task 1: 세션 복원 엔드포인트 구현 (/api/auth/me)**
- File: `src/app/api/auth/me/route.ts` (NEW)
- Acceptance: AC-AUTH-INT-001, AC-AUTH-INT-002
- Dependencies: None
- TDD approach: RED (200 OK response test) → GREEN (implement) → REFACTOR (extract verify logic)

**Task 2: 데모 계정 시딩 추가**
- File: `scripts/seed.ts` (MODIFY)
- Acceptance: AC-AUTH-INT-003
- Dependencies: Task 1
- TDD approach: RED (user count test) → GREEN (seed demo accounts) → REFACTOR (extract seed function)

### Phase 2: Frontend Foundation (Tasks 3-4)

**Task 3: 공유 API 클라이언트 라이브러리 구현**
- File: `src/lib/auth.ts` (NEW)
- Acceptance: AC-AUTH-INT-004, AC-AUTH-INT-005
- Dependencies: Task 1
- TDD approach: RED (API contract test) → GREEN (implement fetch wrappers) → REFACTOR (error handling)

**Task 4: useAuth 공유 훅 구현**
- File: `src/hooks/useAuth.ts` (NEW)
- Acceptance: AC-AUTH-INT-006, AC-AUTH-INT-007, AC-AUTH-INT-008
- Dependencies: Task 3
- TDD approach: RED (hook state test) → GREEN (implement hook) → REFACTOR (extract context)

### Phase 3: Viewport Integration (Tasks 5-7)

**Task 5: MobileApp 하드코딩 제거 및 API 연동**
- File: `src/components/MobileApp.tsx` (MODIFY)
- Acceptance: AC-AUTH-INT-009
- Dependencies: Task 4
- TDD approach: RED (login integration test) → GREEN (replace doLogin) → REFACTOR (cleanup)

**Task 6: TabletApp 하드코딩 제거 및 API 연동**
- File: `src/components/TabletApp.tsx` (MODIFY)
- Acceptance: AC-AUTH-INT-010
- Dependencies: Task 4
- TDD approach: RED (login integration test) → GREEN (replace doLogin) → REFACTOR (cleanup)

**Task 7: DesktopApp 하드코딩 제거 및 API 연동**
- File: `src/components/DesktopApp.tsx` (MODIFY)
- Acceptance: AC-AUTH-INT-011
- Dependencies: Task 4
- TDD approach: RED (login integration test) → GREEN (replace doLogin) → REFACTOR (cleanup)

### Phase 4: Feature Integration (Tasks 8-10)

**Task 8: signup 화면 API 연동**
- Files: All 3 viewport components (MODIFY)
- Acceptance: AC-AUTH-INT-012
- Dependencies: Task 4
- TDD approach: RED (signup API call test) → GREEN (integrate signup) → REFACTOR (error display)

**Task 9: verify-unit 화면 API 연동**
- Files: All 3 viewport components (MODIFY)
- Acceptance: AC-AUTH-INT-013
- Dependencies: Task 4
- TDD approach: RED (verify API call test) → GREEN (integrate verify) → REFACTOR (role update)

**Task 10: logout 기능 API 연동**
- Files: All 3 viewport components (MODIFY)
- Acceptance: AC-AUTH-INT-014
- Dependencies: Task 4
- TDD approach: RED (logout API call test) → GREEN (integrate logout) → REFACTOR (cleanup)

## File Impact Summary

### New Files (4)
1. `src/app/api/auth/me/route.ts` - Session restore endpoint
2. `src/lib/auth.ts` - Auth API client library
3. `src/hooks/useAuth.ts` - Shared auth hook
4. Test files for each new file

### Modified Files (7)
1. `scripts/seed.ts` - Add demo account seeding
2. `src/components/MobileApp.tsx` - Remove hardcoded login
3. `src/components/TabletApp.tsx` - Remove hardcoded login
4. `src/components/DesktopApp.tsx` - Remove hardcoded login
5. Viewport signup forms - Connect to API
6. Viewport verify forms - Connect to API
7. Viewport logout buttons - Connect to API

## Architecture Decisions

1. **React Context for useAuth**: Single source of truth for auth state across all viewports
2. **jose for JWT verification**: Consistent with middleware.ts JWT_SECRET
3. **httpOnly cookie handling**: Backend reads at, frontend cannot (by design)
4. **Bearer AT for verify-unit**: Authorization header pattern
5. **Demo account preservation**: Keep resident@aitteulak.com and admin@aitteulak.com for testing

## Risk Assessment

- **Medium Risk**: LSP errors in TabletApp.tsx need resolution before Task 6
- **Low Risk**: Backend tasks (1-2) are straightforward CRUD
- **Medium Risk**: Frontend tasks depend on proper Context implementation
- **Low Risk**: Test coverage with TDD methodology

## Quality Gates

- TDD RED-GREEN-REFACTOR cycle for each task
- 85%+ code coverage target (quality.yaml)
- Zero LSP errors before Phase 2 completion
- All AC-AUTH-INT-001 through AC-AUTH-INT-014 passing

## Next Step

Decision Point 1: User approval for implementation plan.
