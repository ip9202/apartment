# MoAI Evolution Changelog

All notable skill evolutions and learning graduations will be documented here.

## Format

Each entry: date, learning ID, skill affected, change summary.

---

## [2026-06-22] SPEC-SETUP-001 P0 완료 — 단지 설정 (동/호수/직책/회원 관리)

### 개요
SETUP 도메인 P0 범위(SETUP-01 동 관리, SETUP-02 호수 관리, SETUP-04 직책 부여/변경/회수, SETUP-05 회원 목록 조회, M6 공개 조회) 완성 및 cross-SPEC 스키마 정리(`managed_building_id` 단일 출처 통일). develop 브랜치에 squash-merge 완료 (커밋 bb7b3f4).

### 구현 엔드포인트 (5개)
1. **GET /api/setup/buildings** (공개) — 동/호수 목록 조회, 비인증 허용 (REQ-SETUP-020)
2. **POST /api/setup/buildings** (ADMIN) — 동 추가, 201/409/422 (REQ-SETUP-001, REQ-SETUP-002)
3. **DELETE /api/setup/buildings/[id]** (ADMIN) — 동 삭제, 활성 입주민 존재 시 409 (REQ-SETUP-003)
4. **PUT /api/setup/buildings/[id]/units** (ADMIN) — 호수 일괄 업데이트 (diff 트랜잭션), 활성 입주민 409 (REQ-SETUP-005, REQ-SETUP-006)
5. **GET /api/setup/users** (ADMIN) — 회원 목록 조회, building/role/page/limit/status 필터, password_hash 구조적 배제 (REQ-SETUP-014, REQ-SETUP-015)
6. **PUT /api/setup/users/[id]/role** (ADMIN/CHAIR) — 직책 부여/회수, 회장 단일성 FOR UPDATE (REQ-SETUP-009, REQ-SETUP-010)

### 핵심 설계 결정
- **회장 단일성 보장**: `SELECT ... FOR UPDATE`로 동시성 방어 (REQ-SETUP-010, EC-SETUP-004)
- **password_hash 구조적 배제**: 명시적 컬럼 열거로 절대 노출 방지 (REQ-SETUP-015)
- **public GET matcher 예외**: `GET /api/setup/buildings`만 비인증 허용, POST/DELETE는 핸들러 내부 인증 강제 (REQ-SETUP-020)
- **REP managed_building_id 단일 출처**: M5 마이그레이션으로 `roles.managed_building_id` 제거, `users`로 단일화 (REQ-SETUP-018, REQ-SETUP-019)
- **diff 트랜잭션 멱등성**: 호수 배열 = 최종 목표 상태, 빈 배열 = 전체 삭제 (REQ-SETUP-005)

### 품질 검증 결과
- **테스트**: 290/290 통과 (buildings 19, units 17, role 15, users 16)
- **타입**: `tsc --noEmit` 0 에러
- **린트**: ESLint 0 경고
- **보안**: OWASP CLEAN (SQL injection/password_hash/RBAC/FOR UPDATE 전부 코드 레벨 확인)
- **커버리지**: 85%+ 목표 달성

### 알려진 제한사항 (후속 추적)
1. **INACTIVE 입주민 FK 차단**: INACTIVE 입주민이 `unit_id`로 귀속된 동/호수 삭제 시 FK RESTRICT로 409 반환 ( misleading message). AUTH 강제탈퇴(`deactivate`) 정책과 조율 필요 (non-blocking).
2. **감사 로깅 미구현**: 401/403 이벤트 로깅 없음 — 모니터링 권장 (expert-security A09).
3. **ast-grep gate**: sgconfig 미비로 scan 불가 — 인프라 후속.

### 생성 파일
- `migrations/005_managed_building_unify.sql` — M5 스키마 정리
- `src/app/api/setup/buildings/route.ts` — GET 공개 + POST ADMIN
- `src/app/api/setup/buildings/[id]/route.ts` — DELETE ADMIN
- `src/app/api/setup/buildings/[id]/units/route.ts` — PUT ADMIN (호수 diff)
- `src/app/api/setup/users/route.ts` — GET ADMIN (필터 지원)
- `src/app/api/setup/users/[id]/role/route.ts` — PUT ADMIN/CHAIR (직책 부여)
- `src/lib/rbac.ts` — 공통 RBAC 헬퍼 (requireAdmin, requirePrivileged, 응답 생성)
- `src/middleware.ts` — matcher 예외 업데이트 (GET buildings 공개)

### 수정 파일
- AUTH `src/lib/migration-001.test.ts` — `assertColumnsExist` roles 블록에서 `managed_building_id` 제거 (M5 영향)

### 의존성
- **SPEC-AUTH-001 P0**: `buildings`/`units`/`roles`/`users` 스키마 및 `src/lib` 재사용
- **AUTH 회귀**: AC-AUTH-015 (REP 인증) 및 migration-001.test.ts roles 블록 업데이트 통과 확인

---
