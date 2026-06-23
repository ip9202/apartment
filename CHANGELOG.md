# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- 비밀번호 재설정 기능 (SPEC-AUTH-RESET-001)
  - `POST /api/auth/password/reset/request` 엔드포인트: 비밀번호 재설정 요청 (이메일 발송)
  - `POST /api/auth/password/reset/confirm` 엔드포인트: 비밀번호 재설정 확인 (토큰 검증 + 변경)
  - 토큰 기반 재설정 시스템 (SHA-256 해시, 30분 만료, 일회용 보장)
  - 이메일 발송 모듈 (SMTP 연동, 개발 환경 fallback)
  - Rate Limiting (이메일/IP 3회/10분)
  - 사용자 열거 공격 방지 (통일 응답)
  - 세션 무효화 (비밀번호 변경 후 RT 블랙리스트)

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
