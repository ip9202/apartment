# 아이뜨락 아파트 커뮤니티

제주 서귀포 아이뜨락 아파트 입주민-관리사무소 연결 커뮤니티 웹 서비스 (Next.js 15 + PostgreSQL 15)

## 현재 상태

- ✅ **AUTH P0 완료** (SPEC-AUTH-001): 회원가입·로그인·동/호수 인증·강제 탈퇴 (2026-06-20)
- ✅ **SETUP P0 완료** (SPEC-SETUP-001): 동/호수/직책/회원 관리 (2026-06-22)
- ✅ **NOTICE P0 완료** (SPEC-NOTICE-001): 공지사항 등록/수정/삭제/열람 (2026-06-22)

## 프로젝트 문서

- [CLAUDE.md](./CLAUDE.md) - MoAI 실행 지시문
- [.moai/specs/](./.moai/specs/) - 기능 명세서 (SPEC)

## 기술 스택

- Frontend: Next.js 15, React 19, TypeScript
- Backend: Next.js API Routes
- Database: PostgreSQL 15
- ORM: Prisma

## API 엔드포인트

### 인증 (AUTH)
- `POST /api/auth/signup` - 회원가입
- `POST /api/auth/login` - 로그인
- `POST /api/auth/logout` - 로그아웃
- `POST /api/auth/refresh` - 토큰 갱신
- `POST /api/auth/verify-unit` - 동/호수 인증
- `DELETE /api/auth/users/[id]/deactivate` - 강제 탈퇴 (ADMIN)

### 단지 설정 (SETUP)
- `GET /api/setup/buildings` - 동/호수 목록 (공개, 인증 불필요)
- `POST /api/setup/buildings` - 동 추가 (ADMIN)
- `DELETE /api/setup/buildings/[id]` - 동 삭제 (ADMIN)
- `PUT /api/setup/buildings/[id]/units` - 호수 일괄 업데이트 (ADMIN)
- `GET /api/setup/users` - 회원 목록 (ADMIN, 필터 지원)
- `PUT /api/setup/users/[id]/role` - 직책 부여/회수 (ADMIN/CHAIR)

### 공지사항 (NOTICE)
- `GET /api/notices` - 공지 목록 (인증 사용자, 카테고리 필터 + 페이지네이션)
- `POST /api/notices` - 공지 등록 (ADMIN)
- `GET /api/notices/[id]` - 공지 상세 (인증 사용자)
- `PUT /api/notices/[id]` - 공지 수정 (ADMIN)
- `DELETE /api/notices/[id]` - 공지 삭제 (ADMIN, 영구 삭제)
