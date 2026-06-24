---
spec_id: "SPEC-AUTH-KAKAO-001"
title: "카카오 OAuth 2.0 소셜 로그인 Task Decomposition"
phase: "run"
status: "pending"
created: "2026-06-24"
author: "manager-strategy"
priority: "High"
labels: ["auth", "oauth", "kakao", "tasks", "tdd"]
---

## Task Decomposition

SPEC: SPEC-AUTH-KAKAO-001

> 각 Task = 하나의 TDD 사이클 (RED → GREEN → REFACTOR). brownfield 강화 모드: Pre-RED 에서 기존 코드 읽기 선행.
> 마일스톤 순서: M1(백엔드 인프라) → M2(API 엔드포인트) → M3(프론트엔드) → M4(통합 검증).
> 커버리지 게이트는 `src/lib/**/*.ts` 만 측정 (vitest.config.ts include 한정). 따라서 커버리지 관련 핵심 로직은 `src/lib/` 에 배치.

| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| T-001 | env 부트 검증에 카카오 변수 3종(KAKAO_REST_API_KEY, KAKAO_CLIENT_SECRET, KAKAO_REDIRECT_URI) 추가 — fail-fast assert 확장. RED: 누락 시 throw 테스트. | REQ-KAKAO-002 (부트 검증 부) | - | src/lib/env.ts, src/lib/env.test.ts | pending |
| T-002 | 카카오 OAuth 헬퍼 `buildKakaoAuthUrl(state)` — 인가 URL 조합 (client_id, redirect_uri, response_type=code, state, scope=account_email). RED: URL 파라미터 포함 테스트. | REQ-KAKAO-001 | T-001 | src/lib/kakao.ts, src/lib/kakao.test.ts | pending |
| T-003 | 카카오 토큰 교환 `exchangeKakaoToken(code)` — POST kauth.kakao.com/oauth/token, mock fetch로 응답 스키마(Zod) 검증. 카카오 토큰은 반환 후 호출자가 즉시 사용·폐기. | REQ-KAKAO-003, REQ-KAKAO-013 | T-002 | src/lib/kakao.ts, src/lib/kakao.test.ts | pending |
| T-004 | 카카오 사용자 정보 조회 `fetchKakaoUser(accessToken)` — GET kapi.kakao.com/v2/user/me, Zod 스키마로 id(문자열 변환, BigInt 방어 EC-KAKAO-004) + email 추출. 이메일 누락 시 거부. | REQ-KAKAO-005, REQ-KAKAO-006 | T-003 | src/lib/kakao.ts, src/lib/kakao.test.ts | pending |
| T-005 | 계정 연결/가입 로직 `upsertKakaoAccount(email, kakaoId)` — (a) 기존 이메일 일치 시 provider/provider_id 갱신 + password_hash 보존 + 최초 연결 알림, (b) 신규 가입(RESIDENT, password_hash=NULL), (c) 카카오 ID 중복 시 409, (d) 기존 provider='kakao'+다른 provider_id 시 409(탈취 방어 AC-KAKAO-019), (e) INACTIVE 시 403. withTransaction 사용. | REQ-KAKAO-007, REQ-KAKAO-008, REQ-KAKAO-009, REQ-KAKAO-010, REQ-KAKAO-017 | T-004 | src/lib/kakao-account.ts, src/lib/kakao-account.test.ts | pending |
| T-006 | 최초 연결 알림 이메일 발송 — `sendKakaoLinkedNotification(email)` 헬퍼 (src/lib/email.ts MailTransport 주입 패턴 재사용). RED: 발송 mock 검증. | REQ-KAKAO-007, REQ-KAKAO-017 (알림 부) | T-005 | src/lib/kakao-account.ts (또는 src/lib/kakao-email.ts), src/lib/kakao-account.test.ts | pending |
| T-007 | 카카오 인증 시작 엔드포인트 `GET /api/auth/kakao` — state 생성(crypto.randomUUID) + httpOnly SameSite=Lax Max-Age=600 쿠키 + 302 리다이렉트. 환경변수 누락 시 500. | REQ-KAKAO-001, REQ-KAKAO-002 | T-001, T-002 | src/app/api/auth/kakao/route.ts, src/app/api/auth/kakao/route.test.ts | pending |
| T-008 | 카카오 콜백 엔드포인트 `GET /api/auth/kakao/callback` — state 검증(불일치/누락 시 400 AC-KAKAO-004/005) → 토큰 교환 → 사용자 정보 → upsertKakaoAccount → signAccessToken/signRefreshToken + buildAccessCookie/buildRefreshCookie → state 쿠키 Max-Age=0 삭제 → verified 여부에 따라 / 또는 /verify 리다이렉트. 카카오 토큰 로그 미출력 검증(AC-KAKAO-014). | REQ-KAKAO-003, REQ-KAKAO-004, REQ-KAKAO-005, REQ-KAKAO-006, REQ-KAKAO-011, REQ-KAKAO-012, REQ-KAKAO-013 | T-003, T-004, T-005, T-007 | src/app/api/auth/kakao/callback/route.ts, src/app/api/auth/kakao/callback/route.test.ts | pending |
| T-009 | useAuth 훅에 `kakaoLogin()` 액션 추가 — window.location.href = '/api/auth/kakao'. RED: 호출 시 location 변경 검증 (jsdom). 기존 login/logout/signup/verifyUnit/refresh 보존. | REQ-KAKAO-014, REQ-KAKAO-016 | - | src/hooks/useAuth.ts, src/hooks/useAuth.test.ts | pending |
| T-010 | TabletApp.tsx L477 stub 교체 — `doLogin('kakao@user.com','kakao')` → `useAuth.kakaoLogin()`. AC-KAKAO-016 grep 검증 포함 (kakao@user.com 0 matches). | REQ-KAKAO-014, REQ-KAKAO-015 | T-009 | src/components/TabletApp.tsx, src/components/TabletApp.test.tsx (있으면) | pending |
| T-011 | MobileApp.tsx 카카오 버튼 신규 추가 — TabletApp과 동일 스타일/트리거(kakaoLogin()). 현재 카카오 버튼 부재(0 matches 확인됨). | REQ-KAKAO-014, REQ-KAKAO-015 | T-009 | src/components/MobileApp.tsx | pending |
| T-012 | DesktopApp.tsx 카카오 버튼 신규 추가 — TabletApp과 동일 스타일/트리거(kakaoLogin()). 현재 카카오 버튼 부재(0 matches 확인됨). | REQ-KAKAO-014, REQ-KAKAO-015 | T-009 | src/components/DesktopApp.tsx | pending |
| T-013 | Migration 011 — users(provider, provider_id) WHERE provider_id IS NOT NULL 부분 유니크 인덱스. CREATE UNIQUE INDEX IF NOT EXISTS (멱등). RED: migration-011.test.ts로 인덱스 존재 + 멱등성 + 중복 삽입 거부 검증 (migration-test-helpers.ts 패턴 준용). | REQ-KAKAO-009 (DB 세이프가드) | - | migrations/011_kakao_oauth.sql, src/lib/migration-011.test.ts | pending |
| T-014 | 통합 검증 — AC-KAKAO-018(자동 연결 후 비밀번호 로그인 보존, silent lockout 방지), AC-KAKAO-020(신규 kakao 가입자 password_hash=NULL 시 이메일/비밀번호 로그인 401). 기존 login route.ts L88 `!user.password_hash` 로직이 보존됨을 회귀 테스트로 확인. | REQ-KAKAO-017, AC-KAKAO-018, AC-KAKAO-020 | T-005, T-008 | src/app/api/auth/login/route.test.ts (회귀 케이스 추가) | pending |

---

## 마일스톤 매핑

- **M1 백엔드 인프라**: T-001, T-002, T-003, T-004, T-005, T-006, T-013
- **M2 API 엔드포인트**: T-007, T-008
- **M3 프론트엔드**: T-009, T-010, T-011, T-012
- **M4 통합 검증**: T-014

## 의존성 그래프

```
T-001 (env) ─┬─→ T-002 (buildKakaoAuthUrl) ─→ T-007 (시작 엔드포인트) ─┐
             │                                                        │
             └─→ (모든 태스크가 env 의존)                              ├─→ T-008 (콜백)
                                                                      │
T-003 (exchangeKakaoToken) ─→ T-004 (fetchKakaoUser) ─→ T-005 (upsertKakaoAccount) ─→ T-006 (알림)
                                                                      │
T-013 (migration 011, 독립)                                           │
                                                                      │
T-009 (useAuth kakaoLogin) ─→ T-010 (TabletApp)                       │
                          ├→ T-011 (MobileApp)                         │
                          └→ T-012 (DesktopApp)                        │
                                                                      │
T-014 (회귀 검증) ← T-005, T-008 ─────────────────────────────────────-─┘
```

## 커버리지 전략 (vitest.config.ts 제약 대응)

- 커버리지 게이트는 `src/lib/**/*.ts` 만 측정 → 핵심 비즈니스 로직(토큰 교환, 사용자 정보 파싱, 계정 연결 upsert, 알림 발송)은 반드시 `src/lib/kakao.ts`, `src/lib/kakao-account.ts` 에 배치 (T-002 ~ T-006).
- API route (`src/app/api/auth/kakao/**/route.ts`) 와 컴포넌트는 커버리지 측정 제외이나, 각 태스크에 페어 테스트 파일 필수 (정확성 검증 목적).
- T-013 migration 테스트는 `src/lib/migration-011.test.ts` 로 커버리지 대상에 포함.

## @MX 태그 계획 (Run Phase 적용)

- `@MX:ANCHOR`: useAuth.kakaoLogin (fan_in >= 3: MobileApp/TabletApp/DesktopApp), 카카오 콜백 route (외부 시스템 통합 경계)
- `@MX:WARN + @MX:REASON`: state 검증 로직 (CSRF 핵심), Client Secret 사용 (노출 시 타 앱 위장), 카카오 토큰 폐기 (영속 저장 시 권한 과잉)
- `@MX:NOTE`: 이메일 자동 연결 의도, password_hash=NULL 소셜 전용 계정, 카카오 토큰 미저장 단일 세션 정책
- `@MX:TODO`: 타 provider 확장 지점 (Google/Naver 추가 시)

## 리스크 추적 포인트

1. **이메일 자동 연결 계정 탈취** (AC-KAKAO-019): T-005 에서 기존 provider='kakao'+다른 provider_id 시 409 거부 + T-006 최초 연결 알림으로 탐지 창 제공.
2. **Silent lockout** (REQ-KAKAO-017, AC-KAKAO-018/020): T-005 password_hash 보존 + T-014 기존 login route 회귀 테스트로 검증.
3. **BigInt 카카오 ID** (EC-KAKAO-004): T-004 Zod 스키마에서 id 를 coerce.string() 처리.
4. **카카오 토큰 로그 노출** (AC-KAKAO-014): T-008 콜백 테스트에서 console/logger spy 로 토큰 평문 미출력 검증.
5. **커버리지 게이트 제외**: API route/components 는 측정 제외 → 핵심 로직을 src/lib/ 에 배치하여 85% 임계치 만족 (T-002~T-006).
