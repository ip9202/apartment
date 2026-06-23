# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
