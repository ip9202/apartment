# SPEC Review Report: SPEC-SETUP-001
Iteration: 1/3
Verdict: FAIL
Overall Score: 0.45

Reasoning context ignored per M1 Context Isolation. Audit based solely on spec.md, plan.md, acceptance.md, spec-compact.md, and the AUTH cross-reference artifacts (migration 001 SQL, migration-001.test.ts, AUTH spec-compact.md).

---

## Must-Pass Results

- [FAIL] MP-1 REQ number consistency: spec.md:L114 introduces `REQ-SETUP-007a`, a non-standard letter-suffixed ID that breaks strict sequential numbering (001…018). Additionally, the document claims "18개 REQ-SETUP-XXX" (spec.md:L248, plan.md:L3, acceptance.md:L3, spec-compact.md:L3) while 19 distinct REQ entries exist (001-018 plus 007a). Internal count contradiction.

- [PASS] MP-2 EARS format compliance: All REQ-SETUP-XXX entries in spec.md:L82-L172 use recognizable EARS keyword structures (The system shall / When…shall / While…shall / If…then shall not). The acceptance criteria in acceptance.md are correctly labeled as Given/When/Then test scenarios (acceptance.md:L3), not mislabeled as EARS. Two minor EARS-type misclassifications noted (REQ-SETUP-014, REQ-SETUP-016) but keyword structure is present.

- [FAIL] MP-3 YAML frontmatter validity: spec.md:L1-L10 frontmatter is MISSING the required `labels` field. Field is named `created` (L5) instead of the required `created_at`. The `priority` value `"P0"` (L8) is not in the required enumeration {critical, high, medium, low}. Three separate frontmatter defects.

- [N/A] MP-4 Section 22 language neutrality: N/A — this SPEC scopes a single application domain (Next.js/TypeScript/PostgreSQL SETUP routes), not multi-language LSP tooling. Auto-passes.

Because two must-pass criteria (MP-1, MP-3) FAIL, the overall verdict is FAIL regardless of other scores.

---

## Category Scores (0.0-1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.75 | 0.75 | Most REQs are unambiguous; REQ-SETUP-004 (spec.md:L96) conflates 미인증 into 403 bucket creating ambiguity vs EC-SETUP-007's 401. REQ-SETUP-016 default behavior phrasing is imprecise. |
| Completeness | 0.50 | 0.50 | Sections present (HISTORY, WHY, WHAT, REQUIREMENTS, AC, Exclusions) but GET /api/setup/buildings public endpoint is In-Scope (spec.md:L48) with NO corresponding REQ. Missing REQ for 404-on-delete-nonexistent-building. Frontmatter missing `labels`. |
| Testability | 0.75 | 0.75 | Given/When/Then scenarios are concrete and falsifiable; AC-SETUP-005 (acceptance.md:L33) traces to a REQ that does not specify the tested behavior (404), making the AC's traceability untestable against its stated REQ. |
| Traceability | 0.50 | 0.50 | All 19 REQs have ≥1 AC, but AC-SETUP-005 traces to REQ-SETUP-003 which does not cover 404. GET buildings endpoint (in-scope) has no REQ and therefore no AC. EC-SETUP-006 (public GET) traces to nothing. |

---

## Defects Found

### CRITICAL

**C1.** plan.md:L27-L37 + acceptance.md:L157-L161 (AC-SETUP-023) — AUTH regression update plan targets a non-existent assertion. The plan claims AUTH `migration-001.test.ts` "MAJOR-2 검증은 `foreignKeyExists(pool, 'roles_managed_building_id_fkey')` 어설션을 포함한다" (plan.md:L27). However, the actual `src/lib/migration-001.test.ts` contains NO assertion for `roles_managed_building_id_fkey`. The real MAJOR-2 test (migration-001.test.ts:L142-L145) checks `users_managed_building_id_fkey`, which REMAINS VALID after migration 005 (users table is untouched). The ACTUAL breaking assertion is migration-001.test.ts:L85-L93 (`assertColumnsExist` for roles including `{ table: 'roles', column: 'managed_building_id', ... }` at L90), which the plan does NOT mention updating. An implementer following plan.md will (a) search for a `roles_managed_building_id_fkey` assertion that does not exist, and (b) fail to update the L85-L93 column-existence block, leaving the AUTH test suite broken after SETUP merge. Severity: critical — this is a factual error in cross-SPEC regression handling that risks breaking AUTH tests.
  - Fix: Replace the plan's MAJOR-2 update description. The correct update is: (1) Remove `managed_building_id` from the `assertColumnsExist` roles block at migration-001.test.ts:L85-L93. (2) The `users_managed_building_id_fkey` assertion at L142-L145 needs NO change. (3) Add a new SETUP-owned assertion (in migration-005.test.ts) verifying `roles.managed_building_id` column is ABSENT. Update AC-SETUP-023 to reference the correct assertion location.

### MAJOR

**M1.** spec.md:L248, plan.md:L3, acceptance.md:L3, spec-compact.md:L3 — REQ count contradiction. All four documents state "18개 REQ-SETUP-XXX" / "18개 REQ-SETUP-XXX 요구사항". Actual count is 19 entries (REQ-SETUP-001 through REQ-SETUP-018 PLUS REQ-SETUP-007a). Severity: major — internal consistency error propagated across all artifacts.
  - Fix: Renumber REQ-SETUP-007a → REQ-SETUP-008 and shift all subsequent IDs up by one (008→009, …, 018→019), then update all AC traces, plan.md phase references, and spec-compact.md. Update the count to 19. Alternatively, merge 007a into 007 and update the count to 18.

**M2.** spec.md:L114 — Non-standard REQ ID `REQ-SETUP-007a` violates sequential numbering (MP-1). EARS-style SPEC IDs must be strictly sequential zero-padded integers. The `a` suffix is an informal notation that breaks tooling and traceability.
  - Fix: Renumber as described in M1.

**M3.** spec.md:L48 (§2.1 In-Scope) vs REQUIREMENTS section — `GET /api/setup/buildings` public endpoint is declared In-Scope ("동/호수 공개 조회 (GET /api/setup/buildings) — 인증 목적, 비인증 허용") but has NO corresponding REQ-SETUP-XXX in §4. An entire in-scope, security-relevant feature (unauthenticated public endpoint) lacks a formal requirement. EC-SETUP-006 (acceptance.md:L197-L201) tests this behavior but traces to no REQ. Severity: major — security-relevant behavior (public access) is undocumented as a requirement.
  - Fix: Add a new REQ (e.g., REQ-SETUP-019, Event-driven or Ubiquitous) formally specifying: "The system shall return the list of buildings and their units via GET /api/setup/buildings without requiring authentication, for verify-unit client consumption. The response shall not include user data."

**M4.** acceptance.md:L33-L37 (AC-SETUP-005) — AC traces to REQ-SETUP-003, but REQ-SETUP-003 (spec.md:L90-L92) only specifies the 409 Conflict case (active resident blocks deletion). AC-SETUP-005 tests "미존재 동 삭제 404" (404 for non-existent building deletion), which REQ-SETUP-003 does NOT cover. There is NO REQ specifying 404 behavior for DELETE on a non-existent building. Severity: major — orphan AC with no valid trace target.
  - Fix: Add a REQ (e.g., REQ-SETUP-003a or merged into 003) covering: "If the deletion target building_id does not exist in the database, then the system shall return 404 Not Found." Update AC-SETUP-005 to trace to the correct REQ.

**M5.** spec.md:L96 (REQ-SETUP-004) vs acceptance.md:L203-L207 (EC-SETUP-007) — Status code contradiction for unauthenticated requests. REQ-SETUP-004 explicitly lists "미인증" (unauthenticated) as returning `403 Forbidden`. EC-SETUP-007 correctly specifies `401 Unauthorized` for unauthenticated POST. An unauthenticated caller should receive 401 (no/invalid token) and an authenticated-but-wrong-role caller should receive 403. REQ-SETUP-004 conflates these. Severity: major — security-relevant status code inconsistency.
  - Fix: Amend REQ-SETUP-004 to distinguish: "If the request lacks a valid access token, the system shall return 401 Unauthorized. While the requester role is not ADMIN (authenticated as CHAIR/REP/AUDITOR/RESIDENT), the system shall return 403 Forbidden." Apply the same distinction to REQ-SETUP-007a, REQ-SETUP-012, REQ-SETUP-015.

**M6.** spec.md:L1-L10 — YAML frontmatter defects (MP-3 FAIL): (a) required `labels` field absent; (b) field named `created` instead of `created_at`; (c) `priority: "P0"` not in required enumeration {critical, high, medium, low}.
  - Fix: Add `labels:` field (e.g., `["setup", "p0", "domain"]`). Rename `created` → `created_at` (and `updated` → `updated_at` for consistency). Map `priority: "P0"` to `priority: "critical"`.

### MINOR

**m1.** spec.md:L150-L152 (REQ-SETUP-014) — EARS-type misclassification. Labeled "Unwanted" but the trigger "회원 목록 응답을 직렬화할 때" (when serializing the response) is not an undesired condition — serialization is a ubiquitous operation. This should be a Ubiquitous requirement: "The system shall not include the password_hash field in the member list response body."
  - Fix: Reclassify as Ubiquitous.

**m2.** spec.md:L158-L160 (REQ-SETUP-016) — EARS-type misclassification. Labeled "Unwanted" but the trigger "명시적 status 쿼리 파라미터가 없으면" (when status param is omitted) is a default-behavior condition, not an undesired one. The response is affirmative (include ACTIVE), not preventive. Should be Optional/Feature-driven or Ubiquitous.
  - Fix: Reclassify as Optional: "Where the status query parameter is omitted, the system shall include only status='ACTIVE' members and exclude INACTIVE members."

**m3.** acceptance.md:L167-L177 (EC-SETUP-001, EC-SETUP-002) — Edge cases for name-length-422 and UUID-format-400 validation failures have no corresponding REQ-SETUP-XXX. Only NFR §6.1 (spec.md:L196) references VARCHAR(20) and UUID_RE as constraints.
  - Fix: Either add explicit REQs for input validation failures (422 on name overflow, 400 on UUID mismatch) or document that NFR §6.1 is the normative source for these ACs.

**m4.** acceptance.md:L179-L183 (EC-SETUP-003) — Empty-array-deletes-all-units semantic has no explicit REQ. REQ-SETUP-005 (spec.md:L102-L104) says "전체 호수 배열 제출" but does not clarify that an empty array means delete all.
  - Fix: Add a clarifying note to REQ-SETUP-005 that an empty units array is a valid submission meaning "delete all existing units for this building (subject to active-resident check)."

**m5.** spec.md:L166-L172 (REQ-SETUP-017, REQ-SETUP-018) — Requirements embed implementation details: specific migration filename `005_managed_building_unify.sql` and specific FK name `roles_managed_building_id_fkey`. While migrations are schema contracts, naming the exact file and FK in normative requirement text couples the requirement to a specific implementation.
  - Fix: Generalize the requirement text ("The system shall remove the managed_building_id column from the roles table and consolidate REP building assignment on users.managed_building_id") and move the exact filename/FK name to plan.md.

---

## Chain-of-Verification Pass

Second-look findings: The first pass identified 1 CRITICAL + 6 MAJOR + 5 MINOR defects. On re-read I verified:

- REQ number sequencing was checked end-to-end (001 through 018 plus 007a), not spot-checked — confirmed the 007a anomaly and the 18-vs-19 count contradiction.
- Traceability was verified for EVERY REQ (19 entries) and EVERY AC (23 entries + 7 ECs) — confirmed AC-SETUP-005 mis-trace and the GET-buildings-no-REQ gap.
- The CRITICAL defect (C1) was verified by directly reading migration-001.test.ts:L85-L93 and L142-L145 and confirming plan.md's referenced FK name does not exist in the test file. This is not a sampling error.
- Exclusions (§5, 7 items) were checked for specificity and non-contradiction — all specific, no contradictions among themselves.
- Cross-requirement contradictions were checked — found the REQ-SETUP-004 vs EC-SETUP-007 (401 vs 403) status code contradiction.
- EARS patterns were checked against all 19 REQs — found 2 misclassifications (REQ-SETUP-014, REQ-SETUP-016) but keyword structure present (not an MP-2 FAIL).

No additional defects found beyond the first pass. First pass was thorough.

---

## Recommendation

Verdict: FAIL. The SPEC must be revised before Run Phase. Required fixes in priority order:

1. **[CRITICAL C1] Correct the AUTH regression plan.** Re-read `src/lib/migration-001.test.ts:L85-L93` and `L142-L145`. Update plan.md §Phase 0 (plan.md:L25-L37) and AC-SETUP-023 (acceptance.md:L157-L161) to: (a) remove `managed_building_id` from the roles `assertColumnsExist` block at L85-L93; (b) explicitly state that the `users_managed_building_id_fkey` assertion at L142-L145 requires NO change; (c) add the column-absence verification to the new SETUP migration-005.test.ts. The currently-referenced `roles_managed_building_id_fkey` does not exist in the test file.

2. **[MAJOR M1+M2] Fix REQ numbering.** Renumber REQ-SETUP-007a to a standard sequential integer (either merge into 007, or renumber 007a→008 and shift 008-018 up by one). Update the "18개" count to the correct number across spec.md:L248, plan.md:L3, acceptance.md:L3, spec-compact.md:L3. Update all AC traces accordingly.

3. **[MAJOR M3] Add REQ for GET /api/setup/buildings public endpoint.** The In-Scope declaration at spec.md:L48 must be backed by a formal REQ in §4.

4. **[MAJOR M4] Add REQ for 404-on-delete-nonexistent-building.** AC-SETUP-005 currently traces to a REQ that does not cover its behavior. Either extend REQ-SETUP-003 or add a new REQ.

5. **[MAJOR M5] Resolve 401-vs-403 contradiction.** Amend REQ-SETUP-004, REQ-SETUP-007a, REQ-SETUP-012, REQ-SETUP-015 to distinguish unauthenticated (401) from wrong-role (403). Align with EC-SETUP-007.

6. **[MAJOR M6] Fix YAML frontmatter.** Add `labels`, rename `created`→`created_at`, map `priority: "P0"`→`"critical"`.

7. **[MINOR m1-m5] Address EARS misclassifications, validation REQs, empty-array semantic, and implementation-detail leakage** in a follow-up pass after the major fixes.

The SPEC cannot proceed to Run Phase until C1 and M1-M6 are resolved. Recommend iteration 2 audit after revision.
