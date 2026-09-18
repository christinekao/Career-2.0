## 1. Preconditions and capability gate

- [ ] 1.1 Record and use the accepted archived `m1-opportunity-evidence-substrate` evidence, including Opportunity/JD revision and confirmed Evidence/revision operations, restart/read-back, isolation, and fail-closed behavior; do not start M2 implementation before this planning change passes its remaining gates.
- [ ] 1.2 Record one approved existing executor capability with its finite operation input/output, privacy/disclosure behavior, timeout/limit, failure/retry, cost, and exit behavior; do not install or change a dependency, provider, model, or version.

## 2. Input, identity, and requirement contract

- [ ] 2.1 Define and test canonical serialization and deterministic identities for `analysis_id`, `evidence_snapshot_id`, `requirement_id`, `match_id`, `gap_id`, `positioning_version_id`, and `positioning_claim_id`; prove restart/retry stability and new-generation invalidation without display-text identity.
- [ ] 2.2 Define the immutable input bundle with Opportunity, JD revision, ordered Evidence revisions, operation/schema version, execution identity, idempotency key, generation, timestamp, and disclosure classification.
- [ ] 2.3 Define the requirement schema, finite requirement type/priority vocabulary, source anchor/provenance, explicit/inferred state, extraction status, and structured `EXTRACTION_UNCERTAINTY` signal with finite `0..1` value and declared basis.

## 3. Matching, gaps, and traceability

- [ ] 3.1 Define and implement the fixed `DIRECT`, `STRONG_ADJACENT`, `PARTIAL`, `NO_MATCH`, and `INSUFFICIENT_EVIDENCE` decision table, including evidence requirements, many-to-many relationships, ambiguity fallback, and no keyword/arbitrary-score promotion.
- [ ] 3.2 Persist and validate per-node provenance edges from JD source to requirement to match/gap to fixed Evidence revisions; reject a candidate when any required identity or edge is missing.
- [ ] 3.3 Define positioning claim edges so every claim references at least one requirement, supported claims resolve through match plus Evidence, and gap-based claims remain explicit limitations/unknowns rather than verified facts.
- [ ] 3.4 Implement versioned positioning states (`DRAFT`, `CANDIDATE`, `CONFIRMED`, `STALE`, `REJECTED`), explicit confirmation/current pointer, immutable prior versions, and stale invalidation after JD/Evidence generation changes.

## 4. Provider-independent execution contract

- [ ] 4.1 Implement the finite request/response schema with execution/idempotency identity, operation/schema version, input generation, allowlisted payload, disclosure classification, result status, validation status, structured payload, and safe error classification.
- [ ] 4.2 Define and test `MALFORMED`, `SCHEMA_INVALID`, and `PARTIAL` handling; reject incomplete/private payloads as usable candidates and preserve the last valid state.
- [ ] 4.3 Enforce a positive finite timeout below an application maximum and an execution-bound cancellation request with finite acknowledgement/grace handling; ignore late results after terminal cancellation.
- [ ] 4.4 Define finite retry maximum and eligibility for timeout, unavailable, and explicitly retryable provider failures; prevent automatic retry for malformed, schema-invalid, stale, duplicate, and non-retryable results.
- [ ] 4.5 Enforce idempotent duplicate completion handling and compare Opportunity/JD/Evidence/schema/generation before publication; retain or mark stale results without overwriting newer work or creating duplicate canonical records.

## 5. Persistence, migration, and backup authority

- [ ] 5.1 Add the smallest additive migration from accepted M1 foundation state with `FOUNDATION_STORE_VERSION = 1` unchanged and `INTELLIGENCE_SCHEMA_VERSION` migrating from absent/zero to `1`; preserve foundation identity, root binding, metadata, and rows.
- [ ] 5.2 Make migration transactional and fail closed: validate preconditions, marker, tables, constraints, and read-back before readiness; roll back or leave M2 unavailable on failure without reset, rebind, downgrade, or partial-ready state.
- [ ] 5.3 Add application-owned domain operations for intelligence records without exposing a raw SQLite handle/path or creating a second writer/persistence authority.
- [ ] 5.4 Extend the existing `backup-and-restore` authority's complete-store acceptance to include intelligence records, provenance references, and schema/version metadata in its existing manifest, validation, new-root, and no-silent-merge flow; do not add a second backup format or writer.

## 6. Application boundary and Opportunity experience

- [ ] 6.1 Add only purpose-specific main/preload/IPC operations for loading input/state, starting/cancelling execution, reviewing candidates, and confirming positioning; verify renderer/executor code has no database, private-root, or direct filesystem capability.
- [ ] 6.2 Add Match & Gaps and Positioning views inside the existing Opportunity context with source links, stable IDs, Evidence revision links, uncertainty/status/stale labels, retry, and explicit confirmation controls; do not add CV, Story, Interview, PDF, or a new shell.
- [ ] 6.3 Preserve the accepted Opportunity/Evidence substrate and M1 usability when intelligence is unavailable, offline, cancelled, malformed, or failed; do not add a server, sync layer, background writer, or alternate private-data fallback.

## 7. Deterministic validation and acceptance

- [ ] 7.1 Add isolated synthetic fixtures for every identity/provenance edge, requirement uncertainty/status, all five taxonomy outcomes, many-to-many evidence, ambiguity, missing JD, unsupported claims, versioning, and no automatic Evidence promotion.
- [ ] 7.2 Add a controllable executor test seam covering valid output, malformed/schema-invalid/partial output, timeout, cancellation/late result, unavailable/provider failure, bounded retry, duplicate completion, stale generation, and disclosure scope.
- [ ] 7.3 Validate additive migration success/failure, M1 preservation, domain persistence/restart/read-back, backup/restore coverage, renderer capability absence, private-root isolation, repository/log privacy, and no private data in source-controlled paths.
- [ ] 7.4 Run one bounded real Opportunity vertical-slice acceptance from an accepted selected JD and Evidence substrate through analysis, matching, reviewable positioning, explicit confirmation, restart/read-back, and controlled failure recovery; use synthetic/private-root data only.
- [ ] 7.5 Run scoped final validation and review the complete diff: affected foundation checks, syntax/build, OpenSpec strict validation, privacy/mutation checks, and M2 acceptance; update only affected current-state documents and stop before later M2 slices.
