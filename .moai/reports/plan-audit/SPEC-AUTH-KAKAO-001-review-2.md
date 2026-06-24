# SPEC Review Report: SPEC-AUTH-KAKAO-001
Iteration: 2/3
Verdict: PASS
Overall Score: 0.86

Reasoning context ignored per M1 Context Isolation. Audit based solely on spec.md, acceptance.md, plan.md, codebase verification, and the project's established SPEC convention (cross-checked against SPEC-AUTH-001, SPEC-INTEGRATION-AUTH-001, SPEC-AUTH-RESET-001, SPEC-ATTACHMENT-001).

---

## Must-Pass Results

- **[PASS] MP-1 REQ number consistency**: REQ-KAKAO-001 through REQ-KAKAO-017 are sequential, zero-padded to 3 digits, with no gaps and no duplicates (spec.md:109-185). Verified end-to-end. The newly added REQ-KAKAO-017 (spec.md:183) correctly continues the sequence.

- **[PASS] MP-2 EARS format compliance**: All 17 REQs carry an EARS keyword skeleton matching one of the five patterns (When/If/While/Where + shall / shall not). The two explicit misclassifications flagged in iteration 1 are corrected:
  - REQ-KAKAO-015 (spec.md:173): reclassified Unwanted → Ubiquitous. Now "The system **shall** 3개 뷰포트의 카카오 버튼을 항상 활성화된 상태로 제공하며..." — no embedded condition, correct Ubiquitous form.
  - REQ-KAKAO-016 (spec.md:177): reclassified Ubiquitous → Event-Driven. Now "When 카카오 로그인 콜백이 완료되어 ... useAuth 훅이 마운트되면, the system shall ..." — correct When/then form.
  - New REQ-KAKAO-017 (spec.md:183): State-Driven "While ... `provider='kakao'`로 갱신된 상태인 경우, the system shall ..." — correct.
  - Advisory: see D1-new below for REQ-KAKAO-013, a residual semantic classification concern (structural pattern intact, non-blocking).

- **[PASS] MP-3 YAML frontmatter validity (per PROJECT CONVENTION)**: The iteration-1 D2 finding (`created_at`, mandatory `labels`, status enum `draft/active/implemented/deprecated`) was evaluated against the actual project convention, not an abstract schema. Evidence from 4 existing SPECs:
  - All use `created` (not `created_at`): SPEC-AUTH-001/spec.md:4, SPEC-INTEGRATION-AUTH-001/spec.md:5, SPEC-AUTH-RESET-001/spec.md:4, SPEC-ATTACHMENT-001/spec.md:4.
  - All use freeform status (`Complete`, `Completed`), not a draft/active/implemented/deprecated enum.
  - None of the 4 has a `labels` field — labels are optional in this project.
  - SPEC-AUTH-KAKAO-001 frontmatter (spec.md:1-12) contains all conventionally-required fields (`id`, `version`, `status`, `created`, `updated`, `author`, `priority`, `issue_number`) PLUS an optional `labels` field. This conforms to and exceeds project convention. The iteration-1 D2 defect is therefore retracted as over-rigid. The author's HISTORY note (spec.md:25) explicitly contests D2 on the same grounds and is correct.

- **[N/A] MP-4 Section 22 language neutrality**: N/A — this is a single-product (Korean apartment community app) SPEC scoped to one OAuth provider. Not multi-language tooling.

---

## Category Scores (0.0-1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.88 | 0.75→1.0 | All 17 REQs have a single dominant interpretation. The previously ambiguous password-login regression (D5) is now explicitly resolved by REQ-KAKAO-017 (spec.md:185) and verified against the actual login route (`src/app/api/auth/login/route.ts:88-89` — gates on `password_hash`, not `provider`, confirming the SPEC's claim). Residual: REQ-KAKAO-013 semantic label (D1-new). |
| Completeness | 0.85 | 0.75 | All sections present (HISTORY spec.md:22-25, WHY §1, WHAT §3, REQUIREMENTS §5, ACCEPTANCE acceptance.md, Exclusions §7). Security gaps from iteration 1 (PKCE §6.1, state TTL §6.1, takeover mitigation §6.1) all addressed. Residual: email-sending infrastructure for REQ-KAKAO-017 notification is assumed but not listed in plan.md §2 file manifest (D2-new). |
| Testability | 0.88 | 0.75→1.0 | AC-KAKAO-001 through AC-KAKAO-020 + EC-KAKAO-001~004 are binary-testable Given/When/Then scenarios. AC-KAKAO-014 (acceptance.md:180-181) rewritten to use `vi.spyOn(console,...)`/logger mock with regex and explicit note that `logs/` grep is prohibited — now testable. AC-KAKAO-016 (acceptance.md:202-205) uses concrete `grep -rn` checks with numeric match counts. |
| Traceability | 1.0 | 1.0 | All 17 REQs map to at least one AC (verified end-to-end). New REQ-KAKAO-017 traces to AC-KAKAO-018 and AC-KAKAO-020. No orphaned ACs. No uncovered REQs. |

---

## Defects Found

**D1-new. spec.md:163-165 (REQ-KAKAO-013) — EARS "Unwanted" label is semantically misapplied; the trigger is a normal success event, not an undesired condition. — Severity: major (non-blocking)**

REQ-KAKAO-013 is declared "(Unwanted)" but the trigger is "카카오 토큰 교환 및 사용자 정보 조회가 완료되면" ("when token exchange and user info lookup complete") — this is the happy-path success event, not an undesired runtime condition. The Unwanted pattern per EARS is "If [undesired condition], then the system shall [mitigation]." The response (do not store tokens; discard from memory) is a desired prohibition following normal completion, not a response to a threat condition.

Mitigating factor: the If/then/shall-not structural skeleton is intact, so an implementer will not misimplement the behavior. This is the same *species* of misuse as the old REQ-KAKAO-015/016 but structurally milder. This defect was present in iteration 1 but was not flagged then; it surfaces now under deeper re-read. **Recommendation**: reclassify REQ-KAKAO-013 as Event-Driven ("When ... 완료되면, the system shall ensure tokens are not persisted ...") and move the "shall not store" prohibition into the response body, or split into an Event-Driven REQ + a constraint in §6.1.

**D2-new. spec.md:185 (REQ-KAKAO-017), plan.md §2 (file manifest) — Notification-email sending is required but no email-sending module/dependency is listed in the implementation plan. — Severity: minor**

REQ-KAKAO-017 and AC-KAKAO-008 (acceptance.md:106) require that "최초 1회 연결 알림 이메일" be sent to the existing email account. AC-KAKAO-008 specifies "메일 발송 mock으로 검증", implying a sender function exists to be mocked. However, plan.md §2 (file creation/modification list, plan.md:36-107) enumerates no email-sending library or module. If a reusable email-sending utility already exists (e.g., from SPEC-AUTH-RESET-001's password-reset flow), it should be cited as a `[EXISTING]` dependency in §4 or plan.md §7.3. If it does not exist, this is a hidden implementation gap. **Recommendation**: add one line to plan.md §2 or §7 citing the email-sending infrastructure (existing or new) that will deliver the notification.

No other defects found in this iteration.

---

## Regression Check (Iteration 2)

Defects from iteration 1 — disposition verified against revised spec.md/acceptance.md/plan.md and codebase:

- **D1 (3-viewport stub claim, critical)**: **RESOLVED**. spec.md:40 now correctly distinguishes "TabletApp 기존 stub 교체" from "MobileApp·DesktopApp 신규 추가". spec.md:75 ([NEW]) explicitly documents "현재 카카오 버튼 자체가 부재 — `grep "kakao\|카카오" src/components/MobileApp.tsx src/components/DesktopApp.tsx` 0 matches 확인". REQ-KAKAO-014 (spec.md:171) and plan.md:91 ("주의 D1 정정") align. Codebase re-verified: only `src/components/TabletApp.tsx:477` contains the kakao stub; MobileApp/DesktopApp have zero kakao references.

- **D2 (frontmatter)**: **RETRACTED (defect was invalid against project convention)**. See MP-3 above. The iteration-1 auditor applied an abstract frontmatter schema that does not match this project's established convention (`created` not `created_at`; `status` freeform; `labels` absent from all 4 reference SPECs). The author's optional `labels` addition is a net improvement.

- **D3 (REQ-KAKAO-015 EARS Unwanted misuse)**: **RESOLVED**. Reclassified to Ubiquitous (spec.md:173). Condition removed.

- **D4 (REQ-KAKAO-016 Ubiquitous with embedded condition)**: **RESOLVED**. Reclassified to Event-Driven (spec.md:177). Trigger is now a proper When-clause.

- **D5 (silent lockout / password login regression)**: **RESOLVED**. REQ-KAKAO-017 (spec.md:183-185) explicitly states `provider` is metadata, not an auth gate, and `password_hash` is preserved. Verified against `src/app/api/auth/login/route.ts:88-89`: login gates on `user.password_hash`, not on `provider`, so auto-linked users with preserved `password_hash` can still authenticate via email/password. AC-KAKAO-018 (acceptance.md:236) and AC-KAKAO-020 (acceptance.md:249-255) verify both directions.

- **D6 (PKCE)**: **RESOLVED**. §6.1 [RECOMMENDED] PKCE (spec.md:197) documents RFC 7636/9700 consideration. TD-8 (plan.md:160-164) defers final adopt/reject decision to Run Phase with an explicit requirement to record rationale if rejected. This satisfies "considered and documented."

- **D7 (state cookie TTL)**: **RESOLVED**. Max-Age=600 specified in REQ-KAKAO-001 (spec.md:111), §6.1 [HARD] state 쿠키 TTL (spec.md:194), TD-7 (plan.md:154-158). AC-KAKAO-001 (acceptance.md:30) asserts Set-Cookie Max-Age=600; AC-KAKAO-003 (acceptance.md:52) asserts Max-Age=0 deletion on callback completion.

- **D8 (account-takeover mitigation)**: **RESOLVED**. §6.1 [HARD] 이메일 자동 연결 계정 탈취 완화 (spec.md:198) specifies three measures (a/b/c). REQ-KAKAO-007 (spec.md:139) embeds the `provider='kakao'` + different `provider_id` → reject rule. AC-KAKAO-019 (acceptance.md:239-247) verifies the takeover-defense path end-to-end. First-link notification email in REQ-KAKAO-017 and AC-KAKAO-008. The "kakao is trusted" bare assertion from iteration 1 is replaced by a concrete mitigation chain.

- **D9 (`logs/` grep in AC-KAKAO-014)**: **RESOLVED**. AC-KAKAO-014 (acceptance.md:180-181) rewritten to use `vi.spyOn(console, ...)` or logger mock with regex `/ya29\.[A-Za-z0-9_-]+|access_token.*[A-Za-z0-9]{20,}/`, and explicitly states `grep logs/` is prohibited because Next.js apps do not use a filesystem `logs/` directory.

No iteration-1 defect is unresolved or stagnating.

---

## Chain-of-Verification Pass

Second-look findings — verified by re-reading all sections and re-checking codebase:

- **REQ sequencing**: Re-verified REQ-KAKAO-001 through REQ-KAKAO-017 end-to-end. Sequential, no gaps, no duplicates. Confirmed.
- **Traceability**: Re-verified every REQ (001~017) has at least one AC. REQ-KAKAO-017 → AC-KAKAO-018/020. No orphaned ACs. Confirmed.
- **D1 codebase facts**: Re-ran `grep -rn "kakao\|카카오" src/components/`. Only TabletApp.tsx:477 (stub) and :499 (button label) match. MobileApp/DesktopApp zero matches. SPEC now matches reality.
- **D5 login-route fact**: Read `src/app/api/auth/login/route.ts:88-89`. Gates on `password_hash`, not `provider`. SPEC's claim in REQ-KAKAO-017 is factually correct.
- **EARS semantic re-read**: Discovered REQ-KAKAO-013 misclassification (D1-new) — a pre-existing imperfection not caught in iteration 1, surfaced by deeper re-read. Added.
- **Implementation-completeness re-read**: Discovered email-sending infrastructure assumption (D2-new). Added.
- **Contradictions between requirements**: Re-scanned REQ-KAKAO-007/008/017 and AC-KAKAO-018/019/020 for consistency. REQ-KAKAO-008 (password_hash=NULL for new social-only accounts) is consistent with AC-KAKAO-020 (NULL password rejected at login). REQ-KAKAO-007/017 (preserve password_hash for auto-linked accounts) is consistent with AC-KAKAO-018 (password login still works post-link). No contradictions.

No additional defects missed.

---

## Recommendation

The SPEC is approved for progression to the Run Phase. The revision substantively resolved all 8 substantive iteration-1 defects (D1, D3, D4, D5, D6, D7, D8, D9); the remaining D2 was retracted as based on an over-rigid schema that does not match project convention.

Two non-blocking advisories for the implementer to address during Run Phase:

1. **[D1-new, major]** Reclassify REQ-KAKAO-013 from Unwanted to Event-Driven. Move the "shall not persist tokens" prohibition into the response body of a When-clause, or split into an Event-Driven REQ + a §6.1 constraint. One-line spec edit; no implementation impact.

2. **[D2-new, minor]** In plan.md §2 or §7.3, cite the email-sending infrastructure (existing utility from SPEC-AUTH-RESET-001, or a new module) that will deliver the first-link notification required by REQ-KAKAO-017 / AC-KAKAO-008. Prevents a hidden gap during implementation.

Rationale for PASS: MP-1 (sequential numbering 001–017), MP-2 (all EARS structural patterns present; explicit misclassifications fixed), MP-3 (frontmatter conforms to and exceeds the project's actual convention, verified against 4 reference SPECs), and MP-4 (N/A) all pass. Traceability is complete. The SPEC is internally consistent and its codebase dependency claims are factually accurate.

---

Verdict: PASS
