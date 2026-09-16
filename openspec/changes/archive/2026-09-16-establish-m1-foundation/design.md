## Context

See `proposal.md` for the motivation. The M1 foundation shell and runtime now
exist; product-domain schemas, workflows, and feature screens remain outside
this change. The approved T02 architecture requires one local application and
one canonical writer; T01 selected an Electron desktop shell, a React/Vite
renderer, SQLite through `better-sqlite3`, native filesystem/hash APIs, and
Node's built-in test capability for M1. This follow-up hardens the existing
foundation boundary without claiming product-feature acceptance.

## Goals / Non-Goals

**Goals:**

- Provide one offline-capable local application shape with an explicit renderer,
  preload/IPC, and main/application/domain boundary.
- Make one user-configured private root outside the repository the only managed
  root for foundation state.
- Initialize and reopen local structured state through a narrow replaceable
  persistence boundary.
- Establish deterministic synthetic-root checks for startup, persistence,
  privacy, and fail-closed behavior.
- Keep the foundation ready for later M1 Opportunity and Career Evidence
  changes without claiming any product feature is implemented.

**Non-Goals:**

- No Opportunity, Career Evidence, submission, interaction, interview, backup
  UI, or other M1 product workflow implementation.
- No AI/model/provider integration, server, sync process, scheduler, agent
  runtime, custom framework, adapter layer, or second writer.
- No packaging/distribution system, installer generation, signing, or release
  tooling.
- No full domain schema, document renderer, resume editor, migration of real
  user data, or cloud/private-data service.
- No defense against an adversarial same-OS-user replacement of the `.career2`
  directory inode or symlink between successful path validation and the
  filesystem open syscall. Reject unsafe paths already present at validation
  time and fail closed when validation observes an identity/path change; keep
  active path-swap resistance as future hardening, not an M1 guarantee.

## Decisions

### Application boundary

Use the T01-approved shape:

```text
React renderer
    ↓ narrow preload / IPC
Electron main: application + domain + canonical writer
    ↓
SQLite state + configured private filesystem
```

The renderer can request application operations but cannot directly open the
database or mutate the private filesystem. The main process owns application
startup, private-root checks, persistence lifecycle, and all canonical writes.
For a given configured private root, only one Career 2.0 application process
may own canonical-write access at a time. A second Career 2.0 process targeting
the same root must fail closed before acquiring ownership and must not perform
canonical writes. This is an application-level ownership boundary: direct
editing outside Career 2.0 is unsupported, but the application does not claim
to prevent arbitrary external tools from modifying user-owned files or SQLite
bytes. There is no server or required network path; any development server is
a local build concern, not a product runtime dependency.

Implementation uses a process-scoped local ownership mechanism keyed to the
configured private root. On Darwin, the main process holds the system
`O_EXLOCK` on the validated owner file for the entire ownership lease; kernel
release on process termination makes stale recovery and simultaneous claims
atomic. Darwin validates both the owner lock and the fixed recovery-claim path
with the shared private-state validator before opening the kernel lock, even
though Darwin does not use the recovery claim for normal acquisition.

On other platforms, an exclusive recovery claim serializes stale generation
cleanup before an exclusive owner-file create. The initial claim records its
claimant, root binding, final-owner generation, and the stale lock's PID,
token, and file identity. If that claim is left behind, a later contender
first observes its staleness and atomically renames the claim to a new
UUID-qualified claim path, validates that the moved inode is unchanged, and
publishes its own recovery generation there. It may remove only the matching
stale owner inode, then still obtains the final owner with an exclusive file
create. All fixed and generated recovery claims use the same private-state
path validator; claim cleanup is identity-checked and no claim path is
unconditionally unlinked. An active claim blocks another recovery contender,
while an owner that terminated abnormally can be taken over without leaving a
permanent `OWNERSHIP_RECOVERY_IN_PROGRESS` state. Neither path uses a
distributed lock, daemon, or coordination service.

Ownership is scoped to the normalized private root. Acquisition is considered
complete only when the process has established that root's write authority;
the process must do this before opening write-capable persistence or accepting
canonical writes. A second process targeting the same root receives an
explicit conflict and has no write authority, while processes targeting
different valid roots may operate independently. Clean application shutdown
releases ownership so the root can be acquired again. After abnormal
termination, a new process may recover ownership only after a deterministic
check shows that no active owner remains; stale ownership may be recovered,
but uncertainty about an active owner fails closed. The mechanism remains a
runtime choice rather than a mandated lock-file or library implementation.

The `.career2` directory must be a real directory whose canonical path is
exactly beneath the configured root. Existing foundation files must be regular,
single-linked files and remain bound to that canonical state directory;
pre-existing symlinks, hard links, out-of-root canonical paths, and identity or
path changes observed by validation fail closed before the store is reported
ready. M1 does not defend against an active same-user replacement between a
successful validation check and the subsequent filesystem syscall; the
path-swap race remains unmitigated and is recorded as future hardening, not a
completed confinement guarantee. This exclusion does not permit a stable
configured path or normal pathname resolution to target the repository or any
location outside the configured private root. The ownership lease is rechecked
during persistence initialization, before READY publication, and before the
public store is returned.

### Runtime and renderer choices

Use Electron stable v44 line, React 19.3, Vite 8.3, and
`@vitejs/plugin-react` 6.1.1 as selected by T01. Electron is a replaceable shell
boundary, React/Vite are renderer/build choices, and neither owns Career 2.0
domain semantics. Tauri and a browser/PWA remain rejected for M1 because their
Rust build boundary or browser storage permissions add operational surface
without improving the required single-writer/private-root behavior.

### Private-root configuration

Accept one user-configured absolute private root and reject a root that is the
repository or a repository descendant. Store only the user choice and
non-sensitive configuration in the runtime's user configuration area; never
place career records, source material, attachments, or generated/submitted
bytes in the repository. Normalize and verify the root before opening state.

If the root is missing, inaccessible, unsafe, or changes identity during an
operation, fail closed. Do not fall back to repository-local state, browser
storage, a temporary silent root, or partial success.

### Structured persistence boundary

Use SQLite through `better-sqlite3` 13.0.3 in the Electron main process only.
Expose persistence operations to the application/domain layer through a narrow
boundary so the domain contracts do not depend on the driver's API. The public
result contains metadata and `close()` only; it does not expose the raw SQLite
database or its path. The foundation creates only the minimum metadata needed to identify the local
store and its contract/migration version; later changes add product tables and
rules under their own OpenSpec changes.

The foundation has one conceptual foundation-managed state area under the
selected normalized private root. Its physical directory and file names are
implementation choices, but this area contains one foundation store and its
metadata; initialization must not select a second store for the same root.
The first successful initialization records a store identity bound to the
normalized root. Reopening that root reuses the same logical store identity;
selecting a different valid root creates or opens a different identity, and a
store whose root binding does not match the selected root is not silently
rebound or cloned.

The minimum foundation metadata is a store identity, a foundation store
version, and an initialization state or ready marker as needed for safe
recovery. `FOUNDATION_STORE_VERSION = 1` is the current M1 supported version.
Version 1 opens normally. A newer, unsupported, or incompatible version
fails closed before the store is reported ready; M1 does not rewrite,
downgrade, reset, replace, or silently rebind it. Future migration work is a
later change and must preserve the store identity and root binding.

Initialization and reopen are transactionally/atomically safe enough for the
single local writer. A failed initialization must not report a usable store or
leave an ambiguous partial success. Migration/version checks fail closed when
the store is unsupported rather than silently rewriting it.

Initialization of an uninitialized valid root publishes exactly one usable
foundation store only after its required metadata is complete. Reinitializing
the same root with a valid ready store succeeds deterministically, reuses its
identity and supported version, and does not reset or replace existing state.
If initialization fails before ready, it reports failure and does not present
partial state as usable; a retry follows a deterministic initialization path
and does not require unsafe manual mutation to recover. Foundation
persistence stores infrastructure metadata only: no Career Evidence,
Opportunity, generated CV, submission, AI, or other product-domain records are
introduced by this change.

### Native-module compatibility gate

Use `@electron/rebuild` as a build-time capability for the native SQLite

The implementation order is: the application skeleton exists, dependencies
can be installed and resolved, the Electron native-binding probe passes, and
only then is persistence implementation or acceptance allowed to proceed. A
failed probe stops that path and requires reporting the mismatch and
reassessing the selected binding/build configuration; it does not authorize a
silent SQLite or `better-sqlite3` replacement or an automatic technology
reselection.

### Validation boundary

Use Node `node:test`, `node:assert/strict`, and native `fs`/`path`/`crypto` with
isolated temporary roots. Keep fixtures synthetic, deterministic, local, and
free of personal data. Automate offline startup assumptions, root validation,
single-writer routing, store initialization/reopen, repeat initialization,
unsupported-version and partial-failure retry behavior, ownership for the
same and different roots, clean release, stale/crash recovery, metadata/version
reads, renderer write isolation, and fail-closed errors. Validation must
record the approved pre-existing planning baseline and detect unexpected
implementation/runtime mutations without failing solely because those known
OpenSpec edits are dirty; the exact isolation or comparison mechanism remains
an implementation choice. Static symlink/hard-link confinement is an active
M1 test gate. The active same-user path-swap fixture remains skipped as future
hardening under the approved threat model. The product UI and visual M1
acceptance remain outside this foundation change and will be validated by
their later OpenSpec changes.

## Risks / Trade-offs

- **[Native SQLite ABI mismatch]** → Run the Electron open/write/transaction/reopen probe immediately after the skeleton exists; stop on failure rather than changing drivers implicitly.
- **[Private path points inside the repository]** → Resolve and compare canonical paths before initialization; reject the configuration and keep the repository free of private state.
- **[Renderer or a second application instance becomes a second writer]** → Keep database/filesystem capabilities in the main process, expose only narrow commands, reserve one process-scoped owner per configured root, and test that renderer actions and concurrent second-instance attempts cannot bypass the application boundary.
- **[Development tooling is mistaken for product network dependency]** → Validate a production/local startup path using built local renderer assets with network unavailable; treat Vite's development server as tooling only.
- **[Foundation scope grows into M1 feature work]** → Keep product entities, workflow tables, UI screens, and backup/submission behavior in later, separately reviewable OpenSpec changes.

## Migration Plan

There is no existing application runtime or private data store to migrate. The
implementation sequence creates the foundation in a new project tree, runs
synthetic validation, and only then permits later M1 changes to add product
state. If the foundation gate fails, leave the repository at the prior
planning baseline and revise the change artifacts before applying further
work; no real user data is touched by this change.
