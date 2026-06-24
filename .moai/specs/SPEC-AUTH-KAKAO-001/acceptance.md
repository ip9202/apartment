---
spec_id: "SPEC-AUTH-KAKAO-001"
title: "카카오 OAuth 2.0 소셜 로그인 검수 기준"
phase: "plan"
status: "draft"
created: "2026-06-24"
updated: "2026-06-24"
author: "강력쇠주먹"
priority: "High"
issue_number: ""
labels: ["auth", "oauth", "kakao", "social-login", "acceptance"]
---

# SPEC-AUTH-KAKAO-001 Acceptance Criteria

본 문서는 `spec.md`의 각 REQ에 대해 Given-When-Then 시나리오를 정의한다. 각 모듈당 최소 2개 시나리오, 총 19개 검증 케이스를 포함한다 (REQ-KAKAO-001 ~ REQ-KAKAO-017). 카카오 API 호출은 `vi.fn()` / `msw`로 모킹하여 외부 의존성을 분리한다.

---

## 1. 카카오 인증 시작 (REQ-KAKAO-001, REQ-KAKAO-002)

### AC-KAKAO-001: 정상 인증 시작 리다이렉트

**Given** 서버가 정상 부팅되고 카카오 환경 변수 3종이 설정되어 있다
**When** 클라이언트가 `GET /api/auth/kakao`로 요청한다
**Then**
- 응답이 `302` 상태 코드
- `Location` 헤더가 `https://kauth.kakao.com/oauth/authorize`로 시작
- URL에 `client_id=<KAKAO_REST_API_KEY>`, `redirect_uri=<KAKAO_REDIRECT_URI>`, `response_type=code`, `state=<난수>`, `scope=account_email` 포함
- `Set-Cookie` 헤더에 `state` 쿠키가 httpOnly + SameSite=Lax + **Max-Age=600** 으로 설정 (TTL 600초 초과 금지, REQ-KAKAO-001)
- `state` 쿠키값과 URL `state` 파라미터가 일치

### AC-KAKAO-002: 환경 변수 누락 시 500

**Given** `KAKAO_REST_API_KEY`가 누락된 환경 (또는 부트 검증을 우회한 상태)
**When** 클라이언트가 `GET /api/auth/kakao`로 요청한다
**Then**
- 응답이 `500` 상태 코드
- 응답 본문에 "카카오 로그인 설정 오류" 메시지
- 카카오로 리다이렉트하지 않음

---

## 2. 카카오 콜백 — state 검증 (REQ-KAKAO-003, REQ-KAKAO-004)

### AC-KAKAO-003: state 일치 시 토큰 교환 진행 및 쿠키 즉시 폐기

**Given** 인증 시작 시 발급된 `state` 쿠키(Max-Age=600)가 클라이언트에 존재한다
**When** 카카오가 `GET /api/auth/kakao/callback?code=valid_code&state=<동일값>`로 리다이렉트한다
**Then**
- 서버가 카카오 토큰 교환 API(`POST kauth.kakao.com/oauth/token`)를 호출
- `state` 쿠키가 응답에서 만료 처리(Max-Age=0) — 콜백 완료 시점에 즉시 삭제되어 1회성 사용 보장 (REQ-KAKAO-001, §6.1)
- 200 또는 최종 리다이렉트 응답 반환

### AC-KAKAO-004: state 불일치 시 400

**Given** 클라이언트의 `state` 쿠키값이 `abc123`이다
**When** 카카오가 `GET /api/auth/kakao/callback?code=valid_code&state=xyz789`로 리다이렉트한다
**Then**
- 응답이 `400 Bad Request`
- 응답 본문에 "잘못된 접근입니다" 메시지
- 카카오 토큰 교환 API를 호출하지 않음 (mock fetch 검증)

### AC-KAKAO-005: state 쿠키 없는 콜백 시 400

**Given** 클라이언트에 `state` 쿠키가 없다 (직접 URL 접근 등)
**When** 카카오가 `GET /api/auth/kakao/callback?code=valid_code&state=abc123`로 리다이렉트한다
**Then**
- 응답이 `400 Bad Request`
- 카카오 토큰 교환 미진행

---

## 3. 카카오 사용자 정보 조회 (REQ-KAKAO-005, REQ-KAKAO-006)

### AC-KAKAO-006: 정상 사용자 정보 조회

**Given** 카카오 토큰 교환이 성공하여 카카오 액세스 토큰을 획득했다
**When** 서버가 `GET https://kapi.kakao.com/v2/user/me`에 `Authorization: Bearer <token>`로 요청한다
**Then**
- 카카오 고유 ID(`id`)와 이메일(`kakao_account.email`)을 추출
- 이메일이 정규식으로 유효한 형식

### AC-KAKAO-007: 카카오 이메일 누락 시 거부

**Given** 카카오 사용자 정보 응답에 이메일이 없다 (미동의)
**When** 콜백 처리가 진행된다
**Then**
- 계정 연결/가입을 진행하지 않음
- 로그인 화면으로 리다이렉트하며 "이메일 제공 동의가 필요합니다" 안내
- JWT 세션을 발급하지 않음

---

## 4. 계정 연결 — 기존 이메일 일치 (REQ-KAKAO-007)

### AC-KAKAO-008: 기존 이메일 계정에 카카오 연결 + 알림 발송

**Given** DB에 `email='resident@example.com'`, `provider='email'`, `provider_id=NULL`인 회원이 존재한다
**When** 카카오 이메일이 `resident@example.com`이고 카카오 ID가 `12345`인 사용자가 로그인한다
**Then**
- 기존 회원 레코드의 `provider`가 `'kakao'`로 갱신
- `provider_id`가 `'12345'`로 갱신
- `role_id`, `unit_id`, `verified_at`, `status`, **`password_hash`**는 변경 없음 (이메일/비밀번호 로그인 경로 보존, REQ-KAKAO-017)
- JWT 세션(AT + RT) 발급
- **최초 1회 연결 알림 이메일**이 `resident@example.com`으로 발송됨 (메일 발송 mock으로 검증 — "카카오 계정이 연결되었습니다" 본문)

---

## 5. 계정 연결 — 신규 가입 (REQ-KAKAO-008)

### AC-KAKAO-009: 신규 이메일 시 RESIDENT 자동 가입

**Given** DB에 `newuser@example.com` 이메일이 존재하지 않는다
**When** 카카오 이메일이 `newuser@example.com`, 카카오 ID `67890`인 사용자가 로그인한다
**Then**
- 신규 `users` 레코드 생성
- `role=RESIDENT`, `provider='kakao'`, `provider_id='67890'`, `password_hash=NULL`, `verified_at=NULL`, `status=ACTIVE`
- JWT 세션 발급
- 클라이언트가 `/verify`로 리다이렉트 (verified=false)

---

## 6. 카카오 ID 중복 방지 (REQ-KAKAO-009)

### AC-KAKAO-010: 이미 연결된 카카오 ID 거부

**Given** DB에 `email='user1@example.com'`, `provider='kakao'`, `provider_id='12345'`인 회원이 존재한다
**When** 카카오 ID `12345`, 이메일 `user2@example.com`(미가입)인 사용자가 로그인을 시도한다
**Then**
- 응답이 `409 Conflict`
- "이미 다른 계정에 연결된 카카오 계정입니다" 메시지
- 신규 가입 또는 기존 계정 연결 미진행

---

## 7. INACTIVE 계정 차단 (REQ-KAKAO-010)

### AC-KAKAO-011: 강제 탈퇴 계정 카카오 로그인 거부

**Given** DB에 `email='banned@example.com'`, `status='INACTIVE'`, `verified_at=NULL`인 회원이 존재한다
**When** 카카오 이메일 `banned@example.com`인 사용자가 카카오 로그인을 시도한다
**Then**
- 응답이 `403 Forbidden`
- "관리사무소에 문의하세요" 메시지
- `provider`/`provider_id` 갱신 미진행
- JWT 세션 미발급

---

## 8. 세션 발급 및 리다이렉트 (REQ-KAKAO-011, REQ-KAKAO-012)

### AC-KAKAO-012: verified=true 사용자 메인 리다이렉트

**Given** 카카오 로그인으로 연결된 기존 계정의 `verified_at`이 NOT NULL이다
**When** 콜백 처리가 완료된다
**Then**
- AT가 `at` httpOnly 쿠키로 설정 (속성: 기존 `buildAccessCookie`와 동일)
- RT가 `rt` httpOnly 쿠키로 설정 (속성: 기존 `buildRefreshCookie`와 동일)
- 클라이언트가 `/` (메인)로 리다이렉트

### AC-KAKAO-013: verified=false 사용자 /verify 리다이렉트

**Given** 카카오 로그인으로 신규 가입한 계정의 `verified_at=NULL`이다
**When** 콜백 처리가 완료된다
**Then**
- AT + RT 쿠키 설정
- 클라이언트가 `/verify`로 리다이렉트
- 후속 `/api/auth/me` 호출 시 `verified:false` 반환

---

## 9. 카카오 토큰 미저장 (REQ-KAKAO-013)

### AC-KAKAO-014: 카카오 토큰 DB/로그 미저장

**Given** 카카오 로그인 콜백이 정상 처리되었다
**When** 처리 완료 후 DB와 애플리케이션 로그 출력을 검사한다
**Then**
- DB에 카카오 access_token, refresh_token 컬럼/레코드 없음
- 애플리케이션의 구조화 로거(`console` 또는 프로젝트 로깅 라이브러리) 출력에 카카오 토큰 평문이 마스킹되었거나 미포함 — 테스트는 `vi.spyOn(console, ...)` 또는 로거 mock으로 캡처한 출력에서 정규식 `/ya29\.[A-Za-z0-9_-]+|access_token.*[A-Za-z0-9]{20,}/` 매치가 0건임을 검증 (Next.js 앱은 파일시스템 `logs/` 디렉토리를 사용하지 않으므로 `grep logs/` 사용 금지)

---

## 10. 프론트엔드 카카오 버튼 (REQ-KAKAO-014, REQ-KAKAO-015)

### AC-KAKAO-015: 카카오 버튼 클릭 시 인증 시작 (3뷰포트)

**Given** 3개 뷰포트 컴포넌트(`MobileApp.tsx`, `TabletApp.tsx`, `DesktopApp.tsx`) 각각에 "카카오로 시작하기" 버튼이 렌더링되어 있다 (`TabletApp`은 stub 교체, `MobileApp`·`DesktopApp`은 신규 추가)
**When** 각 뷰포트에서 사용자가 "카카오로 시작하기" 버튼을 클릭한다
**Then**
- `window.location.href`가 `/api/auth/kakao`로 변경
- 가짜 로그인(`doLogin('kakao@user.com','kakao')`) 호출 안 함
- `useAuth.kakaoLogin()` 액션이 트리거
- 3개 컴포넌트 모두 동일한 `kakaoLogin()` 액션을 호출하는지 개별 검증 (fan_in >= 3, @MX:ANCHOR 대상)

### AC-KAKAO-016: stub 비활성 코드 제거 및 신규 버튼 추가 검증

**Given** 본 SPEC 구현이 완료되었다
**When** 다음 검증을 수행한다
**Then**
- `grep -rn "kakao@user.com" src/components/` → 0 matches (TabletApp 가짜 카카오 로그인 코드 완전 제거)
- `grep -rn "카카오로 시작하기\|kakaoLogin" src/components/MobileApp.tsx` → 1+ match (신규 카카오 버튼 추가됨)
- `grep -rn "카카오로 시작하기\|kakaoLogin" src/components/DesktopApp.tsx` → 1+ match (신규 카카오 버튼 추가됨)
- `grep -rn "disabled.*카카오\|준비 중" src/components/` → 0 matches (disabled + "준비 중" 라벨 제거)

---

## 11. 통합 시나리오 (End-to-End)

### AC-KAKAO-017: 신규 사용자 카카오 로그인 전체 플로우

**Given** DB에 카카오 이메일에 해당하는 계정이 없다. 카카오 개발자콘솔 설정이 완료되어 있다.
**When**
1. 사용자가 로그인 화면에서 카카오 버튼 클릭
2. 카카오 인증 화면에서 동의
3. 카카오가 콜백 URL로 리다이렉트
4. 서버가 code → token 교환 → 사용자 정보 조회 → 신규 가입 → 세션 발급
5. 클라이언트가 `/verify`로 리다이렉트
**Then**
- `users` 테이블에 신규 레코드 생성 (provider='kakao', verified_at=NULL)
- AT/RT 쿠키 설정
- `/api/auth/me` 호출 시 신규 사용자 정보 반환
- `/verify` 화면 표시

### AC-KAKAO-018: 기존 이메일 사용자 카카오 연결 전체 플로우 + 비밀번호 로그인 보존

**Given** DB에 `email='existing@example.com'`, `provider='email'`, `password_hash='<bcrypt hash>'`, `verified_at` NOT NULL인 회원이 존재한다
**When** 동일 이메일로 카카오 로그인을 시도한다
**Then**
- 기존 레코드의 provider='kakao', provider_id 갱신
- `verified_at` 유지 (재인증 불필요)
- `password_hash` 유지 (자동 연결 후에도 이메일/비밀번호 로그인 가능)
- 메인 화면(`/`)으로 리다이렉트
- 기존 데이터(unit_id, role) 유지
- 후속 `POST /api/auth/login` (email + 기존 비밀번호) 요청이 200 성공 — `provider='kakao'`로 변경되어도 이메일/비밀번호 로그인이 차단되지 않음 (REQ-KAKAO-017 silent lockout 방지)
- 최초 연결 알림 이메일 발송됨 (REQ-KAKAO-007, REQ-KAKAO-017)

### AC-KAKAO-019: 기존 provider='kakao' 계정에 대한 연결 거부 (탈취 방어)

**Given** DB에 `email='victim@example.com'`, `provider='kakao'`, `provider_id='99999'`인 회원이 존재한다 (이미 카카오 A가 연결됨)
**When** 공격자가 카카오 B(provider_id='88888')로 `victim@example.com` 이메일을 사용하여 카카오 로그인을 시도한다
**Then**
- 응답이 `409 Conflict` (또는 보안상 동등한 거부 응답)
- 기존 회원 레코드의 `provider_id`는 `'99999'`로 유지 (변경 없음)
- 공격자 카카오 ID `88888`로 세션 미발급
- "이미 다른 카카오 계정에 연결된 이메일입니다" 안내 (사용자 열거 방지를 위해 통일 메시지 고려)

### AC-KAKAO-020: 신규 kakao 가입자(password_hash=NULL)의 이메일/비밀번호 로그인 거부

**Given** 카카오 로그인으로 신규 가입한 회원의 `password_hash=NULL`이다 (REQ-KAKAO-008)
**When** 해당 이메일로 `POST /api/auth/login`을 아무 비밀번호로 시도한다
**Then**
- 응답이 `401` (통일된 자격증명 오류 메시지 — 사용자 열거 방지)
- `password_hash`가 NULL이므로 `comparePassword` 단계에서 거부됨 (기존 `src/app/api/auth/login/route.ts` L88 로직과 일관)

---

## 12. 엣지 케이스 (Edge Cases)

### EC-KAKAO-001: 카카오 API 장애 시 폴백

**Given** 카카오 토큰 교환 API가 500 응답한다
**When** 콜백 처리가 진행된다
**Then**
- 사용자에게 "카카오 로그인을 일시적으로 사용할 수 없습니다" 안내
- 이메일 로그인 화면으로 리다이렉트
- 자동 재시도 없음

### EC-KAKAO-002: code 만료/무효

**Given** 카카오가 리다이렉트한 code가 만료되었거나 무효이다
**When** 서버가 토큰 교환을 시도한다
**Then**
- 카카오 API가 에러 응답
- 서버가 400 반환 및 "카카오 로그인을 다시 시도해 주세요" 안내

### EC-KAKAO-003: 동일 브라우저 2탭 카카오 로그인 충돌

**Given** 사용자가 2개 탭에서 거의 동시에 카카오 로그인을 시작했다
**When** 두 콜백이 거의 동시에 도착한다
**Then**
- 두 번째 콜백의 state가 첫 번째 콜백 처리로 인해 쿠키가 만료되어 400 반환
- 사용자가 재시도 시 정상 동작

### EC-KAKAO-004: 카카오 ID 타입 처리

**Given** 카카오 사용자 정보 API의 `id` 필드가 number 타입이다 (BigInt 위험)
**When** 서버가 `provider_id`로 저장한다
**Then**
- 문자열로 변환하여 저장 (number→string)
- Zod 스키마에서 `z.coerce.string()` 또는 명시적 변환

---

## 13. 품질 게이트 (Quality Gates)

### 13.1 TRUST 5

| 항목 | 기준 | 검증 방법 |
|------|------|-----------|
| Tested | 85%+ 커버리지 | `npm test -- --coverage` |
| Readable | 한국어 주석, 명확한 함수명 | 코드 리뷰 |
| Unified | prettier/eslint 통과 | `npm run lint` |
| Secured | state CSRF, Client Secret 보호, 토큰 미저장 | 보안 체크리스트 |
| Trackable | conventional commits, SPEC-ID 참조 | git log 검증 |

### 13.2 LSP 게이트

- TypeScript: 0 errors, 0 type errors
- ESLint: 0 errors, max 5 warnings
- Run Phase 기준 준수

### 13.3 보안 체크리스트

- [ ] `KAKAO_CLIENT_SECRET`가 소스 코드에 하드코딩되지 않음
- [ ] 카카오 토큰이 DB/쿠키/로그에 저장되지 않음
- [ ] state가 예측 불가능한 난수 (crypto.randomUUID)
- [ ] state 쿠키가 httpOnly (JS 접근 차단)
- [ ] 콜백이 CSRF 방어 (state 불일치 시 400)
- [ ] 모든 DB 쿼리가 parameterized query
- [ ] 카카오 API 호출이 서버 측에서만 수행

---

## 14. Definition of Done

본 SPEC이 "완료"로 간주되려면:

1. [ ] 모든 REQ-KAKAO-001 ~ REQ-KAKAO-017이 구현됨
2. [ ] 모든 AC-KAKAO-001 ~ AC-KAKAO-020 시나리오가 통과
3. [ ] 엣지 케이스 EC-KAKAO-001 ~ 004 처리 검증
4. [ ] Migration 011이 멱등 적용 및 롤백 검증
5. [ ] TRUST 5 게이트 통과 (85%+ 커버리지, lint 0 errors)
6. [ ] 보안 체크리스트 7/7 충족
7. [ ] `TabletApp.tsx` 카카오 버튼 stub이 실구현으로 교체됨 + `MobileApp.tsx`·`DesktopApp.tsx`에 카카오 버튼 신규 추가됨 (3뷰포트 UX 일관성)
8. [ ] `useAuth.kakaoLogin()` 액션 추가됨
9. [ ] 카카오 개발자콘솔 설정 가이드 문서화 (README 또는 별도)
10. [ ] SPEC-INTEGRATION-AUTH-001 REQ-AUTH-INT-026 문서 업데이트 (stub→실구현)
11. [ ] 자동 연결 후 이메일/비밀번호 로그인 보존 검증 (AC-KAKAO-018, AC-KAKAO-020)
12. [ ] 최초 연결 알림 이메일 발송 검증 (AC-KAKAO-008)

---

## 15. 테스트 전략 요약

| 계층 | 도구 | 대상 |
|------|------|------|
| 단위 (Unit) | Vitest + vi.fn() | 카카오 헬퍼, 계정 연결 로직, env 검증 |
| 통합 (Integration) | Vitest + msw | 콜백 엔드포인트 전체 플로우 |
| 스키마 | Vitest + 테스트 DB | Migration 011 인덱스 검증 |
| E2E (수동) | 브라우저 + 카카오 개발자콘솔 | 실제 카카오 로그인 전체 플로우 |

카카오 외부 API는 모든 자동화 테스트에서 모킹 필수. E2E는 배포 전 수동 검증.

---

_Version: 1.0.0 | Status: Planned | Priority: High_
