---
id: "SPEC-AUTH-RESET-001"
version: "1.0.0"
status: "Planned"
created: "2026-06-23"
updated: "2026-06-23"
author: "강력쇠주먹"
priority: "P1"
---

# SPEC-AUTH-RESET-001: 인수 기준 (Acceptance Criteria)

비밀번호 재설정 기능의 Given-When-Then 검증 시나리오. 총 16개 케이스로 구성되며, 각 요구사항(REQ-RESET-001 ~ 009)에 대해 관측 가능한 증거를 정의한다.

---

## 1. 재설정 요청 (Reset Request) — REQ-RESET-001, 002, 003

### AC-RESET-001: 가입된 이메일로 재설정 요청 시 토큰 생성 및 이메일 발송

**Given** 데이터베이스에 `user@example.com`으로 가입된 활성 사용자가 존재한다
**When** `POST /api/auth/password/reset/request`에 `{ "email": "user@example.com" }`를 제출한다
**Then**
- 응답 상태 코드는 `200`이다
- 응답 본문은 `"이메일이 존재하면 재설정 링크를 발송했습니다"` 메시지를 포함한다
- `password_reset_tokens` 테이블에 새 레코드가 생성된다 (user_id 매칭, `used_at IS NULL`, `expires_at` = 요청 시각 + 30분)
- 저장된 `token_hash`는 SHA-256 해시(64자 hex) 형태이다
- 이메일 발송 모듈이 재설정 링크(`{APP_URL}/reset-password?token=...`) 포함 이메일을 1회 발송했다 (mock 검증 또는 SMTP 로그)

### AC-RESET-002: 미가입 이메일로 재설정 요청 시 동일 성공 응답 (열거 방지)

**Given** 데이터베이스에 `unknown@example.com`으로 가입된 사용자가 존재하지 않는다
**When** `POST /api/auth/password/reset/request`에 `{ "email": "unknown@example.com" }`를 제출한다
**Then**
- 응답 상태 코드는 `200`이다
- 응답 본문은 AC-RESET-001과 동일한 메시지를 포함한다
- `password_reset_tokens` 테이블에 새 레코드가 생성되지 않는다
- 이메일이 발송되지 않는다
- 응답 시간은 AC-RESET-001과 유사한 범위 내에 있다 (타이밍 공격 방지 — 선택적 강화)

### AC-RESET-003: Rate Limiting 초과 시 429 응답

**Given** 동일 이메일 `user@example.com`에 대해 최근 10분 내 3회 재설정 요청이 이미 수행되었다
**When** 동일 이메일로 4번째 재설정 요청을 제출한다
**Then**
- 응답 상태 코드는 `429 Too Many Requests`이다
- 응답은 `Retry-After` 헤더 또는 재시도 안내를 포함한다
- 새 토큰 레코드가 생성되지 않는다
- 이메일이 발송되지 않는다

### AC-RESET-004: 잘못된 이메일 형식 제출 시 422 응답

**Given** 유효하지 않은 이메일 형식
**When** `POST /api/auth/password/reset/request`에 `{ "email": "not-an-email" }`를 제출한다
**Then**
- 응답 상태 코드는 `422 Unprocessable Entity`이다
- 응답은 이메일 형식 오류 메시지를 포함한다
- 토큰이 생성되지 않는다

---

## 2. 재설정 확인 (Reset Confirm) — REQ-RESET-004, 005, 006, 007, 008

### AC-RESET-005: 유효 토큰 + 강력한 비밀번호로 변경 성공

**Given** `password_reset_tokens`에 유효한 토큰 레코드가 존재한다 (`used_at IS NULL`, `expires_at > now`, token_hash = SHA-256("valid-token"))
**When** `POST /api/auth/password/reset/confirm`에 `{ "token": "valid-token", "password": "StrongP@ss1" }`를 제출한다
**Then**
- 응답 상태 코드는 `200`이다
- `users.password`가 새 bcrypt 해시(salt rounds 12)로 갱신된다
- 해당 토큰 레코드의 `used_at`이 현재 시각으로 갱신된다 (일회용 표시)
- 응답은 "비밀번호가 변경되었습니다" 메시지를 포함한다

### AC-RESET-006: 만료된 토큰으로 변경 시 400 응답

**Given** `password_reset_tokens`에 토큰 레코드가 존재하지만 `expires_at < now`이다
**When** 해당 토큰으로 비밀번호 변경을 시도한다
**Then**
- 응답 상태 코드는 `400 Bad Request`이다
- 응답은 "재설정 링크가 만료되었거나 유효하지 않습니다" 메시지를 포함한다
- `users.password`가 변경되지 않는다
- 토큰의 `used_at`이 갱신되지 않는다

### AC-RESET-007: 이미 사용된 토큰 재사용 시 400 응답 (일회용)

**Given** `password_reset_tokens`에 토큰 레코드가 존재하지만 `used_at IS NOT NULL`이다 (이미 한 번 사용됨)
**When** 동일 토큰으로 비밀번호 변경을 다시 시도한다
**Then**
- 응답 상태 코드는 `400 Bad Request`이다
- 응답은 AC-RESET-006과 동일한 만료/무효 메시지를 포함한다
- `users.password`가 변경되지 않는다

### AC-RESET-008: 존재하지 않는 토큰으로 변경 시 400 응답

**Given** 제공된 토큰의 해시가 `password_reset_tokens`에 존재하지 않는다
**When** 해당 토큰으로 비밀번호 변경을 시도한다
**Then**
- 응답 상태 코드는 `400 Bad Request`이다
- 응답은 만료/무효 메시지를 포함한다 (토큰 존재 여부 노출 금지)

### AC-RESET-009: 약한 비밀번호(8자 미만)로 변경 시 422 응답

**Given** 유효한 토큰을 가지고 있다
**When** `{ "token": "valid-token", "password": "Ab1!" }` (4자)를 제출한다
**Then**
- 응답 상태 코드는 `422 Unprocessable Entity`이다
- 응답은 비밀번호 정책 위반 메시지(8자 이상 요구)를 포함한다
- `users.password`가 변경되지 않는다
- 토큰의 `used_at`이 갱신되지 않는다 (정책 실패 시 토큰 소모 방지)

### AC-RESET-010: 약한 비밀번호(문자 클래스 누락)로 변경 시 422 응답

**Given** 유효한 토큰을 가지고 있다
**When** 영문+숫자는 있으나 특수문자가 없는 비밀번호 `{ "password": "Password1" }`를 제출한다
**Then**
- 응답 상태 코드는 `422`이다
- 응답은 특수문자 누락 메시지를 포함한다
- 비밀번호가 변경되지 않는다

### AC-RESET-011: 비밀번호 변경 후 모든 Refresh Token 무효화

**Given** 사용자가 3개의 활성 Refresh Token을 보유하고 있다 (3개의 RT가 발급된 세션)
**When** 해당 사용자가 비밀번호 재설정을 성공적으로 완료한다
**Then**
- 3개의 모든 RT가 `revoked_refresh_tokens`에 등록된다
- 기존 RT로 `/api/auth/refresh` 호출 시 `401` 응답을 반환한다 (AC-AUTH-001 무결성 유지)
- 사용자는 새 비밀번호로 재로그인해야 한다

### AC-RESET-012: 토큰 원문이 DB에 저장되지 않음 (보안)

**Given** 재설정 요청이 처리되었다
**When** `password_reset_tokens` 테이블을 직접 조회한다
**Then**
- `token_hash` 컬럼은 SHA-256 해시(64자 hex)만 포함한다
- 원문 토큰 문자열이 어느 컬럼에도 존재하지 않는다
- 애플리케이션 로그에 원문 토큰이 기록되지 않는다

---

## 3. 토큰 정리 (Housekeeping) — REQ-RESET-009

### AC-RESET-013: 만료/사용된 토큰 정리 (선택적)

**Given** `password_reset_tokens`에 만료된 레코드 5건과 사용된 레코드 10건이 존재한다
**When** 정리 로직(스케줄드 잡 또는 lazy cleanup)이 실행된다
**Then**
- 만료된(`expires_at < now`) 레코드가 삭제된다
- 사용된(`used_at IS NOT NULL`且 일정 기간 경과) 레코드가 삭제된다
- 유효한 미사용 토큰은 유지된다

*본 케이스는 REQ-RESET-009(Optional)에 해당하며 MVP 차단 조건이 아니다.*

---

## 4. 엣지 케이스 (Edge Cases)

### AC-RESET-014: 비활성(INACTIVE) 사용자의 재설정 요청

**Given** `users.status = INACTIVE`인 사용자의 이메일
**When** 재설정 요청을 제출한다
**Then**
- 응답은 AC-RESET-002와 동일하게 처리된다 (비활성 사용자는 미가입과 동일 취급, 열거 방지)
- 토큰이 생성되지 않는다
- 이메일이 발송되지 않는다

### AC-RESET-015: SMTP 발송 실패 시 처리

**Given** 가입된 이메일이지만 SMTP 서버가 응답하지 않는다
**When** 재설정 요청을 제출한다
**Then**
- 토큰 레코드는 생성된다
- 이메일 발송이 실패한다
- 응답 처리 전략(Run Phase 결정):
  - 옵션 A: `500` 에러 응답 (사용자에게 재시도 유도)
  - 옵션 B: `200` 성공 응답 + 내부 재시도/큐 (REQ-RESET-002 열거 방지 정책과 일관성)
- 실패가 애플리케이션 로그에 기록된다 (토큰 원문 제외)

### AC-RESET-016: 동일 사용자의 연속 재설정 요청 (토큰 누적)

**Given** 사용자가 이미 1개의 유효한 미사용 토큰을 보유하고 있다
**When** 동일 이메일로 재설정 요청을 다시 제출한다 (Rate Limiting 미충족)
**Then**
- 새 토큰 레코드가 추가로 생성된다 (기존 토큰은 무효화하지 않음 — 사용자가 어느 이메일이든 클릭 가능)
- 또는 정책 결정: 기존 미사용 토큰을 무효화하고 최신 토큰만 유효하게 유지 (Run Phase에서 결정, 보안 강화 옵션)

---

## 5. 품질 게이트 (Quality Gates)

### TRUST 5 검증

- **Tested**: 
  - 단위 테스트: 토큰 생성/검증/무효화, 비밀번호 정책, 이메일 모듈
  - 통합 테스트: 재설정 요청/확인 API 전체 흐름
  - 커버리지: `password-reset.ts`, `password-policy.ts` 85% 이상
- **Readable**: 
  - 함수명 명확 (`generateResetToken`, `verifyResetToken`, `invalidateResetToken`, `validatePasswordStrength`)
  - 한국어 주석 (per language.yaml code_comments: ko)
  - OWASP 보안 의도 주석 (@MX:WARN with @MX:REASON)
- **Unified**: 
  - 기존 AUTH API 응답 스키마 준수
  - ESLint/Prettier 통과
  - Conventional commits (`feat(auth-reset): ...`)
- **Secured**: 
  - OWASP 체크리스트 100% 준수 (§6.1)
  - 토큰 해시 저장 (원문 금지)
  - 사용자 열거 방지
  - 세션 무효화
  - Rate Limiting
- **Trackable**: 
  - 모든 커밋에 SPEC-AUTH-RESET-001 참조
  - 감사 로그 (요청/성공/실패 시각, 토큰 원문 제외)

---

## 6. Definition of Done (완료 기준)

본 SPEC이 "Complete" 상태가 되기 위해 다음이 모두 충족되어야 한다:

- [ ] 모든 REQ-RESET-001 ~ 008 요구사항이 구현되었다 (REQ-RESET-009는 선택적)
- [ ] 모든 AC-RESET-001 ~ 016 인수 케이스가 통과한다 (AC-RESET-013, 016 정책 결정 항목 제외)
- [ ] `password_reset_tokens` 마이그레이션이 적용 및 롤백 검증되었다
- [ ] 단위 + 통합 테스트가 통과한다
- [ ] 커버리지가 85% 이상이다 (핵심 모듈)
- [ ] ESLint가 경고 없이 통과한다
- [ ] OWASP 보안 체크리스트(§6.1)가 모두 충족된다
- [ ] MX 태그가 적용되었다 (§7)
- [ ] 환경 변수(SMTP_*) 문서가 업데이트되었다
- [ ] 기존 SPEC-AUTH-001 테스트가 회귀 없이 통과한다
- [ ] README/AUTH 도메인 API 문서에 재설정 엔드포인트가 추가되었다 (Sync Phase)

---

*본 인수 기준은 관측 가능한 증거(HTTP 응답, DB 상태, 이메일 발송, 로그)를 기준으로 작성되었다.*
