## Context

The accepted M1 foundation supplies the local Electron shell, configured private root, single canonical writer, and replaceable persistence boundary. The approved `opportunity-workspace` and `career-evidence` specifications remain broader target contracts; the minimum Opportunity/JD and Evidence/revision substrate is implemented and accepted in the archived `m1-opportunity-evidence-substrate` change. That accepted prerequisite supplies the inputs required here; the full product-domain records and workflows are not assumed. Because the prerequisite does not provide a complete Opportunity workspace UI, this change owns only the minimal selection/context surface needed to enter this slice.

This change remains the first M2 intelligence vertical slice: one selected Opportunity, one JD revision, a fixed Evidence snapshot, explainable matching/gaps, and reviewable positioning. It does not implement or assume the rest of the M1 Workspace or the complete M2 MVP.

## Current implementation state

M2 planning is accepted, Batch 1 is accepted, and Batch 2 implementation is
complete for the remaining `3.4, 5.4, 6.1, 6.2, 6.3, 7.1, 7.3, 7.4` tasks in
addition to the accepted dependency-complete execution/service tranche
(`1.2, 4.1, 4.2, 4.3, 4.4, 4.5, 7.2`). The implementation uses the existing
application-owned in-process executor seam and additive intelligence
persistence, extends the sole backup authority, and adds only purpose-specific
preload/renderer operations for the minimal Opportunity context surface. The
executor seam is promise-returning and non-blocking, receives an
execution-bound AbortSignal, and is bounded by the service timeout/grace
policy. Superseded retries, interrupted persisted runs, malformed persisted
candidates, stale positioning, and invalid backup material fail closed without
replacing current results. The renderer repair adds a purpose-specific
begin/cancel boundary, returns the canonical persisted execution identity while
RUNNING, polls the existing execution read operation, and keeps the current
accepted result separate from active execution state through failure and
cancellation. Independent read-only Batch 2 acceptance is pending; M2 remains
`IN_PROGRESS` and later batches have not started.

## Goals / Non-Goals

**Goals:**

- Define stable, deterministic identities and provenance edges from captured JD source through requirements, matches/gaps, Evidence revisions, and positioning claims.
- Define a finite match/gap taxonomy, structured extraction uncertainty, and testable candidate/readiness rules.
- Define one provider-independent bounded execution contract with explicit malformed, partial, timeout, cancellation, retry, duplicate, and stale behavior.
- Add intelligence persistence additively while retaining the M1 foundation version, writer, private-root, and persistence boundaries.
- Preserve the existing backup/restore authority as the only owner of complete-store backup and restore expectations.
- Own a minimal Opportunity selection/context surface that binds one existing Opportunity and JD revision to Match & Gaps and Positioning.

**Non-Goals:**

- Creating the Opportunity/Evidence substrate in this change; that is `m1-opportunity-evidence-substrate`.
- A candidate persona or candidate concerns system; those are future analysis concerns, not outputs or acceptance criteria of this slice.
- A complete Opportunity workspace, general Opportunity CRUD, Opportunity management product, or general navigation redesign. This change owns only the minimal selection/context surface needed for its vertical slice.
- CV generation, cover letter, Story Bank, Interview Pack, cross-artifact review/repair/recheck, PDF, submission, or the full two-JD MVP.
- Selecting or installing a provider, model, CLI, package, renderer, dependency, or version during planning.
- A generic provider adapter, router, agent framework, server, sync layer, background worker, or second writer.
- Reworking M1 ownership, path confinement, persistence identity, renderer security, or the accepted same-user path-swap TOCTOU limitation.

## Decisions

### 1. The prerequisite is a hard implementation gate

`m1-opportunity-evidence-substrate` is implemented, separately accepted, and
archived. Its gate proves stable Opportunity/JD revision and confirmed
Evidence/revision operations, restart/read-back, private-root isolation, and
fail-closed behavior. The planning repair and read-only planning review for
this change are complete; the baseline is accepted, Batch 1 implementation is
complete for its 10 scoped tasks, and the independent read-only Batch 1
acceptance has passed. Batch 1 is accepted; later apply work remains separate
and Batch 2 implementation is complete pending independent acceptance; later
batches have not started in this run.

### 2. M2 owns the minimal Opportunity selection/context surface

The slice provides the smallest entry surface needed to operate on accepted
substrate data. It allows the user to select one existing `opportunity_id`,
shows the selected Opportunity's available identity/display context together
with one selected `jd_revision_id` and its source/provenance metadata, and
provides explicit entry points to Match & Gaps and Positioning for that same
context. The surface uses the accepted substrate domain operations and does
not create a second Opportunity authority.

Selection/context acceptance is bounded: a missing Opportunity or unavailable
JD revision leaves the slice unavailable and prevents analysis; it does not
silently create a record, select a fallback, or imply that the full Opportunity
workspace exists. Synthetic acceptance fixtures may create substrate records
through the accepted domain operation before exercising the surface.

### 3. Stable identity uses immutable inputs, not display text

The substrate owns opaque `opportunity_id`, `jd_revision_id`, `evidence_id`,
and `evidence_revision_id` values. M2 uses the following persisted identities:

- `analysis_id = analysis:{opportunity_id}:{jd_revision_id}:{analysis_generation}`;
- `evidence_snapshot_id` is the digest of the contract version, the ordered
  eligible confirmed `evidence_revision_ids`, and the application-owned
  `input_generation`; retaining the generation prevents a re-evaluation from
  reusing a current relation identity when the current input generation changes;
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

### 4. Requirement and uncertainty shape is structured

Each requirement carries the fields and finite values defined by the
intelligence spec: `RESPONSIBILITY`, `OUTCOME`, `SKILL`, `CONSTRAINT`,
`QUALIFICATION`, `PREFERENCE`, or `UNKNOWN`, plus the finite priority and
extraction-status values. The extraction signal is a decimal `0..1`
uncertainty value (`0` means no recorded extraction uncertainty and `1` means
maximum) with a declared basis, not a claim-truth probability. Source anchors
must be deterministic and resolve to captured JD text or an explicit
unavailable state. A missing source anchor blocks readiness.

### 5. Matching is a decision table, not a score

The implementation evaluates requirement dimensions, responsibility/outcome
boundaries, eligible confirmed Evidence completeness, and explicit missing
portions.
It applies the fixed taxonomy in the spec: complete support is `DIRECT`, a
transferable but different context is `STRONG_ADJACENT`, a supported subset is
`PARTIAL`, evaluated absence is `NO_MATCH`, and an unsafe/incomplete
evaluation is `INSUFFICIENT_EVIDENCE`. Every non-direct result carries a
deterministic `gap_id`; `NO_MATCH` means complete evaluation found no support,
while `INSUFFICIENT_EVIDENCE` means the evaluation could not safely decide.
Ambiguity takes the least-claim-safe route to `INSUFFICIENT_EVIDENCE`.
Many-to-many Evidence references are allowed, but there is no arbitrary
aggregate score or keyword-only promotion. Persisted match rows also retain
the normalized boolean decision facts used by this table; read-back rejects a
classification that cannot be reproduced from those facts and immutable
snapshot inputs.

### 6. Traceability is stored as per-claim edges

The domain stores source references and immutable IDs on each node, not only on
the final positioning document. Every positioning claim points to at least
one requirement. A supported claim points through `match_id` to fixed eligible
confirmed Evidence revisions; a gap-based claim points to `gap_id` and remains an
explicit limitation or unknown. A candidate with a missing edge fails
validation and cannot be confirmed.

### 7. Positioning is a versioned candidate state machine

Positioning versions use `DRAFT`, `CANDIDATE`, `CONFIRMED`, `STALE`, and
`REJECTED`. The main process alone can move a validated candidate to
`CONFIRMED` and the current pointer. JD/Evidence input changes mark affected
analysis, matches/gaps, and positioning versions `STALE` for current use,
without mutating their historical records. Positioning remains a strategy
layer; no downstream document is created by this change.

### 8. One bounded provider-independent execution contract

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

### 9. Additive migration and existing backup authority

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

### 10. Boundary and privacy remain M1-shaped

The main process owns reads requiring private data, execution authorization,
candidate validation, confirmation, migration, and persistence. Preload adds
only purpose-specific load/start/cancel/review/confirm operations. Renderer and
executor code receive no raw database handle, database path, private-root
path, or direct filesystem write capability. External execution requires
explicit data-scope/party disclosure and excludes unrelated fields by
default; private full text is not written to repository logs.

### 11. Deterministic validation order

Validation starts with the M2-owned minimal Opportunity selection/context
surface over synthetic Opportunity/JD and eligible confirmed Evidence substrate
data (plus explicit ineligible/draft fixtures), then
exercises identity/provenance, every taxonomy branch, positioning
versioning, malformed/partial/failure lifecycle, stale/duplicate handling,
migration failure, backup coverage, restart/read-back, privacy, renderer
capabilities, and one bounded Opportunity acceptance. The prerequisite gate
must pass first; M2 acceptance cannot use invented or personal data.

### 12. Only eligible confirmed Evidence revisions enter intelligence

The accepted substrate can hold both draft and confirmed Evidence revisions,
but M2 intelligence input is narrower. Building an `evidence_snapshot_id`
requires resolving every referenced `evidence_revision_id` and verifying that
each revision is `CONFIRMED`, belongs to the expected Evidence identity, has
valid provenance, and is otherwise eligible under the accepted substrate
contract. A revision's existence is not sufficient eligibility.

If a requested revision is draft, unconfirmed, missing, incompatible, or
otherwise ineligible, snapshot creation fails closed. The revision is not sent
to an executor and no match, gap, or positioning candidate is published from
that input. If no eligible confirmed Evidence is available, the bounded
operation reports `UNAVAILABLE`; a matching evaluation that proceeds without
usable Evidence may only produce `INSUFFICIENT_EVIDENCE`, never a supported
match or confirmed claim. A successfully created snapshot retains its exact
confirmed revision identities and generation even when later revisions exist;
later input changes make dependent work stale rather than rewriting history.

### 13. Content and execution state are projected separately

Match & Gaps and Positioning each expose two orthogonal state values. The
content/surface state is one of `SELECTION_REQUIRED`, `LOADING`, `EMPTY`,
`AVAILABLE_CURRENT`, `STALE`, or `FAILED_UNAVAILABLE`. The execution state is
one of `IDLE`, `RUNNING`, `COMPLETED`, `CANCELLED`, `FAILED`, or
`STALE_RESULT_REJECTED`.

The projection is deterministic:

- No selected Opportunity/JD context maps to `SELECTION_REQUIRED` + `IDLE`.
- Loading the selected context maps to `LOADING` + `IDLE`; an execution in
  progress maps to `RUNNING` with the current content state, or `LOADING`
  when no result exists.
- A valid selected context with no result maps to `EMPTY` + `IDLE`.
- A validated result bound to the current JD/Evidence generation maps to
  `AVAILABLE_CURRENT` + `COMPLETED`.
- A changed JD/Evidence generation makes the prior result `STALE` + `IDLE`;
  it remains readable history and is not current.
- A failed or unavailable execution maps to `FAILED_UNAVAILABLE` + `FAILED`
  when no current result exists. If a current result already exists, the
  content remains `AVAILABLE_CURRENT` and the execution state becomes
  `FAILED`.
- Cancellation never replaces an existing current result: it preserves
  `AVAILABLE_CURRENT` + `CANCELLED`, or produces `EMPTY` + `CANCELLED` when
  no prior result exists.
- A late completion from an older generation maps to
  `STALE_RESULT_REJECTED` and cannot overwrite the prior current result. The
  content remains the prior valid state, or `EMPTY` when no prior result exists.

The same mapping applies independently to Match & Gaps and Positioning. Any
taxonomy, lifecycle, content, or execution state outside the declared finite
vocabularies is invalid; it fails closed without coercion or fallback to a
different valid state.

## Risks / Trade-offs

- **[M2 planning accepted; Batch 1 accepted; Batch 2 implementation complete]** → Keep the independent Batch 2 acceptance separate from implementation; later batches remain outside the current change even though the substrate prerequisite and planning gate are satisfied.
- **[A model changes wording between retries]** → Stable identities use immutable source/input anchors; payload changes create a new result/version or fail validation rather than silently relinking history.
- **[A partial or late response contaminates state]** → Persist only terminal execution metadata for non-success responses; compare generation and idempotency before publication.
- **[M2 records are omitted from backup]** → Keep backup ownership in the sole application capability; Batch 2 now validates complete M1/M2 store coverage, provenance references, schema metadata, new-root restore, and no-silent-merge before independent acceptance.
- **[Detailed contract grows into a provider framework]** → Keep one task-shaped executor and a finite contract; provider selection is a separate gate and no adapter/router is introduced.
- **[Known M1 threat boundary is misunderstood]** → Preserve the approved same-user active path-swap TOCTOU limitation as a known non-goal/future hardening item; this change does not claim to fix it.

## Migration Plan

1. Use the separately accepted and archived `m1-opportunity-evidence-substrate` prerequisite.
2. Record the approved existing executor capability without installing or changing dependencies.
3. Apply the additive intelligence schema migration from foundation version 1; validate transaction, marker, constraints, rollback, and M1 read-back.
4. Implement the M2-owned minimal Opportunity selection/context surface, then synthetic input loading, structured execution, deterministic matching, traceability, positioning review/confirmation, and the narrow UI boundary in dependency order.
5. Exercise failure, cancellation, timeout, retry, duplicate, stale, privacy, backup-coverage, restart, and repository-isolation acceptance.
6. If migration or validation fails, leave M1 available, report M2 unavailable, and do not publish partial intelligence state.
