# SPEC Review Report: SPEC-SETUP-001
Iteration: 2/3
Verdict: PASS
Overall Score: 0.88

Reasoning context ignored per M1 Context Isolation. Audit based solely on spec.md, plan.md, acceptance.md, spec-compact.md, and the AUTH cross-reference artifact (`src/lib/migration-001.test.ts`, read directly to verify C1).

---

## Must-Pass Results

- [PASS] MP-1 REQ number consistency: Base REQ sequence is 001–020 with no gaps or duplicates, zero-padded to 3 digits (spec.md:L84–L204). The author adopted a systematic a/b sub-ID convention for 401/403 splits (004a/004b, 008a/008b, 013a/013b, 016a/016b) and for input validation (007a). This is a recognized EARS sub-clause pattern, not a sequencing gap. The previous lone-007a anomaly (iteration 1 M2) is now subsumed under a documented convention; see observation O1 below for a cosmetic residue.

- [PASS] MP-2 EARS format compliance: Every REQ-SETUP-XXX in spec.md:L82–L204 matches one of the five EARS patterns (Ubiquitous "The system shall", Event-driven "When…shall", State-driven "While…shall", Optional "Where…shall", Unwanted "If…then shall not"). REQ-SETUP-010 (Complex/While) combines While+When but retains shall-response. Acceptance criteria in acceptance.md are correctly labeled as Given/When/Then test scenarios (acceptance.md:L3), not mislabeled as EARS.

- [ACCEPTED-BY-CONSISTENCY] MP-3 YAML frontmatter validity: spec.md:L1–L10 retains `created`/`updated` (not `created_at`/`updated_at`), `priority: "P0"` (not in {critical,high,medium,low}), and no `labels` field. Per task instruction, M6 is treated as non-blocking/accepted-by-consistency because the sibling SPEC-AUTH-001 uses identical frontmatter and passed review. Not re-flagged.

- [N/A] MP-4 Section 22 language neutrality: N/A — single-domain SPEC (Next.js/TypeScript/PostgreSQL SETUP routes). Auto-passes.

No must-pass criterion blocks PASS.

---

## Category Scores (0.0-1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.88 | 0.75 | REQs are unambiguous after the 401/403 a/b split. Minor residue: REQ-SETUP-007a is a lone 'a' with no sibling 'b' (convention used elsewhere is for 401/403 pairs). Acceptance.md:L27 trace label "(REQ-SETUP-004)" is stale (should be 004b). |
| Completeness | 1.0 | 1.0 | All sections present (HISTORY, WHY, WHAT, HOW/REQUIREMENTS, ACCEPTANCE CRITERIA, Exclusions). GET /api/setup/buildings public endpoint now has owning REQ-SETUP-020 (spec.md:L202–L204). 404-non-existent-building now in REQ-SETUP-003 (spec.md:L96). Input-validation REQ-SETUP-007a added (spec.md:L122). Exclusions §5 has 7 specific entries. |
| Testability | 0.88 | 0.75 | All ACs are binary-testable (HTTP status, DB state, test pass/fail). AC-SETUP-023 (acceptance.md:L175–L179) now references the correct assertion location (L90 assertColumnsExist roles block) and correctly states L142–145 is unaffected. Minor: AC-SETUP-004's trace label is ambiguous but its test body is unambiguous. |
| Traceability | 0.88 | 0.75 | Every REQ (20 base IDs) has ≥1 AC or EC. Every AC/EC references an existing REQ. One stale label: acceptance.md:L27 AC-SETUP-004 traces to bare "REQ-SETUP-004" instead of "REQ-SETUP-004b" (spec-compact.md:L45 has the correct "REQ-SETUP-004b" label — the two files disagree). |

---

## Defect Resolution (Iteration 1 → Iteration 2)

### CRITICAL

**C1** (plan.md:L25–L37 + acceptance.md:L175–L179 AC-SETUP-023) — **RESOLVED**.
Independently verified by direct read of `src/lib/migration-001.test.ts:L80–L149`:
- L90: `{ table: 'roles', column: 'managed_building_id', dataType: 'uuid', isNullable: true }` — EXISTS, will break after migration 005 (DROP COLUMN). Confirmed.
- L142–L145: `foreignKeyExists(pool, 'users_managed_building_id_fkey')` — EXISTS, users-based, unaffected. Confirmed.
- No `roles_managed_building_id_fkey` assertion exists anywhere in the file. Confirmed.

plan.md:L27 now states the breaking assertion is `assertColumnsExist` roles block at L85–L93 (item at L90). plan.md:L29 explicitly notes L142–L145 `users_managed_building_id_fkey` is unaffected and that the previously-referenced `roles_managed_building_id_fkey` "AUTH 테스트 파일에 존재하지 않는다". plan.md:L32–L38 prescribes: remove L90 item, leave L142–L145 unchanged, add new `migrations/005.test.ts`. acceptance.md:L175–L179 (AC-SETUP-023) mirrors this correctly. The factual cross-SPEC regression error is corrected.

### MAJOR

**M1** (REQ count contradiction across 4 files) — **RESOLVED**.
All four documents now consistently state "20개 REQ-SETUP-XXX 요구사항(001~020, a/b 서브 ID 포함)":
- spec.md:L280, plan.md:L3, acceptance.md:L3, spec-compact.md:L3, acceptance.md:L271 (DoD).
Base range 001–020 = 20 numbers; a/b sub-IDs are qualified as "포함" (included) under parents. The iteration-1 contradiction (18 claimed vs 19 actual) is eliminated.

**M2** (Non-standard REQ-SETUP-007a breaking MP-1) — **RESOLVED**.
The author adopted a systematic a/b sub-ID convention (004a/b, 008a/b, 013a/b, 016a/b for 401/403 splits; 007a for input validation) rather than eliminating 007a. Under this convention, letter suffixes are documented sub-clauses, not informal notation. MP-1 (sequential base numbering 001–020, no gaps/duplicates) is satisfied. See O1 for a cosmetic residue (007a has no 007b).

**M3** (GET /api/setup/buildings public endpoint had no owning REQ) — **RESOLVED**.
spec.md:L202–L204 adds REQ-SETUP-020 (Event-driven): "When 클라이언트가 GET /api/setup/buildings 로 동/호수 목록을 요청하면, the system shall 액세스 토큰 없이(비인증)도 200 OK 응답으로 동 목록과 종속 호수(unit_number 배열)를 반환한다 ... 응답 본문에는 회원 데이터(email/password_hash/role 등)를 절대 포함하지 않는다." EC-SETUP-006 (acceptance.md:L225–L229) and AC-SETUP-024 (acceptance.md:L185–L189) both trace to REQ-SETUP-020.

**M4** (AC-SETUP-005 404 trace had no covering REQ) — **RESOLVED**.
spec.md:L92–L96 extends REQ-SETUP-003 with a second If-branch: "If 삭제 대상 building_id 가 DB에 존재하지 않으면, then the system shall 404 Not Found 응답을 반환한다 (삭제 대상 없음)." AC-SETUP-005 (acceptance.md:L33–L37) traces to REQ-SETUP-003, which now covers the 404 case.

**M5** (401 vs 403 conflation across setup RBAC REQs) — **RESOLVED**.
Clean a/b split applied to all RBAC requirements:
- REQ-SETUP-004a (401 미인증, spec.md:L98–L100) / REQ-SETUP-004b (403 비-ADMIN, L102–L104)
- REQ-SETUP-008a (401, L126–L128) / REQ-SETUP-008b (403, L130–L132)
- REQ-SETUP-013a (401, L154–L156) / REQ-SETUP-013b (403, L158–L160)
- REQ-SETUP-016a (401, L174–L176) / REQ-SETUP-016b (403, L178–L180)
- REQ-SETUP-012 (403 for authenticated CHAIR attempting ADMIN grant, L150–L152) — correctly 403, no 미인증 conflation.
- REQ-SETUP-020 (비인증 허용 200, L202–L204) — no 401/403.
No REQ lists 미인증 as 403. EC-SETUP-007 (acceptance.md:L231–L235) confirms POST buildings 미인증 → 401, tracing to REQ-SETUP-004a. Aligned.

**M6** (YAML frontmatter defects) — **ACCEPTED-BY-CONSISTENCY** (non-blocking per task instruction; SPEC-AUTH-001 uses identical frontmatter and passed). Not re-flagged.

### MINOR

**m1** (REQ-SETUP-014 EARS misclassification) — **RESOLVED**. Renumbered to REQ-SETUP-015 and reclassified as Ubiquitous (spec.md:L170–L172): "The system shall 회원 목록 응답 본문에 password_hash 필드를 절대 포함하지 않는다".

**m2** (REQ-SETUP-016 EARS misclassification) — **RESOLVED**. Renumbered to REQ-SETUP-017 and reclassified as Optional (spec.md:L182–L184): "Where 회원 목록 조회 요청에 명시적 status 쿼리 파라미터가 생략된 경우, the system shall status='ACTIVE' 회원만 기본으로 포함".

**m3** (EC-SETUP-001/002 validation failures had no owning REQ) — **RESOLVED**. spec.md:L122–L124 adds REQ-SETUP-007a (Unwanted) covering name>VARCHAR(20)→422 and UUID mismatch→400. EC-SETUP-001 (acceptance.md:L195–L199) and EC-SETUP-002 (L201–L205) trace to REQ-SETUP-007a.

**m4** (empty-array-deletes-all semantic missing from REQ) — **RESOLVED**. spec.md:L110–L112 (REQ-SETUP-005) now states: "빈 배열(units: []) 제출은 유효한 제출로 간주하며, '해당 동의 모든 기존 호수 삭제(REQ-SETUP-006 활성 입주민 검사 적용)'를 의미한다." EC-SETUP-003 (acceptance.md:L207–L211) traces to REQ-SETUP-005.

**m5** (implementation details — migration filename, FK name — in REQ body) — **RESOLVED**. REQ-SETUP-018 (spec.md:L190–L192) and REQ-SETUP-019 (L194–L196) now use generalized language ("managed_building_id 컬럼 및 종속 외래키 제약을 제거", "users.managed_building_id 컬럼을 단일 출처로 확정") with no specific filename or FK name. The specific filename `005_managed_building_unify.sql` and FK name `roles_managed_building_id_fkey`/`users_managed_building_id_fkey` appear only in plan.md (implementation context) and spec.md §6.3/§8 (non-normative notes), which is acceptable.

---

## New Defects Found (Regression Check)

**D1.** acceptance.md:L27 (AC-SETUP-004) — **Stale trace label after renumbering.** AC-SETUP-004 ("비-ADMIN 동 추가 403") is labeled "(REQ-SETUP-004)" but the requirement was split into REQ-SETUP-004a (401) / REQ-SETUP-004b (403). The 403 case maps to REQ-SETUP-004b. spec-compact.md:L45 correctly labels this AC as "(REQ-SETUP-004b)", so acceptance.md and spec-compact.md disagree. Severity: minor — the test body is unambiguous and the semantic mapping is clear, but the trace label was not updated during renumbering.
  - Fix: Change acceptance.md:L27 label from "(REQ-SETUP-004)" to "(REQ-SETUP-004b)".

**O1.** (Observation, non-blocking) spec.md:L122 — REQ-SETUP-007a is a lone 'a' sub-ID with no sibling '007b'. Elsewhere the a/b convention denotes 401/403 splits (004, 008, 013, 016). For 007, the 'a' denotes a distinct concern (input validation 422/400), which is semantically reasonable but cosmetically inconsistent with the 401/403 pairing pattern. Fully documented and traced (EC-SETUP-001, EC-SETUP-002). No action required; flagged only for awareness.

No new CRITICAL or MAJOR defects introduced. No orphaned REQs, no orphaned ACs (AC-SETUP-004 maps cleanly to REQ-SETUP-004b semantically). No broken traces beyond the D1 label. No new contradictions between requirements.

---

## REQ Count Confirmation

REQ count is internally consistent across all four files:
- spec.md:L280 — "총 20개 REQ-SETUP-XXX 요구사항(001~020, 일부 a/b 서브 ID 포함)"
- plan.md:L3 — "20개 REQ-SETUP-XXX 요구사항(001~020, a/b 서브 ID 포함)"
- acceptance.md:L3 — "20개 REQ-SETUP-XXX 요구사항(001~020, a/b 서브 ID 포함)"
- spec-compact.md:L3 — "모든 REQ-SETUP-XXX 요구사항(001~020, a/b 서브 ID 포함, 총 20개)"
- acceptance.md:L271 (DoD) — "spec.md의 20개 REQ-SETUP-XXX(001~020, a/b 서브 포함)"

Base IDs 001–020 = 20 numbers, zero-padded, no gaps, no duplicates. The "20개" count matches the base range; a/b sub-IDs are uniformly qualified as "포함" (included sub-clauses). Confirmed consistent.

Distinct REQ entries (base + sub): 001, 002, 003, 004a, 004b, 005, 006, 007, 007a, 008a, 008b, 009, 010, 011, 012, 013a, 013b, 014, 015, 016a, 016b, 017, 018, 019, 020 = 25 entries. All traced.

---

## Chain-of-Verification Pass

Second-look findings (re-read all sections after drafting):
- Re-read every REQ entry in spec.md:L82–L204 (25 entries): base numbering 001–020 intact, no gaps/duplicates.
- Re-verified traceability end-to-end for all 20 base REQs, all 24 ACs, all 7 ECs: found 1 stale label (D1).
- Re-verified C1 by directly reading `src/lib/migration-001.test.ts:L80–L149`: L90 breaks, L142–L145 unaffected, no roles_managed_building_id_fkey. plan.md and AC-SETUP-023 now correct.
- Re-checked Exclusions (§5, 7 items): all specific, no contradictions with included requirements.
- Re-checked cross-requirement contradictions: 401/403 cleanly separated via a/b splits; no REQ conflates 미인증 into 403.
- Re-checked REQ count across all 4 files: consistent (20 base IDs).
- Re-checked a/b sub-ID coverage: every a/b sub-ID (004a, 004b, 008a, 008b, 013a, 013b, 016a, 016b, 007a) has ≥1 AC or EC. No orphaned sub-IDs.

No additional defects beyond D1 and O1. First pass was thorough.

---

## Recommendation

Verdict: **PASS**. All 12 actionable defects from iteration 1 (C1 + M1–M5 + m1–m5) are resolved. M6 is accepted-by-consistency per task instruction. One new minor defect (D1: stale AC-SETUP-004 trace label) and one cosmetic observation (O1: lone 007a) are noted; neither blocks Run Phase.

Recommended (optional, non-blocking) follow-up before or during Run Phase:
1. Update acceptance.md:L27 AC-SETUP-004 label from "(REQ-SETUP-004)" to "(REQ-SETUP-004b)" to match spec-compact.md:L45.
2. (Cosmetic) Consider whether REQ-SETUP-007a should be renumbered to a standalone integer (e.g., merge into 007 or resequence) for convention uniformity — not required for PASS.

The SPEC is cleared to proceed to Run Phase.
