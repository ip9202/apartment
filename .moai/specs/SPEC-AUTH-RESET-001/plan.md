---
id: "SPEC-AUTH-RESET-001"
version: "1.0.0"
status: "Planned"
created: "2026-06-23"
updated: "2026-06-23"
author: "강력쇠주먹"
priority: "P1"
---

# SPEC-AUTH-RESET-001: 구현 계획 (Plan)

비밀번호 재설정 기능의 TDD 구현 계획. SPEC-AUTH-001(Complete) 인프라 위에 구축하며, brownfield TDD 모드(RED-GREEN-REFACTOR)로 진행한다.

---

## 1. 기술 접근법 (Technical Approach)

### 1.1 아키텍처 결정

| 결정 항목 | 선택 | 이유 |
|----------|------|------|
| 토큰 저장 방식 | DB 기반 (`password_reset_tokens`) | 일회용 무효화, 만료 추적, 감사 로그 가능. SPEC-AUTH-001 RT 블랙리스트 패턴과 일관 |
| 토큰 원문 저장 | 저장하지 않음 (SHA-256 해시만) | DB 유출 시 직접 공격 방어 |
| 토큰 난수 생성 | `crypto.randomBytes(32)` | 암호학적으로 안전한 난수 (Node.js 내장) |
| 토큰 만료 | 30분 | 보안(짧을수록 안전)과 사용성(이메일 확인 시간) 균형 |
| 이메일 발송 | Nodemailer (SMTP) | Node.js 표준, 환경 변수 기반 설정 |
| 비밀번호 해시 | bcrypt salt rounds 12 | SPEC-AUTH-001 일관성 |
| 세션 무효화 | RT 블랙리스트 일괄 등록 | 기존 `revoked_refresh_tokens` 재사용 |
| Rate Limiting | DB 기반 (이메일/IP 추적) | SPEC-AUTH-001 `login_attempts` 패턴 확장 또는 별도 추적 |

### 1.2 DB 스키마 (신규 테이블)

```sql
CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 해시 (hex 인코딩, 64자)
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,                      -- NULL = 미사용, NOT NULL = 사용 완료
  requested_ip VARCHAR(45),                 -- 감사용 (IPv4/IPv6)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);
```

### 1.3 환경 변수 (신규)

```bash
# 이메일 발송 (신규)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=********
SMTP_FROM="아이뜨락 커뮤니티 <noreply@example.com>"

# 기존 (재사용)
NEXT_PUBLIC_APP_URL=https://aitteulak.example.com
DATABASE_URL=postgresql://...
JWT_SECRET=********
JWT_REFRESH_SECRET=********
```

개발 환경 fallback:
- SMTP 미설정 시 `console.log`로 재설정 링크를 출력 (개발 전용)
- Ethereal Email (https://ethereal.email) 테스트 계정 옵션

---

## 2. 파일 구조 (예정)

```
src/
  app/
    api/
      auth/
        password/
          reset/
            request/
              route.ts        # POST /api/auth/password/reset/request
            confirm/
              route.ts        # POST /api/auth/password/reset/confirm
    (auth)/
      reset-password/
        page.tsx              # 재설정 링크 클릭 후 랜딩 페이지
      forgot-password/
        page.tsx              # 이메일 입력 페이지
  lib/
    password-reset.ts         # 토큰 생성/검증/무효화 로직
    email.ts                  # 이메일 발송 모듈 (Nodemailer 래퍼)
    password-policy.ts        # 비밀번호 강도 검증 (공유 유틸)
db/
  migrations/
    XXXX_create_password_reset_tokens.sql
src/__tests__/
  password-reset.test.ts      # 토큰 로직 단위 테스트
  email.test.ts               # 이메일 발송 테스트 (mock)
  password-policy.test.ts     # 정책 검증 테스트
  api/
    reset-request.test.ts     # 재설정 요청 API 통합 테스트
    reset-confirm.test.ts     # 재설정 확인 API 통합 테스트
```

---

## 3. 구현 마일스톤 (TDD RED-GREEN-REFACTOR)

### Milestone 1: DB 마이그레이션 (Priority High)

- [ ] `password_reset_tokens` 테이블 마이그레이션 스크립트 작성
- [ ] 로컬 DB 적용 및 롤백 스크립트 검증
- [ ] 마이그레이션 테스트 (적용/롤백)

### Milestone 2: 토큰 생성/검증 로직 (Priority High)

- [ ] RED: 토큰 생성 테스트 (`crypto.randomBytes`, SHA-256 해시, 만료 설정)
- [ ] GREEN: `src/lib/password-reset.ts` 토큰 생성 함수 구현
- [ ] RED: 토큰 검증 테스트 (유효/만료/사용됨/미존재)
- [ ] GREEN: 토큰 검증 함수 구현
- [ ] RED: 토큰 무효화(`used_at` 갱신) 테스트
- [ ] GREEN: 무효화 함수 구현
- [ ] REFACTOR: 중복 제거, 타입 정제

### Milestone 3: 비밀번호 정책 검증 (Priority High)

- [ ] RED: 8자 미만 거부 테스트
- [ ] RED: 영문/숫자/특수문자 누락 거부 테스트
- [ ] RED: 유효 비밀번호 통과 테스트
- [ ] GREEN: `src/lib/password-policy.ts` 구현
- [ ] REFACTOR: 정규식 정리, 에러 메시지 국제화 고려

### Milestone 4: 이메일 발송 모듈 (Priority High)

- [ ] RED: SMTP 발송 테스트 (mock Nodemailer)
- [ ] GREEN: `src/lib/email.ts` Nodemailer 래퍼 구현
- [ ] RED: 개발 환경 fallback(console.log) 테스트
- [ ] GREEN: 환경 분기 로직 추가
- [ ] REFACTOR: 발송 실패 처리, 재시도 로직 검토

### Milestone 5: 재설정 요청 API (Priority High)

- [ ] RED: 가입된 이메일 → 토큰 생성 + 이메일 발송 테스트
- [ ] RED: 미가입 이메일 → 동일 성공 응답 테스트 (열거 방지)
- [ ] RED: Rate Limiting 초과 → 429 테스트
- [ ] GREEN: `POST /api/auth/password/reset/request` 구현
- [ ] REFACTOR: 입력 검증, 에러 처리 정리

### Milestone 6: 재설정 확인 API (Priority High)

- [ ] RED: 유효 토큰 + 강력한 비밀번호 → 변경 성공 테스트
- [ ] RED: 만료 토큰 → 400 테스트
- [ ] RED: 사용된 토큰 → 400 테스트 (일회용)
- [ ] RED: 약한 비밀번호 → 422 테스트
- [ ] RED: 비밀번호 변경 후 RT 무효화 테스트
- [ ] GREEN: `POST /api/auth/password/reset/confirm` 구현
- [ ] REFACTOR: 트랜잭션 처리 (비밀번호 변경 + 토큰 무효화 + RT 무효화 원자성)

### Milestone 7: 프론트엔드 페이지 (Priority Medium)

- [ ] 비밀번호 찾기 페이지 (`/forgot-password`)
- [ ] 재설정 페이지 (`/reset-password?token=...`)
- [ ] 토큰 URL에서 메모리 이동 후 URL 정리 (Referer 노출 방지)
- [ ] 성공/실패 UI 피드백

### Milestone 8: 품질 게이트 (Priority High)

- [ ] 전체 테스트 스위트 통과
- [ ] 커버리지 85% 이상 (password-reset.ts, password-policy.ts)
- [ ] ESLint 통과
- [ ] 보안 검토 (OWASP 체크리스트)
- [ ] MX 태그 적용

---

## 4. 리스크 및 완화 (Risks & Mitigations)

| 리스크 | 영향 | 완화 방안 |
|--------|------|-----------|
| SMTP 발송 지연이 API 응답 블로킹 | UX 저하, 타임아웃 | 비동기 발송(큐) 검토; Milestone 4에서 동기 우선 구현 후 측정 |
| 이메일이 스팸함으로 분류 | 사용자 링크 수신 실패 | SPF/DKIM/DMARC 설정 가이드; 발송자 도메인 검증 |
| 토큰이 Referer 헤더로 유출 | 토큰 탈취 | 클라이언트에서 토큰 URL 제거; `rel="noopener"` 링크 |
| Rate Limiting 우회 (IP 회전) | 이메일 폭탄 | 이메일 기준 + IP 기준 이중 제한; CAPTCHA 검토(P2) |
| DB 장애 시 토큰 검증 불가 | 재설정 불가 | 기존 인프라 장애 대응 절차 준용; 명확한 에러 메시지 |
| 개발 환경에서 실제 이메일 발송 | 실사용자 스팸 | 환경 분기(NODE_ENV); Ethereal Email 사용 |

---

## 5. 기존 SPEC-AUTH-001 통합 지점

본 SPEC은 SPEC-AUTH-001의 다음 컴포넌트를 재사용한다:

- **bcrypt 해시 로직**: 동일 salt rounds 12, 동일 헬퍼 함수
- **`users` 테이블**: `password` 컬럼 업데이트
- **`revoked_refresh_tokens` 테이블**: 비밀번호 변경 후 전체 RT 무효화 시 일괄 등록
- **Rate Limiting 패턴**: `login_attempts` 테이블 패턴 참고 (재설정 요청 추적용 별도 로직 또는 확장)
- **에러 응답 형식**: 기존 API 응답 스키마 준수

통합 시 주의: 본 SPEC은 SPEC-AUTH-001을 수정하지 않는다. 의존만 한다 (단방향).

---

## 6. 개발 환경 설정

Run Phase 시작 전 확인 사항:

- [ ] `nodemailer` 패키지 설치
- [ ] `.env.local`에 SMTP 변수 추가 (개발용 Ethereal 또는 console fallback)
- [ ] `password_reset_tokens` 마이그레이션 로컬 적용
- [ ] 기존 AUTH 테스트가 통과하는지 확인 (회귀 없음)

---

## 7. 품질 게이트 (TRUST 5)

- **Tested**: 85%+ 커버리지, 토큰/정책/이메일/API 통합 테스트
- **Readable**: 명확한 함수명(`generateResetToken`, `verifyResetToken`, `invalidateResetToken`), 한국어 주석 (per language.yaml code_comments: ko)
- **Unified**: 기존 AUTH 코드 스타일 준수, ESLint/Prettier 통과
- **Secured**: OWASP 체크리스트 (§6.1), 토큰 해시 저장, 열거 방지, 세션 무효화
- **Trackable**: conventional commits (`feat(auth-reset): ...`), SPEC-ID 참조

---

*본 계획은 TDD brownfield 모드를 기준으로 한다. 각 마일스톤은 RED-GREEN-REFACTOR 주기로 진행된다.*
