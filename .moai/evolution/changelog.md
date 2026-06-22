# MoAI Evolution Changelog

All notable skill evolutions and learning graduations will be documented here.

## Format

Each entry: date, learning ID, skill affected, change summary.

---

## [2026-06-22] SPEC-NOTICE-001 P0 완료 — 공지사항 (등록/수정/삭제/열람)

### 개요
NOTICE 도메인 P0 범위(NOTICE-01 공지 등록, NOTICE-02 공지 수정, NOTICE-03 공지 삭제, NOTICE-04 공지 목록 열람, NOTICE-05 공지 상세 열람) 완성 및 카테고리 시드 마이그레이션 완료. develop 브랜치에 squash-merge 완료 (커밋 84b5923).

### 구현 엔드포인트 (5개)
1. **GET /api/notices** (인증 사용자) — 공지 목록 조회, category_id 필터 + 페이지네이션, created_at DESC (REQ-NOTICE-011)
2. **POST /api/notices** (ADMIN) — 공지 등록, 201/422(category_id 미존재) (REQ-NOTICE-001, REQ-NOTICE-002)
3. **GET /api/notices/[id]** (인증 사용자) — 공지 상세 조회, content 포함 (REQ-NOTICE-014, REQ-NOTICE-015)
4. **PUT /api/notices/[id]** (ADMIN) — 공지 수정, 404/422 (REQ-NOTICE-004, REQ-NOTICE-006)
5. **DELETE /api/notices/[id]** (ADMIN) — 공지 영구 삭제(hard delete), 404 (REQ-NOTICE-008, REQ-NOTICE-009)

### 핵심 설계 결정
- **route-level Bearer 강제**: middleware.ts는 AT 쿠키만 검사, GET/POST/PUT/DELETE 핸들러 내부에서 verifyAccessToken 직접 호출 (AUTH verify-unit 패턴 일관)
- **목록 content 구조적 배제**: GET 목록 응답에 content 미포함, 상세 GET에서만 포함 (REQ-NOTICE-012)
- **category_id FK 사전 차단**: 등록/수정 시 notice_categories 존재 확인 후 422 반환 (FK 에러 사전 방지)
- **UUID path 검증**: [id] path param에 UUID_REGEX 검증, 불일치 시 400 (EC-NOTICE-003)
- **is_pinned 전방 호환성**: notices 테이블에 is_pinned 컬럼 존재(디폴트 false), 본 SPEC은 API 동작 미노출(NOTICE-06 P1 별도 SPEC)

### 품질 검증 결과
- **테스트**: 333/333 통과 (기존 290 + 신규 43: migration 11, route 32)
- **타입**: `tsc --noEmit` 0 에러
- **린트**: ESLint 0 경고
- **보안**: OWASP CLEAN (RBAC/SQL Injection/UUID 검증 전부 코드 레벨 확인)
- **커버리지**: NOTICE route 93.45% lines (임계 85% 충족)

### 알려진 제한사항 (후속 추적)
1. **첨부파일(attachments) 미구현**: 본 SPEC 범위 완전 제외 — 파일 저장소 백엔드 결정 후 별도 ADR/SPEC 필요
2. **NOTICE-06 상단 고정 미구현**: is_pinned 컬럼 존재(디폴트 false), API 동작 없음 — P1 별도 SPEC 필요
3. **NOTICE-07 카테고리 동적 CRUD 미구현**: 4종(일반/긴급/주차/시설) 고정 시드 — P1 별도 SPEC 필요
4. **notices.author_id FK ON DELETE 미정의**: ADMIN 강제 탈퇴 시 FK 위반 가능 — 38세대 소규모로 본 범위 외

### 생성 파일
- `migrations/006_notices.sql` — M6 스키마 (notice_categories 시드 + notices 테이블)
- `src/app/api/notices/route.ts` — GET 목록 + POST 등록
- `src/app/api/notices/[id]/route.ts` — GET 상세 + PUT 수정 + DELETE 삭제
- `src/lib/migration-006.test.ts` — M6 마이그레이션 검증 (11 tests)
- `src/app/api/notices/route.test.ts` — 목록/등록 검증 (16 tests)
- `src/app/api/notices/[id]/route.test.ts` — 상세/수정/삭제 검증 (16 tests)

### 수정 파일
- 없음 (독립 테이블, AUTH/SETUP 스키마 무영향)

### 의존성
- **SPEC-AUTH-001 P0**: `users` 스키마(FK author_id) 및 `src/lib` (db, auth, rbac) 재사용
- **SPEC-SETUP-001 P0**: RBAC 헬퍼(requireAdmin, 응답 빌더) 재사용

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
