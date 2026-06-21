---
spec_id: "SPEC-AUTH-001"
title: "인증 (Authentication) 시스템 검증 기준"
phase: "acceptance"
status: "draft"
created: "2026-06-21"
updated: "2026-06-21"
author: "강력쇠주먹"
priority: "P0"
issue_number: 0
---

# SPEC-AUTH-001 Acceptance Criteria

본 문서는 `spec.md`에 정의된 REQ-AUTH-001 ~ REQ-AUTH-016 (REQ-AUTH-010a 포함) 요구사항에 대한 관측 가능한 검증 기준을 Given/When/Then 형식으로 제시한다. 각 모듈당 최소 2개 시나리오, 총 13개 이상의 검증 케이스를 정의한다.

---

## 1. 검증 시나리오 (Given / When / Then)

### M1. 회원가입 (AUTH-01)

#### AC-AUTH-001: 정상 회원가입 — 201 응답 + RESIDENT/verified=false

- **Given** `buildings`, `units`, `roles` 테이블에 seed 데이터가 존재하고, 가입되지 않은 이메일 `newuser@example.com`을 제출함
- **When** 클라이언트가 `POST /api/auth/signup`에 유효한 `{email, password, password_confirm}`을 제출
- **Then** 시스템은 `201` 응답을 반환하고, 응답 본문은 `{success: true, data: {id, email, role: "RESIDENT", verified: false}}` 형식이며, DB `users` 테이블에 해당 레코드가 생성됨 (`password_hash`는 bcrypt 해시, `verified_at`은 NULL)

#### AC-AUTH-002: 이메일 중복 — 409 응답

- **Given** `users` 테이블에 `existing@example.com` 레코드가 이미 존재
- **When** 클라이언트가 동일 이메일로 `POST /api/auth/signup` 제출
- **Then** 시스템은 `409 CONFLICT` 응답을 반환하고, 새 레코드는 생성되지 않음

#### AC-AUTH-003: 비밀번호 정책 위반 — 422 응답

- **Given** 비밀번호가 8자 미만이거나 영문+숫자 조합이 아님 (예: `pass`, `password`, `12345678`)
- **When** 클라이언트가 `POST /api/auth/signup` 제출
- **Then** 시스템은 `422 VALIDATION_ERROR` 응답을 반환하고, 구체적인 정책 위반 사유를 메시지로 표시

#### AC-AUTH-004: 평문 비밀번호 저장 금지 (보안)

- **Given** 정상 회원가입 요청이 처리됨
- **When** DB `users.password_hash` 컬럼 값을 직접 조회
- **Then** 저장된 값은 bcrypt 해시 형식(`$2b$12$...`)이며, 평문 비밀번호와 문자열 비교 시 일치하지 않음

---

### M2. 로그인 (AUTH-03)

#### AC-AUTH-005: 정상 로그인 — 200 + access_token + httpOnly RT 쿠키

- **Given** `users@example.com` / `password123`으로 가입된 ACTIVE 회원이 존재하고, `verified_at`이 설정됨
- **When** 클라이언트가 `POST /api/auth/login`에 올바른 자격증명 제출
- **Then** 시스템은 `200` 응답을 반환하고, 응답 본문은 `{success: true, data: {access_token: "eyJ...", user: {id, email, role, verified: true, building, unit}}}` 형식이며, `Set-Cookie` 헤더로 Refresh Token이 `httpOnly; secure; sameSite=strict` 속성으로 설정됨

#### AC-AUTH-006: 자격증명 오류 — 401 통일 메시지 (열거 공격 방지)

- **Given** 두 가지 케이스를 각각 테스트: (a) 존재하지 않는 이메일, (b) 존재하는 이메일이나 틀린 비밀번호
- **When** 클라이언트가 `POST /api/auth/login` 제출
- **Then** 두 케이스 모두 동일한 `401 UNAUTHORIZED` 응답과 동일한 메시지 "이메일 또는 비밀번호가 올바르지 않습니다"를 반환하며, 응답 본문에 어떤 항목이 틀렸는지 구분 정보가 포함되지 않음

#### AC-AUTH-007: 미인증 회원 로그인 — verified=false 응답

- **Given** 회원가입은 완료했으나 동/호수 인증(`verified_at`)을 하지 않은 회원
- **When** 클라이언트가 `POST /api/auth/login` 제출
- **Then** 시스템은 `200` 응답을 반환하되, 응답 본문 `user.verified`가 `false`이며, 클라이언트는 `/verify` 화면으로 강제 이동해야 함

#### AC-AUTH-008: Rate Limiting — 5회 실패 시 429 + 10분 잠금

- **Given** `ratelimit@example.com`으로 가입된 회원이 존재
- **When** 동일 이메일로 5회 연속 틀린 비밀번호 제출
- **Then** 5번째 시도부터 시스템은 `429 TOO_MANY_REQUESTS` 응답을 반환하고, `login_attempts` 테이블에 `locked_until = now() + 10 minutes`가 설정되며, 잠금 해제 전까지 올바른 비밀번호로도 로그인 거부

#### AC-AUTH-009: 잠금 해제 후 정상 복귀

- **Given** `login_attempts.locked_until`이 과거 시각으로 설정됨 (10분 경과)
- **When** 동일 이메일로 올바른 비밀번호 제출
- **Then** 시스템은 정상적으로 `200` 응답을 반환하고, `login_attempts` 레코드의 `failed_count`가 0으로 초기화됨

#### AC-AUTH-010: 로그아웃 — RT 블랙리스트 등록 + 쿠키 삭제

- **Given** 유효한 Access Token과 Refresh Token(httpOnly 쿠키)을 보유한 인증 회원
- **When** 클라이언트가 `POST /api/auth/logout` 제출 (Authorization: Bearer AT)
- **Then** 시스템은 `200` 응답을 반환하고, `revoked_refresh_tokens` 테이블에 해당 RT의 jti/hash가 등록되며, `Set-Cookie` 헤더로 RT 쿠키가 만료 처리(`maxAge=0`)됨

---

### M3. 토큰 갱신 (Refresh)

#### AC-AUTH-011: 유효 RT로 새 AT 발급 — 200

- **Given** 유효하고 블랙리스트에 등록되지 않은 Refresh Token이 httpOnly 쿠키에 존재
- **When** 클라이언트가 `POST /api/auth/refresh` 제출 (쿠키 자동 전송, body 없음)
- **Then** 시스템은 `200` 응답과 `{data: {access_token: "eyJ..."}}` 본문을 반환하며, 새 Access Token은 이전 것과 다른 서명/jti를 가짐

#### AC-AUTH-012: 블랙리스트 RT 거부 — 401

- **Given** 로그아웃으로 이미 `revoked_refresh_tokens`에 등록된 RT
- **When** 클라이언트가 해당 RT로 `POST /api/auth/refresh` 제출
- **Then** 시스템은 `401 UNAUTHORIZED`를 반환하고, 새 Access Token은 발급되지 않으며, 클라이언트는 재로그인 유도

#### AC-AUTH-013: 만료 RT 거부 — 401

- **Given** 만료 시간(7일)이 경과한 Refresh Token
- **When** 클라이언트가 해당 RT로 `POST /api/auth/refresh` 제출
- **Then** 시스템은 `401 UNAUTHORIZED`를 반환하고, 재로그인 유도

---

### M3.1 토큰 형식 검증 (JWT alg / exp / 쿠키 속성)

> 본 시나리오들은 발급된 토큰을 **디코딩**하여 REQ-AUTH-004의 보안 파라미터(alg=HS256, AT 15분 / RT 7일)를 검증한다. RS256 또는 24h AT를 발급하는 구현은 아래 단정문을 만족하지 못해 자동 실패한다 (falsifiable).

#### AC-AUTH-027: Access Token 디코딩 — alg=HS256, exp delta ≤ 15분

- **Given** ACTIVE 회원의 유효 자격증명
- **When** `POST /api/auth/login` 성공 후 응답 본문의 `access_token`을 HS256/RS256 알고리즘 독립적으로 디코딩 (JOSE header + claims 파싱)
- **Then** JOSE header의 `alg`는 `HS256`이고, payload의 `exp − iat ≤ 900`(초, 15분), `iat ≤ now()`이다. `alg`가 `RS256`/`none`/기타이거나 `exp − iat > 900`이면 테스트 실패. → REQ-AUTH-004

#### AC-AUTH-028: Refresh Token 디코딩 — alg=HS256, exp delta ≤ 7일

- **Given** ACTIVE 회원의 유효 자격증명
- **When** `POST /api/auth/login` 응답의 `Set-Cookie` 헤더에서 RT 값을 추출하여 디코딩
- **Then** JOSE header의 `alg`는 `HS256`이고, payload의 `exp − iat ≤ 604800`(초, 7일)이다. `alg ≠ HS256` 또는 `exp − iat > 604800`이면 테스트 실패. → REQ-AUTH-004

#### AC-AUTH-029: Refresh Token 쿠키 속성 — httpOnly + secure + sameSite=strict

- **Given** 프로덕션 모드(`NODE_ENV=production`)에서의 정상 로그인 응답
- **When** 응답의 `Set-Cookie` 헤더(RT)를 파싱
- **Then** 쿠키 속성에 `HttpOnly`, `Secure`, `SameSite=Strict`가 모두 포함되며, `Path=/api/auth`, `Max-Age ≤ 604800`(7일)이다. 어느 하나라도 누락/불일치 시 테스트 실패. → REQ-AUTH-004 (CSRF/XSS 방어)

---

### M4. 동/호수 인증 (AUTH-04)

#### AC-AUTH-014: 정상 인증 — 200 + verified=true

- **Given** 인증된 사용자(유효 AT 보유, `verified_at=NULL`)와 빈 호수(`units.id=X`, 어떤 회원도 `unit_id=X`로 인증하지 않음)
- **When** 클라이언트가 `POST /api/auth/verify-unit`에 `{building_id, unit_id}` 제출
- **Then** 시스템은 `200` 응답과 `{data: {building: "A동", unit: "101", verified_at: "2026-06-21T..."}}`을 반환하고, DB `users.unit_id`가 설정되며 `users.verified_at`이 현재 시각으로 갱신됨

#### AC-AUTH-015: 동대표(REP) managed_building 자동 연결

- **Given** `role=REP`인 인증된 사용자가 동/호수 인증을 시도 (`users.managed_building_id`는 NULL). SETUP 마이그레이션 선행 전이라면 테스트는 해당 컬럼을 stub 한다 (§3 Dependency #6).
- **When** 클라이언트가 `POST /api/auth/verify-unit`에 해당 building_id와 unit_id 제출
- **Then** 시스템은 `200` 응답을 반환하고, 사용자의 `unit_id`가 설정되며, 동시에 해당 회원의 **`users.managed_building_id`** 가 인증한 building_id로 자동 연결됨 (비공개 건의 열람 권한 위임 기반 데이터). → REQ-AUTH-011

#### AC-AUTH-016: 동일 호수 중복 인증 — 409

- **Given** `units.id=X`에 이미 회원 A가 `unit_id=X`로 인증 완료
- **When** 다른 회원 B가 동일 `unit_id=X`로 `POST /api/auth/verify-unit` 제출
- **Then** 시스템은 `409 CONFLICT` 응답과 "해당 호수에 이미 등록된 입주민이 있습니다. 관리사무소에 문의하세요." 메시지를 반환하고, 회원 B의 `unit_id`는 변경되지 않음

#### AC-AUTH-017: 미존재 building/unit — 422

- **Given** DB에 존재하지 않는 `building_id` 또는 `unit_id` (또는 building_id에 속하지 않는 unit_id)
- **When** 클라이언트가 `POST /api/auth/verify-unit` 제출
- **Then** 시스템은 `422 VALIDATION_ERROR` 응답을 반환. → REQ-AUTH-010a

#### AC-AUTH-018: 미인증 회원 메인 접근 차단 — 리다이렉트

- **Given** 로그인은 했으나 `verified_at=NULL`인 회원의 Access Token
- **When** 클라이언트가 `/notices`, `/suggestions`, `/parking` 등 메인 경로 접근
- **Then** 미들웨어가 요청을 가로채어 `/verify`로 리다이렉트하고, 메인 기능은 노출되지 않음

#### AC-AUTH-019: 비로그인 접근 차단 — /login 리다이렉트

- **Given** 인증 토큰 없는 요청
- **When** 클라이언트가 `/notices` 등 보호 경로 접근
- **Then** 미들웨어가 `/login`으로 리다이렉트

---

### M5. 강제 탈퇴 (AUTH-07)

#### AC-AUTH-020: ADMIN 강제 탈퇴 — 5단계 원자적 처리

- **Given** ADMIN 역할 사용자(유효 AT)와 탈퇴 대상 일반 회원(target, `status=ACTIVE`, `unit_id=X`, 작성 건의 3개, 활성 RT 2개 존재)
- **When** ADMIN이 `POST /api/auth/users/{target.id}/deactivate` 제출
- **Then** 시스템은 `200` 응답을 반환하고, 단일 트랜잭션 내에서 다음이 모두 적용됨:
  1. `users.status = "INACTIVE"`
  2. 대상 회원의 모든 건의: `archived=true`, `author_label="전 입주민"`, `author_id=NULL` (단, `unit_id`는 유지 — 호수 귀속 보존, ADR-005). 이 `suggestions` 컬럼 사이드이펙트는 AUTH가 소유하는 도메인 동작이다 (SUGGEST CRUD/답변/상태 외, §2.1 및 Exclusion #5).
  3. 대상 회원 `role` → RESIDENT 환원 (의미상 직책 회수)
  4. `users.unit_id = NULL`, `users.verified_at = NULL` (해당 호수 X는 신규 인증 가능 상태로)
  5. 대상 회원의 모든 활성 RT가 `revoked_refresh_tokens`에 일괄 등록

#### AC-AUTH-021: 탈퇴된 회원 토큰 즉시 무효화

- **Given** AC-AUTH-020 완료 후, 탈퇴된 회원이 이전에 발급받은 Refresh Token을 보유
- **When** 해당 RT로 `POST /api/auth/refresh` 제출
- **Then** 시스템은 `401 UNAUTHORIZED`를 반환 (블랙리스트 조회 결과 일치)

#### AC-AUTH-022: ADMIN 자체 강제 탈퇴 금지 — 403

- **Given** ADMIN 본인의 user.id
- **When** ADMIN이 `POST /api/auth/users/{self.id}/deactivate` 제출
- **Then** 시스템은 `403 FORBIDDEN` 응답을 반환하고, ADMIN 계정은 변경되지 않음 (운영자 자물쇠 회피)

#### AC-AUTH-023: ADMIN 아닌 사용자 강제 탈퇴 시도 — 403

- **Given** RESIDENT/CHAIR/REP/AUDITOR 역할 사용자의 유효 AT
- **When** 해당 사용자가 `POST /api/auth/users/{target.id}/deactivate` 제출
- **Then** 시스템은 `403 FORBIDDEN` 응답을 반환 (RBAC 미들웨어 차단). → REQ-AUTH-016

#### AC-AUTH-024: 강제 탈퇴 트랜잭션 롤백

- **Given** 강제 탈퇴 처리 중 5단계 중간(예: 건의 아카이브 단계)에 DB 오류 발생 상황 (테스트용 강제 실패 주입)
- **When** ADMIN이 `POST /api/auth/users/{target.id}/deactivate` 제출
- **Then** 시스템은 트랜잭션을 ROLLBACK하고 `500` 응답을 반환하며, 대상 회원의 상태(`status`, `unit_id`, 건의 등)는 호출 전과 동일하게 유지됨 (부분 적용 방지)

---

### 보안 검증 (Cross-cutting)

#### AC-AUTH-025: password_hash 노출 방지

- **Given** 임의의 인증 API 응답 (login, signup, refresh, verify-unit, deactivate)
- **When** 응답 본문을 검사
- **Then** `password_hash` 필드가 응답에 포함되지 않음 (직렬화 단계에서 제외)

#### AC-AUTH-026: SQL Injection 방어

- **Given** 이메일 필드에 SQL 인젝션 페이로드(`' OR '1'='1`, `; DROP TABLE users;--`)를 포함한 로그인 요청
- **When** 클라이언트가 `POST /api/auth/login` 제출
- **Then** 시스템은 Parameterized Query로 처리하여 정상적인 401 응답을 반환하고, DB는 변조되지 않음

---

## 2. Edge Cases (경계 조건)

### 회원가입

- 이메일이 RFC 5322 형식 위반 (예: `not-an-email`, `@example.com`, `user@`)
- 이메일이 255자 초과
- 비밀번호가 1000자 이상 (DoS 방지)
- `password_confirm` 불일치
- 이메일 대소문자 (`User@Example.com` vs `user@example.com` — 소문자 정규화 필요)
- 동시에 동일 이메일로 두 요청 (race condition — UNIQUE 제약으로 409 보장)

### 로그인

- 비밀번호에 공백/특수문자 포함
- 잠금 직전 4회 실패 후 성공 → 카운트 초기화 확인
- 잠금 중 올바른 비밀번호 제출 → 여전히 429
- 잠금 만료 직전/직후 경계 시간 테스트
- ACTIVE가 아닌(INACTIVE) 회원 로그인 시도 → 401 (강제 탈퇴된 계정)

### 토큰 갱신

- AT 만료 + RT 유효 → 새 AT 발급
- AT 만료 + RT 만료 → 401 (재로그인)
- RT 쿠키 없음 → 401
- RT 서명 위조 → 401
- 동일 RT로 두 번 갱신 시도 (두 번째는 블랙리스트 처리 여부 — 본 SPEC은 선택적)

### 동/호수 인증

- 이미 인증된 회원이 재인증 시도 (현재 `verified_at`이 NULL이 아님) → 409 또는 422 (정책 결정 필요, 기본: 409)
- REP이 아닌 역할이 managed_building 연결 시도 → 연결 발생하지 않음
- building_id는 유효하나 unit_id가 다른 building의 것 → 422

### 강제 탈퇴

- 이미 INACTIVE인 회원 재탈퇴 시도 → 멱등성 (200 또는 409, 정책 결정 필요)
- 탈퇴 대상이 작성한 건의가 0개인 경우 → 정상 처리 (빈 아카이브)
- 탈퇴 대상이 활성 RT가 0개인 경우 → 정상 처리 (빈 블랙리스트 등록)
- 존재하지 않는 user.id → 404

---

## 3. 성능 기준

| API | P50 응답 시간 | P95 응답 시간 | 비고 |
|-----|:-------------:|:-------------:|------|
| POST /signup | 300ms 이하 | 500ms 이하 | bcrypt 해시 포함 |
| POST /login | 300ms 이하 | 500ms 이하 | bcrypt 비교 포함 |
| POST /logout | 100ms 이하 | 200ms 이하 | RT 블랙리스트 INSERT |
| POST /refresh | 50ms 이하 | 150ms 이하 | 블랙리스트 조회 + JWT 서명 |
| POST /verify-unit | 100ms 이하 | 250ms 이하 | 2회 DB 조회 + 1회 UPDATE |
| POST /users/[id]/deactivate | 300ms 이하 | 700ms 이하 | 5단계 트랜잭션 |

측정 환경: Railway Standard 인스턴스, PostgreSQL 같은 리전.

---

## 4. 동시성 및 확장성

- **동시 회원가입 (동일 이메일)**: UNIQUE 제약으로 한 요청만 성공 (201), 나머지 409
- **동시 verify-unit (동일 호수)**: 유니크 제약 또는 애플리케이션 락으로 한 요청만 성공 (200), 나머지 409
- **동시 강제 탈퇴 (동일 대상)**: 트랜잭션 직렬화로 첫 요청만 성공, 이후 요청은 이미 INACTIVE 상태로 감지
- **서버 재시작 후 Rate Limit 상태**: `login_attempts` DB 영속화로 잠금 상태 유지
- **서버 재시작 후 RT 블랙리스트**: `revoked_refresh_tokens` DB 영속화로 폐기 목록 유지

---

## 5. 품질 게이트 (Quality Gate)

### TRUST 5 준거

| 차원 | 기준 |
|------|------|
| **Tested** | 커버리지 85% 이상, 모든 AC 시나리오 자동화 테스트 포함 |
| **Readable** | 한국어 주석 (핵심 도메인 로직), 명확한 함수명, ESLint 경고 0 |
| **Unified** | Prettier 포맷팅 적용, TypeScript strict 모드, 일관된 에러 응답 형식 |
| **Secured** | OWASP Top 10 점검 (A01~A10), 비밀번호 평문 저장 0건, SQL Injection 방어, JWT 시크릿 노출 0건 |
| **Trackable** | Conventional Commits, 각 커밋에 SPEC-AUTH-001 참조, MX 태그 적용 |

### 자동화 테스트 요건

- 단위 테스트: 각 라이브러리 함수 (`auth.ts`, `rate-limit.ts`, `middleware.ts`)
- 통합 테스트: 각 API route handler (실제 PostgreSQL 테스트 DB 사용)
- E2E 테스트: 회원가입 → 인증 → 로그인 → 로그아웃 전체 흐름
- 보안 테스트: SQL Injection, XSS, CSRF 시나리오 포함

### Definition of Done (완료 정의)

- [ ] 모든 AC-AUTH-001 ~ AC-AUTH-029 시나리오 통과 (AC-027/028/029: JWT 디코딩 및 RT 쿠키 속성 검증 포함)
- [ ] Edge Cases 섹션의 정책 미결정 항목 해결 (재인증 시도, 재탈퇴 멱등성)
- [ ] 성능 기준 P95 달성
- [ ] 커버리지 85% 이상
- [ ] TRUST 5 게이트 5/5 통과
- [ ] 보안 정기 점검 (eslint-plugin-security, npm audit) 이슈 0건
- [ ] `acceptance.md`의 모든 항목 자동화 테스트로 검증 가능

---

## 6. 미결정 항목 (Open Questions — Run Phase 해결)

1. **재인증 시도 정책**: 이미 `verified_at`이 설정된 회원이 다시 `POST /verify-unit` 호출 시 → 409(거부) vs 422(검증 오류) vs 200(재설정 허용)? 권장: **409 CONFLICT** (이미 인증됨)
2. **재탈퇴 멱등성**: 이미 INACTIVE인 회원에 대한 강제 탈퇴 재시도 → 200(멱등) vs 409(충돌) vs 404(없음)? 권장: **200 멱등** (이미 탈퇴된 상태 유지)
3. **RT 재사용 갱신 정책**: 동일 RT로 두 번째 `POST /refresh` 호출 → 허용 vs 블랙리스트 등록 후 거부? 권장: **허용** (단순성, 38세대 규모에서 위험 낮음)
4. **만료된 RT 블랙리스트 정리**: `revoked_refresh_tokens.expires_at < now()` 레코드 자동 삭제 → 구현 vs 보존? 권장: **보존** (감사 목적, 38세대 규모에서 DB 부하 무시)

이상 4개 항목은 Run Phase TDD 시작 전 사용자 확인 후 확정한다.

---

*본 acceptance.md는 `spec.md`의 요구사항을 관측 가능한 검증 기준으로 구체화한다. 모든 AC는 자동화 테스트로 검증 가능해야 한다.*
