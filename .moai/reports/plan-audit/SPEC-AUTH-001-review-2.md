# SPEC Review Report: SPEC-AUTH-001
Iteration: 2/3
Verdict: PASS
Overall Score: 0.88 (up from 0.78 in iteration 1)

Reasoning context ignored per M1 Context Isolation. Only `spec.md`, `plan.md`, `acceptance.md`, `spec-compact.md`, and `research.md` (fact cross-reference only) were used. The task prompt's MAJOR resolution claims were treated as unverified assertions and independently checked against the file contents.

---

## Audit Summary

The author revised SPEC-AUTH-001 from v1.0.0 to v1.1.0 to address all 5 MAJOR findings from iteration 1. The revision is substantive and internally consistent: two new REQs (REQ-AUTH-010a, REQ-AUTH-016) were inserted without disturbing the REQ-001→016 sequence; three new ACs (AC-AUTH-027/028/029) were added under a new "M3.1 토큰 형식 검증" section to make the JWT security parameters (alg=HS256, AT≤900s, RT≤604800s, cookie attributes) falsifiable via token decoding; the REP `managed_building` schema was resolved in favor of `users.managed_building_id` with an explicit cross-SPEC SETUP migration dependency and a stub-fallback policy; and the `suggestions` side-effect boundary was documented as an AUTH-owned 3-column write contract (ADR-005) with Exclusion #5 narrowed to SUGGEST domain logic only.

All 5 MAJORs are genuinely RESOLVED with concrete line-cited evidence (see §MAJOR Resolution Verification). No new CRITICAL or MAJOR regressions were introduced. Cross-file consistency across spec.md / plan.md / acceptance.md / spec-compact.md is intact for every new artifact. One pre-existing MINOR traceability gap (AC-AUTH-019 — unauthenticated → /login redirect has no explicit owning REQ) carries forward from iteration 1 unchanged; it is not a regression and does not block.

---

## Must-Pass Results

- **[PASS] MP-1 REQ number consistency**: spec.md §4 defines REQ-AUTH-001 through REQ-AUTH-016 plus REQ-AUTH-010a (sub-numbered, spec.md:135). Sequence is gap-free and duplicate-free. REQ-AUTH-010a sits between 010 and 011 without collision. spec-compact.md:24-57, plan.md:379, and acceptance.md:15 all enumerate the same 17-entry set consistently.
- **[PASS] MP-2 EARS format compliance**: All 17 REQs match a valid EARS pattern. The two new REQs verify cleanly:
  - REQ-AUTH-010a (spec.md:135-137): "If [condition], then the system shall not [response]" — Unwanted. Valid.
  - REQ-AUTH-016 (spec.md:170-172): "If [condition], then the system shall not [response]" — Unwanted. Valid.
  - The remaining 15 REQs (001-016 excluding 010a) are unchanged from iteration 1 which passed EARS.
- **[PASS] MP-3 YAML frontmatter validity (task-tailored)**: spec.md:1-10 contains 8 fields: `id`, `version` ("1.1.0"), `status` ("draft"), `created` (ISO date), `updated` (ISO date), `author`, `priority` ("P0"), `issue_number` (int). The version bump 1.0.0 → 1.1.0 is reflected. The `created`/`updated` naming deviation from canonical `created_at` (iteration-1 MINOR-6) persists but is not a must-pass blocker under the task-tailored 8-field criteria.
- **[N/A] MP-4 Section 22 language neutrality**: SPEC is single-language scoped (Korean apartment community platform). Not multi-language tooling. Auto-pass.

---

## MAJOR Resolution Verification

### MAJOR-1 — Orphan AC: RBAC guard on /deactivate has no owning REQ — RESOLVED

Evidence:
- spec.md:170-172 — **REQ-AUTH-016 (Unwanted)** added in M5: "If 강제 탈퇴 엔드포인트(`POST /api/auth/users/[id]/deactivate`) 호출자의 역할이 ADMIN이 아니면 (RESIDENT/CHAIR/REP/AUDITOR), then the system shall not 탈퇴 로직을 실행하고 `403 Forbidden`을 반환한다 (RBAC 미들웨어 차단, AC-AUTH-023 추적)."
- acceptance.md:200-204 — **AC-AUTH-023** now explicitly traces: "→ REQ-AUTH-016". Given/When/Then verifies RESIDENT/CHAIR/REP/AUDITOR → 403.
- spec-compact.md:57 — REQ-AUTH-016 listed.
- plan.md:260 (Phase F1 RED) — "ADMIN 아닌 사용자(RESIDENT/CHAIR/REP/AUDITOR) 시도 → 403 테스트 (REQ-AUTH-016, RBAC 미들웨어)".

Verdict: **RESOLVED**. The security-critical RBAC enforcement is now owned by a formal REQ with bidirectional traceability.

---

### MAJOR-2 — REP managed_building schema coherence unresolved — RESOLVED

Evidence:
- spec.md:141-143 (REQ-AUTH-011) — Reworded to per-user: "해당 회원 레코드의 `users.managed_building_id` 컬럼에 인증한 building_id를 자동 연결한다." Includes an explicit schema decision note rejecting the shared `roles.managed_building_id` lookup-table placement ("2개 동 × 복수 REP 불가").
- spec.md:72 (§3 Dependencies #6) — Cross-SPEC dependency documented: "managed_building은 회원 단위(users.managed_building_id)에서 읽는다... 마이그레이션 및 스키마 정의는 SETUP SPEC 소관... SETUP 마이그레이션 선행 전까지 AUTH 테스트는 이 컬럼을 stub 한다 (cross-SPEC dependency)."
- acceptance.md:145-147 (AC-AUTH-015) — "사용자의 **`users.managed_building_id`** 가 인증한 building_id로 자동 연결됨" with stub note referencing §3 Dependency #6.
- plan.md:368 (§9 Dependencies) — Full rationale: schema ownership assigned to SETUP SPEC, AUTH consumes only, stub policy on migration absence.
- plan.md:228, 232 (Phase E1) — RED/GREEN note the stub fallback.
- spec-compact.md:44 — REQ-AUTH-011 references `users.managed_building_id` + §3 Dep #6.

The original incoherence (research.md:82 places `managed_building_id` on the shared `roles` lookup table, which cannot represent 2 buildings × multiple REPs) is now resolved by (a) moving the authoritative read path to `users.managed_building_id`, (b) explicitly flagging the SETUP-owned migration, and (c) providing a stub fallback so AUTH tests are not blocked.

Verdict: **RESOLVED**. Schema decision, ownership, and fallback are all documented.

---

### MAJOR-3 — JWT algorithm and token expiries not testable in any AC — RESOLVED

Evidence:
- acceptance.md:111 — New section header "### M3.1 토큰 형식 검증 (JWT alg / exp / 쿠키 속성)" with explicit falsifiability statement: "RS256 또는 24h AT를 발급하는 구현은 아래 단정문을 만족하지 못해 자동 실패한다 (falsifiable)."
- acceptance.md:115-119 (**AC-AUTH-027**) — Access Token decode: "JOSE header의 `alg`는 `HS256`이고, payload의 `exp − iat ≤ 900`(초, 15분), `iat ≤ now()`이다. `alg`가 `RS256`/`none`/기타이거나 `exp − iat > 900`이면 테스트 실패. → REQ-AUTH-004".
- acceptance.md:121-125 (**AC-AUTH-028**) — Refresh Token decode: "JOSE header의 `alg`는 `HS256`이고, payload의 `exp − iat ≤ 604800`(초, 7일)이다. `alg ≠ HS256` 또는 `exp − iat > 604800`이면 테스트 실패. → REQ-AUTH-004".
- acceptance.md:127-131 (**AC-AUTH-029**) — RT cookie attributes: "`HttpOnly`, `Secure`, `SameSite=Strict`가 모두 포함되며, `Path=/api/auth`, `Max-Age ≤ 604800`(7일)이다. 어느 하나라도 누락/불일치 시 테스트 실패. → REQ-AUTH-004".
- plan.md:148 (Phase A2 RED) — Test plan references AC-AUTH-027/028 for alg/exp deltas and AC-AUTH-029 for cookie attributes.
- spec-compact.md:87-91 — M3.1 section mirrors the three ACs.

Each AC has an explicit failure condition (RS256, 24h AT, missing cookie attribute), making them genuinely falsifiable rather than tautological. All three trace to REQ-AUTH-004.

Verdict: **RESOLVED**. The headline security constraints (HS256, AT 15min, RT 7day, cookie hardening) are now verifiable.

---

### MAJOR-4 — AC-AUTH-017 (invalid building/unit → 422) lacks an explicit REQ — RESOLVED

Evidence:
- spec.md:135-137 — **REQ-AUTH-010a (Unwanted)** added in M4: "If verify-unit 요청이 DB에 존재하지 않는 `building_id` 또는 `unit_id`를 포함하면 (또는 `building_id`에 속하지 않는 `unit_id`), then the system shall not 인증을 진행하고 `422 Unprocessable Entity` 응답을 반환한다 (AC-AUTH-017 추적)."
- acceptance.md:155-159 (AC-AUTH-017) — Now traces: "→ REQ-AUTH-010a".
- spec-compact.md:43 — REQ-AUTH-010a listed with "(AC-AUTH-017)" cross-reference.
- plan.md:230 (Phase E1 RED) — "존재하지 않는 building_id/unit_id (또는 building에 속하지 않는 unit_id) → 422 테스트 (REQ-AUTH-010a)".

The FK-validation behavior is now a distinct REQ rather than an implied precondition of REQ-AUTH-010. The sub-numbering (010a) preserves the M4 module grouping and the 001→016 sequence.

Verdict: **RESOLVED**.

---

### MAJOR-5 — `suggestions` table write not listed in §2.1 In-Scope; cross-domain boundary tension — RESOLVED

Evidence:
- spec.md:51 (§2.1 In-Scope) — `suggestions` write target now explicitly listed: "suggestions 테이블 컬럼 사이드이펙트 쓰기 (강제 탈퇴 트랜잭션 내 전용): `archived=true`, `author_id=NULL`, `author_label="전 입주민"` — ADR-005(건의 호수 귀속 정책) 준거. **AUTH가 소유하는 도메인 동작**이며 SUGGEST CRUD/답변/상태 전이 로직은 포함하지 않는다 (Exclusion #5 참조)."
- spec.md:184 (Exclusion #5) — Narrowed: "SUGGEST 도메인 기능(건의 CRUD/답변/상태 전이/카테고리 관리)은 OUT — 단, 강제 탈퇴 트랜잭션의 `suggestions` 컬럼 사이드이펙트(`author_id=NULL` / `author_label="전 입주민"` / `archived=true`)는 ADR-005 호수 귀속 정책 준수를 위해 AUTH가 소유한다 (§2.1 및 REQ-AUTH-014 step 2 참조)."
- spec.md:73 (§3 Dependencies #7) — ADR-005 summary added inline so the bundle reader can verify the policy locally (also resolves iteration-1 MINOR-8).
- spec.md:161 (REQ-AUTH-014 step 2) — Side-effect annotated as "AUTH가 소유하는 도메인 사이드이펙트 (SUGGEST CRUD 외, §2.1/Exclusion #5 참조)".
- acceptance.md:183 (AC-AUTH-020 step 2) — "이 `suggestions` 컬럼 사이드이펙트는 AUTH가 소유하는 도메인 동작이다 (SUGGEST CRUD/답변/상태 외, §2.1 및 Exclusion #5)."
- plan.md:250 (Phase F1) — Full 3-column write contract documented: "UPDATE suggestions SET author_id=NULL, author_label='전 입주민', archived=true WHERE author_id=$1" with explicit dual-ownership avoidance note.
- spec-compact.md:51 (§2.1) and spec-compact.md:212 (Exclusion #5) — Consistently narrowed.

The §2.1/Exclusion #5 contradiction is eliminated: §2.1 declares the narrow write ownership, Exclusion #5 narrows the SUGGEST-domain exclusion to CRUD/answer/state-transition/category logic only. The 3-column data contract (`author_id`, `author_label`, `archived`) is explicit, `unit_id` preservation (호수 귀속) is stated, and dual-ownership conflict with the future SUGGEST SPEC is flagged.

Verdict: **RESOLVED**. Boundary tension fully dissolved.

---

## Regression Check (Iteration 2)

### New CRITICAL defects introduced: None.
### New MAJOR defects introduced: None.

### Traceability verification for new artifacts
- REQ-AUTH-010a ← AC-AUTH-017 (acceptance.md:159). Bidirectional. ✓
- REQ-AUTH-016 ← AC-AUTH-023 (acceptance.md:204). Bidirectional. ✓
- AC-AUTH-027/028/029 → REQ-AUTH-004 (acceptance.md:119, 125, 131). REQ-AUTH-004 exists (spec.md:99-101). Multiple ACs per REQ is acceptable (strengthens coverage). ✓
- All 17 REQs (001-016 + 010a) have ≥1 AC. Verified end-to-end.
- All 29 ACs (001-029) trace to a REQ, except cross-cutting AC-025/026 (security NFR §6.1, acceptable per iteration-1 determination).

### Cross-reference integrity across 4 files
| Artifact | spec.md | acceptance.md | plan.md | spec-compact.md | Consistent |
|----------|---------|---------------|---------|-----------------|:----------:|
| REQ-AUTH-010a | :135 | AC-017 :159 | E1 :230 | :43 | ✓ |
| REQ-AUTH-016 | :170 | AC-023 :204 | F1 :260 | :57 | ✓ |
| AC-AUTH-027/028/029 | — | :115-131 | A2 :148 | :87-91 | ✓ |
| users.managed_building_id | §2.1/§3/REQ-011 | AC-015 | §9/E1 | REQ-011 | ✓ |
| suggestions 3-col side-effect | §2.1/Excl#5/§3#7 | AC-020 | F1 | Excl#5/AC-020 | ✓ |
| Version 1.1.0 | :3 | (n/a) | (n/a) | (n/a) | ✓ |

No broken cross-references detected.

### REQ/AC ID collision check
- REQ IDs: 001-016 + 010a — unique, no collisions.
- AC IDs: 001-029 — unique. AC-027/028/029 do not collide with the pre-existing 001-026 range. The document-order jump (013 → 027/028/029 → 014 in acceptance.md) is cosmetic; AC IDs need only be unique, not document-order sequential.

### Contradiction check
- REQ-AUTH-015 (self-deactivate → 403) vs REQ-AUTH-016 (non-ADMIN → 403): both return 403 for distinct, non-overlapping conditions. No contradiction.
- REQ-AUTH-010a (non-existent FK → 422) vs REQ-AUTH-012 (duplicate unit → 409): distinct triggers. No contradiction.
- §2.1 (suggestions write IN) vs Exclusion #5 (SUGGEST domain OUT): complementary, boundary explicitly drawn. No contradiction.

### Pre-existing MINOR carry-forward (NOT a regression)
- **AC-AUTH-019** (acceptance.md:167-171) tests "비로그인 접근 → /login 리다이렉트" but no REQ explicitly captures the "no AT → /login redirect" behavior. REQ-AUTH-013 covers only `verified_at=NULL` → /verify. This traceability gap existed in iteration 1 (not flagged explicitly in the iter-1 Chain-of-Verification, which only noted AC-025/026 as acceptable cross-cutting). It is a latent MINOR, unchanged by the revision, and does not block. Severity: minor.

---

## Category Scores (0.0-1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.88 | 0.75 → 0.88 (improved) | REQ-AUTH-011 ambiguity resolved with explicit schema decision (spec.md:141-143); ADR-005 now summarized inline (spec.md:73) resolving iter-1 MINOR-8. Minor residual: AC-AUTH-019 redirect behavior lacks owning REQ. |
| Completeness | 0.88 | 0.75 → 0.88 (improved) | All previously-uncovered behaviors now have owning REQs (010a, 016) and testable ACs (027/028/029); suggestions write contract explicit. |
| Testability | 0.88 | 0.75 → 0.88 (improved) | JWT security params now falsifiable via AC-027/028/029 with explicit failure conditions (RS256, 24h AT, missing cookie attr). All 29 ACs binary-testable. |
| Traceability | 0.88 | 0.75 → 0.88 (improved) | Orphan AC-AUTH-023 → REQ-AUTH-016; weak-trace AC-AUTH-017 → REQ-AUTH-010a. 17/17 REQs covered, 29/29 ACs traced (except cross-cutting AC-025/026 and latent AC-019). |

---

## Defects Found

### CRITICAL (blocks implementation)
None.

### MAJOR (should fix)
None.

### MINOR (carry-forward from iteration 1, non-blocking)
- **MINOR-9 (pre-existing)** — acceptance.md:167-171 (AC-AUTH-019): "비로그인 접근 → /login 리다이렉트" has no explicit owning REQ. REQ-AUTH-013 covers `verified_at=NULL` → /verify only, not the no-token → /login path. This is a latent traceability gap that existed in iteration 1 and is unchanged by the revision. Recommended fix (optional): add a clause to REQ-AUTH-013 or a new REQ-AUTH-013a covering the unauthenticated-request redirect.
- Iteration-1 MINOR-1 through MINOR-7 remain (bilingual EARS word order, RT rotation tradeoff, INACTIVE login, email normalization, post-signup redirect, YAML field naming, audit logging NFR). None block. MINOR-8 (ADR-005 external) is now resolved by spec.md:73 inline summary.

---

## Chain-of-Verification Pass

Second-look findings: re-read all 17 REQs (001-016 + 010a) and all 29 ACs end-to-end across the 4 files. Verified:
- REQ sequencing: 001→016 + 010a sub-number — no gaps, no duplicates (confirmed full sequence, not spot-checked).
- Every new REQ (010a, 016) has ≥1 AC; every new AC (027/028/029) traces to REQ-004.
- AC ID uniqueness: 001-029, no duplicates.
- Exclusions specificity: 7 exclusions, all specific with rationale (spec.md:180-186). Exclusion #5 narrowed correctly.
- Contradictions: none found between REQs or between §2.1 and Exclusion #5.
- Cross-file consistency: verified all 5 revision artifacts (REQ-010a, REQ-016, AC-027/028/029, users.managed_building_id, suggestions side-effect) are consistent across spec.md, acceptance.md, plan.md, spec-compact.md.
- One latent pre-existing MINOR (AC-AUTH-019 traceability) identified — not a regression.
- No new CRITICAL or MAJOR defects found. First pass was thorough.

---

## Recommendation

Verdict is **PASS**. All 5 iteration-1 MAJOR findings are genuinely resolved with concrete line-cited evidence (5/5). The revision introduced no new CRITICAL or MAJOR regressions. Must-Pass criteria MP-1/MP-2/MP-3 PASS; MP-4 N/A. Cross-file consistency is intact for every new artifact.

The SPEC is ready to proceed to Run Phase. The single carry-forward MINOR (AC-AUTH-019 owning REQ) and the batch of iteration-1 cosmetic MINORs can be addressed in a optional polish pass but do not block implementation kickoff.
