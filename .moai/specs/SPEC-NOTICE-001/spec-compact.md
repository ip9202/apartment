# SPEC-NOTICE-001 Compact Reference

공지사항(등록/수정/삭제/열람) 도메인의 압축 참조 문서. 모든 REQ-NOTICE-XXX 요구사항(001~018, a/b 서브 ID 포함, 총 18개), 검증 기준, 생성 파일, 제외 항목을 추출.

---

## 1. 요구사항 요약 (REQ-NOTICE-XXX)

| REQ ID | 모듈 | EARS 유형 | 핵심 요구사항 |
|--------|------|-----------|---------------|
| REQ-NOTICE-001 | M1 공지 등록 | Event-driven | ADMIN 공지 등록 시 notices 생성 + 201 반환 |
| REQ-NOTICE-002 | M1 공지 등록 | Unwanted | 미존재 category_id 등록 시 422 반환 (FK 위반 사전 차단) |
| REQ-NOTICE-003a | M1 공지 등록 | Unwanted | 공지 등록 미인증(토큰 없음) 시 401 반환 |
| REQ-NOTICE-003b | M1 공지 등록 | State-driven | 인증됨-비-ADMIN 공지 등록 시 403 반환 |
| REQ-NOTICE-004 | M2 공지 수정 | Event-driven | ADMIN 공지 수정 시 notices 갱신 + 200 반환 |
| REQ-NOTICE-005 | M2 공지 수정 | Unwanted | 미존재 공지 수정 시 404 반환 |
| REQ-NOTICE-006 | M2 공지 수정 | Unwanted | 미존재 category_id 수정 시 422 반환 |
| REQ-NOTICE-007a | M2 공지 수정 | Unwanted | 공지 수정 미인증 시 401 반환 |
| REQ-NOTICE-007b | M2 공지 수정 | State-driven | 인증됨-비-ADMIN 공지 수정 시 403 반환 |
| REQ-NOTICE-008 | M3 공지 삭제 | Event-driven | ADMIN 공지 영구 삭제(hard delete) + 200 반환 |
| REQ-NOTICE-009 | M3 공지 삭제 | Unwanted | 미존재 공지 삭제 시 404 반환 |
| REQ-NOTICE-010a | M3 공지 삭제 | Unwanted | 공지 삭제 미인증 시 401 반환 |
| REQ-NOTICE-010b | M3 공지 삭제 | State-driven | 인증됨-비-ADMIN 공지 삭제 시 403 반환 |
| REQ-NOTICE-011 | M4 공지 목록 | Event-driven | 인증 사용자 공지 목록 조회 시 category_id 필터 + 페이지네이션 + 200 반환 |
| REQ-NOTICE-012 | M4 공지 목록 | Ubiquitous | 공지 목록 응답에 content 미포함 (요약만) |
| REQ-NOTICE-013a | M4 공지 목록 | Unwanted | 공지 목록 조회 미인증 시 401 반환 |
| REQ-NOTICE-014 | M5 공지 상세 | Event-driven | 인증 사용자 공지 상세 조회 시 200 + 전체 필드 반환 |
| REQ-NOTICE-015 | M5 공지 상세 | Unwanted | 미존재 공지 상세 시 404 반환 |
| REQ-NOTICE-016a | M5 공지 상세 | Unwanted | 공지 상세 조회 미인증 시 401 반환 |
| REQ-NOTICE-017 | M6 마이그레이션 | Ubiquitous | notice_categories 시드 테이블 (4종 고정: 일반/긴급/주차/시설) |
| REQ-NOTICE-018 | M6 마이그레이션 | Ubiquitous | notices 테이블 스키마 (ERD 준거, is_pinned 컬럼 존재하나 API 동작 미노출) |

---

## 2. 검증 기준 요약 (Acceptance Criteria)

상세 시나리오는 `acceptance.md` 참조. 각 모듈당 최소 2개, 총 AC-NOTICE-001~018 + Edge Cases.

---

## 3. 생성 파일 (예정)

| 파일 | 모듈 | 설명 |
|------|------|------|
| `migrations/006_notices.sql` | M6 | notice_categories(시드) + notices 테이블 생성 |
| `src/app/api/notices/route.ts` | M1/M4 | GET 인증(목록), POST ADMIN(등록) |
| `src/app/api/notices/[id]/route.ts` | M2/M3/M5 | GET 인증(상세), PUT ADMIN(수정), DELETE ADMIN(삭제) |
| `src/app/api/notices/route.test.ts` | M1/M4 | 테스트 |
| `src/app/api/notices/[id]/route.test.ts` | M2/M3/M5 | 테스트 |
| `migrations/006.test.ts` | M6 | migration 검증 테스트 |

---

## 4. 제외 항목 (Exclusions)

1. 첨부파일 (attachments) — 본 SPEC 완전 제외, 별도 ADR/SPEC
2. NOTICE-06 상단 고정 (is_pinned API 동작) — P1 별도 SPEC
3. NOTICE-07 카테고리 동적 CRUD — P1 별도 SPEC
4. 소프트 삭제 — 본 SPEC은 hard delete (기획서 명시)
5. 공지 검색/조회수/알림 — 범위 외

---

## 5. 핵심 의사결정

| 결정 | 내용 | 근거 |
|------|------|------|
| 범위 | P0 ONLY (NOTICE-01~05) | 사용자 확정 |
| 카테고리 | 4종 고정 시드 (일반/긴급/주차/시설) | NOTICE-07 P1 OUT |
| 첨부파일 | 완전 제외 | 파일 저장소 백엔드 미결정 |
| is_pinned | 컬럼 존재, API 동작 미노출 | NOTICE-06 P1 OUT, 전방 호환 |
| 삭제 | hard delete (영구 삭제) | 기획서 명시 |
| RBAC | 쓰기=ADMIN(requireAdmin), 읽기=인증 사용자 | 권한 매트릭스 |

---

*본 compact 문서는 `spec.md`의 WHAT/WHY를 빠르게 참조하기 위한 요약이다.*
