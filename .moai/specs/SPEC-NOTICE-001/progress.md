## SPEC-NOTICE-001 Progress

- Started: 2026-06-22 (Run Phase 착수)
- Phase: Run 완료 → Sync 완료 (문서 동기화 완료, 본 PR)
- Develop 병합: 2026-06-22 (커밋 84b5923, squash-merge 완료)
- Feature 브랜치 삭제: 완료 (본 PR merge 후 자동 삭제)
- Harness: standard (sub-agent mode), development_mode: tdd
- 검증 전략: 각 Phase 후 MoAI 직접 npm test / tsc --noEmit 교차 검증 (Lesson: 에이전트 품질 보고 hallucination 방지)

### Iteration log
- [2026-06-22] Phase A (M6 migration) GREEN — 11 tests, commit 3ca1787
- [2026-06-22] Phase B (M1 POST + M4 GET) GREEN — 16 tests, commit 3e38472
- [2026-06-22] Phase C (M5 GET detail) GREEN — 6 tests, commit 9b58da2
- [2026-06-22] Phase D (M2 PUT) GREEN — 5 tests, commit 2465d04
- [2026-06-22] Phase E (M3 DELETE) GREEN — 5 tests, commit d0bec45
- [2026-06-22] Phase V 최종 검증 PASS — tsc 0 err, lint 0 err, 333 tests pass, NOTICE route 93.45% lines

## Task Status
- T-NOTICE-A (M6 마이그레이션): done
- T-NOTICE-B (M1 등록 + M4 목록): done
- T-NOTICE-C (M5 상세): done
- T-NOTICE-D (M2 수정): done
- T-NOTICE-E (M3 삭제): done
- T-NOTICE-V (최종 검증): done

## Known limitations (후속 추적)
- 첨부파일 (attachments): 본 SPEC 범위 외 — 파일 저장소 백엔드 결정 후 별도 SPEC
- NOTICE-06 상단 고정 (is_pinned API 동작): P1 별도 SPEC — 컬럼 존재(디폴트 false), API 미노출
- NOTICE-07 카테고리 동적 CRUD: P1 별도 SPEC — 본 SPEC은 4종 고정 시드
- notices.author_id FK ON DELETE 미정의: ADMIN 강제 탈퇴 시 FK 위반 가능 (38세대 소규모, 본 범위 외)

## Acceptance criteria completion (Re-planning Gate 추적)
| Iteration | AC 완료 수 | 에러 수 delta | 비고 |
|-----------|-----------|---------------|------|
| Phase A   | AC-001, AC-002 (2) | 0 | M6 스키마/시드/멱등성 |
| Phase B   | AC-003~006, 016~019 + EC-001,002,004,005,006 (12) | 0 | M1 등록 + M4 목록 |
| Phase C   | AC-020~022 + EC-003 (4) | 0 | M5 상세 |
| Phase D   | AC-007~011 (5) | 0 | M2 수정 |
| Phase E   | AC-012~015 (4) | 0 | M3 삭제 |
| 합계      | AC-001~022 (22) + EC-001~006 (6) = 28/28 | 0 | 전체 통과 |

## Coverage
- src/lib (config 범위): 94.3% lines (임계 85% 충족)
- src/app/api/notices (NOTICE 신규): 93.45% lines, 100% functions

## 회귀 검증
- 기존 290 테스트 + 신규 43 테스트 = 333 전체 통과, 0 회귀
