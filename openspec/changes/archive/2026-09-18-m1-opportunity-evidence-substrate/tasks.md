## 1. Minimum Opportunity substrate

- [x] 1.1 Implement application-owned Opportunity create/read/reopen operations with a stable `opportunity_id`, minimal company/role/source metadata, and no full Workspace records.
- [x] 1.2 Implement immutable JD capture revisions with stable `jd_revision_id`, captured-text identity, source metadata, explicit availability state, and read-back of older revisions.

## 2. Minimum Career Evidence substrate

- [x] 2.1 Implement application-owned Evidence create/read operations with stable `evidence_id` and immutable `evidence_revision_id`, including provenance, responsibility boundary, outcome, metric definition when present, and confirmation state.
- [x] 2.2 Implement explicit confirmation and revision creation so only confirmed user/application operations move the current Evidence pointer; generated or AI output cannot auto-promote.

## 3. Persistence and application boundary

- [x] 3.1 Add the smallest additive migration from the accepted M1 foundation, preserve `FOUNDATION_STORE_VERSION = 1` and existing foundation data, re-check ownership through migration and ready publication, and fail closed with M1 still usable if migration or initialization fails.
- [x] 3.2 Expose only domain operations through the existing main-process writer and narrow boundary; verify no raw SQLite handle/path or renderer database/filesystem capability is exposed.

## 4. Deterministic validation and prerequisite acceptance

- [x] 4.1 Add synthetic private-root fixtures for Opportunity/JD and Evidence/revision creation, confirmation, immutable history, missing source, true cross-process restart/read-back, and no generated-data promotion.
- [x] 4.2 Validate private-root/repository isolation, foundation compatibility, ownership-loss rollback, degraded substrate failure handling, failure without partial success, and clean ownership release using the existing validation approach.
- [x] 4.3 Prepare bounded prerequisite implementation evidence, record the exact tested revision/evidence and hand off the separate read-only acceptance gate; keep `m2-intelligence-vertical-slice` blocked until that gate is accepted.

Implementation evidence is complete and the nine checked items represent
implementation and validation work only. The formal
`M1_OPPORTUNITY_EVIDENCE_SUBSTRATE = ACCEPTED` decision remains owned by the
separate read-only prerequisite acceptance review; this change does not
self-accept that gate. The previous acceptance review found migration ownership
safety, degraded-foundation behavior, and true cross-process read-back gaps;
the schema-readiness repair then closed confirmed-only current pointers,
strict CHECK probes, canonical schema markers, incompatible-schema degraded
handling, and after-marker ownership loss. This repair adds the single public
error boundary and privacy regressions for re-review but does not change the
acceptance status.

Implementation validation record (2026-09-18 repair): the checked revision was
`HEAD=911a10392a1d2073145c7859feb001d0dd38fe2c` plus the uncommitted files in
this change's implementation worktree; no commit was created. The repair
added migration ownership-loss rollback, degraded foundation/substrate status,
a true two-child-process restart/read-back regression, and the schema-readiness
repair regressions for confirmed-only current pointers, strict CHECK probes,
canonical schema markers, incompatible mandatory extensions, and after-marker
ownership loss. Foundation/domain tests were 36 passed, 1 skipped, 0 failed;
The public error boundary now maps internal diagnostics to stable safe codes
and messages before foundation status or domain IPC reaches the renderer;
private-root, SQLite, configuration-path, classification-preservation, and
ready-status regressions were added.
The first direct Electron public-IPC probe proved that Electron does not
preserve custom properties on an `ipcMain.handle` thrown object; the minimal
main-process public error envelope and preload transport decoder now preserve
only the safe `{ code, message }` rejection without changing successful domain
payloads. The final probe passed private-path, SQLite/config, stack-redaction,
unknown-code fallback, known classification, and success cases through
`ipcRenderer.invoke -> preload -> renderer`.
ABI, build, syntax, OpenSpec strict, and diff check were revalidated or retained
where the close-out did not touch the relevant runtime. The previously
accepted bounded Electron evidence remains fresh because the normal startup
contract and Electron entry path were not changed: fresh PID `54523` loaded
`src/main/index.cjs`, created a visible 900x680 BrowserWindow, loaded the local
renderer, completed the actual preload identity and IPC handshake, created/read
an Opportunity and JD revision plus draft/confirmed Evidence revisions,
verified foundation/domain metadata and root binding, held the 8-second visible
observation window, and exited with code 0 after ownership reacquisition. The
temporary root was cleaned up and no personal data was used. The formal
`M1_OPPORTUNITY_EVIDENCE_SUBSTRATE = ACCEPTED` decision remains owned by the
separate read-only prerequisite acceptance review.

Worktree evidence (2026-09-18 direct public-IPC error-boundary repair):
`HEAD=911a10392a1d2073145c7859feb001d0dd38fe2c`.
The exact dirty path set was:
`PLAN.md`, `PROGRESS.md`, `docs/OSS_REUSE.md`, `docs/PRODUCT_PLAN.md`,
`docs/architecture/CURRENT_ARCHITECTURE.md`,
`docs/architecture/diagrams/authority-ownership-map.md`,
`docs/architecture/diagrams/workspace-boundary-map.md`,
`docs/project-dashboard.html`, `package.json`, `src/main/foundation.cjs`,
`src/main/index.cjs`, `src/main/persistence.cjs`, `src/preload/index.cjs`,
`test/foundation.test.cjs`, `test/offline-startup-electron.cjs`,
`test/public-ipc-error-electron.cjs`,
`openspec/changes/m1-opportunity-evidence-substrate/.openspec.yaml`,
`design.md`, `proposal.md`, `tasks.md`, and all five files under
`openspec/changes/m2-intelligence-vertical-slice/`.
`TRACKED_DIFF_SHA256=f66fb05d9b77bc63ae2cd0b4c1aa49a96cc07076dcebbf0c439559a3a636dc78`
is SHA-256 of the binary output of
`git diff --binary HEAD -- . ':(exclude)openspec/changes/m1-opportunity-evidence-substrate/tasks.md'`.
Excluding this ledger makes the digest independent of the evidence block
that records it. `UNTRACKED_MANIFEST_SHA256=d87ab13062196d79e71e7c1866e065b6e819ec24e3efa0f61af46405e6a590ea`
is SHA-256 of UTF-8 rows for the sorted untracked paths, excluding this task
ledger, where each row is `relative-path NUL file-SHA-256` and rows are joined
with one LF, including a final LF. The covered paths are
`m1-opportunity-evidence-substrate/.openspec.yaml`, `design.md`, and
`proposal.md`, all five files under `m2-intelligence-vertical-slice/`, and
`test/public-ipc-error-electron.cjs`. The implementation-task prefix hash is
`TASK_LEDGER_PREFIX_SHA256=0b145b54f10d489d3036d77a9d3e75953d7fc4a17661a390428e46037be9f662`,
the SHA-256 of the bytes in this file before the line beginning
`Implementation evidence is complete`.
The exact combined algorithm is SHA-256 of the UTF-8 bytes of this exact
four-line input, with one LF after each line, including the final line, and
no other bytes:
```text
HEAD=<HEAD>
TRACKED_DIFF_SHA256=<tracked digest>
UNTRACKED_MANIFEST_SHA256=<manifest digest>
TASK_LEDGER_PREFIX_SHA256=<prefix digest>
```
With the values above it produces
`WORKTREE_EVIDENCE_DIGEST=a60a25646fd42e54f6aab4b5d8bbca1fbcb90e66484eac9c970f90c8aa1706c1`.
No commit was created.
