---
spec_id: "SPEC-AUTH-001"
title: "인증 (Authentication) 시스템 구현 계획"
phase: "plan"
status: "draft"
created: "2026-06-21"
updated: "2026-06-21"
author: "강력쇠주먹"
priority: "P0"
issue_number: 0
---

# SPEC-AUTH-001 Implementation Plan

본 문서는 `spec.md`에 정의된 AUTH 도메인 P0 요구사항을 TDD(RED-GREEN-REFACTOR)로 구현하기 위한 계획을 제시한다. 구현 디테일(함수명, 클래스 구조, 정확한 API 스키마)은 Run Phase에서 확정하되, 본 계획은 파일 구조, DB 스키마, 기술 결정, 리스크 완화를 명시한다.

---

## 1. 기술 스택 (Constitution 준수)

| 항목 | 기술 | 버전 | 근거 |
|------|------|------|------|
| 프레임워크 | Next.js | 15 (App Router) | `.moai/project/tech.md` ADR-001 |
| 데이터베이스 | PostgreSQL | 15 (Railway Managed) | ADR-002 |
| 스키마 관리 | 마이그레이션 스크립트 | SQL 기반 | ERD + 본 SPEC 신규 테이블 |
| 인증 토큰 | jsonwebtoken | 최신 안정 | ADR-003 |
| 비밀번호 해시 | bcrypt | salt rounds 12 | ADR-003, 보안설계 §2 |
| 쿠키 | httpOnly + secure + sameSite=strict | 네이티브 | ADR-003, CSRF 방지 |
| 언어 | TypeScript | Next.js 15 기본 | ADR-001 |
| 런타임 | Node.js | 20 이상 | tech.md |

---

## 2. 파일 생성 목록

Run Phase에서 다음 파일을 생성한다. greenfield이므로 모든 파일이 신규 생성된다.

### 2.1 API Route Handlers (`src/app/api/auth/`)

```
src/app/api/auth/
├── signup/route.ts                              # AUTH-01 회원가입
├── login/route.ts                               # AUTH-03 로그인
├── logout/route.ts                              # AUTH-03 로그아웃
├── refresh/route.ts                             # M3 토큰 갱신
├── verify-unit/route.ts                         # AUTH-04 동/호수 인증
└── users/[id]/deactivate/route.ts               # AUTH-07 강제 탈퇴 (신규 엔드포인트)
```

### 2.2 라이브러리 (`src/lib/`)

```
src/lib/
├── db.ts                                        # PostgreSQL 연결 풀 (공통)
├── auth.ts                                      # JWT 발급/검증/갱신, bcrypt 해시/비교
├── middleware.ts                                # 인증·권한(RBAC) 검증 미들웨어
└── rate-limit.ts                                # 로그인 시도 추적/잠금 (DB 기반)
```

### 2.3 DB 마이그레이션 (`migrations/` 또는 `prisma/migrations/`)

```
migrations/
├── 001_init_users_buildings_units_roles.sql     # ERD 기반 핵심 테이블 (선행)
├── 002_revoked_refresh_tokens.sql               # 본 SPEC 신규 — RT 블랙리스트
└── 003_login_attempts.sql                       # 본 SPEC 신규 — Rate Limiting 추적
```

> 마이그레이션 001은 본 SPEC 범위에서 "이미 존재한다고 가정"한다 (Dependencies). 단, 테스트 환경 구성을 위해 seed 스크립트는 본 SPEC 책임.

### 2.4 UI 페이지 (`src/app/(auth)/`)

```
src/app/(auth)/
├── login/page.tsx                               # 로그인 화면
├── signup/page.tsx                              # 회원가입 화면
└── verify/page.tsx                              # 동/호수 인증 화면
```

### 2.5 타입 정의 (`src/types/`)

```
src/types/
└── auth.ts                                      # 인증 관련 TypeScript 타입 (User, Token, API 응답 등)
```

### 2.6 테스트 (`src/__tests__/` 또는 `tests/`)

Run Phase TDD에 따라 각 모듈별 `.test.ts` 파일 생성. 자세한 목록은 §4 TDD 작업 분해 참조.

---

## 3. 신규 DB 테이블 스키마

### 3.1 `revoked_refresh_tokens` (RT 블랙리스트 — 본 SPEC 도입)

목적: ADR-003 트레이드오프(무상태 JWT의 즉시 무효화 한계) 해결. 로그아웃 및 강제 탈퇴 시 RT를 등록하여 재사용 차단.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | UUID | PK, DEFAULT gen_random_uuid() | |
| token_jti | VARCHAR(255) | NOT NULL, UNIQUE | JWT의 jti 클레임 (토큰 식별자) |
| token_hash | VARCHAR(255) | NOT NULL | 토큰 전체 해시 (SHA-256, 검색용) |
| user_id | UUID | FK → users.id, NOT NULL | 토큰 소유자 |
| revoked_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | 폐기 시각 |
| expires_at | TIMESTAMPTZ | NOT NULL | 원본 토큰 만료 시점 (정리 작업용) |

**인덱스**: `token_hash` (조회 성능), `user_id` (사용자별 일괄 폐기), `expires_at` (정리 작업).

**정리 작업** (선택): cron 또는 트리거로 `expires_at < now()` 레코드 삭제 (본 SPEC 범위 선택적 구현, 기본은 보존).

### 3.2 `login_attempts` (Rate Limiting 추적 — 본 SPEC 도입)

목적: 로그인 5회 실패 시 10분 잠금 정책의 영속적 추적. in-memory 대신 DB 기반 채택 (이유: 서버 재시작 후에도 잠금 상태 유지, 38세대 규모에서 DB 부하 무시 가능).

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | UUID | PK, DEFAULT gen_random_uuid() | |
| email | VARCHAR(255) | NOT NULL | 로그인 시도 이메일 (소문자 정규화) |
| failed_count | INT | NOT NULL, DEFAULT 0 | 연속 실패 횟수 |
| locked_until | TIMESTAMPTZ | NULLABLE | 잠금 해제 시각 (NULL = 잠금 아님) |
| last_attempt_at | TIMESTAMPTZ | NOT NULL, DEFAULT now() | 마지막 시도 시각 |

**인덱스**: `email` (조회 성능).

**잠금 로직**:
- 실패 시 `failed_count += 1`, `last_attempt_at = now()`
- `failed_count >= 5`이면 `locked_until = now() + interval '10 minutes'`
- 성공 시 해당 email 레코드 삭제 (또는 count 0 초기화)
- `locked_until > now()`인 동안 로그인 시도는 429 반환

---

## 4. TDD 작업 분해 (RED-GREEN-REFACTOR)

본 SPEC은 greenfield 프로젝트이므로 TDD 모드를 적용한다 (`quality.yaml development_mode: tdd`).

### Phase A: 기반 인프라 (Priority High)

#### A1. `src/lib/db.ts` — PostgreSQL 연결 풀

- **RED**: 연결 풀 인스턴스 생성 테스트, 쿼리 실행 테스트 (mock DB)
- **GREEN**: pg Pool 래퍼 구현, 환경 변수 로딩
- **REFACTOR**: 환경별 설정 분리 (개발/프로덕션), 연결 에러 처리

#### A2. `src/lib/auth.ts` — JWT 유틸리티

- **RED**: Access Token 발급/검증 테스트, Refresh Token 발급/검증 테스트, 만료 토큰 거부 테스트, 잘못된 서명 거부 테스트, **발급된 AT/RT 디코딩 후 alg=HS256 및 exp delta(AT ≤ 900초 / RT ≤ 604800초) 단정 (AC-AUTH-027/028)**, **RT Set-Cookie 속성(httpOnly/secure/sameSite=strict/path/maxAge) 단정 (AC-AUTH-029)**
- **GREEN**: `signAccessToken`, `signRefreshToken`, `verifyAccessToken`, `verifyRefreshToken` 구현
- **REFACTOR**: 공통 서명 로직 추출, 만료 시간 상수화 (15분, 7일)

#### A3. `src/lib/auth.ts` — bcrypt 해시 함수

- **RED**: 평문 해시 테스트, 해시 검증(올바른 비밀번호) 테스트, 해시 검증(틀린 비밀번호) 테스트, salt rounds 12 검증
- **GREEN**: `hashPassword`, `comparePassword` 구현
- **REFACTOR**: salt rounds 상수화 (`BCRYPT_SALT_ROUNDS = 12`)

#### A4. `migrations/002_revoked_refresh_tokens.sql` + `migrations/003_login_attempts.sql`

- **RED**: 마이그레이션 적용 테스트 (테스트 DB에서), 테이블 구조 검증
- **GREEN**: SQL 스크립트 작성 (제약, 인덱스 포함)
- **REFACTOR**: idempotent 스크립트 (IF NOT EXISTS)

### Phase B: 회원가입 (AUTH-01) — Priority High

#### B1. `src/app/api/auth/signup/route.ts`

- **RED**:
  - 정상 가입 → 201 + `role=RESIDENT`, `verified=false` 응답 테스트
  - 이메일 중복 → 409 테스트
  - 이메일 형식 오류 → 422 테스트
  - 비밀번호 정책 위반 (8자 미만, 영문+숫자 조합 아님) → 422 테스트
  - password_confirm 불일치 → 422 테스트
- **GREEN**: route handler 구현, bcrypt 해시 적용, DB INSERT
- **REFACTOR**: 유효성 검증 로직 별도 모듈 분리 (`src/lib/validators.ts`)

### Phase C: 로그인 / 로그아웃 (AUTH-03) — Priority High

#### C1. `src/lib/rate-limit.ts` — 로그인 시도 추적

- **RED**:
  - 1~4회 실패 → 카운트 증가, 잠금 안 함 테스트
  - 5회 실패 → `locked_until` 설정 테스트
  - 잠금 중 시도 → 429 반환 테스트
  - 잠금 해제 후 시도 → 정상 처리 테스트
  - 성공 시 카운트 초기화 테스트
- **GREEN**: `recordFailedAttempt`, `isLocked`, `resetAttempts`, `getLockStatus` 구현
- **REFACTOR**: 임계값/잠금 시간 상수화 (`MAX_FAILED_ATTEMPTS = 5`, `LOCK_DURATION_MINUTES = 10`)

#### C2. `src/app/api/auth/login/route.ts`

- **RED**:
  - 정상 로그인 → 200 + access_token + RT 쿠키 설정 테스트
  - 존재하지 않는 이메일 → 401 (통일 메시지) 테스트
  - 비밀번호 불일치 → 401 (동일 메시지) 테스트
  - 5회 실패 → 429 테스트
  - 잠금 중 시도 → 429 테스트
  - 미인증 회원 로그인 → 200 + `verified=false` 응답 테스트
- **GREEN**: route handler 구현, Rate Limit 연동, JWT 발급, 쿠키 설정
- **REFACTOR**: 에러 메시지 상수화, bcrypt 비교 실패/성공 분기 정리

#### C3. `src/app/api/auth/logout/route.ts`

- **RED**:
  - 정상 로그아웃 → 200 + RT 블랙리스트 등록 + 쿠키 삭제 테스트
  - 미인증 요청 → 401 테스트
- **GREEN**: route handler 구현, RT jti 추출, 블랙리스트 INSERT, 쿠키 만료
- **REFACTOR**: 토큰 폐기 공통 함수 추출

### Phase D: 토큰 갱신 (M3) — Priority High

#### D1. `src/app/api/auth/refresh/route.ts`

- **RED**:
  - 유효 RT → 200 + 새 access_token 테스트
  - 만료 RT → 401 테스트
  - 블랙리스트 RT → 401 테스트
  - RT 없음 → 401 테스트
- **GREEN**: route handler 구현, 쿠키에서 RT 추출, 블랙리스트 조회, 새 AT 발급
- **REFACTOR**: 블랙리스트 조회 함수 (`isTokenRevoked`) 추출

### Phase E: 동/호수 인증 (AUTH-04) — Priority High

#### E1. `src/app/api/auth/verify-unit/route.ts`

- **RED**:
  - 정상 인증 → 200 + `verified_at` 갱신 테스트
  - 동대표(REP) 인증 → `users.managed_building_id` 자동 연결 테스트 (REQ-AUTH-011; SETUP 마이그레이션 미선행 시 stub)
  - 동일 호수 중복 → 409 테스트
  - 존재하지 않는 building_id/unit_id (또는 building에 속하지 않는 unit_id) → 422 테스트 (REQ-AUTH-010a)
  - 미인증 사용자 (토큰 없음) → 401 테스트
- **GREEN**: route handler 구현, units 조회, 중복 검사, users 업데이트 (REP인 경우 `users.managed_building_id` 동시 갱신)
- **REFACTOR**: 호수 중복 검사 함수 추출, REP 특수 처리 분기 정리

#### E2. `src/lib/middleware.ts` — 미인증 접근 차단

- **RED**:
  - 미인증 회원(`/verified=false`)의 `/notices` 접근 → `/verify` 리다이렉트 테스트
  - 인증 완료 회원의 `/notices` 접근 → 정상 진행 테스트
  - 비로그인 사용자의 `/notices` 접근 → `/login` 리다이렉트 테스트
- **GREEN**: Next.js middleware 구현, JWT 검증, verified 상태 확인
- **REFACTOR**: RBAC 정책 테이블화 (`src/lib/rbac-policy.ts`)

### Phase F: 강제 탈퇴 (AUTH-07) — Priority Medium-High

#### F1. `src/app/api/auth/users/[id]/deactivate/route.ts` (신규 엔드포인트)

> Plan Review 확정 결정 #1: AUTH-07 API 소유권은 AUTH 도메인에 귀속. `/api/setup/users/:id`가 아닌 `/api/auth/users/[id]/deactivate`로 제공.

> **`suggestions` 컬럼 사이드이펙트 쓰기 계약 (MAJOR-5 해소, ADR-005 준거)**: 강제 탈퇴 트랜잭션은 `suggestions` 테이블에 대해 **오직 3개 컬럼**만 사이드이펙트로 갱신한다 — `author_id = NULL`, `author_label = '전 입주민'`, `archived = true`. `suggestions.unit_id`는 유지(호수 귀속). 이 갱신은 AUTH가 소유하는 도메인 동작이며, SUGGEST 도메인의 CRUD/답변/상태 전이/카테고리 로직과 무관하다 (SUGGEST SPEC과 듀얼 소유권 충돌 회피). 구현 시 `UPDATE suggestions SET author_id=NULL, author_label='전 입주민', archived=true WHERE author_id=$1`를 단일 트랜잭션 내에서 실행한다.

- **RED**:
  - ADMIN이 일반 회원 탈퇴 → 200 + 5단계 원자적 처리 테스트:
    - `status=INACTIVE` 변경
    - 건의 `archived=true`, `author_label="전 입주민"`, `author_id=NULL`
    - 직책 회수 (`role` → RESIDENT)
    - `unit_id=NULL`, `verified_at=NULL`
    - RT 일괄 블랙리스트 등록
  - ADMIN 자체 탈퇴 시도 → 403 테스트 (REQ-AUTH-015)
  - ADMIN 아닌 사용자(RESIDENT/CHAIR/REP/AUDITOR) 시도 → 403 테스트 (REQ-AUTH-016, RBAC 미들웨어)
  - 트랜잭션 중간 실패 → 전체 롤백 테스트
- **GREEN**: route handler 구현, 단일 트랜잭션(`BEGIN/COMMIT/ROLLBACK`), 5단계 순차 실행
- **REFACTOR**: 건의 아카이브 로직 별도 도메인 함수 추출 (`src/lib/suggest-archive.ts`, AUTH-06 재사용 대비)

### Phase G: UI 페이지 — Priority Medium

#### G1. `src/app/(auth)/login/page.tsx`

- 폼: 이메일, 비밀번호 입력
- 제출 시 `/api/auth/login` 호출
- 401 시 통일 메시지 표시
- 429 시 "10분 후 재시도" 안내

#### G2. `src/app/(auth)/signup/page.tsx`

- 폼: 이메일, 비밀번호, 비밀번호 확인 입력
- 클라이언트 측 유효성 검사 (서버 검증과 별개)
- 제출 시 `/api/auth/signup` 호출
- 성공 시 `/verify` 자동 이동

#### G3. `src/app/(auth)/verify/page.tsx`

- 동 선택 드롭다운 (`/api/setup/buildings`에서 로드)
- 호수 선택 드롭다운 (동 선택 후 로드)
- 제출 시 `/api/auth/verify-unit` 호출
- 409 시 "관리사무소 문의" 안내

### Phase H: 통합 테스트 및 품질 게이트 — Priority Medium

- E2E 흐름 테스트: 회원가입 → 인증 → 로그인 → 로그아웃
- 강제 탈퇴 E2E: ADMIN 로그인 → 탈퇴 실행 → 탈퇴된 회원 토큰 무효 확인
- 커버리지 85% 이상 달성
- TRUST 5 게이트 통과: eslint, prettier, 타입 체크

---

## 5. JWT 설정 상세

| 항목 | 값 | 근거 |
|------|------|------|
| 알고리즘 | HS256 | ADR-003, 대칭키 단일 서버 |
| Access Token 만료 | 15분 | ADR-003 |
| Refresh Token 만료 | 7일 | ADR-003 |
| Access Token 서명 키 | `JWT_SECRET` (32자+) | 환경 변수 |
| Refresh Token 서명 키 | `JWT_REFRESH_SECRET` (32자+, JWT_SECRET과 상이) | 환경 변수 |
| RT 쿠키 속성 | `httpOnly=true`, `secure=<NODE_ENV=production>`, `sameSite=strict`, `path=/api/auth`, `maxAge=7d` | CSRF 방지 |
| jti 클레임 | RT 발급 시 고유 UUID 생성 | 블랙리스트 식별용 |

---

## 6. 환경 변수

```env
# .env.local (개발) / Railway Variables (프로덕션)
DATABASE_URL=postgresql://user:password@host:5432/aitteulak
JWT_SECRET=<32자 이상 무작위 문자열>
JWT_REFRESH_SECRET=<32자 이상, JWT_SECRET과 상이>
NEXT_PUBLIC_APP_URL=http://localhost:3000  # 개발
# NEXT_PUBLIC_APP_URL=https://your-domain.railway.app  # 프로덕션
```

- `.env.local`은 `.gitignore`에 포함 필수
- `.env.example`은 템플릿으로 커밋 (실제 값 미포함)
- Railway 프로덕션은 플랫폼 비밀 관리 사용

---

## 7. 리스크 분석 및 완화

| 리스크 | 심각도 | 가능성 | 완화 방안 |
|--------|:------:|:------:|-----------|
| **RT 토큰 누출** | 높음 | 낮음 | httpOnly 쿠키 저장, SameSite=Strict, 블랙리스트 즉시 폐기, 7일 만료 |
| **Access Token 탈취** | 중간 | 중간 | 15분 짧은 만료, RT 갱신 시 새 AT 발급 |
| **브루트포스 공격** | 높음 | 중간 | 5회 실패 / 10분 잠금 (`login_attempts` DB 추적), bcrypt salt 12 |
| **CSRF 공격** | 중간 | 낮음 | RT 쿠키 SameSite=Strict, POST 전용 (GET 토큰 변경 금지) |
| **SQL Injection** | 높음 | 낮음 | Parameterized Query / ORM 필수, 정적 분석 (eslint-plugin-security) |
| **사용자 열거 공격** | 중간 | 중간 | 로그인 실패 메시지 통일 ("이메일 또는 비밀번호가 올바르지 않습니다") |
| **JWT_SECRET 노출** | 치명적 | 낮음 | 환경 변수만 사용, 소스 코드 하드코딩 금지, Railway 비밀 관리 |
| **강제 탈퇴 트랜잭션 실패** | 높음 | 낮음 | 단일 트랜잭션 BEGIN/COMMIT/ROLLBACK, 중간 실패 시 전체 롤백 |
| **동/호수 seed 데이터 누락** | 중간 | 낮음 | 테스트 픽스처로 seed 보장, verify-unit 사전 검증 |
| **서버 재시작 시 Rate Limit 상태 손실** | 낮음 | 중간 | in-memory 대신 DB 기반 (`login_attempts` 테이블) |
| **HTTPS 미적용 환경** | 높음 | 낮음 | 프로덕션 Railway HTTPS 강제, 개발은 예외 허용 (명시적 로그) |
| **AUTH-02 스키마 호환성 누락** | 낮음 | 중간 | `users.provider` 컬럼 DEFAULT 'email' 유지, AUTH-02 SPEC에서 kakao 사용 |

---

## 8. MX Tag 적용 계획 요약

Run Phase에서 `spec.md` §7에 정의된 MX 태그 계획을 적용한다:

| 타입 | 적용 지점 | 수량 |
|------|-----------|:----:|
| `@MX:ANCHOR` | `db.ts`, `auth.ts` 토큰 함수, `middleware.ts` RBAC | 3+ |
| `@MX:WARN` + `@MX:REASON` | bcrypt, JWT 서명/검증, RT 블랙리스트, Rate Limit 임계치 | 4+ |
| `@MX:NOTE` | 회원가입→인증 이동, REP managed_building, 강제 탈퇴 트랜잭션 | 3+ |
| `@MX:TODO` | AUTH-02 연결 지점 (provider), AUTH-05 비밀번호 재설정 | 2+ |

---

## 9. 의존성 및 선행 작업

### Run Phase 시작 전 필요

1. PostgreSQL 인스턴스 접근 가능 (로컬 또는 Railway)
2. `migrations/001_init_users_buildings_units_roles.sql` 적용 완료 (Users, Buildings, Units, Roles 테이블 생성)
3. seed 스크립트로 buildings (A동/B동), units (26+12세대), roles (5종) 데이터 적재
4. 환경 변수 설정 완료 (`DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `NEXT_PUBLIC_APP_URL`)
5. **`users.managed_building_id` 컬럼 (cross-SPEC, MAJOR-2 해소)**: `managed_building`은 회원 단위(`users.managed_building_id`)로 표현된다. 해당 컬럼의 스키마 정의·마이그레이션은 **SETUP SPEC 소관** (roles/buildings 스키마 소유권 일관성). AUTH는 verify-unit(REQ-AUTH-011) 시 이 컬럼을 소비만 한다. **SETUP 마이그레이션이 선행하지 않은 경우 AUTH 테스트는 `users.managed_building_id`를 stub 한다** (테스트 픽스처로 컬럼을 모킹). 공유 `roles.managed_building_id` 스키마는 2개 동 × 복수 REP를 표현할 수 없으므로 AUTH REQ-AUTH-011/AC-AUTH-015는 `users` 기반으로 작성되었다.

### 본 SPEC이 생성하는 마이그레이션

- `002_revoked_refresh_tokens.sql`
- `003_login_attempts.sql`

---

## 10. 완료 기준 (Definition of Done)

- [ ] 모든 REQ-AUTH-001 ~ REQ-AUTH-016 (REQ-AUTH-010a 포함) 요구사항 구현
- [ ] TDD RED-GREEN-REFACTOR 사이클 완료 (Phase A~H)
- [ ] 테스트 커버리지 85% 이상
- [ ] `acceptance.md`의 모든 Given/When/Then 시나리오 통과
- [ ] TRUST 5 게이트 통과 (eslint, prettier, tsc, 보안 점검)
- [ ] MX 태그 적용 완료 (§8 계획 준거)
- [ ] `.env.example` 템플릿 작성 (실제 값 미포함)
- [ ] 마이그레이션 스크립트 idempotent 검증

---

*본 plan.md는 `spec.md`와 `acceptance.md`와 함께 Run Phase의 기준 문서로 사용된다.*
