---
spec_id: "SPEC-AUTH-KAKAO-001"
title: "카카오 OAuth 2.0 소셜 로그인 구현 계획"
phase: "plan"
status: "draft"
created: "2026-06-24"
updated: "2026-06-24"
author: "강력쇠주먹"
priority: "High"
issue_number: ""
labels: ["auth", "oauth", "kakao", "plan"]
---

# SPEC-AUTH-KAKAO-001 Implementation Plan

본 문서는 `spec.md`에 정의된 카카오 OAuth 2.0 소셜 로그인 요구사항을 TDD(RED-GREEN-REFACTOR) brownfield 강화 모드로 구현하기 위한 계획을 제시한다. 구현 디테일(정확한 함수 시그니처, API 스키마)은 Run Phase에서 확정하되, 본 계획은 파일 구조, DB 스키마 변경, 기술 결정, 리스크 완화, 마일스톤을 명시한다.

---

## 1. 기술 스택 (Constitution 준수)

| 항목 | 기술 | 버전 | 근거 |
|------|------|------|------|
| 프레임워크 | Next.js | 15 (App Router) | 기존 SPEC-AUTH-001 준거 |
| 인증 토큰 | jsonwebtoken | 기존 | `src/lib/auth.ts` 재사용 |
| 쿠키 | httpOnly 네이티브 | 기존 | `src/lib/cookies.ts` 재사용 |
| 카카오 API | fetch (네이티브) | — | 외부 HTTP 호출, 신규 의존성 최소화 |
| 런타임 | Node.js | 20+ | 카카오 콜백은 Edge 불가 (외부 fetch + DB) |
| 언어 | TypeScript | strict | 기존 프로젝트 준거 |
| 검증 | Zod | 기존 | 콜백 파라미터 검증 |

신규 npm 의존성은 추가하지 않는다. 카카오 SDK 대신 순수 OAuth 2.0 REST 호출을 사용하여 의존성 최소화 및 보안 제어력 유지.

---

## 2. 파일 생성/수정 목록

### 2.1 API Route Handlers [NEW]

```
src/app/api/auth/kakao/
├── route.ts                        # GET: 카카오 인증 시작 (state 생성 + 302 리다이렉트)
└── callback/
    └── route.ts                    # GET: code→token 교환 → 사용자 정보 → 연결/가입 → 세션 발급
```

- 둘 다 Node.js 런타임 (`export const runtime = 'nodejs'`). Edge 불가 (외부 fetch + DB + 쿠키 세팅).
- 콜백은 `GET`만 지원 (카카오가 GET 리다이렉트).

### 2.2 라이브러리 [NEW]

```
src/lib/
└── kakao.ts                        # 카카오 OAuth 헬퍼 (토큰 교환, 사용자 정보 조회, 인증 URL 빌더)
```

- `buildKakaoAuthUrl(state)`: 인증 시작 URL 생성
- `exchangeKakaoToken(code)`: 카카오 토큰 교환 API 호출
- `fetchKakaoUser(accessToken)`: 카카오 사용자 정보 API 호출
- 반환 타입은 Zod 스키마로 검증 (`KakaoUserSchema`)

### 2.3 DB 계정 연결 헬퍼 [NEW]

```
src/lib/
└── kakao-account.ts                # 이메일 기준 자동 연결/신규 가입 로직 (upsertKakaoAccount)
```

- `upsertKakaoAccount(email, kakaoId)`: 기존 이메일 일치 → 연결, 미존재 → 신규 RESIDENT 가입
- REQ-KAKAO-009 (provider_id 중복) 검사 포함
- REQ-KAKAO-010 (INACTIVE 차단) 검사 포함

### 2.4 환경 변수 [MODIFY]

```
src/lib/env.ts                      # 카카오 변수 3종 추가 + 부트 검증
.env.example                        # 템플릿 추가
.env.local                          # 운영자 실값 (커밋 제외)
.env.test                           # 테스트용 더미값
```

### 2.5 프론트엔드 [MODIFY] + [NEW]

```
src/hooks/useAuth.ts                # [MODIFY] kakaoLogin() 액션 추가
src/components/TabletApp.tsx        # [MODIFY] L477 doLogin('kakao@user.com','kakao') stub → kakaoLogin() 실구현 교체
src/components/MobileApp.tsx        # [NEW] 카카오 로그인 버튼 신규 추가 (현재 카카오 버튼 부재 — grep 0 matches 확인됨)
src/components/DesktopApp.tsx       # [NEW] 카카오 로그인 버튼 신규 추가 (현재 카카오 버튼 부재 — grep 0 matches 확인됨)
```

> **주의 (D1 정정)**: TableApp.tsx:477만 카카오 stub이 존재하며, MobileApp/DesktopApp에는 카카오 버튼 자체가 없다. 따라서 3뷰포트 UX 일관성을 위해 MobileApp/DesktopApp에 TabletApp과 동일한 스타일/트리거를 가진 카카오 버튼을 신규 추가해야 한다 (stub "교체"가 아님).

### 2.6 DB 마이그레이션 [NEW]

```
migrations/011_kakao_oauth.sql      # users(provider, provider_id) 부분 유니크 인덱스
```

### 2.7 테스트 [NEW]

```
src/lib/kakao.test.ts               # 카카오 헬퍼 단위 테스트 (mock fetch)
src/lib/kakao-account.test.ts       # 계정 연결 로직 단위 테스트
src/app/api/auth/kakao/route.test.ts            # 인증 시작 엔드포인트
src/app/api/auth/kakao/callback/route.test.ts   # 콜백 엔드포인트 (통합)
src/lib/migration-011.test.ts       # 마이그레이션 스키마 검증
```

---

## 3. 기술 결정 (Technical Decisions)

### TD-1: Authorization Code 플로우 채택 (Implicit 제외)

OAuth 2.0 Authorization Code 플로우만 사용. Implicit 플로우는 사용하지 않는다.

근거: Client Secret 보호 가능, Refresh Token 발급 가능(본 SPEC은 미사용이지만 확장성), 업계 표준.

### TD-2: 카카오 SDK 대신 순수 REST 호출

카카오 JavaScript SDK 대신 서버 측에서 `fetch`로 카카오 REST API 직접 호출.

근거: (1) 신규 npm 의존성 최소화, (2) 클라이언트 측 카카오 SDK는 보안 노출 증가, (3) 서버 측 호출로 Client Secret 보호.

### TD-3: 이메일 기준 자동 연결 (사용자 결정) + 탈취 완화

카카오 이메일이 기존 `users.email`과 일치하면 자동 연결. 단, 다음 완화 조치를 적용 (단순 "카카오 신뢰" 주장을 구체화):

1. **기존 provider 보호**: 기존 계정이 이미 `provider='kakao'` + 다른 `provider_id`인 경우 연결 거부 (409). 한 이메일 = 한 카카오 계정만 연결 강제.
2. **최초 연결 알림**: 기존 `provider='email'` 계정에 처음 카카오가 연결되면, 해당 이메일로 "카카오 계정이 연결되었습니다" 알림 발송. 본인이 시도하지 않은 연결인 경우 사용자가 비밀번호 재설정(SPEC-AUTH-RESET-001)을 통해 대응할 수 있는 탐지 창 제공.
3. **비밀번호 로그인 보존**: 자동 연결 후에도 기존 `password_hash`를 유지하여 `provider='kakao'` 상태에서도 이메일/비밀번호 로그인 허용 (silent lockout 방지, REQ-KAKAO-017). `provider`는 가입 경로 표시용 메타데이터일 뿐 인증 게이트가 아님.
4. **신뢰 전제 명시**: 카카오 계정 이메일은 카카오 본인인증/Kakao 인증서 기반이나, 서비스 자체 계정 소유권 증명과 동등하지는 않음. 자동 연결은 "사용자 마찰 최소화"와 "탈취 리스크"의 균형 선택이며, 완화 조치 1-3이 탐지·방어 창을 제공.

근거: interview.md Q1 결정(자동 연결)을 유지하되, plan-auditor iteration 1 D8이 지적한 "kakao is trusted" 일축을 구체적 완화 체계로 대체.

### TD-4: 카카오 토큰 미저장

카카오 access_token, refresh_token을 DB/쿠키에 저장하지 않음. 1회 사용 후 폐기.

근거: 서비스는 자체 JWT 세션을 사용하므로 카카오 토큰 영속 보관 불필요. 최소권한 원칙. 카카오 싱크/메시지 기능 확장 시 별도 SPEC에서 재검토.

### TD-5: state 쿠키 SameSite=Lax

카카오 인증 시작 시 state 쿠키는 SameSite=Lax (Strict 아님).

근거: 카카오→서버 콜백은 크로스사이트 리다이렉트이므로 SameSite=Strict면 쿠키가 콜백 요청에 전송되지 않음. Lax는 최상위 리다이렉트 GET을 허용하므로 콜백 동작. state 자체로 CSRF 방어.

### TD-6: 기존 JWT/쿠키 인프라 전면 재사용

카카오 세션도 `signAccessToken`, `signRefreshToken`, `buildAccessCookie`, `buildRefreshCookie`를 그대로 사용.

근거: 세션 메커니즘 단일성. 카카오 전용 쿠키/JWT 생성 금지. 미들웨어(`src/middleware.ts`) 수정 불필요 (AT 쿠키 기반 verified 검증은 provider 무관).

### TD-7: state 쿠키 TTL = 600초 (CSRF 강화)

state 쿠키에 Max-Age=600(10분)을 명시적으로 설정 (REQ-KAKAO-001). 세션 쿠키(TTL 무제한) 사용 금지. 콜백 처리 완료 시 즉시 Max-Age=0으로 삭제.

근거: plan-auditor iteration 1 D7. 세션 쿠키는 브라우저 세션 전체에 걸쳐 유효하므로 탈취 시 재생 공격 창이 확대됨. 600초 TTL + 1회성 삭제로 창을 최소화.

### TD-8: PKCE 도입 검토 (Run Phase 결정)

Authorization Code 플로우에 PKCE(RFC 7636/9700) 도입을 Run Phase에서 검토. 서버 측 confidential client이므로 필수는 아니나, 2026년 OAuth 권장사항이자 심층 방어로 권장.

근거: plan-auditor iteration 1 D6. 미도입 시 본 plan.md §3 TD-8에 근거를 명시.

---

## 4. DB 스키마 변경 (Migration 011)

### 4.1 변경 내용

기존 `users` 테이블의 `provider`, `provider_id` 컬럼은 migration 001에 존재. 본 마이그레이션은 부분 유니크 인덱스만 추가:

- 인덱스명: `idx_users_provider_provider_id_unique`
- 대상: `users(provider, provider_id) WHERE provider_id IS NOT NULL`
- 유일성: UNIQUE
- 목적: REQ-KAKAO-009 — 한 카카오 ID는 한 서비스 계정에만 연결 보장 (DB 레벨 세이프가드)

### 4.2 멱등성

`CREATE UNIQUE INDEX IF NOT EXISTS` 사용. 재실행 시 이미 존재하면 no-op.

### 4.3 롤백

`DROP INDEX IF EXISTS idx_users_provider_provider_id_unique`. 컬럼 자체는 migration 001 소유이므로 본 마이그레이션은 인덱스만 관리.

---

## 5. 마일스톤 (우선순위 기반, 시간 추정 제외)

### Milestone 1: 카카오 OAuth 백엔드 (Priority High)

- 환경 변수 추가 + 부트 검증
- 카카오 헬퍼 라이브러리 (`src/lib/kakao.ts`)
- 계정 연결 헬퍼 (`src/lib/kakao-account.ts`)
- 인증 시작 엔드포인트 (`/api/auth/kakao`)
- 콜백 엔드포인트 (`/api/auth/kakao/callback`)
- Migration 011

### Milestone 2: 프론트엔드 연동 (Priority High)

- `useAuth.kakaoLogin()` 액션 추가
- `TabletApp.tsx` 카카오 버튼 stub 교체 (L477)
- `MobileApp.tsx`, `DesktopApp.tsx` 카카오 버튼 신규 추가 (3뷰포트 UX 일관성)

### Milestone 3: 테스트 및 검증 (Priority High)

- 단위 테스트 (헬퍼, 계정 연결)
- 통합 테스트 (엔드투엔드 콜백 플로우)
- 마이그레이션 스키마 테스트
- TRUST 5 게이트 통과

### Milestone 4: 카카오 개발자콘솔 설정 (Priority Medium, 운영자 작업)

- 앱 등록, REST API 키 발급
- Client Secret 활성화
- Redirect URI 등록 (dev + prod)
- 동의 항목 설정 (이메일 필수)

---

## 6. 리스크 및 완화 (Risks & Mitigation)

| 리스크 | 심각도 | 완화 전략 |
|--------|--------|-----------|
| 카카오 API 장애 시 로그인 불가 | Medium | 이메일 로그인 폴백 안내, 카카오 버튼 비활성화 아님 (사용자가 이메일 로그인 선택 가능) |
| 카카오 이메일 탈취 → 기존 계정 인계 | Medium | TD-3 완화 체계: (1) 기존 provider='kakao' 시 연결 거부, (2) 최초 연결 알림 이메일 발송, (3) 비밀번호 로그인 보존(silent lockout 방지), (4) 카카오 신뢰 전제 명시 |
| state 재생 공격 | Low | state는 1회성, 콜백 검증 후 쿠키 만료. **Max-Age=600초 TTL** 명시 (TD-7, REQ-KAKAO-001) |
| Client Secret 노출 | High | 환경 변수만 사용, 응답 본문/로그 마스킹, 부트 검증 |
| 동일 카카오 ID 2계정 연결 race condition | Low | DB 유니크 인덱스(migration 011)로 최종 방어 |
| 카카오 이메일 미동의 | Medium | 동의 화면에서 이메일 필수 동의 설정 + REQ-KAKAO-006 거부 로직 |
| 카카오 API 응답 스키마 변경 | Low | Zod 스키마 검증 + 단위 테스트로 회귀 방어 |
| Authorization Code 가로채기 | Medium | PKCE 도입 검토(TD-8, §6.1) + HTTPS 강제 |
| 자동 연결 후 silent lockout | Medium | REQ-KAKAO-017: password_hash 보존 + provider는 인증 게이트 아님. AC-KAKAO-018/020 검증 |

---

## 7. 의존성 (Dependencies)

### 7.1 선행 SPEC (완료 조건)

- **SPEC-AUTH-001** (Complete): 인증 백엔드, JWT, verify-unit, 미들웨어
- **SPEC-INTEGRATION-AUTH-001** (Complete): useAuth 훅, 3개 뷰포트 API 연동, 카카오 stub(REQ-AUTH-INT-026)

### 7.2 후속 SPEC (영향 받음)

- 본 SPEC 완료 후 SPEC-INTEGRATION-AUTH-001 REQ-AUTH-INT-026의 "준비 중" stub은 실구현으로 대체됨 (문서 동기화 필요)

### 7.3 외부 의존성

- 카카오 OAuth API (`kauth.kakao.com`, `kapi.kakao.com`) — 가용성은 카카오 정책에 의존
- 카카오 개발자콘솔 앱 설정 — 운영자 사전 작업 필수

---

## 8. 구현 브랜치 & Git Flow

- **SPEC 커밋**: `develop` 브랜치 — SPEC 문서는 공유 계획 산출물
- **구현 브랜치**: `feature/SPEC-AUTH-KAKAO-001-kakao` (develop에서 분기)
- **PR**: `feature/SPEC-AUTH-KAKAO-001-kakao` → `develop`
- 구현은 별도 `/moai run` 단계에서 진행하며, 본 SPEC 문서 작성 시점에는 코드를 수정하지 않는다.

---

## 9. TRUST 5 게이트

| 항목 | 기준 |
|------|------|
| Tested | 85%+ 커버리지, 카카오 API는 mock, DB는 테스트 DB 사용 |
| Readable | 한국어 주석(code_comments: ko), 명확한 함수명 |
| Unified | 기존 코딩 스타일 준수, prettier/eslint 통과 |
| Secured | state CSRF, Client Secret 보호, 카카오 토큰 미저장, OWASP 준수 |
| Trackable | Conventional commits, SPEC-ID 참조 |

---

## 10. Open Items (Run Phase에서 해소)

1. **카카오 앱 역할(Role) 설정**: 카카오 개발자콘솔에서 본 앱의 역할(개인/사업자) 확인 — 사업자 앱인 경우 카카오 싱크 심사 필요 여부. 본 SPEC은 개인 앱 기준 (이메일 동의만).
2. **Redirect URI 다중 환경**: dev(`localhost:3000`)와 prod(Railway)를 별도 앱으로 분리할지, 한 앱에 다중 URI 등록할지 — 운영자 결정.
3. **카카오 로그아웃 연동**: 서비스 로그아웃 시 카카오 세션도 만료할지 여부 — OUT (본 SPEC은 서비스 JWT만 관리).
4. **기존 카카오 stub 버튼 스타일**: 비활성→활성 교체 시 기존 노란색 버튼 디자인 유지 여부 — UI는 기존 Claude Design 산출물 유지.

---

_Version: 1.1.0 | Status: Planned | Priority: High_
