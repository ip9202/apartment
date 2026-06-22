## SPEC-SUGGEST-001 Progress

- Started: (미착수 — Run Phase 대기 중)
- Phase: Plan 완료 (spec.md, spec-compact.md, research.md, plan.md, acceptance.md, tasks.md 작성 완료)
- Develop 머지: (대기 중 — MoAI 검토 후 develop 커밋 예정)
- Harness: standard (sub-agent mode), development_mode: tdd
- 검증 전략: 각 Phase 후 MoAI 직접 npm test / tsc --noEmit 교차 검증 (Lesson: 에이전트 품질 보고 hallucination 방지)

### Iteration log
- (Run Phase 진입 후 기록 예정)

## Task Status
- T-SUGGEST-A (M8b 마이그레이션 007): pending
- T-SUGGEST-B (M1 등록 + M4 목록 역할분기): pending
- T-SUGGEST-C (M5 상세 권한검사): pending
- T-SUGGEST-D (M2 수정 작성자본인): pending
- T-SUGGEST-E (M3 아카이브 익명화): pending
- T-SUGGEST-F (M6 답변 등록): pending
- T-SUGGEST-G (M7 상태 전이 검증): pending
- T-SUGGEST-H (M8a 호수별 이력): pending
- T-SUGGEST-V (최종 검증): pending

## Known limitations (후속 추적)
- 첨부파일 (attachments): 본 SPEC 범위 외 — 파일 저장소 백엔드 결정 후 별도 SPEC
- SUGGEST-13 카테고리 동적 CRUD: P1 별도 SPEC — 본 SPEC은 4종 고정 시드
- 건의 영구 삭제 (hard delete): ADR-005 금지 — DELETE = archive semantics
- 건의 답변 수정/삭제: 본 SPEC은 등록만, 수정/삭제는 별도 SPEC
- 건의 검색(전문 검색): 범위 외, 필터만 지원
- AUDITOR 건의 권한: apt_08 §7 매트릭스 미명시 → RESIDENT 동일 취급(공개+본인비공개 열람, 등록 가능). 후속 보안 정책 명시 권장.

## Acceptance criteria completion (Re-planning Gate 추적)
| Iteration | AC 완료 수 | 에러 수 delta | 비고 |
|-----------|-----------|---------------|------|
| (Run Phase 진입 후 기록 예정) | - | - | - |

## Coverage
- (Run Phase 진입 후 기록 예정)

## 회귀 검증
- 기존 333 테스트(AUTH + SETUP + NOTICE) + 신규 SUGGEST 테스트 = 전체 통과, 0 회귀 목표
- AUTH deactivate 사이드이펙트(REQ-AUTH-014) 호환성 유지 필수 — migration 007 ALTER 후에도 기존 004 컬럼/데이터 보존
