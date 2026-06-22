## Task Decomposition
SPEC: SPEC-NOTICE-001

개발 방법론: TDD (RED-GREEN-REFACTOR), quality.yaml development_mode=tdd.
실행 모드: Standard Mode (sub-agent, manager-tdd). Phase별 순차 진행.

| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| T-NOTICE-A | M6 notice_categories 시드 + notices 마이그레이션 | REQ-017,018, AC-001,002 | - | migrations/006_notices.sql, migrations/006.test.ts | pending |
| T-NOTICE-B | M1 공지 등록 + M4 공지 목록 열람 | REQ-001,002,003a,003b,011,012,013a, AC-003~006,016~019, EC-001,002,004,005,006 | T-NOTICE-A | src/app/api/notices/route.ts, src/app/api/notices/route.test.ts | pending |
| T-NOTICE-C | M5 공지 상세 열람 | REQ-014,015,016a, AC-020,021,022, EC-003 | T-NOTICE-B | src/app/api/notices/[id]/route.ts (GET), src/app/api/notices/[id]/route.test.ts (GET) | pending |
| T-NOTICE-D | M2 공지 수정 | REQ-004,005,006,007a,007b, AC-007~011 | T-NOTICE-C | src/app/api/notices/[id]/route.ts (PUT 추가), src/app/api/notices/[id]/route.test.ts (PUT 추가) | pending |
| T-NOTICE-E | M3 공지 삭제 (hard delete) | REQ-008,009,010a,010b, AC-012~015 | T-NOTICE-D | src/app/api/notices/[id]/route.ts (DELETE 추가), src/app/api/notices/[id]/route.test.ts (DELETE 추가) | pending |
| T-NOTICE-V | 최종 검증 + develop 머지 준비 | 전체 AC + 기존 290 회귀 | T-NOTICE-A,B,C,D,E | - | pending |

## 재사용 파일 (AUTH/SETUP 소유, 수정 없음)
- src/lib/db.ts (query)
- src/lib/auth.ts (verifyAccessToken)
- src/lib/rbac.ts (requireAdmin, unauthorized, forbidden, badRequest, notFound, validationError)
- src/middleware.ts (수정 불필요 — /api/notices는 기존 matcher로 인증 적용, 공개 엔드포인트 아님)

## 정책 결정 (Plan Review 확정)
1. P0 범위: NOTICE-01~05만. NOTICE-06(상단 고정)/NOTICE-07(카테고리 CRUD)/첨부파일은 OUT.
2. 카테고리: 4종 고정 시드(일반/긴급/주차/시설) — 동적 CRUD 미구현.
3. 첨부파일: 본 SPEC 완전 제외 — API 스키마에 attachments 필드 부재.
4. is_pinned: 컬럼 존재(ERD 준거, 디폴트 false)하나 API 동작 미노출 — 등록/수정 시 is_pinned 무시, 응답에서도 미포함.
5. 삭제: hard delete (영구 삭제, 기획서 명시) — 소프트 삭제/archived 정책은 건의 도메인만.
6. RBAC: 쓰기(POST/PUT/DELETE) = requireAdmin(ADMIN only); 읽기(GET) = 인증 사용자(역할 무관).
7. content 길이: 기능명세서 NOTICE-01 "최대 10,000자" 준거 — zod max(10000).
8. title 길이: VARCHAR(100) — zod max(100).
9. 401 vs 403: 미인증(토큰 누락/만료/변조)=401; 인증됨-권한불일치=403. AUTH/SETUP 일관 패턴.
