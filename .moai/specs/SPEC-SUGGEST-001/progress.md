## SPEC-SUGGEST-001 Progress

- Started: 2026-06-22 (Run Phase 2 — TDD Implementation)
- Phase: Run 완료 (Phase A~H + V 전 단계 RED-GREEN-REFACTOR 완료)
- Develop 머지: ✅ 완료 (2026-06-22, squash-merge 커밋 0d90dd1, 브랜치 삭제)
- Harness: standard (sub-agent mode), development_mode: tdd
- 검증 전략: 각 Phase 후 MoAI 직접 npm test / tsc --noEmit 교차 검증 (Lesson: 에이전트 품질 보고 hallucination 방지)

### Iteration log
- 2026-06-22 Phase A (M8b migration 007): RED 14 tests fail → GREEN 14 pass. R1 CRITICAL AUTH deactivate 호환성 단정 포함 (unit_id 보존, 신규 NOT NULL 컬럼 간섭 없음). commit 994c095.
- 2026-06-22 Phase B (M1 등록 + M4 목록): RED 18 fail → GREEN 18 pass. requireAuthenticated 헬퍼 (fan_in=3), ADMIN 등록 403, 역할별 비공개 분기. commit e83a780.
- 2026-06-22 Phase C (M5 상세): RED 8 fail → GREEN 8 pass. 비공개 403 (404 아님). commit c0e2ded.
- 2026-06-22 Phase D+E (M2 수정 + M3 아카이브): RED 14 fail → GREEN 14 pass. ADR-005 익명화 + unit_id 영구 보존, archived 체크를 권한 체크보다 먼저 수행 (재아카이브 멱등성). commit b4722ab.
- 2026-06-22 Phase F (M6 답변): RED 7 fail → GREEN 7 pass. ADMIN 전용. commit 3a23681.
- 2026-06-22 Phase G (M7 상태 전이): RED 10 fail → GREEN 10 pass. 화이트리스트 맵, 접수→완료 409. commit 2560497.
- 2026-06-22 Phase H (M8a 호수 이력): RED 8 fail → GREEN 8 pass. ADMIN/CHAIR (requirePrivileged), 아카이브/비공개 포함 created_at ASC. commit 3b77f51.
- 2026-06-22 Phase V (최종 검증): tsc 0 errors, lint 0 errors (2 pre-existing warnings), 412 tests pass (333 baseline + 79 신규), coverage 93.13% stmts / 87.24% branches / 93.07% lines (목표 85% 초과).

## Task Status
- T-SUGGEST-A (M8b 마이그레이션 007): done (994c095)
- T-SUGGEST-B (M1 등록 + M4 목록 역할분기): done (e83a780)
- T-SUGGEST-C (M5 상세 권한검사): done (c0e2ded)
- T-SUGGEST-D (M2 수정 작성자본인): done (b4722ab)
- T-SUGGEST-E (M3 아카이브 익명화): done (b4722ab)
- T-SUGGEST-F (M6 답변 등록): done (3a23681)
- T-SUGGEST-G (M7 상태 전이 검증): done (2560497)
- T-SUGGEST-H (M8a 호수별 이력): done (3b77f51)
- T-SUGGEST-V (최종 검증): done

## Known limitations (후속 추적)
- 첨부파일 (attachments): 본 SPEC 범위 외 — 파일 저장소 백엔드 결정 후 별도 SPEC
- SUGGEST-13 카테고리 동적 CRUD: P1 별도 SPEC — 본 SPEC은 4종 고정 시드
- 건의 영구 삭제 (hard delete): ADR-005 금지 — DELETE = archive semantics
- 건의 답변 수정/삭제: 본 SPEC은 등록만, 수정/삭제는 별도 SPEC
- 건의 검색(전문 검색): 범위 외, 필터만 지원
- AUDITOR 건의 권한: apt_08 §7 매트릭스 미명시 → RESIDENT 동일 취급(공개+본인비공개 열람, 등록 가능). 후속 보안 정책 명시 권장.
- 상태 변경 reason 필드: 현재 로그 전용 (테이블 컬럼 없음). status_history 테이블 도입 시 별도 SPEC.

## Acceptance criteria completion (Re-planning Gate 추적)
| Iteration | AC 완료 수 | 에러 수 delta | 비고 |
|-----------|-----------|---------------|------|
| Phase A~V | AC-001~050 + EC-001~008 = 58 → 구현 커버 | 0 | 회귀 0, AUTH/SETUP/NOTICE 333 테스트 유지 |

## Coverage (Phase V)
- Statements: 93.13% (217/233)
- Branches: 87.24% (130/149)
- Functions: 88.88% (16/18)
- Lines: 93.07% (215/231)
- 목표 85% 초과 달성

## 회귀 검증
- 기존 333 테스트(AUTH + SETUP + NOTICE) + 신규 SUGGEST 79 테스트 = 412 전체 통과, 0 회귀
- R1 CRITICAL: AUTH deactivate UPDATE 가 migration 007 ALTER 후에도 정상 동작 단정 포함 (migration-007.test.ts)
