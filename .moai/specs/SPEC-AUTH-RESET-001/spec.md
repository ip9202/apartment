---
id: "SPEC-AUTH-RESET-001"
version: "1.0.0"
status: "Completed"
created: "2026-06-23"
updated: "2026-06-24"
author: "강력쇠주먹"
priority: "P1"
issue_number: 0
---

# SPEC-AUTH-RESET-001: 비밀번호 재설정 (Password Reset)

아이뜨락 아파트 커뮤니티 플랫폼의 비밀번호 재설정 기능 스펙. 본 SPEC은 AUTH 도메인 P1 항목인 AUTH-05(비밀번호 재설정, 이메일 링크 방식)을 정의하며, SPEC-AUTH-001(Complete)의 Exclusion #2를 구현한다.

---

## HISTORY

- **2026-06-23**: 최초 작성 (강력쇠주먹). PRD AUTH-05 정의 및 SPEC-AUTH-001 Exclusion #2 기반. 확정 결정: (1) DB 기반 토큰 저장(SHA-256 해시), (2) 토큰 만료 30분, (3) 사용자 열거 공격 방지를 위한 응답 통일, (4) 비밀번호 변경 후 전체 세션 무효화.

---

## 1. 배경 및 목적

비밀번호를 분실한 입주민이 이메일로 링크를 받아 비밀번호를 재설정할 수 있는 기능을 제공한다. 본 SPEC은 다음을 달성해야 한다:

- 비밀번호 분실 시 이메일 기반 자가 복구 흐름 제공 (AUTH-05)
- 보안 기본 요건 충족: 토큰 난수 생성, 만료 관리, 일회용 보장, 사용자 열거 공격 방지
- 기존 AUTH 인프라 재사용: bcrypt 해시, Refresh Token 블랙리스트, Rate Limiting

PRD 매핑: `product.md` P1 항목 "AUTH-05: 비밀번호 재설정 (이메일 링크)".

기술 결정 근거는 `.moai/project/tech.md` (ADR-003 JWT 결정, 환경 변수) 및 `SPEC-AUTH-001` research.md를 참조한다.

---

## 2. 범위

### 2.1 In-Scope (본 SPEC이 구현하는 것)

- AUTH-05: 비밀번호 재설정 요청 (이메일 입력 → 재설정 링크 발송)
- AUTH-05: 비밀번호 재설정 확인 (토큰 검증 → 새 비밀번호 설정)
- 신규 DB 테이블: `password_reset_tokens` (토큰 해시, 만료, 일회용 추적)
- 신규 API 엔드포인트 2종:
  - `POST /api/auth/password/reset/request` — 재설정 요청
  - `POST /api/auth/password/reset/confirm` — 토큰 검증 + 비밀번호 변경
- 이메일 발송 모듈 (SMTP 연동, 개발 환경 fallback)
- `users` 테이블 쓰기 (password 컬럼 업데이트)
- `revoked_refresh_tokens` 테이블 쓰기 (비밀번호 변경 후 전체 세션 무효화)
- 비밀번호 강도 정책 검증 (8자+, 영문+숫자+특수문자)

### 2.2 Out-of-Scope (별도 SPEC 또는 명시적 OUT)

- SMS 기반 비밀번호 재설정 — 현재 범위 아님
- 2단계 인증(2FA) 연동 재설정 흐름 — 현재 범위 아님
- 이전 비밀번호 재사용 방지 (password history) — P2 후보, 복잡도 증가로 연기
- 관리자(ADMIN)에 의한 강제 비밀번호 재설정 — AUTH-07(강제 탈퇴) 범위와 별개, 필요 시 별도 SPEC
- AUTH-02 카카오 소셜 로그인 사용자의 비밀번호 재설정 — OAuth 사용자는 자체 비밀번호 없음
- 이메일 템플릿 디자인 고도화 (HTML 브랜딩 등) — 최소 텍스트/단순 HTML 우선

---

## 3. 가정 및 사사전 조건 (Dependencies)

본 SPEC은 다음 사전 조건이 충족되었다고 가정한다:

1. **SPEC-AUTH-001 구현 완료**: 회원가입, 로그인, RT 블랙리스트, bcrypt 해시 로직이 구현되어 있음 (status: Complete)
2. **`users` 테이블 존재**: `id`, `email`, `password` (bcrypt 해시), `status` 컬럼 포함
3. **`revoked_refresh_tokens` 테이블 존재**: RT 블랙리스트 테이블이 마이그레이션되어 있음
4. **환경 변수 구성**:
   - `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (기존)
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` (신규 — 이메일 발송용)
   - `NEXT_PUBLIC_APP_URL` (재설정 링크 베이스 URL, 기존)
5. **HTTPS 강제**: 재설정 링크는 HTTPS 환경에서만 유효 (프로덕션 Railway HTTPS)
6. **bcrypt 의존성**: `bcrypt` (또는 `bcryptjs`) 패키지 설치됨 (salt rounds 12, 기존 일관성)
7. **이메일 발송 라이브러리**: `nodemailer` 설치 필요 (Run Phase에서 추가)

---

## 4. 기능 요구사항 (EARS)

### M1. 재설정 요청 (Reset Request)

#### REQ-RESET-001 (Event-driven) — 재설정 토큰 생성 및 이메일 발송

> **When** 가입된 이메일 주소로 비밀번호 재설정을 요청하면, the system **shall** 다음을 수행한다:
> 1. `crypto.randomBytes(32)`로 난수 토큰을 생성한다
> 2. 토큰의 SHA-256 해시를 `password_reset_tokens` 테이블에 저장한다 (원문 토큰은 DB에 저장하지 않는다)
> 3. 만료 시각(`expires_at = now + 30분`)을 설정한다
> 4. 재설정 링크(`{APP_URL}/reset-password?token={원문토큰}`)를 포함한 이메일을 발송한다

#### REQ-RESET-002 (Ubiquitous) — 사용자 열거 공격 방지

> **The system shall** 재설정 요청 시 이메일이 가입되어 있지 않더라도 동일한 성공 응답("이메일이 존재하면 재설정 링크를 발송했습니다")을 반환한다. 가입 여부에 따라 응답을 구분하지 않는다 (사용자 열거 공격 방지, OWASP 권고).

#### REQ-RESET-003 (State-driven) — Rate Limiting (이메일 폭탄 방지)

> **While** 동일 이메일 주소 또는 동일 IP에 대해 설정된 임계치(10분당 3회)를 초과한 재설정 요청이 누적된 상태인 경우, the system **shall** 추가 요청을 차단하고 `429 Too Many Requests` 응답을 반환한다 (이메일 폭탄 공격 및 토큰 남발 방지).

---

### M2. 재설정 확인 (Reset Confirm)

#### REQ-RESET-004 (Event-driven) — 유효 토큰으로 비밀번호 변경

> **When** 유효하고 만료되지 않았으며 사용되지 않은 토큰과 함께 강력한 새 비밀번호(8자 이상, 영문+숫자+특수문자 조합)가 제출되면, the system **shall** 다음을 수행한다:
> 1. 제공된 토큰의 SHA-256 해시가 DB의 레코드와 일치하는지 검증한다
> 2. 새 비밀번호를 bcrypt(salt rounds 12)로 해시하여 `users.password`에 저장한다
> 3. 해당 토큰 레코드의 `used_at`을 현재 시각으로 갱신한다 (일회용 표시)
> 4. 성공 응답을 반환한다

#### REQ-RESET-005 (Unwanted) — 만료/사용된 토큰 거부

> **If** 제공된 토큰이 만료되었거나 이미 사용된(`used_at IS NOT NULL`) 토큰이거나 DB에 존재하지 않으면, **then** the system **shall not** 비밀번호를 변경하고 `400 Bad Request` 응답과 "재설정 링크가 만료되었거나 유효하지 않습니다" 메시지를 반환한다.

#### REQ-RESET-006 (Unwanted) — 약한 비밀번호 거부

> **If** 제출된 새 비밀번호가 정책(8자 이상, 영문+숫자+특수문자 조합)을 위반하면, **then** the system **shall not** 비밀번호를 변경하고 `422 Unprocessable Entity` 응답과 정책 위반 상세 메시지를 반환한다.

#### REQ-RESET-007 (Event-driven) — 비밀번호 변경 후 전체 세션 무효화

> **When** 비밀번호 변경이 성공하면, the system **shall** 해당 사용자의 모든 기존 Refresh Token을 즉시 무효화한다 (revoked_refresh_tokens 일괄 등록). 이는 탈취된 세션이 변경 후 비밀번호로 접근하지 못하도록 강제한다.

#### REQ-RESET-008 (Unwanted) — 토큰 일회용 보장

> **If** 이미 사용된 토큰(`used_at IS NOT NULL`)으로 재차 재설정을 시도하면, **then** the system **shall not** 두 번째 변경을 허용하고 REQ-RESET-005와 동일한 오류를 반환한다 (토큰 재사용 공격 방지).

---

### M3. 토큰 정기 정리 (Housekeeping)

#### REQ-RESET-009 (Optional) — 만료 토큰 자동 정리

> **Where** 가능한 경우, the system **shall** 만료된(`expires_at < now`) 또는 사용된(`used_at IS NOT NULL`) 토큰 레코드를 정기적으로 정리하여 `password_reset_tokens` 테이블 크기를 관리한다 (스케줄드 잡 또는 lazy cleanup). 본 요구사항은 nice-to-have이며 MVP 차단 조건이 아니다.

---

## 5. Exclusions (What NOT to Build)

본 SPEC은 다음 항목을 구현하지 않는다:

1. **SMS 기반 재설정** — 이메일 링크 방식만 구현. SMS는 인프라(비용, 전화번호 수집) 부담으로 현재 범위 아님.
2. **2FA 연동 재설정** — 2FA 자체가 미구현(P2). 2FA가 도입된 후 별도 SPEC에서 연동 흐름 정의.
3. **이전 비밀번호 재사용 방지 (Password History)** — password_history 테이블 추가 + 검증 로직 필요. 복잡도 증가로 P2 후보로 연기.
4. **관리자 강제 비밀번호 재설정** — ADMIN이 특정 사용자 비밀번호를 강제 초기화하는 기능. AUTH-07과 별개이며, 필요 시 별도 SPEC(AUTH-07 확장 또는 신규).
5. **OAuth 사용자 비밀번호 재설정** — AUTH-02(카카오 로그인) 사용자는 자체 비밀번호가 없으므로 본 흐름 대상 아님. AUTH-02 구현 시 별도 처리.
6. **재설정 링크 클릭 추적 / 분석** — 마케팅/분석 목적의 추적은 OUT. 감사 로그(요청/성공/실패 시각)는 §6.4에 포함.
7. **커스텀 이메일 도메인 / 브랜딩** — 발송자 주소는 환경 변수(`SMTP_FROM`)로만 관리. HTML 템플릿 고도화는 최소 범위.

---

## 6. 비기능 요구사항 (제약)

### 6.1 보안 (Security) — OWASP 준거

- **토큰 난수 생성**: `crypto.randomBytes(32)` 사용. `Math.random()` 또는 예측 가능한 생성기 금지.
- **토큰 해시 저장**: 원문 토큰을 DB에 평문 저장 금지. SHA-256 해시만 저장 (DB 유출 시 직접 공격 방어).
- **토큰 만료**: 30분 고정. 과도한 만료 창(1시간 초과)은 토큰 유출 위험을 증가시키므로 금지.
- **토큰 일회용**: `used_at` 갱신으로 재사용 차단 (REQ-RESET-008).
- **비밀번호 해시**: bcrypt salt rounds 12 (기존 SPEC-AUTH-001 일관성).
- **사용자 열거 방지**: 재설정 요청 응답은 이메일 존재 여부를 노출하지 않는다 (REQ-RESET-002).
- **세션 무효화**: 비밀번호 변경 시 모든 RT 즉시 무효화 (REQ-RESET-007) — 탈취 세션 차단.
- **Rate Limiting**: 이메일 폭탄 공격 방지 (REQ-RESET-003).
- **HTTPS 강제**: 재설정 링크는 HTTPS에서만 유효. HTTP 요청 시 토큰이 URL에 노출되므로 프로덕션에서는 자동 리다이렉트 필수.
- **토큰 URL 노출 최소화**: 토큰은 URL 쿼리 파라미터로 전달되나, 링크 클릭 후 즉시 클라이언트에서 토큰을 메모리로 옮기고 URL에서 제거 권장 (Referer 헤더 노출 방지).
- **로그 보안**: 토큰 원문, 비밀번호(평문/해시)는 절대 로그에 기록하지 않는다.

### 6.2 성능 (Performance)

- 재설정 요청 API 응답 시간: P95 1초 이하 (이메일 발송 동기 처리 포함; 발송 지연 시 비동기 큐 도입 검토).
- 재설정 확인 API 응답 시간: P95 500ms 이하 (bcrypt 해시 연산 포함).
- 이메일 발송이 SMTP 지연으로 인해 응답을 블로킹할 경우, Run Phase에서 비동기 발송(큐/백그라운드 잡) 도입을 검토한다.

### 6.3 가용성 (Availability)

- SMTP 서버 장애 시: 재설정 요청은 실패 응답(또는 REQ-RESET-002에 따라 성공 응답 + 내부 재시도). 사용자에게 명확한 안내.
- 단일 PostgreSQL 인스턴스 의존 (기존 인프라 일관성).
- `password_reset_tokens` 테이블은 DB 기반 → 서버 재시작 후에도 유효 토큰 유지.

### 6.4 감사 (Auditability)

- 재설정 요청 이벤트: 이메일(해시 마스킹), 요청 시각, 요청 IP를 애플리케이션 로그로 기록.
- 재설정 성공 이벤트: user_id, 성공 시각을 로그로 기록.
- 재설정 실패 이벤트(만료/사용된 토큰/정책 위반): 실패 사유, 시각을 로그로 기록.
- 토큰 원문, 비밀번호는 로그에서 제외.

### 6.5 개인정보 최소화 (Data Minimization)

- `password_reset_tokens` 테이블은 토큰 해시, user_id, 만료 시각만 저장.
- 요청 IP는 감사 목적으로만 저장 (선택적, 개인정보 영향 평가 후 결정).
- 만료/사용된 토큰은 정기적으로 정리 (REQ-RESET-009).

---

## 7. MX Tag Plan (코드 주석 계획)

Run Phase에서 다음 @MX 태그를 적용한다:

### @MX:ANCHOR (fan_in >= 3 또는 공개 API 경계)

- `src/lib/password-reset.ts`: 토큰 생성/검증/무효화 함수 — 재설정 API route에서 호출
- `src/lib/email.ts`: 이메일 발송 모듈 — 재설정 외 향후 알림에서도 재사용 가능
- `POST /api/auth/password/reset/request` 엔드포인트: 외부 공개 API 경계
- `POST /api/auth/password/reset/confirm` 엔드포인트: 외부 공개 API 경계

### @MX:WARN with @MX:REASON (위험 영역)

- 토큰 난수 생성 (`crypto.randomBytes`) — `@MX:REASON: 예측 가능한 토큰은 계정 탈취로 직결`
- 토큰 SHA-256 해시 저장 — `@MX:REASON: DB 유출 시 직접 공격 방어, 원문 저장 금지`
- 토큰 만료 검증 — `@MX:REASON: 만료 창 오설정 시 토큰 유출 위험 증가`
- 토큰 일회용 처리(`used_at` 갱신) — `@MX:REASON: 재사용 공격 방어 핵심`
- 비밀번호 변경 후 전체 세션 무효화 — `@MX:REASON: 탈취 세션 지속 접근 차단`
- 사용자 열거 방지 응답 분기 — `@MX:REASON: 가입 여부 노출 시 계정 존재 확인 공격 가능`

### @MX:NOTE (도메인 의도 전달)

- 재설정 흐름 전체 — `@MX:NOTE: PRD AUTH-05, SPEC-AUTH-001 Exclusion #2 구현`
- bcrypt 재사용 — `@MX:NOTE: SPEC-AUTH-001 비밀번호 해시 로직과 일관성 유지`
- RT 블랙리스트 재사용 — `@MX:NOTE: SPEC-AUTH-001 세션 무효화 인프라 활용`

### @MX:TODO (후속 SPEC 연결 지점)

- 이메일 발송 모듈 — `@MX:TODO: P2 푸시/이메일 알림에서 재사용`
- 만료 토큰 정리 로직 — `@MX:TODO: 스케줄드 잡 인프라 도입 후 활성화`
- 비밀번호 변경 이메일 알림 — `@MX:TODO: P2 알림 시스템과 연동 시 본인 확인 알림`

---

## 8. 검증 기준 요약

상세 Given/When/Then 시나리오는 `acceptance.md`를 참조. 각 모듈당 최소 2개 시나리오, 총 12개 이상 검증 케이스를 정의한다.

---

## 9. 참조 문서

- `.moai/project/product.md`: 제품 개요 및 AUTH-05 정의 (P1)
- `.moai/project/tech.md`: 기술 스택, ADR-003, 환경 변수 목록
- `.moai/project/structure.md`: 라우팅 구조, 보안 아키텍처
- `SPEC-AUTH-001/spec.md`: 기존 인증 시스템 (의존 대상, Exclusion #2 원본)
- `plan.md` (본 디렉토리): TDD 구현 계획, 파일 목록, DB 마이그레이션
- `acceptance.md` (본 디렉토리): 검증 시나리오, 품질 게이트 기준

---

*본 SPEC은 brownfield 프로젝트 기준으로 작성되었다 (SPEC-AUTH-001 기반 통합).*
