## Task Decomposition
SPEC: SPEC-SUGGEST-001

개발 방법론: TDD (RED-GREEN-REFACTOR), quality.yaml development_mode=tdd.
실행 모드: Standard Mode (sub-agent, manager-tdd). Phase별 순차 진행.

| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| T-SUGGEST-A | M8b suggestion_categories 시드 + suggestions ALTER + suggestion_replies 마이그레이션 | REQ-038,039,040, AC-001,002,003,004 | - | migrations/007_suggestions_expand.sql, src/lib/migration-007.test.ts | pending |
| T-SUGGEST-B | M1 건의 등록 + M4 건의 목록 열람 (역할별 분기) + SUGGEST 도메인 requireAuthenticated 헬퍼 | REQ-001~005,018~022, AC-005~009,024~029 | T-SUGGEST-A | src/lib/suggest-rbac.ts (신규, requireAuthenticated 헬퍼 — 공유 rbac.ts 수정 없음), src/app/api/suggestions/route.ts, src/app/api/suggestions/route.test.ts | pending |
| T-SUGGEST-C | M5 건의 상세 열람 (권한 검사) | REQ-023~026, AC-030~034 | T-SUGGEST-B | src/app/api/suggestions/[id]/route.ts (GET), src/app/api/suggestions/[id]/route.test.ts (GET) | pending |
| T-SUGGEST-D | M2 건의 수정 (작성자 본인, archived/완료 409) | REQ-006~011, AC-010~017 | T-SUGGEST-C | src/app/api/suggestions/[id]/route.ts (PUT 추가), src/app/api/suggestions/[id]/route.test.ts (PUT 추가) | pending |
| T-SUGGEST-E | M3 건의 아카이브 (작성자/ADMIN, 익명화, unit_id 보존) | REQ-012~017, AC-018~023, EC-006 | T-SUGGEST-D | src/app/api/suggestions/[id]/route.ts (DELETE 추가), src/app/api/suggestions/[id]/route.test.ts (DELETE 추가) | pending |
| T-SUGGEST-F | M6 건의 답변 등록 (ADMIN) | REQ-027~029b, AC-035~038 | T-SUGGEST-E | src/app/api/suggestions/[id]/replies/route.ts, src/app/api/suggestions/[id]/replies/route.test.ts | pending |
| T-SUGGEST-G | M7 처리 상태 변경 (ADMIN, 전이 검증 409) | REQ-030~034b, AC-039~045, EC-007 | T-SUGGEST-F | src/app/api/suggestions/[id]/status/route.ts, src/app/api/suggestions/[id]/status/route.test.ts | pending |
| T-SUGGEST-H | M8a 호수별 건의 이력 조회 (ADMIN/CHAIR, 아카이브 포함) | REQ-035~037b, AC-046~050 | T-SUGGEST-G | src/app/api/suggestions/units/[building]/[unit]/route.ts, src/app/api/suggestions/units/[building]/[unit]/route.test.ts | pending |
| T-SUGGEST-V | 최종 검증 + develop 머지 준비 | 전체 AC + 기존 333 회귀 | T-SUGGEST-A,B,C,D,E,F,G,H | - | pending |

## 재사용 파일 (AUTH/SETUP/NOTICE 소유, 수정 없음)
- src/lib/db.ts (query)
- src/lib/auth.ts (verifyAccessToken)
- src/lib/rbac.ts (requireAdmin, requirePrivileged, unauthorized, forbidden, badRequest, notFound, conflict, validationError) — **수정 없음** (공유 파일, Scope Discipline 준거)
- src/middleware.ts (수정 불필요 — /api/suggestions는 기존 matcher로 인증 적용, 공개 엔드포인트 아님)

## 신규 파일 (SUGGEST 소유)
- src/lib/suggest-rbac.ts — requireAuthenticated 헬퍼 (Bearer→verify→ACTIVE 조회, {callerId, callerRole, unitId, managedBuildingId} 반환). M1/M4/M5 공유 (fan_in=3). NOTICE 의 로컬 requireAuth 인라인 패턴을 별도 파일로 추출한 것 — 공유 rbac.ts 를 건드리지 않아 기존 333 테스트 회귀 리스크 제로.

## 정책 결정 (Plan Review 확정)
1. P0 범위: SUGGEST-01~12 전체. SUGGEST-13(카테고리 CRUD)/첨부파일/영구삭제/답변 수정·삭제/검색/알림은 OUT.
2. 카테고리: 4종 고정 시드(시설/주차/소음/기타) — 동적 CRUD 미구현.
3. 첨부파일: 본 SPEC 완전 제외 — API 스키마에 attachments 필드 부재.
4. 삭제 정책: archive-only (hard delete 금지). DELETE = archived=true + 익명화(author_id=NULL, author_label="전 입주민"). unit_id 영구 보존(ADR-005).
5. 테이블 전략: 기존 004 suggestions를 migration 007 ALTER로 확장(컬럼 7종 추가). 기존 004 데이터/컬럼 보존. suggestion_categories + suggestion_replies 신규 테이블도 007에 포함(매니저 판단 시 008 분리 가능).
6. RBAC: 등록=RESIDENT 이상(ADMIN 403, apt_08 §7); 수정=작성자 본인 only; 아카이브=작성자 OR ADMIN; 답변/상태변경=ADMIN; 호수이력=ADMIN/CHAIR.
7. 역할 분기(비공개 열람): RESIDENT/AUDITOR=본인, REP=담당동(managed_building_id), CHAIR/ADMIN=전체. AUDITOR는 apt_08 미명시 → RESIDENT 동일 취급.
8. 비공개 무권한 접근: 403 (404 아님 — 존재 여부 누출 방지).
9. 상태 전이: 접수→처리중→완료, 접수/처리중→보류, 보류→처리중/접수, 완료→접수(재오픈). 불허 전이 409. reason 선택 로깅.
10. content 길이: 5000자 (NOTICE 10000자와 상이 — apt_03 SUGGEST-01 명시).
11. title 길이: VARCHAR(100) — zod max(100).
12. 호수별 이력 path param: building_id(UUID) + unit_number(String), units JOIN으로 unit_id 해석.
13. 401 vs 403: 미인증(토큰 누락/만료/변조)=401; 인증됨-권한불일치=403. AUTH/SETUP/NOTICE 일관 패턴.
