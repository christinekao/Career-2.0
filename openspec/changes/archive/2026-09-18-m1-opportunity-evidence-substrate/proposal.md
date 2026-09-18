## Why

The accepted M1 foundation provides the private-root, single-writer, persistence, and Electron boundaries. At planning time it deliberately contained no product-domain Opportunity or Career Evidence records. The first M2 intelligence slice needs a small, reviewable substrate for one Opportunity/JD revision and confirmed Evidence revisions; this change makes that prerequisite explicit without implementing the rest of the M1 Workspace or M2.

Implementation status (2026-09-17): the minimum substrate implementation and
synthetic validation evidence are complete; the separate read-only prerequisite
acceptance review is pending. M2 implementation remains blocked.

## What Changes

- Implement the minimum application-owned Opportunity substrate: one stable Opportunity identity, readable current state, and immutable job-description captures with source metadata and unavailable-source handling.
- Implement the minimum application-owned Career Evidence substrate: stable Evidence identities, immutable Evidence revisions, provenance/responsibility/outcome boundaries, and explicit confirmation.
- Expose only the domain operations needed to create, read, reopen, and confirm these records through the existing main-process writer and narrow application boundary.
- Validate true cross-process restart/read-back, immutable revisions, private-root isolation, migration ownership-loss rollback, degraded substrate failure behavior, fail-closed persistence, and preservation of the M1 foundation state with synthetic data.
- Keep the substrate independent of AI, providers, CV/Story/Interview/PDF output, submission history, full Workspace workflow, and backup-system implementation.

## Capabilities

### New Capabilities

None. This is an implementation change for behavior already defined by the approved `opportunity-workspace` and `career-evidence` baseline specifications; `.openspec.yaml` therefore uses `skip_specs: true` and does not create a second behavioral authority.

### Modified Capabilities

None. The existing Opportunity and Career Evidence requirements remain the governing contracts.

## Impact

- Future application/domain modules, persistence operations, narrow preload/IPC reads and writes, and deterministic synthetic tests.
- The existing M1 foundation remains the only private-root and persistence authority; no raw SQLite handle, second writer, new storage format, or new dependency is introduced.
- This change is a hard prerequisite for applying `m2-intelligence-vertical-slice`; it must receive its own implementation and read-only acceptance before M2 intelligence implementation begins.
