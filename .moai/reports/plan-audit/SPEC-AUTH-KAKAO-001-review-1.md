# SPEC Review Report: SPEC-AUTH-KAKAO-001
Iteration: 1/3
Verdict: FAIL
Overall Score: 0.52

Reasoning context ignored per M1 Context Isolation. Audit based solely on spec.md, acceptance.md, plan.md, spec-compact.md, and codebase verification.

---

## Must-Pass Results

- **[FAIL] MP-1 REQ number consistency**: REQ-KAKAO-001 through REQ-KAKAO-016 are sequential, zero-padded, no gaps, no duplicates (spec.md:106-177). Evidence: sequential numbering verified end-to-end. This criterion alone PASSES, but is listed for completeness.

- **[FAIL] MP-2 EARS format compliance**: The EARS clauses use a hybrid Korean/English structure where EARS keywords (When/If/While/Where, shall/shall not) are English but triggers and responses are Korean, producing malformed clauses (e.g., spec.md:108: "When 클라이언트가 ... 요청하면, the system shall 난수 state 값을 생성하여 ..."). More critically:
  - **REQ-KAKAO-015 (spec.md:172)** is labeled "Unwanted" but its condition "If 본 SPEC이 구현되면" ("If this SPEC is implemented") is NOT an undesired runtime condition — it is the desired state. The Unwanted EARS pattern requires "If [undesired condition]". Semantic misuse of the pattern.
  - **REQ-KAKAO-016 (spec.md:176)** is labeled "Ubiquitous" but contains an embedded condition ("카카오 로그인 완료 후 리다이렉트된 페이지에서 useAuth 마운트 시"). Ubiquitous requires "The system shall [response]" with NO condition. This is closer to State-driven or Event-driven.
  - Mixed informal/formal within single criteria (Korean trigger + English keyword + Korean response) constitutes mixed informal/formal within a single criterion = FAIL per MP-2.

- **[FAIL] MP-3 YAML frontmatter validity**: spec.md frontmatter (spec.md:1-11) is MISSING the required `labels` field. Required fields per M5 are: id, version, status, created_at, priority, labels. Present: id, version, status, priority, author. Missing: `labels`. Additionally:
  - `status: "Planned"` is not in the standard enum (draft, active, implemented, deprecated) — value mismatch.
  - Field is `created` not `created_at` — naming mismatch with required field.
  - acceptance.md and plan.md frontmatter also lack `labels`.

- **[N/A] MP-4 Section 22 language neutrality**: N/A — this is a single-language (Korean product) SPEC scoped to a specific app. Not multi-language tooling.

---

## Category Scores (0.0-1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.50 | 0.50 | Multiple requirements require interpretation. REQ-KAKAO-007 (spec.md:136) changes `provider` to 'kakao' but does not specify whether the linked user can still log in via email+password — a reasonable engineer might implement either way. REQ-KAKAO-015/016 are mislabeled EARS types. |
| Completeness | 0.50 | 0.50 | Frontmatter incomplete (no labels). Security gaps: no PKCE, no state cookie TTL specified in REQs, no account-takeover mitigation beyond assertion. Core sections present (HISTORY, WHY, WHAT, REQUIREMENTS, ACCEPTANCE, Exclusions). |
| Testability | 0.75 | 0.75 | Most ACs are Given/When/Then with binary outcomes (acceptance.md). AC-KAKAO-014 (acceptance.md:180) references `grep ... logs/` but project has no `logs/` directory — untestable as written. EC-KAKAO-003 concurrent-tab "Then" is ambiguous about exact cookie lifecycle. |
| Traceability | 1.0 | 1.0 | Every REQ-KAKAO-001~016 maps to at least one AC-KAKAO-XXX (acceptance.md:19-233). No orphaned ACs. No uncovered REQs. Verified end-to-end. |

---

## Defects Found

**D1. spec.md:72, plan.md:87-88, acceptance.md:188-202 — FACTUAL ERROR: 3-viewport kakao stub claim is false (only 1 of 3 viewports has the stub). — Severity: critical**

The SPEC repeatedly claims all three viewports (MobileApp, TabletApp, DesktopApp) have a disabled kakao stub button showing "준비 중" that must be replaced:
- spec.md:72: "[MODIFY] 3개 뷰포트(MobileApp, TabletApp, DesktopApp) 카카오 버튼: 비활성 stub → 활성 트리거 교체"
- REQ-KAKAO-014 (spec.md:168): "3개 뷰포트(MobileApp, TabletApp, DesktopApp) 중 하나"
- REQ-KAKAO-015 (spec.md:172): "3개 뷰포트의 카카오 버튼은 더 이상 ... 가짜 로그인 ... disabled + '준비 중'"
- AC-KAKAO-015 (acceptance.md:188): "3개 뷰포트(MobileApp, TabletApp, DesktopApp) 중 하나의 카카오 버튼"
- plan.md:86-88: "src/components/MobileApp.tsx ... TabletApp.tsx (L477 doLogin stub 교체) ... DesktopApp.tsx"

**Codebase verification:**
- `src/components/TabletApp.tsx:477` — HAS `doLogin('kakao@user.com', 'kakao')` stub. CONFIRMED.
- `src/components/MobileApp.tsx` — grep for "kakao"/"카카오" returns ZERO matches. NO stub exists.
- `src/components/DesktopApp.tsx` — grep for "kakao"/"카카오" returns ZERO matches. NO stub exists.

The SPEC's scope, requirements, acceptance criteria, and implementation plan are all based on a false premise. 2 of the 3 claimed modifications target non-existent code. AC-KAKAO-016 ("grep -rn 'kakao@user.com' src/components/" → 0 matches) would pass trivially today for MobileApp/DesktopApp because the stub was never there.

**D2. spec.md:1-11 — YAML frontmatter missing required `labels` field; `status` value invalid; `created` naming mismatch. — Severity: major (MP-3)**

Required `labels` field absent in spec.md, acceptance.md, plan.md, spec-compact.md frontmatter. `status: "Planned"` is not in the standard enum (draft/active/implemented/deprecated). Field name `created` does not match required `created_at`.

**D3. spec.md:172 — REQ-KAKAO-015 misuses the EARS "Unwanted" pattern. — Severity: major (MP-2)**

REQ-KAKAO-015 is declared "(Unwanted)" but the condition "If 본 SPEC이 구현되면" ("If this SPEC is implemented") is a desired state, not an undesired condition. The Unwanted pattern per EARS is "If [undesired condition], then the system shall [response]". This is a semantic misuse. This requirement should be a Ubiquitous or a constraint, not Unwanted.

**D4. spec.md:176 — REQ-KAKAO-016 mislabels a conditional requirement as "Ubiquitous". — Severity: major (MP-2)**

REQ-KAKAO-016 is declared "(Ubiquitous)" but contains an embedded condition ("카카오 로그인 완료 후 리다이렉트된 페이지에서 useAuth 마운트 시 /api/auth/me가 정상 동작하여"). Ubiquitous EARS requires "The system shall [response]" with NO condition. This is State-driven or Event-driven, not Ubiquitous.

**D5. spec.md:136 (REQ-KAKAO-007) — Unaddressed functional regression: auto-linking changes `provider` to 'kakao', locking user out of email/password login. — Severity: major**

REQ-KAKAO-007 specifies that when kakao email matches an existing account, the system updates `provider='kakao'`, `provider_id=<kakao_ID>` and preserves `role_id, unit_id, verified_at, status`. The SPEC does NOT mention preserving or handling the original password-based login path. If the existing email/password login flow checks `provider='email'` to allow password authentication, the auto-linked user is silently locked out of password login. The SPEC must either: (a) state that linked users can still use password login (and verify the login flow supports this), or (b) declare this as intended behavior and document it. Neither is done.

**D6. spec.md (Security §6.1, REQ-KAKAO-001/003/004) — No PKCE (Proof Key for Code Exchange) considered for OAuth 2.0 Authorization Code flow. — Severity: major (security)**

For a new OAuth 2.0 integration in 2026, PKCE (RFC 7636/9700) is strongly recommended even for server-side (confidential) clients, especially in browser-redirect flows. The SPEC uses only `state` + `client_secret` for security. PKCE is not mentioned, not even as a considered-and-rejected option. This is a security gap for a security-sensitive SPEC.

**D7. spec.md:184 (§6.1), plan.md:207 — `state` cookie has no specified TTL/Max-Age in REQs or ACs. — Severity: major (security)**

REQ-KAKAO-001 specifies the state cookie is httpOnly + SameSite=Lax but does NOT specify a Max-Age or expiration. Without a TTL, the cookie persists for the browser session, weakening CSRF defense (a stolen state cookie remains valid indefinitely). plan.md:207 mentions "TTL 짧게 유지" in risk mitigation but this is not translated into any REQ or AC. There is no acceptance criterion verifying a Max-Age on the state cookie.

**D8. spec.md:136 (REQ-KAKAO-007), plan.md:126 (TD-3) — Account-takeover risk via email-based auto-linking is under-mitigated. — Severity: major (security)**

REQ-KAKAO-007 auto-links kakao accounts to existing users based solely on email match. If an attacker creates a kakao account using a victim's email address, the attacker gains access to the victim's existing service account. plan.md:126 (TD-3) acknowledges this risk but dismisses it with "카카오 계정은 본인인증 기반 신뢰도 충분" — this is a weak assertion, not a mitigation. Kakao account email verification does not constitute identity-proofing equivalent to the service's own account ownership. The SPEC should require at minimum: (a) the existing account's provider must still be 'email' (not already linked to another kakao ID), and/or (b) re-verification step, and/or (c) notify the existing account owner. REQ-KAKAO-009 only prevents duplicate kakao ID, not the email-takeover vector. While interview.md records this as a user decision, the SPEC's risk analysis (plan.md §6) rates this "Medium" with inadequate mitigation.

**D9. acceptance.md:180 (AC-KAKAO-014) — References `grep -ri "kakao.*access_token" logs/` but project has no `logs/` directory. — Severity: minor**

Next.js applications do not typically write structured logs to a `logs/` filesystem directory. This acceptance criterion is likely untestable as written. It should reference the actual logging mechanism (stdout, a logging library, or structured log fields) used by the project.

**D10. spec.md:108 (REQ-KAKAO-001) — EARS clauses use malformed bilingual structure mixing Korean grammar with English EARS keywords. — Severity: minor (MP-2 contributing)**

All 16 REQs use a pattern like "When [Korean trigger with -면 suffix], the system shall [Korean response]". The Korean conditional suffix (-면) duplicates the semantic role of the English "When" keyword, and the response places Korean verb phrases directly after "shall" without English verb alignment. While the EARS keyword is technically present, this creates ambiguity in parsing and is inconsistent with the EARS template's intended single-language coherence. This pattern is uniform across all REQs.

---

## Chain-of-Verification Pass

Second-look findings — verified by re-reading all sections:

- **REQ sequencing**: Re-verified REQ-KAKAO-001 through REQ-KAKAO-016 end-to-end. Sequential, no gaps. Confirmed.
- **Traceability**: Re-verified every REQ has at least one AC. Confirmed complete coverage.
- **Dependency claims against codebase**:
  - migration 001 `provider`/`provider_id` columns — CONFIRMED (migrations/001_*.sql:41-42)
  - `signAccessToken`/`signRefreshToken` in src/lib/auth.ts — CONFIRMED (auth.ts:40,48)
  - `buildAccessCookie`/`buildRefreshCookie` in src/lib/cookies.ts — CONFIRMED (cookies.ts:77,36)
  - **3-viewport kakao stub claim — DISPROVEN** (only TabletApp.tsx:477 has it; MobileApp and DesktopApp have zero kakao references). Added as D1.
  - Migration 011 as next number — CONFIRMED (migrations 001-010 exist).
- **Exclusions specificity**: §7 has 8 specific entries. PASS.
- **Contradictions between requirements**: Discovered D5 (provider change vs password login path) — a latent functional contradiction not explicitly addressed.
- **New defect found in second pass**: D9 (logs/ directory assumption) — caught during AC re-read.

No defects missed in first pass. First pass was thorough.

---

## Regression Check (Iteration 2+ only)
N/A — this is iteration 1.

---

## Recommendation

This SPEC requires revision before implementation. Blocking defects (fix first):

1. **[D1, critical] Correct the 3-viewport claim.** Verify which viewports actually contain the kakao stub by running `grep -rn "kakao\|카카오" src/components/`. As of audit date, only `src/components/TabletApp.tsx:477` has the stub. Update spec.md §3.1 (line 72), REQ-KAKAO-014 (line 168), REQ-KAKAO-015 (line 172), AC-KAKAO-015 (acceptance.md:188), AC-KAKAO-016 (acceptance.md:198), and plan.md §2.5 (lines 84-88) to reflect reality. If MobileApp/DesktopApp are supposed to have kakao buttons, that is a separate frontend task that must be explicitly scoped.

2. **[D2, MP-3] Fix YAML frontmatter.** Add `labels` field (array) to spec.md, acceptance.md, plan.md, spec-compact.md. Change `status: "Planned"` to a valid enum value (`draft` for unapproved). Rename `created` → `created_at` (ISO 8601 date string).

3. **[D3, D4, MP-2] Fix EARS pattern misuse.** REQ-KAKAO-015: reclassify as Ubiquitous or move to a "Constraints" section — it is not an Unwanted runtime condition. REQ-KAKAO-016: reclassify as State-driven ("While the user is authenticated via kakao, the system shall ...") or Event-driven. Also consider normalizing the bilingual EARS structure (D10) for consistency.

4. **[D5] Resolve the password-login regression.** Add an explicit REQ or clarification stating whether auto-linked users (provider changed from 'email' to 'kakao') can still authenticate via email+password, and verify the existing login flow supports the intended behavior.

5. **[D6, D7, D8] Strengthen security requirements.**
   - Add PKCE support or explicitly document why it is rejected with rationale.
   - Add a concrete Max-Age/TTL for the `state` cookie to REQ-KAKAO-001 and an acceptance criterion verifying it.
   - Add an explicit mitigation for the email-takeover vector in REQ-KAKAO-007 (e.g., require existing provider='email', notify account owner, or require re-verification) — do not rely on the assertion that "kakao is trusted."

6. **[D9] Fix untestable AC.** Replace the `logs/` grep in AC-KAKAO-014 with a reference to the project's actual logging output mechanism.

---

Verdict: FAIL
