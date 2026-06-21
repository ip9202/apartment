---
spec_id: SPEC-AUTH-001
title: 인증 (Authentication) 시스템
phase: research
status: draft
created: 2026-06-21
author: manager-spec (Phase 0.5 Deep Research)
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

# SPEC-AUTH-001 Deep Research — 인증 시스템

본 문서는 9개 기획 문서에서 인증(AUTH) 도메인에 관련된 모든 사실을 추출한 연구 결과입니다.
SPEC 작성 전 Plan Review 게이트의 기반이 되며, 구현 디테일(함수명/클래스 구조/API 스키마)은 포함하지 않습니다 — "무엇(WHAT)/왜(WHY)"에 집중합니다.

---

## 1. 인증 요구사항 요약 (AUTH-01 ~ AUTH-07)

| ID | 기능 | 우선순위 | 대상 역할 | 핵심 설명 |
|----|------|:--------:|-----------|-----------|
| AUTH-01 | 이메일/비밀번호 회원가입 | **P0** | 전체 | 이메일 중복 검사 포함. 가입 직후 `role: RESIDENT`, `verified: false` 상태로 생성 후 동/호수 인증 화면으로 강제 이동 |
| AUTH-02 | 카카오 소셜 로그인 | **P1** | 전체 | OAuth 2.0. 본 SPEC의 명시적 OUT(후속 모듈/SPEC) 또는 별도 모듈 표시 권장 |
| AUTH-03 | 로그인 / 로그아웃 | **P0** | 전체 | JWT 세션 관리 (AT 15분 + RT 7일 httpOnly 쿠키). 미인증 회원 로그인 시 인증 화면 강제 이동 |
| AUTH-04 | 동/호수 인증 (최초 1회) | **P0** | RESIDENT·직책 | 동(building) + 호수(unit) 선택 → `verified: true` 획득. 동대표 역할 시 `managed_building` 자동 연결. 미인증 시 모든 메인 기능 접근 차단 |
| AUTH-05 | 비밀번호 재설정 | **P1** | 전체 | 이메일 링크 방식, 링크 유효시간 1시간. 본 SPEC OUT |
| AUTH-06 | 회원 탈퇴 (본인) | **P1** | 전체 | 탈퇴 시 작성 건의 익명 처리 (host 귀속 유지). 본 SPEC OUT |
| AUTH-07 | 회원 강제 탈퇴 | **P0** | ADMIN | 전입·전출 시 관리사무소가 직접 탈퇴 처리. 상태 `INACTIVE`, 건의 아카이브(`author_label: "전 입주민"`), 직책 자동 회수, 동/호수 인증 해제(해당 호수 신규 인증 가능 상태로), Refresh Token 즉시 무효화 |

### 본 SPEC P0 범위 (구현 대상)

- AUTH-01, AUTH-03, AUTH-04, AUTH-07

### 본 SPEC OUT (별도 SPEC/P1)

- AUTH-02 (카카오 소셜 로그인) — P1
- AUTH-05 (비밀번호 재설정) — P1
- AUTH-06 (본인 회원 탈퇴) — P1
  - 단, AUTH-07 강제 탈퇴의 "건의 아카이브 처리" 로직은 AUTH-06과 공유되므로 재사용 가능한 형태로 분리 필요

---

## 2. DB 스키마 (정확 — ERD에서 그대로 추출)

PostgreSQL 15. UUID PK. 모든 타임스탬프 `TIMESTAMPTZ`.

### 2.1 `buildings` (동 목록) — AUTH 의존, 관리는 SETUP SPEC

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | UUID | PK, DEFAULT gen_random_uuid() | |
| name | VARCHAR(20) | NOT NULL, UNIQUE | "A동", "B동" |
| created_at | TIMESTAMPTZ | DEFAULT now() | |

### 2.2 `units` (호수 목록) — AUTH 의존, 관리는 SETUP SPEC

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | UUID | PK | |
| building_id | UUID | FK → buildings.id | |
| unit_number | VARCHAR(10) | NOT NULL | "101", "201" 등 |
| created_at | TIMESTAMPTZ | DEFAULT now() | |

**유니크 제약**: `(building_id, unit_number)`

### 2.3 `roles` (직책) — AUTH 의존, 관리는 SETUP SPEC

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | UUID | PK | |
| code | VARCHAR(20) | NOT NULL, UNIQUE | `ADMIN`, `CHAIR`, `REP`, `AUDITOR`, `RESIDENT` |
| name | VARCHAR(30) | NOT NULL | "관리사무소", "회장" 등 표시명 |
| managed_building_id | UUID | FK → buildings.id, NULLABLE | 동대표(REP) 전용 |
| sort_order | INT | DEFAULT 0 | 표시 순서 |
| created_at | TIMESTAMPTZ | DEFAULT now() | |

**초기 데이터 (seed)**: ADMIN, CHAIR, REP, AUDITOR, RESIDENT (기본 5종)

### 2.4 `users` (회원) — AUTH 핵심 테이블

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| id | UUID | PK | |
| email | VARCHAR(255) | NOT NULL, UNIQUE | RFC 5322 형식 |
| password_hash | VARCHAR(255) | NULLABLE | 소셜 로그인(AUTH-02) 시 NULL |
| provider | VARCHAR(20) | DEFAULT 'email' | 'email', 'kakao' |
| provider_id | VARCHAR(255) | NULLABLE | 소셜 로그인 식별자 |
| role_id | UUID | FK → roles.id | 회원의 직책 |
| unit_id | UUID | FK → units.id, NULLABLE | 동/호수 인증 전 NULL |
| status | VARCHAR(20) | DEFAULT 'ACTIVE' | `ACTIVE`, `INACTIVE` |
| verified_at | TIMESTAMPTZ | NULLABLE | 동/호수 인증 완료 시각 |
| created_at | TIMESTAMPTZ | DEFAULT now() | |
| updated_at | TIMESTAMPTZ | DEFAULT now() | |

**인덱스**: email, unit_id, role_id

### 2.5 리프레시 토큰 블랙리스트 (ERD에 명시 없음 — 구현 필요)

ADR-003 및 보안설계 §1에 "로그아웃 시 RT DB 블랙리스트 등록"이 명시되어 있으나, ERD에 별도 테이블이 정의되어 있지 않음.

**본 SPEC에서 정의 필요한 테이블(예: `revoked_refresh_tokens`)**:
- `token` (또는 `jti`): 리프레시 토큰 식별자
- `user_id` (UUID, FK → users.id)
- `revoked_at` (TIMESTAMPTZ)
- `expires_at` (TIMESTAMPTZ) — 원본 토큰 만료 시점 (블랙리스트 정리용)
- 설계 상세는 spec.md/plan.md 단계에서 결정 (다만 본 research.md는 구현 디테일 회피 → 테이블 존재 및 목적만 명시)

---

## 3. API 계약 (정확 — API 명세서에서 추출)

공통:
- Base URL: `/api/auth/*` (프로젝트 API는 `/api/v1/...` prefix를 사용할 수도 있으나 apt_06 문서 기준 `/auth/*` 표기. 구현 시 `/api/auth/*`로 매핑 — structure.md §라우팅 구조 참조)
- 인증: Bearer Token (JWT Access Token), 단 `/refresh`는 httpOnly 쿠키
- 응답 형식: `{ "success": bool, "data": obj|null, "error": obj|null }`

### 3.1 `POST /auth/signup` — AUTH-01

**Request**
```json
{ "email": "user@example.com", "password": "password123", "password_confirm": "password123" }
```
유효성: email RFC 5322 / 최대 255자 / 중복 불가; password 8자 이상 영문+숫자 조합; password_confirm == password.

**Response `201`**
```json
{ "success": true, "data": { "id": "uuid", "email": "user@example.com", "role": "RESIDENT", "verified": false } }
```

**에러 케이스**
- `409 CONFLICT` — 이메일 중복
- `422 VALIDATION_ERROR` — 유효성 오류 (형식 불일치, 비밀번호 정책 위반, confirm 불일치)

### 3.2 `POST /auth/login` — AUTH-03

**Request**
```json
{ "email": "user@example.com", "password": "password123" }
```

**Response `200`**
```json
{
  "success": true,
  "data": {
    "access_token": "eyJ...",
    "user": {
      "id": "uuid", "email": "user@example.com", "role": "RESIDENT",
      "verified": true, "building": "A동", "unit": "101"
    }
  }
}
```
> Refresh Token은 httpOnly 쿠키로 자동 설정 (Set-Cookie).

**에러 케이스**
- `401 UNAUTHORIZED` — "이메일 또는 비밀번호가 올바르지 않습니다" (존재하지 않는 이메일과 비밀번호 오류 메시지 동일 — 사용자 열거 공격 방지)
- `429 TOO_MANY_REQUESTS` — 5회 연속 실패 시 10분 잠금

### 3.3 `POST /auth/logout` — AUTH-03 (🔒 인증 필요)

**Request**: 없음 (또는 빈 body)

**Response `200`** `{}` — Refresh Token 블랙리스트 등록, 쿠키 삭제(Set-Cookie로 만료 처리).

### 3.4 `POST /auth/refresh`

**Request**: Refresh Token 쿠키 자동 전송 (body 없음)

**Response `200`**
```json
{ "data": { "access_token": "eyJ..." } }
```
**에러 케이스**
- `401 UNAUTHORIZED` — RT 없음/만료/블랙리스트 등록됨 → 재로그인 유도

### 3.5 `POST /auth/verify-unit` — AUTH-04 (🔒 인증 필요)

**Request**
```json
{ "building_id": "uuid", "unit_id": "uuid" }
```

**Response `200`**
```json
{ "data": { "building": "A동", "unit": "101", "verified_at": "2026-06-20T09:00:00Z" } }
```

**에러 케이스**
- `409 CONFLICT` — "해당 호수에 이미 등록된 입주민이 있습니다. 관리사무소에 문의하세요." (동일 호수 중복 인증 방지)
- `422 VALIDATION_ERROR` — 존재하지 않는 동/호수

> 참고: 회원 강제 탈퇴(AUTH-07)는 `DELETE /setup/users/:id` 엔드포인트로 제공되며, 이는 SETUP 도메인 API에 위치하지만 AUTH-07 요구사항에 해당. 본 SPEC에서 API 엔드포인트 소유권 결정 필요(후술 의존성 메모 참조).

---

## 4. 인증 플로우

### 4.1 회원가입 → 동·호수 인증 (AUTH-01 + AUTH-04)

```
회원가입 버튼 → 이메일/비밀번호 입력 → 유효성 검사
  → [성공] 회원 생성 (role=RESIDENT, verified=false) → 동/호수 인증 화면으로 강제 이동
       → 동 선택 → 호수 선택 → 인증 처리
            → [중복 호수] 오류: 관리사무소 문의 안내
            → [성공] verified=true, 홈 화면 이동
  → [실패] 입력 화면으로 복귀
```
(출처: apt_04 §2 회원가입 플로우)

### 4.2 로그인 → 토큰 발급 (AUTH-03)

```
이메일/비밀번호 입력 → 서버 조회 (이메일 없음/비밀번호 오류 동일 메시지)
  → bcrypt 비교
  → [성공] Access Token(15분) + Refresh Token(7일) 발급
       → RT httpOnly 쿠키 저장 → 응답 (access_token + user 정보)
       → verified=false 면 동/호수 인증 화면 강제 이동
  → [5회 실패] 10분 잠금 (429)
```
(출처: apt_03 AUTH-03 처리 로직, apt_07 §3 시퀀스 다이어그램)

### 4.3 토큰 갱신 (refresh)

```
클라이언트 → POST /auth/refresh (RT 쿠키 자동 전송)
  → RT 검증 (서명 + 만료 + 블랙리스트 확인)
  → [유효] 새 Access Token 발급
  → [무효] 401 → 클라이언트 재로그인 유도
```
(출처: apt_07 §3 토큰 갱신 시퀀스)

### 4.4 로그아웃

```
클라이언트 → POST /auth/logout (Bearer Token)
  → RT DB 블랙리스트 등록
  → RT 쿠키 삭제 (Set-Cookie 만료)
  → 200 OK
```

### 4.5 강제 탈퇴 (AUTH-07)

```
관리사무소 → 회원 관리 화면 → 강제 탈퇴 선택 → 확인 다이얼로그
  → [확인]
       1. 대상 회원 status = INACTIVE
       2. 해당 회원 모든 건의 → archived=true, author_label="전 입주민", author_id=NULL (unit_id는 유지)
       3. 직책 자동 회수 (role → RESIDENT로 사실상 의미 상실; INACTIVE 상태이므로 접근 불가)
       4. 동/호수 인증 해제 (unit_id=NULL, verified_at=NULL → 해당 호수 신규 인증 가능)
       5. **해당 회원 Refresh Token 즉시 무효화 (블랙리스트 일괄 등록)**
  → [관리사무소 계정 강제 탈퇴 불가] 403 Forbidden
```
(출처: apt_03 AUTH-07, apt_04 §7 관리사무소 회원 관리 플로우, apt_08 §1 강제 탈퇴 시 토큰 무효화)

---

## 5. 보안 설계 (AUTH 도메인 관련)

### 5.1 토큰 전략 (ADR-003 + apt_08 §1)

| 항목 | 정책 |
|------|------|
| Access Token | JWT, 만료 **15분**, HS256 서명, 서버 사이드 시크릿(`JWT_SECRET`, 32자 이상), 클라이언트 전송(Bearer/Authorization 헤더) |
| Refresh Token | JWT, 만료 **7일**, HS256 서명, 별도 시크릿(`JWT_REFRESH_SECRET`, JWT_SECRET과 상이), **httpOnly 쿠키** 저장 (XSS 방지) |
| 토큰 갱신 | Access Token 만료 시 Refresh Token으로 자동 갱신 |
| 토큰 무효화 | 로그아웃 시 RT DB 블랙리스트 등록 |
| 강제 탈퇴 시 | 해당 사용자의 모든 RT **즉시** 무효화 |
| CSRF 방지 | Refresh Token 쿠키 `SameSite=Strict` 설정 |

### 5.2 비밀번호 정책 (apt_08 §2)

| 항목 | 정책 |
|------|------|
| 해싱 알고리즘 | **bcrypt, salt rounds 12** |
| 최소 조건 | 8자 이상, 영문+숫자 조합 |
| 평문 저장 | 절대 금지 |
| 전송 | HTTPS 전용 |
| 재설정 (AUTH-05, P1 OUT) | 이메일 링크 방식, 링크 유효시간 1시간 |

### 5.3 API 보안 / Rate Limiting (apt_08 §3)

| 항목 | 정책 |
|------|------|
| 서버 사이드 JWT 검증 | 모든 보호 API에서 강제 (클라이언트 단독 신뢰 금지) |
| 권한 검사 | RBAC (역할 기반 접근 제어) |
| Rate Limiting | **로그인 5회 연속 실패 시 10분 잠금** |
| CORS | 허용 Origin 화이트리스트 |
| CSRF | `SameSite=Strict` 쿠키 설정 |

### 5.4 입력 유효성 검증 (apt_08 §4)

- 서버 사이드 필수 검증
- SQL Injection 방어: Parameterized Query / ORM 필수
- XSS: 사용자 입력 저장 시 이스케이프, 렌더링 시 sanitize
- 문자열 길이 서버 검증

### 5.5 개인정보 최소화 (apt_08 §5)

| 수집 항목 | 수집 | 용도 |
|-----------|:----:|------|
| 이메일 | ✅ | 로그인 식별자 |
| 비밀번호 (해시) | ✅ | 인증 |
| 동/호수 | ✅ | 입주민 인증 |
| 이름/전화번호/생년월일 | ❌ | 미수집 |

### 5.6 데이터 암호화 (apt_08 §6)

- 전송 중: TLS 1.2 이상 (HTTPS 강제)
- 저장 시: 비밀번호 bcrypt 해시 / 나머지 평문
- DB 연결: SSL 모드 활성화

---

## 6. ADR-003 근거 및 트레이드오프 (JWT + httpOnly 쿠키)

**결정**: JWT Access Token(15분) + Refresh Token(7일, httpOnly 쿠키)

**컨텍스트**:
- 별도 인증 서버 없이 Next.js API Route 안에서 인증 처리 필요
- Refresh Token의 보안 저장이 핵심 요구사항

**검토한 대안**:
1. **Session 기반** — 서버 상태 관리 필요, 수평 확장 어려움 → 기각
2. **Access Token만** — 토큰 만료 시 UX 불편 (잦은 재로그인) → 기각
3. **NextAuth.js** — 편의성 높으나 커스텀 로직(강제 탈퇴, 블랙리스트, 동/호수 인증 플로우) 제한 → 기각
4. **JWT (AT + RT)** — 무상태, 서버 확장 용이, httpOnly 쿠키로 RT 보안 저장 → **채택**

**트레이드오프**:
- 토큰 즉시 무효화를 위해 **DB 블랙리스트 필요** (무상태성 약화)
- → 본 SPEC은 `revoked_refresh_tokens` 테이블 도입으로 해결

**재검토 트리거**: 명시되지 않음 (확정 상태)

---

## 7. 동/호수 의존성 메모 (핵심 의존성 경계)

**AUTH-04 (동·호수 인증 / verify-unit)는 `buildings`, `units`, `roles` 테이블 데이터에 의존**합니다.

| 데이터 | 제공 주체 | AUTH의 역할 |
|--------|-----------|-------------|
| `buildings` (A동·B동) 및 `units` (호수 목록) | **SETUP SPEC** (`SETUP-01`, `SETUP-02`) 또는 `db:seed` | verify-unit은 이 데이터를 **소비만** (조회용 GET /setup/buildings는 전체 공개 — 인증 목적) |
| `roles` (ADMIN/CHAIR/REP/AUDITOR/RESIDENT 5종) | SETUP SPEC 또는 `db:seed` | 회원가입 시 RESIDENT role_id 참조, 동대표 verify-unit 시 managed_building 연결 |
| buildings/units/roles의 **CRUD 관리** | **OUT** — SETUP SPEC 소관 | 본 SPEC은 목록 관리(추가/삭제/수정)를 다루지 않음 |

**가정 (사전 조건)**:
- 본 SPEC 구현/테스트 시점에 `buildings`, `units`, `roles` 테이블에 seed 데이터가 존재한다고 가정합니다.
- 아이뜨락 초기 seed (apt_03 SETUP-01/02에 명시):
  - A동: `[101,102, 201,202, 301,302, 501,502, 601,602, 701,702, 801,802, 203,204, 303,304, 503,504, 603,604, 703,704, 803,804]`
  - B동: `[201,202, 301,302, 501,502, 601,602, 701,702, 801,802]`
  - **주의**: 4층 없음. A동 3·4호 라인 및 B동은 1층 없음.
- roles seed: ADMIN, CHAIR, REP, AUDITOR, RESIDENT

**API 소유권 경계 (중요)**:
- `POST /auth/verify-unit` → AUTH SPEC 소유
- `GET /setup/buildings` (동/호수 목록 조회, 인증 목적 전체 공개) → **SETUP SPEC 소유**이지만 AUTH 클라이언트가 소비
- `DELETE /setup/users/:id` (회원 강제 탈퇴 = AUTH-07) → API 경로는 `/setup/*` 이나 요구사항은 AUTH-07. **소유권 협의 필요**:
  - 옵션 A: AUTH SPEC이 `/api/auth/users/:id/deactivate` (또는 유사) 신규 엔드포인트로 소유
  - 옵션 B: SETUP SPEC의 `DELETE /setup/users/:id`가 AUTH-07 로직을 구현
  - → Plan Review 게이트에서 결정 권장

---

## 8. 리스크 및 제약

| 리스크/제약 | 설명 | 완화 방안 |
|-------------|------|-----------|
| **RT 블랙리스트 테이블 미정의** | ERD에 `revoked_refresh_tokens` 테이블 없음. ADR-003 트레이드오프가 이를 요구 | 본 SPEC에서 테이블 신규 정의 (스키마 마이그레이션 필요) |
| **강제 탈퇴 API 소유권 모호** | AUTH-07 요구사항 vs `/setup/users/:id` 경로 | Plan Review에서 결정 |
| **Rate Limiting 구현 미정** | "5회 실패 시 10분 잠금"의 저장소(in-memory vs DB vs Redis) 미결정 | 38세대 소규모 → in-memory 또는 DB 기반 가능. 본 SPEC에서 결정 |
| **동/호수 목록 seed 의존** | buildings/units/roles 데이터가 없으면 verify-unit 테스트 불가 | 테스트 픽스처로 seed 데이터 보장 |
| **AUTH-02 (카카오) 사전 고려** | users 테이블의 `provider`, `provider_id` 컬럼이 AUTH-02를 위한 것. P0에서는 사용 안 함 | 스키마는 AUTH-02 호환성 확보 (본 SPEC은 email provider만 다룸) |
| **AUTH-07 건의 아카이브 로직 공유** | AUTH-06 (본인 탈퇴)과 "건의 익명화" 로직 공유 | 재사용 가능한 도메인 함수로 분리 (구현 디테일은 plan.md) |
| **쿠키 SameSite=Strict + 크로스사이트 시나리오** | SameSite=Strict는 외부 링크 유입 시 쿠키 미전송 | 아파트 커뮤니티 특성상 same-site 운영, 허용 가능 |
| **HTTPS 강제** | 모든 토큰 전송은 HTTPS 필수 (apt_08 §6) | Railway 배포 시 HTTPS 자동 제공; 개발 환경에서도 HTTPS 권장 |
| **환경변수 관리** | `JWT_SECRET`, `JWT_REFRESH_SECRET` 32자 이상, 상이해야 함 | `.env.local` Git 제외, Railway 비밀 관리 사용 |
| **사용자 열거 공격** | login에서 "이메일 없음" vs "비밀번호 오류" 메시지 분리 시 공격 표면 | apt_03이 동일 메시지 정책 명시 → 준수 |

---

## 9. Reference (기획 문서 파일 경로)

| 항목 | 파일 경로 |
|------|-----------|
| 서비스 기획 (페르소나, 인증 컨텍스트) | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_01_서비스기획서.md` |
| PRD (AUTH-01~07, P0/P1) | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_02_PRD.md` |
| 기능 명세서 (AUTH 입출력/예외) | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_03_기능명세서.md` |
| 유저 플로우 (회원가입/로그인/verify-unit/강제탈퇴) | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_04_유저플로우.md` |
| ERD (users/buildings/units/roles 스키마) | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_05_ERD.md` |
| API 명세서 (/auth/* 엔드포인트) | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_06_API명세서.md` |
| 시스템 아키텍처 (인증 흐름, 미들웨어) | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_07_시스템아키텍처.md` |
| 보안 설계 (토큰/비밀번호/RateLimit/CSRF) | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_08_보안설계.md` |
| ADR (ADR-003 JWT 결정) | `/Users/ip9202/Documents/Claude/Projects/apartment_community/docs/apt_09_ADR.md` |
| 프로젝트 product.md | `/Users/ip9202/develop/vibe/apartment/.moai/project/product.md` |
| 프로젝트 tech.md | `/Users/ip9202/develop/vibe/apartment/.moai/project/tech.md` |
| 프로젝트 structure.md | `/Users/ip9202/develop/vibe/apartment/.moai/project/structure.md` |

---

## 10. 연구 결론 (SPEC 작성을 위한 핵심 관찰)

1. **P0 범위는 명확**: AUTH-01, AUTH-03, AUTH-04, AUTH-07 네 가지. P1(AUTH-02/05/06)은 OUT.
2. **JWT AT(15분)/RT(7일, httpOnly 쿠키) + bcrypt salt 12**가 핵심 기술 제약. ADR-003 확정.
3. **RT 블랙리스트 테이블 신규 도입 필요** — ERD에 없으나 ADR-003/보안설계가 요구.
4. **동/호수 인증(verify-unit)은 buildings/units/roles seed 데이터에 강하게 의존** — 이 데이터 관리는 SETUP SPEC 소관, AUTH는 소비만.
5. **강제 탈퇴(AUTH-07)의 API 소유권 경계**(`/setup/users/:id` vs `/auth/*`)를 Plan Review에서 결정해야 함.
6. **Rate Limiting 저장소** 및 **CSRF SameSite=Strict** 적용이 보안 하이라이트.
7. **사용자 열거 공격 방지**를 위해 login 에러 메시지 통일 정책 준수 필요.
8. **개인정보 최소화**: email + password_hash + 동/호수만 수집. 이름/전화번호/생년월일 미수집.

---

*본 research.md는 Plan Review 게이트 통과 후 spec.md/plan.md/acceptance.md 작성의 기반이 됩니다.*
