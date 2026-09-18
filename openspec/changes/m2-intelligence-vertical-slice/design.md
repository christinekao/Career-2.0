## Context

The accepted M1 foundation supplies the local Electron shell, configured private root, single canonical writer, and replaceable persistence boundary. The approved `opportunity-workspace` and `career-evidence` specifications remain broader target contracts; the minimum Opportunity/JD and Evidence/revision substrate is implemented and accepted in the archived `m1-opportunity-evidence-substrate` change. That accepted prerequisite supplies the inputs required here; the full product-domain records and workflows are not assumed.

This change remains the first M2 intelligence vertical slice: one selected Opportunity, one JD revision, a fixed Evidence snapshot, explainable matching/gaps, and reviewable positioning. It does not implement or assume the rest of the M1 Workspace or the complete M2 MVP.

## Goals / Non-Goals

**Goals:**

- Define stable, deterministic identities and provenance edges from captured JD source through requirements, matches/gaps, Evidence revisions, and positioning claims.
- Define a finite match/gap taxonomy, structured extraction uncertainty, and testable candidate/readiness rules.
- Define one provider-independent bounded execution contract with explicit malformed, partial, timeout, cancellation, retry, duplicate, and stale behavior.
- Add intelligence persistence additively while retaining the M1 foundation version, writer, private-root, and persistence boundaries.
- Preserve the existing backup/restore authority as the only owner of complete-store backup and restore expectations.

**Non-Goals:**

- Creating the Opportunity/Evidence substrate in this change; that is `m1-opportunity-evidence-substrate`.
- CV generation, cover letter, Story Bank, Interview Pack, cross-artifact review/repair/recheck, PDF, submission, or the full two-JD MVP.
- Selecting or installing a provider, model, CLI, package, renderer, dependency, or version during planning.
- A generic provider adapter, router, agent framework, server, sync layer, background worker, or second writer.
- Reworking M1 ownership, path confinement, persistence identity, renderer security, or the accepted same-user path-swap TOCTOU limitation.

## Decisions

### 1. The prerequisite is a hard implementation gate

`m1-opportunity-evidence-substrate` is implemented, separately accepted, and
archived. Its gate proves stable Opportunity/JD revision and confirmed
Evidence/revision operations, restart/read-back, private-root isolation, and
fail-closed behavior. M2 implementation remains blocked until this planning
change's remaining blockers are repaired and its read-only planning review
passes.

### 2. Stable identity uses immutable inputs, not display text

The substrate owns opaque `opportunity_id`, `jd_revision_id`, `evidence_id`,
and `evidence_revision_id` values. M2 uses the following persisted identities:

- `analysis_id = analysis:{opportunity_id}:{jd_revision_id}:{analysis_generation}`;
- `evidence_snapshot_id` is the digest of the contract version plus the
  ordered fixed `evidence_revision_ids`;
- `requirement_id` is the digest of contract version, `jd_revision_id`,
  deterministic source anchor, normalized content, and requirement type;
- `match_id` is the digest of matching contract version, `jd_revision_id`,
  `requirement_id`, and `evidence_snapshot_id`;
- `gap_id` uses the same input identity as `match_id` with the gap contract
  marker;
- `positioning_version_id` is `pos:{opportunity_id}:{version_number}`, where
  the single writer allocates the next monotonic version number per
  Opportunity and reuses it for retries of the same candidate;
- `positioning_claim_id` is the positioning version identity plus the
  deterministic ordinal of the validated claim within that version.

Canonical serialization, digest encoding, source-anchor format, and ordering
are implementation-testable contract details. Reprocessing the same immutable
JD revision and Evidence snapshot with the same contract version must reuse
the same requirement/match/gap identities; a new JD or Evidence generation
must not reuse the old current result. Display text alone is never an identity.

### 3. Requirement and uncertainty shape is structured

Each requirement carries the fields and finite values defined by the
intelligence spec: `RESPONSIBILITY`, `OUTCOME`, `SKILL`, `CONSTRAINT`,
`QUALIFICATION`, `PREFERENCE`, or `UNKNOWN`, plus the finite priority and
extraction-status values. The extraction signal is a decimal `0..1`
uncertainty value (`0` means no recorded extraction uncertainty and `1` means
maximum) with a declared basis, not a claim-truth probability. Source anchors
must be deterministic and resolve to captured JD text or an explicit
unavailable state. A missing source anchor blocks readiness.

### 4. Matching is a decision table, not a score

The implementation evaluates requirement dimensions, responsibility/outcome
boundaries, available Evidence completeness, and explicit missing portions.
It applies the fixed taxonomy in the spec: complete support is `DIRECT`, a
transferable but different context is `STRONG_ADJACENT`, a supported subset is
`PARTIAL`, evaluated absence is `NO_MATCH`, and an unsafe/incomplete
evaluation is `INSUFFICIENT_EVIDENCE`. Every non-direct result carries a
deterministic `gap_id`; `NO_MATCH` means complete evaluation found no support,
while `INSUFFICIENT_EVIDENCE` means the evaluation could not safely decide.
Ambiguity takes the least-claim-safe route to `INSUFFICIENT_EVIDENCE`.
Many-to-many Evidence references are allowed, but there is no arbitrary
aggregate score or keyword-only promotion.

### 5. Traceability is stored as per-claim edges

The domain stores source references and immutable IDs on each node, not only on
the final positioning document. Every positioning claim points to at least
one requirement. A supported claim points through `match_id` to fixed
Evidence revisions; a gap-based claim points to `gap_id` and remains an
explicit limitation or unknown. A candidate with a missing edge fails
validation and cannot be confirmed.

### 6. Positioning is a versioned candidate state machine

Positioning versions use `DRAFT`, `CANDIDATE`, `CONFIRMED`, `STALE`, and
`REJECTED`. The main process alone can move a validated candidate to
`CONFIRMED` and the current pointer. JD/Evidence input changes mark affected
analysis, matches/gaps, and positioning versions `STALE` for current use,
without mutating their historical records. Positioning remains a strategy
layer; no downstream document is created by this change.

### 7. One bounded provider-independent execution contract

The request contains `execution_id`, stable `idempotency_key`, finite
`operation_type`, `schema_version`, Opportunity/JD/Evidence snapshot
identities, input generation, `requested_at`, disclosure classification, and
an allowlisted payload. The response echoes operation identity and schema,
declares a finite result status and validation status, and carries structured
payload only when complete and valid. `MALFORMED`, `SCHEMA_INVALID`, and
`PARTIAL` are non-success states; partial/private output is not persisted as a
usable candidate.

The timeout is configurable but positive, finite, and below an application
maximum. Cancellation uses an execution-bound request and finite acknowledgement
grace period. Retry eligibility and a finite maximum-attempt value are part of
the contract; backoff is implementation detail. Retryable provider failures,
unavailability, and timeouts may retry with the same logical idempotency key.
Malformed, schema-invalid, stale, duplicate, and non-retryable failures do
not retry automatically. Terminal duplicate completion is ignored or returns
the existing result. Main-process generation comparison rejects late results.

Provider selection remains a separate implementation gate. Before apply, the
selected existing capability must be recorded with its actual input/output,
privacy, limits, failure, cost, and exit behavior; no dependency or version
change is permitted by this planning change.

### 8. Additive migration and existing backup authority

`FOUNDATION_STORE_VERSION = 1` remains unchanged. Intelligence owns a separate
monotonic `INTELLIGENCE_SCHEMA_VERSION`, beginning at `0` absent and migrating
additively to `1`. The migration and intelligence domain operations belong to
the existing application-owned persistence boundary and single writer.

Migration preconditions, transaction boundaries, schema marker, tables,
constraints, and read-back are validated before M2 readiness. Failure rolls
back or fails closed before publishing the new schema, leaves the valid M1
foundation usable, and never resets/rebinds/downgrades existing data.

The existing `backup-and-restore` capability remains the sole authority. Its
complete-store acceptance for a store containing M2 records must include
intelligence records, immutable provenance references, and supported schema
metadata in the existing manifest/validation/new-root/no-silent-merge flow.
M2 acceptance is blocked until that coverage is demonstrated or the authority
explicitly records the supported M2 scope. No second backup format, writer, or
framework is planned.

### 9. Boundary and privacy remain M1-shaped

The main process owns reads requiring private data, execution authorization,
candidate validation, confirmation, migration, and persistence. Preload adds
only purpose-specific load/start/cancel/review/confirm operations. Renderer and
executor code receive no raw database handle, database path, private-root
path, or direct filesystem write capability. External execution requires
explicit data-scope/party disclosure and excludes unrelated fields by
default; private full text is not written to repository logs.

### 10. Deterministic validation order

Validation starts with synthetic Opportunity/JD and Evidence substrate data,
then exercises identity/provenance, every taxonomy branch, positioning
versioning, malformed/partial/failure lifecycle, stale/duplicate handling,
migration failure, backup coverage, restart/read-back, privacy, renderer
capabilities, and one bounded Opportunity acceptance. The prerequisite gate
must pass first; M2 acceptance cannot use invented or personal data.

## Risks / Trade-offs

- **[M2 planning remains incomplete]** → Keep M2 apply blocked until the remaining planning blockers are repaired and the read-only planning review passes, even though the substrate prerequisite is accepted.
- **[A model changes wording between retries]** → Stable identities use immutable source/input anchors; payload changes create a new result/version or fail validation rather than silently relinking history.
- **[A partial or late response contaminates state]** → Persist only terminal execution metadata for non-success responses; compare generation and idempotency before publication.
- **[M2 records are omitted from backup]** → Keep backup ownership in the existing capability and block M2 acceptance until complete-store coverage is demonstrated.
- **[Detailed contract grows into a provider framework]** → Keep one task-shaped executor and a finite contract; provider selection is a separate gate and no adapter/router is introduced.
- **[Known M1 threat boundary is misunderstood]** → Preserve the approved same-user active path-swap TOCTOU limitation as a known non-goal/future hardening item; this change does not claim to fix it.

## Migration Plan

1. Use the separately accepted and archived `m1-opportunity-evidence-substrate` prerequisite.
2. Record the approved existing executor capability without installing or changing dependencies.
3. Apply the additive intelligence schema migration from foundation version 1; validate transaction, marker, constraints, rollback, and M1 read-back.
4. Implement synthetic input loading, structured execution, deterministic matching, traceability, positioning review/confirmation, and narrow UI boundary in dependency order.
5. Exercise failure, cancellation, timeout, retry, duplicate, stale, privacy, backup-coverage, restart, and repository-isolation acceptance.
6. If migration or validation fails, leave M1 available, report M2 unavailable, and do not publish partial intelligence state.
