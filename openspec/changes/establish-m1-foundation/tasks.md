## 1. Application skeleton

- [ ] 1.1 Create the minimal Electron stable v44, React 19.3, and Vite 8.3 project skeleton with build metadata and no product feature screens; verify the dependency graph and repository contain no private data.
- [ ] 1.2 Add a local packaged/startup path that does not require a server or network; validate startup with network access unavailable and record the result.

## 2. Process and writer boundary

- [ ] 2.1 Establish the React renderer → narrow preload/IPC → Electron main/application/domain boundary; verify renderer code has no direct database or private-filesystem write access.
- [ ] 2.2 Route foundation mutations through one canonical application writer and reject unsupported second-writer/direct-edit paths; add deterministic boundary validation.

## 3. Private-root contract

- [ ] 3.1 Implement user-configured absolute private-root validation outside the repository, including normalized-path checks and explicit failure for unset, unavailable, unreadable, unsafe, or repository-local roots; validate with synthetic roots.
- [ ] 3.2 Initialize only the foundation-managed state location under a valid private root and prove that failure leaves no false success or repository-local fallback.

## 4. Structured persistence bootstrap

- [ ] 4.1 Add the narrow persistence boundary and SQLite bootstrap through `better-sqlite3` 13.0.3 in the main process, including minimum store identity and contract/migration version metadata; validate first initialization, transaction-safe failure, and reopen.
- [ ] 4.2 Configure `@electron/rebuild` and run the synthetic Electron native-binding open/write/transaction/reopen probe; stop and report if the selected binding/runtime compatibility gate fails.

## 5. Foundation validation and handoff

- [ ] 5.1 Add deterministic `node:test`/`node:assert/strict` fixtures using isolated temporary private roots for offline startup, private-root failure, writer routing, persistence initialization, reopen, and repository privacy checks.
- [ ] 5.2 Run the foundation validation from a clean worktree, confirm no product M1 behavior was implemented, and record the evidence needed before starting the next M1 OpenSpec change.
