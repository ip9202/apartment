# SPEC Review Report: SPEC-AUTH-001
Iteration: 1/3
Verdict: PASS
Overall Score: 0.78

Reasoning context ignored per M1 Context Isolation. Only `spec.md`, `plan.md`, `acceptance.md`, `spec-compact.md`, and `research.md` (fact cross-reference only) were used.

---

## Audit Summary

SPEC-AUTH-001 defines the AUTH domain P0 scope (AUTH-01/03/04/07 + M3 refresh) for the 아이뜨락 apartment community platform. The SPEC bundle is internally coherent on EARS structure (4 of 5 EARS types present; Optional type justifiably absent for P0), REQ numbering (REQ-AUTH-001~015 sequential, no gaps/duplicates), JWT/bcrypt/rate-limit security design (HS256 AT 15min + RT 7day httpOnly cookie, distinct secrets, bcrypt salt 12, 5/10min lockout, RT blacklist, enumeration defense), Korean terminology preservation (동대표/관리사무소/동·호수 인증/강제 탈퇴/전 입주민), and greenfield hygiene (no implementation code, no Delta markers, 8 YAML fields). No CRITICAL blockers were found. However, five MAJOR issues require resolution before or early in Run Phase: (1) AC-AUTH-023 (non-ADMIN → 403 RBAC guard) has no owning REQ; (2) REQ-AUTH-011 / AC-AUTH-015 assume per-user `managed_building_id` but `research.md` §2.3 places the column on the shared `roles` lookup table with a single REP seed row — schema coherence unresolved; (3) JWT algorithm (HS256) and token expiries (AT 15min / RT 7day) are not asserted in any acceptance scenario; (4) AC-AUTH-017 (존재하지 않는 building/unit → 422) lacks an explicit REQ; (5) force-deactivate writes to the `suggestions` table (cross-domain) but §2.1 In-Scope does not list `suggestions` as a write target, creating a scope-boundary tension with Exclusion #5. These are fixable without blocking the SPEC; recommendations are provided below.

---

## Must-Pass Results

- **[PASS] MP-1 REQ number consistency**: REQ-AUTH-001 through REQ-AUTH-015 are sequential with no gaps and no duplicates (spec.md:79-158). Zero-padding is consistent (3-digit). Verified end-to-end.
- **[PASS] MP-2 EARS format compliance**: All 15 REQs match a valid EARS pattern. Distribution: Ubiquitous=1 (REQ-001), Event-driven=8 (REQ-003/004/007/008/010/011/014 + implied), State-driven=2 (REQ-006/013), Unwanted=4 (REQ-002/005/009/012/015). Optional type absent — acceptable for P0 scope (no optional auth features). Each REQ carries an explicit EARS keyword (`The system shall` / `When … the system shall` / `While … the system shall` / `If … then the system shall [not]`). Note: bilingual sentence mixing produces awkward word order (see MINOR-1) but the EARS keyword and pattern are present and identifiable.
- **[PASS] MP-3 YAML frontmatter validity (task-tailored)**: spec.md:1-10 contains 8 fields: `id` (string), `version` (string), `status` (string), `created` (ISO date), `updated` (ISO date), `author` (string), `priority` (string "P0"), `issue_number` (int). The task's hygiene target ("exactly 8 fields") is met. Caveat: field is named `created` rather than canonical `created_at`, and no `labels` key exists — see MINOR-6. Per the task's tailored hygiene criteria (not generic MP-3 naming), this passes.
- **[N/A] MP-4 Section 22 language neutrality**: SPEC is single-language scoped (Korean apartment platform). Not multi-language tooling. Auto-pass.

---

## Category Scores (0.0-1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.75 | 0.75 — minor ambiguity in 1-2 REQs | REQ-AUTH-011 "회원의 역할 레코드" is ambiguous vs. ERD schema (spec.md:133); ADR-005 cited but not defined in bundle (spec.md:209) |
| Completeness | 0.75 | 0.75 — one non-critical gap | Missing formal REQ for RBAC guard (AC-AUTH-023) and for invalid building/unit 422 (AC-AUTH-017); all required sections present (HISTORY/WHY/WHAT/REQUIREMENTS/ACCEPTANCE/Exclusions) |
| Testability | 0.75 | 0.75 — most ACs binary-testable, JWT params not asserted | AC-AUTH-005/011 do not assert HS256, AT 15min, RT 7day; remaining 24 ACs are concrete and falsifiable |
| Traceability | 0.75 | 0.75 — one orphan AC, one weak trace | AC-AUTH-023 (RBAC 403) has no owning REQ; AC-AUTH-017 weakly traces; all 15 REQs have ≥1 AC |

---

## Defects Found

### CRITICAL (blocks implementation)
None.

### MAJOR (should fix)

**MAJOR-1 — Orphan AC: RBAC guard on /deactivate has no owning REQ**
- Location: `acceptance.md:176-180` (AC-AUTH-023) vs. `spec.md:147-158` (REQ-AUTH-014/015)
- Defect: AC-AUTH-023 verifies "ADMIN 아닌 사용자 강제 탈퇴 시도 → 403 FORBIDDEN (RBAC 미들웨어 차단)". This is a security-critical RBAC enforcement, but no REQ-AUTH-XXX captures it. REQ-AUTH-014 assumes the caller is ADMIN; REQ-AUTH-015 covers only self-deactivate. An implementer could omit the RBAC check and still satisfy all 15 REQs while failing AC-AUTH-023.
- Recommended fix: Add `REQ-AUTH-016 (Event-driven or Unwanted) — 비ADMIN 역할의 /deactivate 호출 거부`: "If 요청자의 역할이 ADMIN이 아니면, then the system shall 403 Forbidden을 반환하고 탈퇴 로직을 실행하지 않는다." Renumber downstream if needed, or insert as REQ-AUTH-015a.

**MAJOR-2 — REP managed_building schema coherence unresolved**
- Location: `spec.md:131-133` (REQ-AUTH-011), `acceptance.md:119-123` (AC-AUTH-015) vs. `research.md:75-86` (§2.3 roles schema)
- Defect: REQ-AUTH-011 and AC-AUTH-015 treat `managed_building_id` as per-user ("해당 회원의 역할 레코드에… managed_building_id로 자동 연결"). But `research.md` §2.3 documents `managed_building_id` as a column on the `roles` lookup table, seeded with exactly 5 rows (ADMIN/CHAIR/REP/AUDITOR/RESIDENT) — i.e., a single shared REP row. With 2 buildings (A동/B동), the documented schema cannot represent 2 distinct REPs. The requirement cannot be correctly implemented without either (a) moving `managed_building_id` to `users`, (b) introducing a `user_roles` mapping table, or (c) seeding multiple REP rows. The `roles` table is owned by SETUP SPEC, so AUTH-001 cannot unilaterally fix this.
- Recommended fix: Before Run Phase, resolve with SETUP SPEC owner. Document the resolved schema assumption in spec.md §3 (Dependencies). If `managed_building_id` stays on `roles`, reword REQ-AUTH-011 to "the REP role record" and constrain to one REP per building; if moved to `users`, add a migration note. Either way, add an explicit dependency note that the current ERD is insufficient.

**MAJOR-3 — JWT algorithm and token expiries not testable in any AC**
- Location: `spec.md:97` (REQ-AUTH-004: "Access Token(15분, HS256)… Refresh Token(7일)"), `acceptance.md:51-55` (AC-AUTH-005), `acceptance.md:91-95` (AC-AUTH-011)
- Defect: REQ-AUTH-004 specifies HS256, AT 15min, RT 7day as hard security constraints. But AC-AUTH-005 only asserts "access_token: 'eyJ...'" (a JWT-shaped string) and RT cookie attributes; it does not decode the JWT to verify `alg=HS256`, `exp` = 15min (AT) or 7day (RT). AC-AUTH-011 (refresh) likewise only checks a new AT is returned. The security-critical parameters are untestable as written — an implementer could emit RS256 or a 24h AT and pass these ACs.
- Recommended fix: Add assertion clauses to AC-AUTH-005 and AC-AUTH-011: "Then 발급된 Access Token을 디코딩하면 `alg=HS256`, `exp - iat ≤ 900초`(15분)이고, RT 쿠키의 토큰은 `exp - iat ≤ 604800초`(7일)이다." Add a dedicated AC for RT expiry boundary (day-7 rejection).

**MAJOR-4 — AC-AUTH-017 (invalid building/unit → 422) lacks an explicit REQ**
- Location: `acceptance.md:131-135` (AC-AUTH-017) vs. `spec.md:127-129` (REQ-AUTH-010)
- Defect: REQ-AUTH-010's trigger is "유효한 building_id와 unit_id를 제출하고" — it presupposes valid input but does not state the rejection behavior for invalid input. AC-AUTH-017 tests "미존재 building/unit → 422 VALIDATION_ERROR" but traces only weakly to REQ-AUTH-010's implied precondition. Input validation for non-existent foreign keys is a distinct behavior worth its own REQ.
- Recommended fix: Either add a clause to REQ-AUTH-010 ("…제출하고, 해당 building_id/unit_id가 존재하지 않으면 422를 반환한다") or add `REQ-AUTH-010a (Unwanted) — 미존재 building/unit 제출 시 422 거부`.

**MAJOR-5 — `suggestions` table write not listed in §2.1 In-Scope; cross-domain boundary tension**
- Location: `spec.md:48-49` (§2.1 write targets), `spec.md:170` (Exclusion #5), `spec.md:149-154` (REQ-AUTH-014 step 2), `acceptance.md:159` (AC-AUTH-020 step 2)
- Defect: §2.1 lists write targets as `users`, `revoked_refresh_tokens`, `login_attempts` only. But REQ-AUTH-014 step 2 and AC-AUTH-020 step 2 write to `suggestions` (archived=true, author_label="전 입주민", author_id=NULL). Exclusion #5 acknowledges this ("AUTH-07 강제 탈퇴 시 suggestions 테이블 업데이트는 본 SPEC이 수행한다"), but the §2.1 In-Scope list is incomplete and SUGGEST is simultaneously declared out-of-scope. This creates a coherence wrinkle: the transactional boundary crosses into an excluded domain without the schema dependency being declared (suggestions table columns: archived, author_label, author_id, unit_id are assumed but not defined in this SPEC bundle).
- Recommended fix: (a) Add `suggestions` to §2.1 write targets with the note "(강제 탈퇴 트랜잭션 내 아카이브 전용; SUGGEST 도메인 CRUD는 본 SPEC 외)"; (b) Add `suggestions` schema columns consumed (archived, author_label, author_id, unit_id) to §3 Dependencies or a short data-contract subsection; (c) Ensure the SUGGEST SPEC acknowledges this write path to avoid dual-ownership conflicts.

### MINOR (nice to fix)

**MINOR-1 — Bilingual EARS sentence mixing produces awkward word order**
- Location: `spec.md:81` (REQ-AUTH-001) et al.
- Defect: "The system shall 모든 회원가입 요청에 대해 이메일 중복을 검사하고…" places the English auxiliary `shall` immediately before a Korean object phrase, producing ungrammatical bilingual structure. Semantic intent is clear and the EARS keyword is present, but the pattern is malformed.
- Recommended fix: Restructure to "The system shall [verb-first English or Korean-predicate-first]". E.g., "모든 회원가입 요청에 대해, the system shall 이메일 중복을 검사하고…" or keep the Korean predicate first.

**MINOR-2 — RT rotation (reuse) not implemented; documented tradeoff**
- Location: `acceptance.md:308` (Open Question #3)
- Defect: RT reuse is allowed (no rotation/blacklist-on-refresh). Stolen RT remains valid 7 days with unlimited AT refreshes. Defensible at 38세대 scale and explicitly flagged as an open question. Not a defect per se, but worth a security note.
- Recommended fix: Add a one-line security note in spec.md §6.1 referencing the tradeoff and the re-evaluation trigger (e.g., if user count exceeds 200 or breach suspected).

**MINOR-3 — INACTIVE user login rejection not a formal REQ**
- Location: `acceptance.md:223` (Edge Cases) vs. `spec.md:95-101` (REQ-AUTH-004/005)
- Defect: Edge case "ACTIVE가 아닌(INACTIVE) 회원 로그인 시도 → 401" is tested as an edge case but no REQ explicitly states INACTIVE users cannot login.
- Recommended fix: Add a clause to REQ-AUTH-005 or a new REQ-AUTH-005a covering INACTIVE status rejection.

**MINOR-4 — Email case normalization not a formal REQ**
- Location: `acceptance.md:214` (Edge Cases)
- Defect: "User@Example.com vs user@example.com — 소문자 정규화 필요" is flagged as an edge case but no REQ mandates email lowercasing on signup/login. Without it, duplicate accounts with case variants are possible despite the UNIQUE constraint.
- Recommended fix: Add to REQ-AUTH-001 or REQ-AUTH-004: "이메일은 소문자 정규화 후 저장 및 조회한다."

**MINOR-5 — Post-signup client redirect to /verify not an explicit AC**
- Location: `spec.md:89` (REQ-AUTH-003 "동/호수 인증 화면으로 강제 이동") vs. `acceptance.md:23-27` (AC-AUTH-001)
- Defect: AC-AUTH-001 verifies the server-side state (role=RESIDENT, verified=false) and DB record, but does not assert the client is redirected to /verify post-signup. The "강제 이동" behavior is only indirectly covered by middleware ACs (AC-AUTH-018/019).
- Recommended fix: Add to AC-AUTH-001: "Then 응답 또는 후속 요청 흐름에서 클라이언트가 /verify 경로로 이동한다."

**MINOR-6 — YAML field naming deviates from canonical MP-3**
- Location: `spec.md:1-10`
- Defect: Fields are `created`/`updated` rather than canonical `created_at`/`updated_at`; no `labels` key. The 8-field hygiene target is met, but alignment with the broader MoAI SPEC template would improve tooling compatibility.
- Recommended fix: Rename `created`→`created_at`, `updated`→`updated_at`; add `labels: ["auth", "p0", "jwt"]` (or equivalent). Keep `author`/`issue_number` as optional extras.

**MINOR-7 — Audit logging NFR (§6.4) has no traceable REQ or AC**
- Location: `spec.md:202-203` (§6.4 Auditability)
- Defect: §6.4 states "회원가입, 로그인, 강제 탈퇴 이벤트는 애플리케이션 로그로 기록" and "RT 블랙리스트 등록 시각 revoked_at 기록". No REQ captures logging and no AC tests log output or `revoked_at` population (AC-AUTH-010/020 check blacklist registration but not `revoked_at` timestamp).
- Recommended fix: Add a non-functional REQ (e.g., REQ-AUTH-017) for audit event logging, or add `revoked_at IS NOT NULL` assertions to AC-AUTH-010/020.

**MINOR-8 — ADR-005 cited but not defined in SPEC bundle**
- Location: `spec.md:209`, `acceptance.md:159`
- Defect: "ADR-005 준거" (건의 데이터 영구 보존, 호수 귀속 유지) is referenced twice but `research.md` §6 only covers ADR-003. ADR-005 lives in `.moai/project/tech.md` (external). The citation is valid but a reader of the SPEC bundle cannot verify the ADR content locally.
- Recommended fix: Add a one-line summary of ADR-005's decision in spec.md §3 or §6.5, or include the ADR-005 excerpt in research.md.

---

## Chain-of-Verification Pass

Second-look findings: re-read all 15 REQs and 26 ACs end-to-end. Verified:
- REQ sequencing 001→015: no gaps, no duplicates (confirmed full sequence, not spot-checked).
- Every REQ has ≥1 AC (15/15 covered).
- Every AC traces to a REQ except: AC-AUTH-023 (RBAC, orphan → MAJOR-1), AC-AUTH-017 (weak trace → MAJOR-4), AC-AUTH-025/026 (cross-cutting security, acceptable).
- AC ID uniqueness: AC-AUTH-001→026, no duplicates.
- Exclusions specificity: 7 specific exclusions with rationale (spec.md:162-172) — not vague.
- Contradictions: found REP managed_building schema tension (MAJOR-2) and suggestions write boundary tension (MAJOR-5); no REQ-vs-REQ contradictions.
- New defect found in second pass: MINOR-8 (ADR-005 external citation) and MINOR-7 (audit logging NFR untraceable) — added to defect list.
- Confirmed no CRITICAL findings. First pass was thorough.

---

## Recommendation

Verdict is PASS (zero CRITICAL findings). The 5 MAJOR findings should be addressed before Run Phase kicks off, in this priority order:

1. **MAJOR-2 (REP schema)** — Resolve with SETUP SPEC owner first; this is a cross-SPEC dependency that can block correct implementation of REQ-AUTH-011/AC-AUTH-015. Update spec.md §3 with the resolved schema assumption.
2. **MAJOR-1 (RBAC REQ)** — Add REQ-AUTH-016 (or 015a) for non-ADMIN → 403. Low effort, closes a security-traceability gap.
3. **MAJOR-3 (JWT testability)** — Strengthen AC-AUTH-005/011 with `alg=HS256` and `exp` assertions; add an RT day-7 boundary AC. Ensures the headline security constraint is verifiable.
4. **MAJOR-4 (422 REQ)** — Add a clause or sub-REQ for invalid building/unit rejection. One-line fix.
5. **MAJOR-5 (suggestions boundary)** — Update §2.1 write-target list and declare the `suggestions` column data contract; coordinate with SUGGEST SPEC owner to avoid dual-ownership.

MINOR findings can be batched into a single revision pass. None block the SPEC from proceeding to annotation approval / Run Phase.
