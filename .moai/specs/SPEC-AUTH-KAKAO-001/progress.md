---
spec_id: "SPEC-AUTH-KAKAO-001"
title: "카카오 OAuth 2.0 소셜 로그인 진행 추적"
phase: "run"
status: "backend-complete"
created: "2026-06-24"
updated: "2026-06-24"
---

# SPEC-AUTH-KAKAO-001 진행 추적

## 백엔드 Phase 2B (TDD) — 완료 (2026-06-24)

담당: manager-tdd (백엔드 스코프: T-001~T-008, T-013)
프론트엔드(T-009~T-012), 회귀(T-014)는 다른 에이전트 소관.

### 완료 태스크

| Task | 파일 | 테스트 수 | 비고 |
|------|------|-----------|------|
| T-001 | src/lib/env.ts (수정), src/lib/env.test.ts (수정), .env.example, .env.test | +5 케이스 (총 13) | kakao 변수 3종 fail-fast |
| T-002 | src/lib/kakao.ts (신규), src/lib/kakao.test.ts (신규) | 3 | buildKakaoAuthUrl |
| T-003 | src/lib/kakao.ts, src/lib/kakao.test.ts | 3 | exchangeKakaoToken + KakaoTokenError + Zod |
| T-004 | src/lib/kakao.ts, src/lib/kakao.test.ts | 5 | fetchKakaoUser + KakaoEmailMissingError + EC-KAKAO-004 |
| T-005 | src/lib/kakao-account.ts (신규), src/lib/kakao-account.test.ts (신규) | 7 | upsertKakaoAccount 5분기 + KakaoConflictError/InactiveError, db 모킹 |
| T-006 | src/lib/kakao-email.ts (신규) | (T-005 에서 검증) | sendKakaoLinkedNotification, MailTransport 주입 |
| T-007 | src/app/api/auth/kakao/route.ts (신규), route.test.ts (신규) | 3 | GET 시작 엔드포인트, state 쿠키 Max-Age=600 |
| T-008 | src/app/api/auth/kakao/callback/route.ts (신규), route.test.ts (신규) | 9 | GET 콜백, state 검증/토큰폐기/리다이렉트/콘솔미출력 |
| T-013 | migrations/011_kakao_oauth.sql (신규), src/lib/migration-011.test.ts (신규) | 5 | 부분 유니크 인덱스 + 멱등 + 중복거부 + NULL제외 |

### 검증 결과 (직접 실행 증거)

- **단위 테스트 (백엔드 스코프)**: `npm run test:run -- src/lib/kakao.test.ts src/lib/kakao-account.test.ts src/lib/migration-011.test.ts src/lib/env.test.ts src/app/api/auth/kakao`
  - 결과: Test Files 6 passed (6) / Tests 48 passed (48)
- **tsc --noEmit**: 0 errors
- **lint**: 0 errors in 신규/수정 파일 (1 pre-existing error in vitest.setup.ts — 본 SPEC 무관)
- **커버리지 (src/lib kakao 스코프)**: Statements 98.79%, Lines 98.78%, Functions 100%, Branches 89.47%
  - kakao-account.ts 96.29% lines, kakao.ts/kakao-email.ts/env.ts 100%

### 구현 발산 (tasks.md 대비)

- T-005: tasks.md 는 src/lib/kakao-account.ts 또는 src/lib/kakao-email.ts 중 택일 제안 → 알림 헬퍼를 별도 파일(src/lib/kakao-email.ts)로 분리. 이유: kakao-account.ts 의 db/트랜잭션 의존과 이메일 전송 의존을 분리하여 단위 테스트 주입 명확화.
- T-005: DB 통합 테스트 대신 db 모듈(query/withTransaction) vi.mock 단위 테스트 채택. 이유: 5개 분기 로직을 결정론적으로 빠르게 검증. DB 레벨 유일성은 T-013 migration-011.test.ts 가 보장.
- T-008 콜백: Next.js Request.cookies 미지원 환경(jsdom) 대응으로 Cookie 헤더 수동 파싱(parseCookie 헬퍼) 적용. 프로덕션에서는 동일 헤더 기반이므로 동작 일관.

### 알려진 사항 (블로커 아님)

- 전체 스위트 실행 시 src/app/api/setup/buildings/[id]/units/route.test.ts 9건 실패 — 본 SPEC 무관한 pre-existing 실패 (단독 실행 시에도 2건 실패 재현, kakao 코드 의존성 없음).

### 남은 태스크 (다른 에이전트)

- T-009~T-012 (프론트엔드 useAuth/TabletApp/MobileApp/DesktopApp)
- T-014 (login route 회귀 — AC-KAKAO-018/020, 본 에이전트는 login route 미수정 원칙 준수)
