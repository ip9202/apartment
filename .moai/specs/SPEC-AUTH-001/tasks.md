---
spec_id: "SPEC-AUTH-001"
title: "인증 (Authentication) 시스템 — TDD 작업 분해"
phase: "plan"
sub_phase: "1.5-task-decomposition"
status: "draft"
created: "2026-06-21"
updated: "2026-06-21"
author: "강력쇠주먹"
priority: "P0"
development_mode: "tdd"
coverage_verified: true
task_count: 13
---

# SPEC-AUTH-001 Task Decomposition (Phase 1.5)

본 문서는 `plan.md` Phase A-F (P0 백엔드 범위) 를 원자적 TDD 사이클(RED-GREEN-REFACTOR) 단위로 분해한다.

## 적용된 정책 결정 (6종)

| ID | 결정 | 적용 태스크 |
|----|------|-------------|
| Q1 | 재인증 시도(이미 인증된 사용자) → 409 CONFLICT | TASK-AUTH-011 |
| Q2 | 재탈퇴(이미 INACTIVE) → 200 idempotent | TASK-AUTH-013 |
| Q3 | RT 재사용 갱신 허용 (사용 후 블랙리스트 등록 안 함) | TASK-AUTH-010 |
| Q4 | 만료 RT 블랙리스트 보존 (정리 cron 없음) | TASK-AUTH-004 |
| UI | thin stubs P1 지연 (P0 백엔드 차단 없음) | Phase G 제외 |
| MW | verify-unit 성공 시 verified:true fresh AT 재발급 | TASK-AUTH-011, 012 |

## 범위 결정

- **포함**: Phase A (기반 인프라), B (회원가입), C (로그인/로그아웃), D (토큰 갱신), E (동/호수 인증 + 미들웨어), F (강제 탈퇴 — P0)
- **제외 (P1 지연)**: Phase G (UI 페이지 — thin stubs)
- **제외 (품질 게이트)**: Phase H (통합/E2E) — Run Phase 2.x 품질 게이트에서 별도 수행, REQ 매핑 없음

---

## 작업 분해 테이블

| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| TASK-AUTH-001 | PostgreSQL 연결 풀 구현 (`db.ts`). pg Pool 래퍼, 환경 변수 로딩, 쿼리 실행. 모든 DB 접근 경로의 기반 (fan_in >= 3 → @MX:ANCHOR). | REQ-AUTH-001 ~ 016 (공통 기반) | (없음) | `src/lib/db.ts`, `src/lib/db.test.ts`, `.env.example` | pending |
| TASK-AUTH-002 | JWT 토큰 발급/검증 함수 구현 (`auth.ts` — JWT 파트). `signAccessToken` (HS256, 15분), `signRefreshToken` (HS256, 7일, jti 포함), `verifyAccessToken`, `verifyRefreshToken`. AT/RT 디코딩 후 alg=HS256 및 exp delta 단정 (AC-AUTH-027/028). 인증 타입 정의 포함. fan_in >= 3 → @MX:ANCHOR. | REQ-AUTH-004, REQ-AUTH-008 | TASK-AUTH-001 | `src/lib/auth.ts`, `src/lib/auth.test.ts`, `src/types/auth.ts` | pending |
| TASK-AUTH-003 | bcrypt 해시 함수 구현 (`auth.ts` — bcrypt 파트). `hashPassword` (salt rounds 12 고정), `comparePassword`. salt rounds 상수화 `BCRYPT_SALT_ROUNDS = 12`. @MX:WARN + @MX:REASON (비밀번호 보안 핵심). | REQ-AUTH-002 | TASK-AUTH-002 | `src/lib/auth.ts` (확장), `src/lib/auth.bcrypt.test.ts` | pending |
| TASK-AUTH-004 | 마이그레이션 002: `revoked_refresh_tokens` 테이블 생성. token_jti/token_hash/user_id/revoked_at/expires_at 컬럼, 인덱스(token_hash, user_id, expires_at). Q4 정책: 만료 RT 보존 (정리 cron 제외). Idempotent (IF NOT EXISTS). @MX:WARN (RT 블랙리스트 누락 시 탈취 토큰 재사용). | REQ-AUTH-007, REQ-AUTH-009, REQ-AUTH-014 | TASK-AUTH-001 | `migrations/002_revoked_refresh_tokens.sql`, `migrations/002.test.ts` | pending |
| TASK-AUTH-005 | 마이그레이션 003: `login_attempts` 테이블 생성. email/failed_count/locked_until/last_attempt_at 컬럼, email 인덱스. Idempotent. DB 기반 Rate Limiting 추적 (서버 재시작 후에도 잠금 상태 유지). | REQ-AUTH-006 | TASK-AUTH-001 | `migrations/003_login_attempts.sql`, `migrations/003.test.ts` | pending |
| TASK-AUTH-006 | 회원가입 API route 구현 (`POST /api/auth/signup`). 이메일 중복 검사 (→ 409), 이메일 형식 검증 (→ 422), 비밀번호 정책 (8자+ 영문/숫자, → 422), password_confirm 일치 (→ 422), bcrypt 해시 적용, `role=RESIDENT` `verified=false` 로 레코드 생성 (→ 201). REFACTOR: 유효성 검증 로직 `validators.ts` 분리. @MX:NOTE (회원가입→인증 이동 플로우). @MX:TODO (`provider="email"` 기본값, AUTH-02 연결). | REQ-AUTH-001, REQ-AUTH-002, REQ-AUTH-003 | TASK-AUTH-003 | `src/app/api/auth/signup/route.ts`, `src/app/api/auth/signup/route.test.ts`, `src/lib/validators.ts`, `src/lib/validators.test.ts` | pending |
| TASK-AUTH-007 | Rate Limiting 라이브러리 구현 (`rate-limit.ts`). `recordFailedAttempt`, `isLocked`, `resetAttempts`, `getLockStatus`. 임계값 `MAX_FAILED_ATTEMPTS = 5`, 잠금 `LOCK_DURATION_MINUTES = 10`. 1-4회 실패 카운트 증가, 5회 실패 시 locked_until 설정, 잠금 중 429, 성공 시 카운트 초기화. @MX:WARN (임계치 오설정 시 브루트포스 허용). | REQ-AUTH-006 | TASK-AUTH-005 | `src/lib/rate-limit.ts`, `src/lib/rate-limit.test.ts` | pending |
| TASK-AUTH-008 | 로그인 API route 구현 (`POST /api/auth/login`). Rate Limit 연동, 존재하지 않는 이메일/비밀번호 불일치 → 동일 메시지 401 (REQ-AUTH-005 사용자 열거 방지), 5회 실패/잠금 중 → 429, 미인증 회원 → 200 + `verified=false`. 성공 시 AT 응답 본문 + RT httpOnly 쿠키 설정 (AC-AUTH-029 쿠키 속성 단정). @MX:WARN (JWT 서명). | REQ-AUTH-004, REQ-AUTH-005, REQ-AUTH-006 | TASK-AUTH-002, TASK-AUTH-003, TASK-AUTH-007 | `src/app/api/auth/login/route.ts`, `src/app/api/auth/login/route.test.ts` | pending |
| TASK-AUTH-009 | 로그아웃 API route 구현 (`POST /api/auth/logout`). RT jti 추출, `revoked_refresh_tokens` INSERT, RT 쿠키 만료 삭제. 미인증 요청 → 401. REFACTOR: 토큰 폐기 공통 함수 `revokeRefreshToken` 추출. @MX:WARN (RT 블랙리스트 등록). | REQ-AUTH-007 | TASK-AUTH-002, TASK-AUTH-004 | `src/app/api/auth/logout/route.ts`, `src/app/api/auth/logout/route.test.ts` | pending |
| TASK-AUTH-010 | 토큰 갱신 API route 구현 (`POST /api/auth/refresh`). 쿠키에서 RT 추출, 블랙리스트 조회 (`isTokenRevoked`), 유효 RT → 새 AT 발급 (200), 만료/블랙리스트 RT → 401, RT 없음 → 401. Q3 정책: RT 재사용 갱신 허용 (갱신 후 RT 블랙리스트 등록 안 함, 회전 없음). REFACTOR: `isTokenRevoked` 함수 추출. | REQ-AUTH-008, REQ-AUTH-009 | TASK-AUTH-002, TASK-AUTH-004, TASK-AUTH-009 | `src/app/api/auth/refresh/route.ts`, `src/app/api/auth/refresh/route.test.ts` | pending |
| TASK-AUTH-011 | 동/호수 인증 API route 구현 (`POST /api/auth/verify-unit`). units 조회, 중복 검사 (Q1: 이미 verified 사용자 재인증 → 409 CONFLICT / REQ-AUTH-012 동일 호수 중복 → 409), 미존재 building_id/unit_id 또는 building-unit 불일치 → 422 (REQ-AUTH-010a), 미인증 사용자 → 401, REP 역할 시 `users.managed_building_id` 자동 연결 (REQ-AUTH-011, SETUP 마이그레이션 미선행 시 stub), `verified_at` 갱신, 성공 시 `verified:true` fresh AT 재발급 (MW 정책). @MX:NOTE (REP managed_building, 비공개 건의 열람 권한 위임 기반). | REQ-AUTH-010, REQ-AUTH-010a, REQ-AUTH-011, REQ-AUTH-012 | TASK-AUTH-002, TASK-AUTH-001 | `src/app/api/auth/verify-unit/route.ts`, `src/app/api/auth/verify-unit/route.test.ts` | pending |
| TASK-AUTH-012 | 미들웨어 구현 (`middleware.ts`). JWT 검증, verified 상태 확인, 미인증 회원(`/verified=false`)의 `/notices` 등 메인 접근 → `/verify` 리다이렉트, 비로그인 사용자 → `/login` 리다이렉트, 인증 완료 회원 정상 진입. verify-unit 성공 후 fresh AT(verified:true) 전파 지원. RBAC 정책 테이블화 `rbac-policy.ts`. fan_in >= 3 → @MX:ANCHOR. 비-ADMIN 역할의 ADMIN 전용 엔드포인트 접근 → 403 (REQ-AUTH-016 부분). | REQ-AUTH-013, REQ-AUTH-016 | TASK-AUTH-002 | `src/lib/middleware.ts`, `src/lib/middleware.test.ts`, `src/lib/rbac-policy.ts`, `src/lib/rbac-policy.test.ts` | pending |
| TASK-AUTH-013 | 강제 탈퇴 API route 구현 (`POST /api/auth/users/[id]/deactivate`). 단일 트랜잭션(BEGIN/COMMIT/ROLLBACK) 내 5단계 원자적 처리: (1) `status=INACTIVE`, (2) 건의 `archived=true`/`author_label="전 입주민"`/`author_id=NULL` (suggestions.unit_id 유지, ADR-005 준거), (3) `role=RESIDENT` 환원, (4) `unit_id=NULL`/`verified_at=NULL`, (5) RT 일괄 블랙리스트 등록. ADMIN 자체 탈퇴 → 403 (REQ-AUTH-015). 비-ADMIN RBAC → 403 (REQ-AUTH-016). Q2 정책: already-INACTIVE 재탈퇴 → 200 idempotent. 트랜잭션 중간 실패 → 전체 롤백. REFACTOR: 건의 아카이브 로직 `suggest-archive.ts` 분리 (AUTH-06 재사용 대비). @MX:NOTE (5단계 원자적 처리 트랜잭션 경계). @MX:WARN. | REQ-AUTH-014, REQ-AUTH-015, REQ-AUTH-016 | TASK-AUTH-004, TASK-AUTH-009, TASK-AUTH-012 | `src/app/api/auth/users/[id]/deactivate/route.ts`, `src/app/api/auth/users/[id]/deactivate/route.test.ts`, `src/lib/suggest-archive.ts`, `src/lib/suggest-archive.test.ts` | pending |

---

## 커버리지 검증

### REQ → Task 매핑

| REQ ID | 1차 Task | 비고 |
|--------|----------|------|
| REQ-AUTH-001 (이메일 중복 검사) | TASK-AUTH-006 | |
| REQ-AUTH-002 (평문 비밀번호 저장 금지) | TASK-AUTH-003, TASK-AUTH-006 | 해시 함수 + 적용 |
| REQ-AUTH-003 (가입 성공 → 인증 화면) | TASK-AUTH-006 | 백엔드 201 응답 (UI 리다이렉트는 P1 Phase G) |
| REQ-AUTH-004 (로그인 토큰 발급) | TASK-AUTH-008 | |
| REQ-AUTH-005 (자격증명 오류 메시지 통일) | TASK-AUTH-008 | |
| REQ-AUTH-006 (5회 실패 10분 잠금) | TASK-AUTH-007, TASK-AUTH-008 | 추적 라이브러리 + route 연동 |
| REQ-AUTH-007 (로그아웃 RT 블랙리스트) | TASK-AUTH-009 | |
| REQ-AUTH-008 (RT로 AT 갱신) | TASK-AUTH-010 | |
| REQ-AUTH-009 (블랙리스트/만료 RT 거부) | TASK-AUTH-010 | |
| REQ-AUTH-010 (인증 성공 → verified=true) | TASK-AUTH-011 | |
| REQ-AUTH-010a (미존재 building/unit → 422) | TASK-AUTH-011 | |
| REQ-AUTH-011 (REP managed_building 자동 연결) | TASK-AUTH-011 | |
| REQ-AUTH-012 (동일 호수 중복 → 409) | TASK-AUTH-011 | Q1 재인증 409 정책 포함 |
| REQ-AUTH-013 (미인증 회원 메인 접근 차단) | TASK-AUTH-012 | |
| REQ-AUTH-014 (ADMIN 강제 탈퇴 원자적) | TASK-AUTH-013 | |
| REQ-AUTH-015 (ADMIN 자체 탈퇴 금지 403) | TASK-AUTH-013 | |
| REQ-AUTH-016 (비-ADMIN RBAC 403) | TASK-AUTH-012, TASK-AUTH-013 | 미들웨어 RBAC + deactivate route |

모든 REQ-AUTH ID (001 ~ 016 + 010a = 17개) 가 1개 이상 태스크에 매핑됨. **coverage_verified = true**.

### Planned File → Task 매핑

| Planned File (plan.md §2) | Task |
|---------------------------|------|
| `src/lib/db.ts` | TASK-AUTH-001 |
| `src/lib/auth.ts` | TASK-AUTH-002 (JWT), TASK-AUTH-003 (bcrypt) |
| `src/lib/middleware.ts` | TASK-AUTH-012 |
| `src/lib/rate-limit.ts` | TASK-AUTH-007 |
| `src/lib/validators.ts` | TASK-AUTH-006 (REFACTOR 산출물) |
| `src/lib/rbac-policy.ts` | TASK-AUTH-012 (REFACTOR 산출물) |
| `src/lib/suggest-archive.ts` | TASK-AUTH-013 (REFACTOR 산출물) |
| `src/app/api/auth/signup/route.ts` | TASK-AUTH-006 |
| `src/app/api/auth/login/route.ts` | TASK-AUTH-008 |
| `src/app/api/auth/logout/route.ts` | TASK-AUTH-009 |
| `src/app/api/auth/refresh/route.ts` | TASK-AUTH-010 |
| `src/app/api/auth/verify-unit/route.ts` | TASK-AUTH-011 |
| `src/app/api/auth/users/[id]/deactivate/route.ts` | TASK-AUTH-013 |
| `migrations/002_revoked_refresh_tokens.sql` | TASK-AUTH-004 |
| `migrations/003_login_attempts.sql` | TASK-AUTH-005 |
| `src/types/auth.ts` | TASK-AUTH-002 |
| `src/app/(auth)/login/page.tsx` | (P1 지연 — Phase G) |
| `src/app/(auth)/signup/page.tsx` | (P1 지연 — Phase G) |
| `src/app/(auth)/verify/page.tsx` | (P1 지연 — Phase G) |

P0 백엔드 planned files 100% 매핑. UI 3개 파일은 P1 Phase G로 지연 (사용자 결정에 따름).

---

## Phase별 태스크 집계

| Phase | 범위 | Task 수 | Task IDs |
|-------|------|:-------:|----------|
| A | 기반 인프라 (DB, JWT, bcrypt, migrations) | 5 | TASK-AUTH-001 ~ 005 |
| B | 회원가입 (AUTH-01) | 1 | TASK-AUTH-006 |
| C | 로그인/로그아웃 (AUTH-03) | 3 | TASK-AUTH-007 ~ 009 |
| D | 토큰 갱신 (M3) | 1 | TASK-AUTH-010 |
| E | 동/호수 인증 + 미들웨어 (AUTH-04) | 2 | TASK-AUTH-011, 012 |
| F | 강제 탈퇴 (AUTH-07) | 1 | TASK-AUTH-013 |
| **합계** | | **13** | |

---

## 의존성 그래프

```
TASK-AUTH-001 (db)
  ├── TASK-AUTH-002 (JWT) ─── TASK-AUTH-003 (bcrypt)
  │     ├── TASK-AUTH-008 (login) ◄── TASK-AUTH-007 (rate-limit) ◄── TASK-AUTH-005 (mig login_attempts)
  │     ├── TASK-AUTH-009 (logout) ◄── TASK-AUTH-004 (mig RT blacklist)
  │     │     └── TASK-AUTH-010 (refresh)
  │     ├── TASK-AUTH-011 (verify-unit)
  │     └── TASK-AUTH-012 (middleware)
  │           └── TASK-AUTH-013 (deactivate) ◄── TASK-AUTH-009, TASK-AUTH-004
  ├── TASK-AUTH-006 (signup) ◄── TASK-AUTH-003
  └── TASK-AUTH-004, TASK-AUTH-005 (migrations)
```

순환 의존성 없음. 위상 정렬 가능.

---

*본 tasks.md는 Phase 1.5 (Task Decomposition) 산출물이며, Phase 1.7 (Scaffolding) 및 Phase 2B (TDD 구현)의 기준 문서로 사용된다.*
