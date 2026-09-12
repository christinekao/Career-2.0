## Context

See `proposal.md` for the motivation. Career 2.0 has no product source code or
runtime yet. The approved T02 architecture requires one local application and
one canonical writer; T01 selected an Electron desktop shell, a React/Vite
renderer, SQLite through `better-sqlite3`, native filesystem/hash APIs, and
Node's built-in test capability for M1. The existing product and architecture
documents remain authoritative; this design only makes the foundation boundary
executable later.

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
- No full domain schema, document renderer, resume editor, migration of real
  user data, or cloud/private-data service.

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
There is no server or required network path; any development server is a local
build concern, not a product runtime dependency.

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
boundary so the domain contracts do not depend on the driver's API. The
foundation creates only the minimum metadata needed to identify the local
store and its contract/migration version; later changes add product tables and
rules under their own OpenSpec changes.

Initialization and reopen are transactionally/atomically safe enough for the
single local writer. A failed initialization must not report a usable store or
leave an ambiguous partial success. Migration/version checks fail closed when
the store is unsupported rather than silently rewriting it.

### Native-module compatibility gate

Use `@electron/rebuild` as a build-time capability for the native SQLite
binding. Before persistence feature work is accepted, run a small synthetic
open/write/transaction/reopen probe against the Electron runtime. A failed
probe stops the implementation gate and requires re-evaluation of the selected
binding/runtime; it does not authorize a silent replacement.

### Validation boundary

Use Node `node:test`, `node:assert/strict`, and native `fs`/`path`/`crypto` with
isolated temporary roots. Keep fixtures synthetic, deterministic, local, and
free of personal data. Automate offline startup assumptions, root validation,
single-writer routing, store initialization/reopen, and fail-closed errors.
The product UI and visual M1 acceptance remain outside this foundation change
and will be validated by their later OpenSpec changes.

## Risks / Trade-offs

- **[Native SQLite ABI mismatch]** → Run the Electron open/write/transaction/reopen probe immediately after the skeleton exists; stop on failure rather than changing drivers implicitly.
- **[Private path points inside the repository]** → Resolve and compare canonical paths before initialization; reject the configuration and keep the repository free of private state.
- **[Renderer becomes a second writer]** → Keep database/filesystem capabilities in the main process, expose only narrow commands, and test that renderer actions route through the application boundary.
- **[Development tooling is mistaken for product network dependency]** → Validate a packaged/local startup path with network unavailable; treat Vite's development server as tooling only.
- **[Foundation scope grows into M1 feature work]** → Keep product entities, workflow tables, UI screens, and backup/submission behavior in later, separately reviewable OpenSpec changes.

## Migration Plan

There is no existing application runtime or private data store to migrate. The
implementation sequence creates the foundation in a new project tree, runs
synthetic validation, and only then permits later M1 changes to add product
state. If the foundation gate fails, leave the repository at the prior
planning baseline and revise the change artifacts before applying further
work; no real user data is touched by this change.
