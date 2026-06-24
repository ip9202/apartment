# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- 카카오 OAuth 2.0 소셜 로그인 (SPEC-AUTH-KAKAO-001)
  - `GET /api/auth/kakao` 엔드포인트: 카카오 로그인 시작 (state 쿠키 발급 + 카카오 인증 화면 302 리다이렉트)
  - `GET /api/auth/kakao/callback` 엔드포인트: 카카오 로그인 콜백 (state CSRF 검증 → 토큰 교환 → 사용자 정보 조회 → upsert → AT/RT 쿠키 발급 → 리다이렉트)
  - 이메일 기반 자동 계정 연결: 카카오 이메일이 기존 `users.email`과 일치하면 해당 계정에 카카오 수단 연결, 미존재 시 신규 RESIDENT 가입 (`password_hash=NULL`)
  - migration 011: `users(provider, provider_id)` 부분 유니크 인덱스 (`WHERE provider_id IS NOT NULL`)
  - state CSRF 방어: `crypto.randomUUID` 생성, httpOnly·SameSite=Lax·Max-Age=600s 쿠키 저장, 콜백 완료 시 일회용 폐기
  - 카카오 토큰 정책: 1회성 교환 후 메모리에서만 사용, DB/쿠키에 영구 저장하지 않음
  - 계정 탈취 방어: 기존 카카오 계정과 다른 id 충돌 시 409 거부, 최초 연결 시 기존 이메일 계정에 알림 발송, 자동 연결 후에도 기존 이메일/비밀번호 로그인 보존 (silent lockout 방지)
  - 3뷰포트 카카오 버튼: `TabletApp.tsx` stub 교체, `MobileApp.tsx`·`DesktopApp.tsx` 신규 추가 (항상 활성화)
- 비밀번호 재설정 기능 (SPEC-AUTH-RESET-001)
  - `POST /api/auth/password/reset/request` 엔드포인트: 비밀번호 재설정 요청 (이메일 발송)
  - `POST /api/auth/password/reset/confirm` 엔드포인트: 비밀번호 재설정 확인 (토큰 검증 + 변경)
  - 토큰 기반 재설정 시스템 (SHA-256 해시, 30분 만료, 일회용 보장)
  - 이메일 발송 모듈 (SMTP 연동, 개발 환경 fallback)
  - Rate Limiting (이메일/IP 3회/10분)
  - 사용자 열거 공격 방지 (통일 응답)
  - 세션 무효화 (비밀번호 변경 후 RT 블랙리스트)
- 공지/건의 첨부파일 기능 (SPEC-ATTACHMENT-001)
  - `POST /api/notices/[id]/attachments` 엔드포인트: 공지 첨부 업로드 (ADMIN)
  - `POST /api/suggestions/[id]/attachments` 엔드포인트: 건의 첨부 업로드 (작성자 본인 + ADMIN)
  - `GET /api/attachments/[id]` 엔드포인트: 첨부 다운로드/스트리밍 (대상 게시물 가시성 재검증)
  - `DELETE /api/attachments/[id]` 엔드포인트: 첨부 삭제 (NOTICE=ADMIN, SUGGEST=작성자 본인+ADMIN)
  - 다형성 `attachments` 테이블 (migration 010, target_type NOTICE|SUGGEST)
  - 파일 검증: PNG/JPG/JPEG/WEBP + PDF/HWP/DOCX 화이트리스트, 파일당 10MB, 게시물당 5개, 매직 바이트 교차 검증
  - cascade 삭제: NOTICE 영구 삭제 / SUGGEST 아카이브 / AUTH 강제 탈퇴 시 첨부 정리

### Security
- 카카오 OAuth state CSRF 방어 (crypto.randomUUID + httpOnly 쿠키, 일회용 폐기)
- 카카오 Client Secret 환경 변수 전용 관리 (`.env.local`, 버전 관리 제외)
- 카카오 액세스/리프레시 토큰 영구 저장 금지 (1회성 교환 후 폐기)
- 이메일 정규화(소문자) 기반 계정 탈취 완화 (대소문자 혼용 우회 차단)
- OWASP Top 10 준수 (A01: Injection, A02: Broken Auth, A03: Crypto, A07: Identification, A09: Logging)
- crypto.randomBytes(32) CSPRNG 토큰 생성
- 파라미터화 쿼리 (SQL Injection 방지)
- 일회용 토큰 보장 (used_at 추적)
- 첨부파일 경로 순회 방어 (UUID 기반 storage_path, 파일명 새니타이제이션)
- 첨부 MIME 스푸핑 방어 (매직 바이트 시그니처 교차 검증)
- 첨부 다운로드 권한 재검증 (직접 링크 공격 방지)

### Security (카카오 OAuth 설계 결정)
- PKCE 미도입: confidential client 기반 client-secret + state CSRF + httpOnly 600s 쿠키 조합으로 충분한 것으로 판단하여, Authorization Code Flow에 PKCE는 적용하지 않음 (근거: SPEC-AUTH-KAKAO-001 §6.1)

### Security
- OWASP Top 10 준수 (A01: Injection, A02: Broken Auth, A03: Crypto, A07: Identification, A09: Logging)
- crypto.randomBytes(32) CSPRNG 토큰 생성
- 파라미터화 쿼리 (SQL Injection 방지)
- 일회용 토큰 보장 (used_at 추적)

## [1.2.0] - 2026-06-24

## [1.1.0] - 2026-06-23

### Added
- 인증 연동 (SPEC-INTEGRATION-AUTH-001)
  - `GET /api/auth/me` 엔드포인트: 세션 복원 기능
  - `useAuth` 훅: React 인증 상태 관리
  - 데모 계정 시드: `resident@aitteulak.com`, `admin@aitteulak.com`
  - API 클라이언트: `src/lib/api/auth.ts`
  - 통합 테스트: 8개 테스트 케이스

### Changed
- `MobileApp.tsx`, `TabletApp.tsx`: 하드코딩된 데모 로그인을 실제 API 호출로 교체
- `scripts/seed.ts`: 데모 계정 생성 로직 추가

### Fixed
- 페이지 새로고침 시 세션 상태 유지 기능 구현
- 인증 오류 메시지 UI 표시 기능 추가

### Security
- httpOnly 쿠키 기반 세션 복원 구현
- JWT 검증 로직 통일 (middleware + /api/auth/me)

## [1.0.0] - 2026-06-22

### Added
- 주차 자리 배정 추첨 시스템 (SPEC-PARKING-001)
- 공지사항 기능 (SPEC-NOTICE-001)
- 건의/문의 기능 (SPEC-SUGGEST-001)
- 단지 설정 기능 (SPEC-SETUP-001)
- 인증 백엔드 API (SPEC-AUTH-001)

[Unreleased]: https://github.com/your-org/apartment/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/your-org/apartment/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/your-org/apartment/releases/tag/v1.0.0
