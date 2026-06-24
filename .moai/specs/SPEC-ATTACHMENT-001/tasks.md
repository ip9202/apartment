# Task Decomposition

SPEC: SPEC-ATTACHMENT-001
Mode: sub-agent sequential (manager-tdd) | Methodology: TDD brownfield enhancement
Branch: feature/SPEC-ATTACHMENT-001-attachments
Key decision: Phase E disk cleanup = post-commit best-effort (DB commits, then fs.unlink; failure logged, orphan monitored via REQ-ATT-016)

## Phase A — Foundation
| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| T-001 | migration 010_attachments.sql (polymorphic table + 2 indexes, idempotent) | REQ-ATT-029 | - | migrations/010_attachments.sql, migrations/010_attachments.test.ts | pending |
| T-002 | Extract canAccessPrivate + buildVisibilityCondition to suggest-rbac.ts (gating: run full SUGGEST suite after) | REQ-ATT-013 | - | src/lib/suggest-rbac.ts, src/app/api/suggestions/route.ts, src/app/api/suggestions/[id]/route.ts | pending |
| T-003 | attachments-validation.ts (MIME/ext/magic/size/limits; HWP exception) | REQ-ATT-005,008,022,023,025 | - | src/lib/attachments-validation.ts, src/lib/attachments-validation.test.ts | pending |
| T-004 | attachments-storage.ts (save/read/remove/resolveDir; UUID path; traversal defense) | REQ-ATT-008 | - | src/lib/attachments-storage.ts, src/lib/attachments-storage.test.ts | pending |
| T-005 | env + dir scaffold | - | - | .env.example, public/uploads/.gitkeep | pending |

## Phase B — Upload
| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| T-006 | POST /api/notices/[id]/attachments (ADMIN) | REQ-ATT-001,003,006,007,024 | T-001,003,004 | src/app/api/notices/[id]/attachments/route.ts(+test) | pending |
| T-007 | POST /api/suggestions/[id]/attachments (author+ADMIN; uploader_id=caller) | REQ-ATT-002,004,006,007,024 | T-006 | src/app/api/suggestions/[id]/attachments/route.ts(+test) | pending |

## Phase C — Download / Delete
| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| T-008 | GET /api/attachments/[id] (download; authz by target visibility; disk-missing 500) | REQ-ATT-012,013,014,015,016 | T-002,004 | src/app/api/attachments/[id]/route.ts | pending |
| T-009 | DELETE /api/attachments/[id] (NOTICE=ADMIN/SUGGEST=author+ADMIN; post-commit disk removal) | REQ-ATT-017,018,019,020,021 | T-008 | src/app/api/attachments/[id]/route.ts(+test) | pending |

## Phase D — Response enrichment
| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| T-010 | GET /api/notices/[id] += attachments[] (no storage_path) | REQ-ATT-009,011 | T-001 | src/app/api/notices/[id]/route.ts | pending |
| T-011 | GET /api/suggestions/[id] += attachments[] post-authz | REQ-ATT-010,011 | T-001,002 | src/app/api/suggestions/[id]/route.ts | pending |

## Phase E — Cascade hooks (characterization-first; post-commit disk)
| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| T-012 | Characterization baseline: run existing NOTICE/SUGGEST/deactivate tests | - | T-002 | (no new file; snapshot baseline) | pending |
| T-013 | NOTICE DELETE cascade (withTransaction; post-commit unlink) | REQ-ATT-026 | T-012 | src/app/api/notices/[id]/route.ts | pending |
| T-014 | SUGGEST DELETE archive cascade (withTransaction; post-commit unlink) | REQ-ATT-027 | T-012 | src/app/api/suggestions/[id]/route.ts | pending |
| T-015 | AUTH deactivate attachment cascade (inside existing tx; post-commit unlink; preserve unit_id ADR-005) | REQ-ATT-028 | T-012 | src/app/api/auth/users/[id]/deactivate/route.ts | pending |
| T-016 | Full suite green; coverage; divergence report | ALL | T-013,014,015 | (report) | pending |

## Planned files total: 13 new + 6 modified (drift baseline)
