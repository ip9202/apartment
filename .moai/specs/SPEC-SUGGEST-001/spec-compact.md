# SPEC-SUGGEST-001 Compact Reference

건의/문의(등록/수정/아카이브/열람/답변/상태/호수이력) 도메인의 압축 참조 문서. 모든 REQ-SUGGEST-XXX 요구사항(001~040, a/b 서브 ID 포함, 총 40개), 검증 기준, 생성 파일, 제외 항목을 추출.

---

## 1. 요구사항 요약 (REQ-SUGGEST-XXX)

| REQ ID | 모듈 | EARS 유형 | 핵심 요구사항 |
|--------|------|-----------|---------------|
| REQ-SUGGEST-001 | M1 건의 등록 | Event-driven | RESIDENT 이상 건의 등록 시 suggestions 생성 + 201 반환 (author_id, unit_id, status='접수', archived=false) |
| REQ-SUGGEST-002 | M1 건의 등록 | Unwanted | ADMIN 건의 등록 시 403 반환 (관리사무소 등록 권한 없음, apt_08 §7) |
| REQ-SUGGEST-003 | M1 건의 등록 | Unwanted | 미존재 category_id 등록 시 422 반환 (FK 사전 차단) |
| REQ-SUGGEST-004 | M1 건의 등록 | Unwanted | 건의 등록 미인증 시 401 반환 |
| REQ-SUGGEST-005 | M1 건의 등록 | Unwanted | 동/호수 미인증(unit_id NULL) 사용자 등록 시 403 반환 |
| REQ-SUGGEST-006 | M2 건의 수정 | Event-driven | 작성자 본인 건의 수정 시 suggestions 갱신 + 200 반환 |
| REQ-SUGGEST-007 | M2 건의 수정 | Unwanted | 타인(ADMIN 포함) 건의 수정 시 403 반환 (작성자 본인 only) |
| REQ-SUGGEST-008 | M2 건의 수정 | Unwanted | archived=true 또는 status='완료' 건의 수정 시 409 반환 |
| REQ-SUGGEST-009 | M2 건의 수정 | Unwanted | 미존재 건의 수정 시 404 반환 |
| REQ-SUGGEST-010 | M2 건의 수정 | Unwanted | 미존재 category_id 수정 시 422 반환 |
| REQ-SUGGEST-011 | M2 건의 수정 | Unwanted | 건의 수정 미인증 시 401 반환 |
| REQ-SUGGEST-012 | M3 건의 아카이브 | Event-driven | 작성자 본인 DELETE 시 archived=true + author_id=NULL + author_label="전 입주민" + unit_id 보존 + 200 반환 |
| REQ-SUGGEST-013 | M3 건의 아카이브 | Event-driven | ADMIN DELETE 시 동일 익명화 절차 + 200 반환 |
| REQ-SUGGEST-014 | M3 건의 아카이브 | Unwanted | 타인(비-ADMIN) 아카이브 시 403 반환 |
| REQ-SUGGEST-015 | M3 건의 아카이브 | Unwanted | 이미 archived=true 재아카이브 시 409 반환 (멱등성) |
| REQ-SUGGEST-016 | M3 건의 아카이브 | Unwanted | 미존재 건의 아카이브 시 404 반환 |
| REQ-SUGGEST-017 | M3 건의 아카이브 | Unwanted | 건의 아카이브 미인증 시 401 반환 |
| REQ-SUGGEST-018 | M4 건의 목록 | Event-driven | 인증 사용자 목록 조회 시 역할별 자동 필터링 + 쿼리 필터 + 페이지네이션 + 200 반환 |
| REQ-SUGGEST-019 | M4 건의 목록 | Ubiquitous | 건의 목록 응답에 content 미포함 (요약만) |
| REQ-SUGGEST-020 | M4 건의 목록 | Unwanted | 건의 목록 조회 미인증 시 401 반환 |
| REQ-SUGGEST-021 | M4 건의 목록 | State-driven | REP 비공개 담당 동(managed_building_id) 필터링 |
| REQ-SUGGEST-022 | M4 건의 목록 | State-driven | RESIDENT/AUDITOR 비공개 본인(author_id) 필터링 |
| REQ-SUGGEST-023 | M5 건의 상세 | Event-driven | 인증 사용자 권한 검사 후 건의 상세 200 + 전체 필드 반환 |
| REQ-SUGGEST-024 | M5 건의 상세 | Unwanted | 비공개 건의 무권한 열람 시 403 반환 (404 아님 — 존재 누출 방지) |
| REQ-SUGGEST-025 | M5 건의 상세 | Unwanted | 미존재 건의 상세 시 404 반환 |
| REQ-SUGGEST-026 | M5 건의 상세 | Unwanted | 건의 상세 조회 미인증 시 401 반환 |
| REQ-SUGGEST-027 | M6 건의 답변 | Event-driven | ADMIN 답변 등록 시 suggestion_replies 생성 + 201 반환 |
| REQ-SUGGEST-028 | M6 건의 답변 | Unwanted | 미존재 건의 답변 등록 시 404 반환 |
| REQ-SUGGEST-029a | M6 건의 답변 | Unwanted | 답변 등록 미인증 시 401 반환 |
| REQ-SUGGEST-029b | M6 건의 답변 | State-driven | 비-ADMIN 답변 등록 시 403 반환 |
| REQ-SUGGEST-030 | M7 상태 변경 | Event-driven | ADMIN 상태 변경 시 suggestions.status 갱신 + 200 반환 (reason 선택 로깅) |
| REQ-SUGGEST-031 | M7 상태 변경 | State-driven | 상태 전이 규칙: 접수→처리중→완료, 접수/처리중→보류, 보류→처리중/접수, 완료→접수(재오픈) |
| REQ-SUGGEST-032 | M7 상태 변경 | Unwanted | 불가능한 상태 전이 시 409 반환 (현재/요청 상태 포함) |
| REQ-SUGGEST-033 | M7 상태 변경 | Unwanted | 미존재 건의 상태 변경 시 404 반환 |
| REQ-SUGGEST-034a | M7 상태 변경 | Unwanted | 상태 변경 미인증 시 401 반환 |
| REQ-SUGGEST-034b | M7 상태 변경 | State-driven | 비-ADMIN 상태 변경 시 403 반환 |
| REQ-SUGGEST-035 | M8a 호수 이력 | Event-driven | ADMIN/CHAIR 호수별 이력 조회 시 아카이브 포함 시간순 + 200 반환 (building_id+unit_number 해석) |
| REQ-SUGGEST-036 | M8a 호수 이력 | Unwanted | 미존재 building/unit 조합 시 404 반환 |
| REQ-SUGGEST-037a | M8a 호수 이력 | Unwanted | 호수별 이력 조회 미인증 시 401 반환 |
| REQ-SUGGEST-037b | M8a 호수 이력 | State-driven | 비-ADMIN/비-CHAIR 호수별 이력 조회 시 403 반환 |
| REQ-SUGGEST-038 | M8b 마이그레이션 | Ubiquitous | suggestion_categories 시드 테이블 (4종 고정: 시설/주차/소음/기타) |
| REQ-SUGGEST-039 | M8b 마이그레이션 | Ubiquitous | suggestions 테이블 ALTER 확장 (컬럼 7종 추가, 기존 004 보존) |
| REQ-SUGGEST-040 | M8b 마이그레이션 | Ubiquitous | suggestion_replies 신규 테이블 |

---

## 2. 검증 기준 요약 (Acceptance Criteria)

상세 시나리오는 `acceptance.md` 참조. 각 모듈당 최소 2개, 총 AC-SUGGEST-001~040 + Edge Cases.

---

## 3. 생성 파일 (예정)

| 파일 | 모듈 | 설명 |
|------|------|------|
| `migrations/007_suggestions_expand.sql` | M8b | suggestions ALTER(컬럼 7종) + suggestion_categories(시드) + suggestion_replies 생성 |
| `src/app/api/suggestions/route.ts` | M1/M4 | GET 인증(목록, 역할별 분기), POST RESIDENT 이상(등록, ADMIN 403) |
| `src/app/api/suggestions/[id]/route.ts` | M2/M3/M5 | GET 인증(상세, 권한 검사), PUT 작성자(수정), DELETE 작성자/ADMIN(아카이브) |
| `src/app/api/suggestions/[id]/replies/route.ts` | M6 | POST ADMIN(답변 등록) |
| `src/app/api/suggestions/[id]/status/route.ts` | M7 | PUT ADMIN(상태 변경, 전이 검증) |
| `src/app/api/suggestions/units/[building]/[unit]/route.ts` | M8a | GET ADMIN/CHAIR(호수별 이력, 아카이브 포함) |
| `src/app/api/suggestions/route.test.ts` | M1/M4 | 테스트 |
| `src/app/api/suggestions/[id]/route.test.ts` | M2/M3/M5 | 테스트 |
| `src/app/api/suggestions/[id]/replies/route.test.ts` | M6 | 테스트 |
| `src/app/api/suggestions/[id]/status/route.test.ts` | M7 | 테스트 |
| `src/app/api/suggestions/units/[building]/[unit]/route.test.ts` | M8a | 테스트 |
| `src/lib/migration-007.test.ts` | M8b | migration 007 검증 테스트 |

---

## 4. 제외 항목 (Exclusions)

1. 첨부파일 (attachments) — 본 SPEC 완전 제외, 별도 ADR/SPEC
2. SUGGEST-13 카테고리 동적 CRUD — P1 별도 SPEC
3. 건의 영구 삭제 (hard delete) — ADR-005 금지, DELETE = archive semantics
4. 건의 검색(전문 검색) — 범위 외, 필터만 지원
5. 건의 답변 수정/삭제 — 범위 외 (등록만)
6. 건의 알림(푸시/이메일) — P2
7. 건의 수정 이력 추적 — 범위 외

---

## 5. 핵심 의사결정

| 결정 | 내용 | 근거 |
|------|------|------|
| 범위 | FULL P0 (SUGGEST-01~12) 단일 SPEC | 사용자 확정 |
| 카테고리 | 4종 고정 시드 (시설/주차/소음/기타) | SUGGEST-13 P1 OUT |
| 첨부파일 | 완전 제외 | NOTICE-001 동일, 파일 저장소 미결정 |
| 삭제 정책 | archive-only (hard delete 금지) | ADR-005 호수 귀속 |
| 테이블 전략 | 004 ALTER + categories/replies 신규 | 기존 004 보존, AUTH 호환성 |
| ADMIN 등록 | ❌ (403) | apt_08 §7 매트릭스 (PRD SUGGEST-01 "RESIDENT 이상"과 충돌 → apt_08 우선) |
| 역할 분기 | RESIDENT/AUDITOR=본인, REP=담당동, CHAIR/ADMIN=전체 | apt_08 §7 + apt_06 GET /suggestions |
| 비공개 무권한 | 403 (404 아님) | 존재 여부 누출 방지 |
| 상태 전이 | 접수→처리중→완료, 보류, 재오픈 | apt_03 처리상태전이 |
| content 길이 | 5000자 (NOTICE 10000자와 상이) | apt_03 SUGGEST-01 명시 |

---

## 6. 모호점 (FLAG — plan.md/research.md 상세)

1. **ADMIN 건의 등록 권한 충돌**: apt_08 §7 매트릭스(❌) vs PRD SUGGEST-01("RESIDENT 이상") → apt_08 우선 (ADMIN 403). AUDITOR는 매트릭스에 미명시 → RESIDENT 동일 취급.
2. **호수별 이력 path param 해석**: apt_06 `/units/:building/:unit` 표기 모호 → building_id(UUID) + unit_number(String)으로 해석, units JOIN으로 unit_id 해석.
3. **보류/재오픈 reason 필드**: 선택값 모델링, 로깅만 (hard 422 아님).
4. **migration 007 vs 007+008 분리**: 007에 전부(ALTER + categories + replies) 넣는 것 기본, 매니저 판단으로 008 분리 가능.

---

*본 compact 문서는 `spec.md`의 WHAT/WHY를 빠르게 참조하기 위한 요약이다.*
