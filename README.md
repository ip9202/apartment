# 아이뜨락 아파트 커뮤니티

제주 서귀포 아이뜨락 아파트 입주민-관리사무소 연결 커뮤니티 웹 서비스 (Next.js 15 + PostgreSQL 15)

## 현재 상태

- ✅ **AUTH P0 완료** (SPEC-AUTH-001): 회원가입·로그인·동/호수 인증·강제 탈퇴 (2026-06-20)
- ✅ **INTEGRATION-AUTH P0 완료** (SPEC-INTEGRATION-AUTH-001): 프론트엔드↔백엔드 인증 연동 (2026-06-23)
- ✅ **SETUP P0 완료** (SPEC-SETUP-001): 동/호수/직책/회원 관리 (2026-06-22)
- ✅ **NOTICE P0 완료** (SPEC-NOTICE-001): 공지사항 등록/수정/삭제/열람 (2026-06-22)
- ✅ **SUGGEST P0 완료** (SPEC-SUGGEST-001): 건의/문의 등록/수정/아카이브/열람/답변/상태/호수이력 (2026-06-22)
- ✅ **PARKING P0 완료** (SPEC-PARKING-001): 주차 자리 배정 추첨 시스템 (2026-06-23)
- ✅ **AUTH-RESET P0 완료** (SPEC-AUTH-RESET-001): 비밀번호 재설정 (이메일 링크) (2026-06-24)
- ✅ **ATTACHMENT P0 완료** (SPEC-ATTACHMENT-001): 공지/건의 첨부파일 (2026-06-24)
- ✅ **AUTH-KAKAO P0 완료** (SPEC-AUTH-KAKAO-001): 카카오 OAuth 소셜 로그인 (2026-06-24)

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
- `GET /api/auth/me` - 세션 복원 (현재 사용자 정보 조회)
- `POST /api/auth/signup` - 회원가입
- `POST /api/auth/login` - 로그인
- `POST /api/auth/logout` - 로그아웃
- `POST /api/auth/refresh` - 토큰 갱신
- `POST /api/auth/verify-unit` - 동/호수 인증
- `DELETE /api/auth/users/[id]/deactivate` - 강제 탈퇴 (ADMIN)
- `POST /api/auth/password/reset/request` - 비밀번호 재설정 요청 (이메일 발송)
- `POST /api/auth/password/reset/confirm` - 비밀번호 재설정 확인 (토큰 검증 + 변경)
- `GET /api/auth/kakao` - 카카오 로그인 시작 (state 쿠키 발급 + 카카오 인증 화면 리다이렉트)
- `GET /api/auth/kakao/callback` - 카카오 로그인 콜백 (state 검증 → 토큰 교환 → 세션 쿠키 발급)

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

### 건의/문의 (SUGGEST)
- `GET /api/suggestions` - 건의 목록 (인증 사용자, 역할별 비공개 분기 + 필터 + 페이지네이션)
- `POST /api/suggestions` - 건의 등록 (RESIDENT/REP/AUDITOR/CHAIR, ADMIN 제외)
- `GET /api/suggestions/[id]` - 건의 상세 (인증 사용자, 비공개 시 권한 검사)
- `PUT /api/suggestions/[id]` - 건의 수정 (작성자 본인, archived/완료 상태 수정 불가)
- `DELETE /api/suggestions/[id]` - 건의 아카이브 (작성자 본인 또는 ADMIN, 익명화 전환)
- `POST /api/suggestions/[id]/replies` - 답변 등록 (ADMIN)
- `PUT /api/suggestions/[id]/status` - 상태 변경 (ADMIN, 화이트리스트 전이 검증)
- `GET /api/suggestions/units/[building]/[unit]` - 호수별 건의 이력 (ADMIN/CHAIR, 아카이브 포함)

### 첨부파일 (ATTACHMENT)
- `POST /api/notices/[id]/attachments` - 공지 첨부 업로드 (ADMIN)
- `POST /api/suggestions/[id]/attachments` - 건의 첨부 업로드 (작성자 본인 + ADMIN)
- `GET /api/attachments/[id]` - 첨부 다운로드/스트리밍 (대상 게시물 가시성 준거)
- `DELETE /api/attachments/[id]` - 첨부 삭제 (NOTICE=ADMIN, SUGGEST=작성자 본인 + ADMIN)

### 주차 자리 배정 추첨 (PARKING)
- `POST /api/parking/rounds` - 회차 생성 (ADMIN/CHAIR, 자리풀 동적 입력, seed 자동생성)
- `POST /api/parking/rounds/[id]/draw` - 추첨(자리 확정) (RESIDENT+, 세대당 1회, 결정론적 순열)
- `DELETE /api/parking/rounds/[id]/draw` - 추첨 취소/반납 (본인, OPEN 상태만)
- `POST /api/parking/rounds/[id]/auto-assign` - 자동배정 실행 (ADMIN, 미참여 세대 AUTO, OPEN→ASSIGNED 전이)
- `PUT /api/parking/rounds/[id]/publish` - 결과 공개 (ADMIN, ASSIGNED→PUBLISHED 전이)
- `GET /api/parking/rounds/[id]/allocations` - 결과 열람 (역할별 가시성 분기)
- `GET /api/parking/rounds/[id]/verify` - 투명성 공개 (seed+알고리즘+입력 공개)

## 운영자 가이드

### 카카오 소셜 로그인 설정 (운영자)

카카오 OAuth 2.0 소셜 로그인을 사용하려면 아래 절차를 따른다.

1. **Kakao Developers Console 앱 등록**
   - https://developers.kakao.com 접속 → 내 애플리케이션 → 애플리케이션 추가
   - 앱 이름: 예) 아이뜨락 아파트
2. **REST API Key / Client Secret 발급**
   - 요약 탭에서 **REST API Key** 확인 (`KAKAO_REST_API_KEY`로 사용)
   - 카카오 로그인 → 보안에서 **Client Secret** 생성 후 활성화 (`KAKAO_CLIENT_SECRET`)
3. **Redirect URI 등록**
   - 카카오 로그인 → Redirect URI 등록
   - 개발: `http://localhost:3000/api/auth/kakao/callback`
   - 운영(Railway 등): `https://<prod-domain>/api/auth/kakao/callback`
4. **동의 항목(Scope) 설정 — 필수**
   - 카카오 로그인 → 동의 항목에서 **이메일(`account_email`)** 을 필수 동의로 설정
   - 이메일은 자동 계정 연결의 기준이 되므로 누락 시 가입이 불가하다
5. **환경 변수 설정 (`.env.local`)**
   ```
   KAKAO_REST_API_KEY=<REST API Key>
   KAKAO_CLIENT_SECRET=<Client Secret>
   KAKAO_REDIRECT_URI=http://localhost:3000/api/auth/kakao/callback   # 운영: https://<prod-domain>/api/auth/kakao/callback
   ```
   세 변수는 누락 시 fail-fast로 서버가 기동하지 않는다.
6. **DB 마이그레이션 적용**
   ```bash
   npm run db:migrate    # migrations/011_kakao_oauth.sql 적용 (users.provider+provider_id 부분 유니크 인덱스)
   ```

> 참고: 카카오 토큰은 1회성 교환 후 DB/쿠키에 저장하지 않는다. PKCE는 confidential client 정책상 미도입 (state CSRF + httpOnly 600s 쿠키로 충분). 자세한 설계 근거는 `SPEC-AUTH-KAKAO-001/spec.md` 참조.
