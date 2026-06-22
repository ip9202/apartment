## SPEC-SETUP-001 Progress

- Started: 2026-06-22 (--resume 세션)
- Phase A (M5 통일 + AUTH 회귀): 완료 — 커밋 0608777, 223/223 통과 (이전 세션)
- Harness: standard (sub-agent mode), development_mode: tdd
- 검증 전략: Lesson #1 — 각 Phase 후 MoAI 직접 npm test / tsc --noEmit 교차 검증

### Iteration log
- [2026-06-22] Phase B 완료: M1 동 관리 CRUD + M6 공개 조회 (커밋 25ca66b). 직접 검증: tsc 0, buildings 19/19, 전체 242/242. Known limitation: INACTIVE 입주민 unit_id 귀속 동 삭제 FK 차단 (AUTH 정책 조율 예정).
- [2026-06-22] Phase C 완료: M2 호수 일괄 업데이트 (커밋 0b42394). 직접 검증: tsc 0, units 17/17, 전체 259/259. diff 트랜잭션 + 활성 입주민 409 guard(@MX:WARN).
- [2026-06-22] Phase D 완료: M3 직책 부여/회수 (커밋 75b6229). 직접 검증: tsc 0, role 15/15, 전체 274/274. 회장 단일성 FOR UPDATE 동시성 방어 직접 리뷰 확인. requirePrivileged 추가(requireAdmin 호환).
- [2026-06-22] Phase E 완료: M4 회원 목록 조회 (커밋 2a12a51). 직접 검증: tsc 0, users 16/16, 전체 290/290. password_hash 구조적 배제(selectColumns) 직접 확인(REQ-015).
- [2026-06-22] Phase V 시작: 최종 검증 + develop 머지 준비. 구현 Phase B-E 전부 완료 (4 커밋).
- [2026-06-22] Phase V 완료: 최종 검증 통과 (tsc 0, eslint 0, 290/290). /moai review PASS — manager-quality(TRUST 5 5/5) + expert-security(OWASP CLEAN) 합의 + MoAI 직접 교차 검증(SQL injection/password_hash/RBAC/FOR UPDATE 전부 코드 레벨 확인). Critical 0건.
- [2026-06-22] develop squash merge 완료 (bb7b3f4). develop에서 290/290 재확인. SPEC-SETUP-001 P0 완료.

## Known limitations (후속 추적)
1. INACTIVE 입주민 unit_id 귀속 동/호수 삭제 시 FK RESTRICT 차단 → 409 (misleading message). AUTH 강제탈퇴(deactivate) 정책과 조율 필요. @MX:NOTE 문서화. non-blocking.
2. 감사 로깅(401/403 이벤트) 미구현 — 모니터링 권장 (expert-security A09).
3. ast-grep gate: sgconfig 미비로 scan 불가 — 인프라 후속.
