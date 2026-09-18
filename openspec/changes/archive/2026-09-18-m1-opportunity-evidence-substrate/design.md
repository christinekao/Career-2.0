## Context

The accepted `establish-m1-foundation` change supplies the local Electron shell, configured private root, single writer, and narrow persistence boundary. At planning time, the approved `opportunity-workspace` and `career-evidence` specifications described product contracts without an implemented substrate. The minimum substrate is now implemented by this change, but `m2-intelligence-vertical-slice` cannot use it until this change receives its separate read-only acceptance.

Implementation status (2026-09-17): minimum Opportunity/JD and Career
Evidence/revision operations, additive migration, migration ownership gates,
narrow IPC, degraded foundation/substrate status, true cross-process
restart/read-back tests, and bounded implementation evidence are complete.
Formal prerequisite acceptance remains pending; M2 implementation has not
started.

## Goals / Non-Goals

**Goals:**

- Implement only the minimum records and operations that let a later slice select one Opportunity/JD revision and read fixed Career Evidence revisions.
- Preserve immutable JD and Evidence revision identity, provenance, confirmation state, and restart/read-back behavior.
- Keep all canonical mutations inside the existing application writer and persistence boundary.
- Produce an independently reviewable acceptance gate for the M2 change.

**Non-Goals:**

- Full M1 Workspace, contacts, interactions, interviews, applications, submissions, documents, backup/restore implementation, or search/automation.
- M2 analysis, matching, positioning, AI execution, CV, Story Bank, Interview Pack, or PDF output.
- A second persistence authority, raw SQLite access, server, sync layer, background writer, new dependency, or technology change.

## Decisions

### 1. Named prerequisite and ordering

`m1-opportunity-evidence-substrate` is the named prerequisite for
`m2-intelligence-vertical-slice`. Its implementation must complete, pass its
own read-only acceptance, and leave its accepted evidence available before any
M2 implementation task starts. M2 planning may proceed in parallel, but M2
apply is blocked until this gate is `ACCEPTED`.

### 2. Minimum Opportunity substrate

The substrate owns one stable `opportunity_id` and the smallest readable
Opportunity state needed by the intelligence slice: company/role identity,
source metadata, and a sequence of immutable `jd_revision_id` captures. Each
JD revision retains its captured text when available, source reference,
capture metadata, content identity, and an explicit missing/unavailable state.
Creating a newer capture adds a revision and never overwrites an older one.

The required operations are create/read current Opportunity, add/read a JD
revision, and reopen/read the same records after process restart. No other
Opportunity workflow is implied.

### 3. Minimum Career Evidence substrate

The substrate owns stable `evidence_id` identities and immutable
`evidence_revision_id` records. A revision contains the factual content,
provenance, responsibility boundary, outcome, metric definition when present,
and confirmation state required by the existing Career Evidence contract.
Only an explicit user/application confirmation operation can make a revision
canonical/current; changing factual meaning creates a new revision and leaves
the old revision readable.

The required operations are create/read an Evidence draft or confirmed record,
confirm a revision, and reopen/read fixed revisions after restart. No generated
or AI output is accepted as canonical by this change.

### 4. Writer, persistence, and boundary

Domain operations route through the existing main-process canonical writer and
the existing replaceable persistence boundary. The implementation may add the
minimum domain tables/operations and an additive migration from the accepted
M1 foundation, but it must not alter `FOUNDATION_STORE_VERSION = 1`, reset or
rebind an existing store, expose a database handle/path, or give renderer code
direct filesystem/database access. Ownership is re-validated before migration,
inside the migration transaction around schema/marker publication, and before
the substrate is returned as ready; a lost owner rolls the migration back and
fails closed. A domain migration failure leaves the valid M1 foundation
`READY`, reports the Opportunity/Evidence substrate `UNAVAILABLE`, and exposes
no domain operations as ready.

### 5. Acceptance gate

The prerequisite is accepted only when synthetic tests and a bounded manual or
integration check demonstrate: Opportunity creation/read/reopen; immutable JD
revision capture and missing-source behavior; Evidence creation,
confirmation, immutable revision history and provenance; M1 foundation
compatibility; private-root/repository isolation; no generated-data promotion;
and clean failure without partial success. It must also show that ownership
loss during migration cannot publish a partial substrate, a domain migration
failure leaves M1 usable but the substrate unavailable, and a fresh process
can read back IDs, immutable revisions, current pointers, and provenance after
the writer process exits. The evidence must identify the tested change
revision and private-root fixture, and must show no personal data.

### 6. Existing specification ownership

This change uses `skip_specs: true` because it implements the already-approved
behavior in `openspec/specs/opportunity-workspace/spec.md` and
`openspec/specs/career-evidence/spec.md` without changing their requirements.
Those baseline specs remain the behavioral authority; this change is the
named implementation/acceptance record, not a duplicate capability contract.

## Risks / Trade-offs

- **[Substrate grows into Workspace]** → Keep the acceptance list above as a hard boundary; defer every other product-domain record.
- **[M2 starts against an unaccepted substrate]** → Require the named change to be accepted before M2 apply and verify the exact prerequisite status in M2 preflight.
- **[New records weaken M1 isolation]** → Reuse the M1 writer, private root, persistence boundary, and synthetic-root validation; fail closed on migration or identity errors.

## Migration Plan

1. Implement the minimum Opportunity/JD and Evidence/revision operations behind the existing M1 boundary.
2. Add and test only the additive schema migration required for those records; keep foundation metadata/version and existing rows intact.
3. Run synthetic cross-process restart, revision, privacy, isolation,
   ownership-loss, degraded-foundation, and failure validation.
4. Obtain a separate read-only acceptance review and mark this prerequisite accepted.
5. Only then allow `m2-intelligence-vertical-slice` implementation; if the gate fails, leave M2 unstarted and keep the M1 foundation usable.
