## Why

Career 2.0 has approved M1 behavior and capability decisions, but no executable
local application foundation on which the Opportunity and Career Evidence work
can safely be built. A bounded foundation is needed now to prove the selected
local runtime, private-root boundary, single-writer boundary, and persistence
bootstrap before product changes begin.

## What Changes

- Add the minimal local application foundation needed to start Career 2.0 offline.
- Establish the renderer, narrow preload/IPC, and main/application/domain writer boundary.
- Establish configuration and fail-closed handling for one user-configured private root outside Git.
- Establish the persistence bootstrap boundary for private local structured state and migration/version handling.
- Establish deterministic synthetic-root validation for the foundation and verify the native SQLite binding rebuild path required by Electron.

## Capabilities

### New Capabilities

- `application-foundation`: offline startup, private-root initialization, single-writer application boundaries, and foundation-level validation.

### Modified Capabilities

None. Existing Career 2.0 capability specifications remain the approved M1
target behavior and are not rewritten by this foundation change.

## Success

The foundation is ready for subsequent M1 changes when the application starts
locally without a required network, the configured private root is the only
managed storage root, canonical writes have one application owner, private
storage failure is fail-closed, persistence can initialize and reopen in that
root, and deterministic synthetic tests prove these boundaries. No product
feature is considered implemented by this change.

## Impact

- A new application/tooling boundary will be added using the T01-approved runtime and UI choices.
- A persistence boundary will be exposed to the application/domain layer without making product semantics depend on a driver API.
- The private data contract will be exercised through user configuration and isolated test roots; real career data remains outside the repository.
- No existing product authority, architecture authority, delivery-plan authority, or Engineering Memory relationship changes.
