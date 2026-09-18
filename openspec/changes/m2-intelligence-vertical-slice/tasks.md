## 1. Preconditions and capability gate

- [x] 1.1 Record and use the accepted archived `m1-opportunity-evidence-substrate` evidence, including Opportunity/JD revision and confirmed Evidence/revision operations, restart/read-back, isolation, and fail-closed behavior; use this as the implementation precondition after the accepted planning baseline, without treating planning close-out as implementation progress.
- [ ] 1.2 Record one approved existing executor capability with its finite operation input/output, privacy/disclosure behavior, timeout/limit, failure/retry, cost, and exit behavior; do not install or change a dependency, provider, model, or version.

## 2. Input, identity, and requirement contract

- [x] 2.1 Define and test canonical serialization and deterministic identities for `analysis_id`, `evidence_snapshot_id`, `requirement_id`, `match_id`, `gap_id`, `positioning_version_id`, and `positioning_claim_id`; prove restart/retry stability and new-generation invalidation without display-text identity.
- [x] 2.2 Define and test the immutable input bundle with Opportunity, JD revision, ordered eligible `CONFIRMED` Evidence revisions, operation/schema version, execution identity, idempotency key, generation, timestamp, and disclosure classification; reject draft, unconfirmed, missing, incompatible, or otherwise ineligible Evidence before provider input is built.
- [x] 2.3 Define the requirement schema, finite requirement type/priority vocabulary, source anchor/provenance, explicit/inferred state, extraction status, and structured `EXTRACTION_UNCERTAINTY` signal with finite `0..1` value and declared basis.

## 3. Matching, gaps, and traceability

- [x] 3.1 Define and implement the fixed `DIRECT`, `STRONG_ADJACENT`, `PARTIAL`, `NO_MATCH`, and `INSUFFICIENT_EVIDENCE` decision table, including evidence requirements, many-to-many relationships, ambiguity fallback, and no keyword/arbitrary-score promotion.
- [x] 3.2 Persist and validate per-node provenance edges from JD source to requirement to match/gap to fixed eligible `CONFIRMED` Evidence revisions; reject a candidate when any required identity, eligibility check, or edge is missing, and preserve the exact snapshot generation for later stale detection.
- [x] 3.3 Define positioning claim edges so every claim references at least one requirement, supported claims resolve through match plus Evidence, and gap-based claims remain explicit limitations/unknowns rather than verified facts.
- [ ] 3.4 Implement versioned positioning states (`DRAFT`, `CANDIDATE`, `CONFIRMED`, `STALE`, `REJECTED`), explicit confirmation/current pointer, immutable prior versions, stale invalidation after JD/Evidence generation changes, and fail-closed rejection of unknown lifecycle states.

## 4. Provider-independent execution contract

- [ ] 4.1 Implement the finite request/response schema with execution/idempotency identity, operation/schema version, input generation, allowlisted payload, disclosure classification, result status, validation status, structured payload, and safe error classification.
- [ ] 4.2 Define and test `MALFORMED`, `SCHEMA_INVALID`, and `PARTIAL` handling; reject incomplete/private payloads as usable candidates and preserve the last valid state.
- [ ] 4.3 Enforce a positive finite timeout below an application maximum and an execution-bound cancellation request with finite acknowledgement/grace handling; ignore late results after terminal cancellation.
- [ ] 4.4 Define finite retry maximum and eligibility for timeout, unavailable, and explicitly retryable provider failures; prevent automatic retry for malformed, schema-invalid, stale, duplicate, and non-retryable results.
- [ ] 4.5 Enforce idempotent duplicate completion handling and compare Opportunity/JD/Evidence/schema/generation before publication; retain or mark stale results without overwriting newer work or creating duplicate canonical records.

## 5. Persistence, migration, and backup authority

- [x] 5.1 Add the smallest additive migration from accepted M1 foundation state with `FOUNDATION_STORE_VERSION = 1` unchanged and `INTELLIGENCE_SCHEMA_VERSION` migrating from absent/zero to `1`; preserve foundation identity, root binding, metadata, and rows.
- [x] 5.2 Make migration transactional and fail closed: validate preconditions, marker, tables, constraints, and read-back before readiness; roll back or leave M2 unavailable on failure without reset, rebind, downgrade, or partial-ready state.
- [x] 5.3 Add application-owned domain operations for intelligence records without exposing a raw SQLite handle/path or creating a second writer/persistence authority.
- [ ] 5.4 Extend the existing `backup-and-restore` authority's complete-store acceptance to include intelligence records, provenance references, and schema/version metadata in its existing manifest, validation, new-root, and no-silent-merge flow; do not add a second backup format or writer.

## 6. Application boundary and Opportunity experience

- [ ] 6.1 Add only purpose-specific main/preload/IPC operations for loading input/state, starting/cancelling execution, reviewing candidates, and confirming positioning; verify renderer/executor code has no database, private-root, or direct filesystem capability.
- [ ] 6.2 Own and add the minimal Opportunity selection/context surface for this slice: select one existing substrate Opportunity, select an available JD revision, show the required Opportunity/JD identity and source context, and enter Match & Gaps or Positioning with source links, stable IDs, eligible confirmed Evidence revision links, uncertainty/status/stale labels, retry, and explicit confirmation controls. Project orthogonal content/surface state (`SELECTION_REQUIRED`, `LOADING`, `EMPTY`, `AVAILABLE_CURRENT`, `STALE`, `FAILED_UNAVAILABLE`) and execution state (`IDLE`, `RUNNING`, `COMPLETED`, `CANCELLED`, `FAILED`, `STALE_RESULT_REJECTED`) deterministically for both surfaces, including unknown-state rejection; do not add a full Opportunity workspace, general CRUD, Opportunity management, general navigation redesign, candidate persona/concerns system, CV, Story, Interview, PDF, or a new shell.
- [ ] 6.3 Preserve the accepted Opportunity/Evidence substrate and M1 usability when intelligence is unavailable, offline, cancelled, malformed, or failed: cancellation, failure, and stale-result rejection preserve any prior current result; input changes mark old results stale; `EMPTY` remains distinct from unavailable; do not add a server, sync layer, background writer, or alternate private-data fallback.

## 7. Deterministic validation and acceptance

- [ ] 7.1 Add isolated synthetic fixtures for every identity/provenance edge, requirement uncertainty/status, all five taxonomy outcomes, many-to-many evidence, ambiguity, missing JD, unsupported claims, versioning, and no automatic Evidence promotion; include a confirmed-Evidence positive fixture, draft/unconfirmed rejection, no-confirmed/unavailable behavior, end-to-end confirmed traceability, and unknown taxonomy/lifecycle states that fail closed.
- [ ] 7.2 Add a controllable executor test seam covering valid output, malformed/schema-invalid/partial output, timeout, cancellation/late result, unavailable/provider failure, bounded retry, duplicate completion, stale generation, disclosure scope, unknown execution status, unknown content/execution UI states, and deterministic content/execution UI-state projections for both surfaces.
- [ ] 7.3 Validate additive migration success/failure, M1 preservation, domain persistence/restart/read-back, backup/restore coverage, renderer capability absence, private-root isolation, repository/log privacy, no private data in source-controlled paths, confirmed Evidence snapshot eligibility, and rejection of ineligible revisions before executor input.
- [ ] 7.4 Run one bounded real Opportunity vertical-slice acceptance from the M2-owned selection/context surface through an accepted selected JD and confirmed Evidence substrate, analysis, matching, reviewable positioning, explicit confirmation, restart/read-back, and controlled failure recovery; verify missing-selection/unavailable handling, current-result preservation on cancellation/failure, stale-result rejection, and use synthetic/private-root data only.
- [ ] 7.5 Run scoped final validation and review the complete diff: affected foundation checks, syntax/build, OpenSpec strict validation, privacy/mutation checks, and M2 acceptance; update only affected current-state documents and stop before later M2 slices.
