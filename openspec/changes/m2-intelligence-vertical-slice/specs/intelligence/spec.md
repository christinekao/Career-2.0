## Purpose

This capability turns one selected Opportunity and job-description revision into a versioned, evidence-linked analysis and positioning workflow. It makes every material output inspectable, bounded, uncertain when appropriate, and safe to retain as a candidate without changing canonical Career Evidence.

## ADDED Requirements

### Requirement: The slice provides a minimal Opportunity selection and context surface

The application SHALL provide the M2 intelligence slice with a minimal entry
surface that lets the user select one existing Opportunity from the accepted
Opportunity substrate, select one available JD revision for that Opportunity,
and view the required Opportunity/JD identity, display context, and
source/provenance metadata. From that selected context, the surface SHALL
provide explicit entry points to Match & Gaps and Positioning using the same
`opportunity_id` and `jd_revision_id`. This requirement does not create a full
Opportunity workspace, general Opportunity CRUD, an Opportunity management
product, or a general navigation redesign; candidate persona and candidate
concerns are not outputs of this capability.

If no Opportunity is selected or its JD revision is unavailable, the surface
SHALL show an unavailable/selection-required state and SHALL NOT silently
create a record, choose a fallback, or start intelligence execution. Synthetic
acceptance fixtures MAY create the required substrate records through the
accepted domain operations before exercising this surface.

#### Scenario: An existing Opportunity and JD revision are selected

- **WHEN** the user selects an existing Opportunity and an available JD revision
- **THEN** the application shows the required context and exposes Match & Gaps and Positioning entry points bound to the same stable identities

#### Scenario: The selected context is incomplete

- **WHEN** no Opportunity is selected or the selected Opportunity has no available JD revision
- **THEN** the surface reports selection-required/unavailable, does not start analysis, and does not create or silently substitute a domain record

#### Scenario: The user enters an intelligence view

- **WHEN** the user opens Match & Gaps or Positioning from the selected context
- **THEN** the view receives the selected Opportunity/JD context and its provenance metadata through the purpose-specific application boundary, without implying that a full Opportunity workspace exists

### Requirement: Intelligence input Evidence is eligible and confirmed

The system SHALL build an Evidence snapshot only from revisions that resolve to the expected Evidence identity, are `CONFIRMED`, have valid provenance, and satisfy the accepted substrate's eligibility rules. The existence of an Evidence revision SHALL NOT make it eligible for intelligence. A draft, unconfirmed, missing, incompatible, or otherwise ineligible revision SHALL fail closed before provider input is constructed; it SHALL not produce a supported match, gap, positioning candidate, or confirmed claim. When no eligible confirmed Evidence is available, the bounded operation SHALL report `UNAVAILABLE`; a matching view that has no usable Evidence MAY expose only `INSUFFICIENT_EVIDENCE` and SHALL not infer a capability gap.

The snapshot SHALL retain the exact ordered confirmed `evidence_revision_ids` and its input generation. Later Evidence revisions SHALL create a newer generation and mark dependent results stale without rewriting the earlier snapshot or its provenance.

#### Scenario: A confirmed Evidence snapshot is accepted

- **WHEN** every selected Evidence revision is `CONFIRMED`, belongs to the expected Evidence identity, has valid provenance, and is eligible
- **THEN** the application creates the immutable snapshot, sends only those revisions in an authorized request, and preserves their identities for matching and positioning traceability

#### Scenario: A draft or unconfirmed revision is rejected

- **WHEN** any selected Evidence revision is draft, unconfirmed, or otherwise ineligible
- **THEN** snapshot creation fails closed, no ineligible content is sent to an executor, and no supported match, gap, positioning candidate, or confirmed claim is published

#### Scenario: Confirmed Evidence is missing or unavailable

- **WHEN** no eligible confirmed Evidence revision can be resolved for the selected input
- **THEN** the bounded operation reports `UNAVAILABLE`, or a matching view reports only `INSUFFICIENT_EVIDENCE` without treating the absence as a capability conclusion

### Requirement: Intelligence input generations are explicit and available

The system SHALL run each intelligence operation against exactly one accepted Opportunity, one immutable job-description revision, and one immutable snapshot of eligible `CONFIRMED` Evidence revisions. The input set SHALL retain `opportunity_id`, `jd_revision_id`, `evidence_snapshot_id`, the ordered `evidence_revision_ids`, `operation_type`, `schema_version`, `execution_id`, `idempotency_key`, and an application-owned input generation. The operation SHALL be blocked as `UNAVAILABLE` when the named `m1-opportunity-evidence-substrate` prerequisite is not accepted, the selected JD revision is unavailable, or no eligible confirmed Evidence snapshot can be created.

#### Scenario: A valid selected input set starts an operation

- **WHEN** the user starts a supported operation for an accepted Opportunity, available JD revision, and immutable snapshot of eligible confirmed Evidence
- **THEN** the application stores the immutable input identities and generation before publishing a candidate result

#### Scenario: The product-domain substrate is not accepted

- **WHEN** M2 is invoked before `m1-opportunity-evidence-substrate` has its own accepted implementation evidence
- **THEN** the operation remains `UNAVAILABLE`, does not invent or substitute Opportunity/JD/Evidence records, and does not write an intelligence candidate

#### Scenario: A newer source revision exists

- **WHEN** a newer JD revision or Evidence revision changes the current input generation after an operation starts
- **THEN** completion from the older generation is marked `STALE` or discarded and cannot become current

### Requirement: Requirements have stable source-bound identity and structured uncertainty

Each extracted requirement SHALL contain at least `requirement_id`, `jd_revision_id`, a `source_ref` with a deterministic locator or source anchor, `normalized_content`, `requirement_type`, `priority`, `explicitness`, `uncertainty`, and `extraction_status`. `requirement_type` SHALL be one of `RESPONSIBILITY`, `OUTCOME`, `SKILL`, `CONSTRAINT`, `QUALIFICATION`, `PREFERENCE`, or `UNKNOWN`; `priority` SHALL be one of `HIGH`, `MEDIUM`, `LOW`, or `UNKNOWN`; `explicitness` SHALL be `EXPLICIT` or `INFERRED`; and `extraction_status` SHALL be `EXTRACTED`, `INFERRED`, `UNAVAILABLE`, or `REJECTED`.

`uncertainty` SHALL be structured as `{ signal_type, value, basis }`, where `signal_type` is `EXTRACTION_UNCERTAINTY`, `value` is a finite decimal in the inclusive range `0..1` (`0` means no recorded extraction uncertainty and `1` means maximum extraction uncertainty), and `basis` is `RULE`, `MODEL`, or `USER_REVIEW`. The value is a bounded extraction/normalization uncertainty signal, not a probability that the user possesses the capability and not a substitute for provenance. Free-text confidence SHALL NOT replace these fields.

`requirement_id` SHALL be deterministic for the same `jd_revision_id`, contract/schema version, source anchor, normalized requirement content, and requirement type. It SHALL not be derived from display text alone, and the same JD revision SHALL produce the same identity when the same validated input is processed again.

#### Scenario: The same JD revision is processed twice

- **WHEN** the same JD revision and validated requirement content are processed with the same contract version
- **THEN** the requirement receives the same `requirement_id` and source provenance rather than a duplicate identity caused by process restart or retry

#### Scenario: An inferred requirement is returned

- **WHEN** analysis derives a requirement that is not explicitly stated in the captured JD text
- **THEN** it is marked `INFERRED`, includes its source anchor and structured uncertainty, and is not presented as an explicit employer requirement

#### Scenario: Requirement extraction cannot be supported

- **WHEN** source text or a stable source anchor is unavailable, or the structure cannot be validated
- **THEN** the requirement is `UNAVAILABLE` or `REJECTED`, no unsupported requirement is promoted, and the analysis is not ready

### Requirement: Matching and gaps use a deterministic evidence taxonomy

The system SHALL evaluate each selected high-priority requirement against zero or more eligible fixed `CONFIRMED` Evidence revisions and SHALL persist one stable relation identity for the requirement and Evidence snapshot. `match_id` SHALL be deterministic for the matching contract version, `jd_revision_id`, `requirement_id`, and `evidence_snapshot_id`; every non-`DIRECT` classification SHALL also carry a deterministic `gap_id` for the same input identity and its gap contract marker. One requirement MAY reference multiple Evidence revisions, and one Evidence revision MAY support multiple requirements.

The final classification SHALL follow this decision table, without a keyword-only rule or arbitrary total score:

| Classification | Required condition | Evidence references | Required explanation |
| --- | --- | --- | --- |
| `DIRECT` | All material requirement dimensions, responsibility boundaries, and stated outcomes are supported by one or more eligible fixed `CONFIRMED` Evidence revisions with no unresolved material limitation | One or more | What supports the complete requirement and its scope |
| `STRONG_ADJACENT` | No eligible Evidence revision establishes the requirement directly, but one or more eligible fixed `CONFIRMED` revisions establish materially transferable behavior in a different context, domain, or scope | One or more | Transferable relation and boundary that prevents direct support |
| `PARTIAL` | A non-empty subset of the same requirement is supported, while one or more material dimensions, outcomes, or scope limits remain unsupported | One or more | Supported subset and missing dimensions |
| `NO_MATCH` | The available Evidence snapshot is complete for evaluation and no supported direct, adjacent, or partial relation is found | Zero or more | Evaluation basis and explicit absence of a supported relation |
| `INSUFFICIENT_EVIDENCE` | The Evidence snapshot is unavailable/incomplete, the requirement source is materially ambiguous, or the available records cannot safely determine a relation | Zero or more | Missing source/evidence or ambiguity; no capability conclusion |

When multiple possible classifications conflict, the application SHALL choose the least-claim-safe classification justified by the table; unresolved ambiguity SHALL be `INSUFFICIENT_EVIDENCE`. `NO_MATCH` SHALL mean evaluated absence of support, while `INSUFFICIENT_EVIDENCE` SHALL mean that a safe evaluation was not possible. `DIRECT` SHALL never be selected solely from shared keywords or a score. `STRONG_ADJACENT`, `PARTIAL`, `NO_MATCH`, and `INSUFFICIENT_EVIDENCE` SHALL expose their `gap_id` and limitation/missing-support explanation; `DIRECT` need not create a gap. A classification outside the five declared values SHALL be invalid and SHALL fail closed without coercion.

#### Scenario: Complete responsibility and outcome support exists

- **WHEN** fixed Evidence revisions cover every material responsibility and outcome boundary of a requirement
- **THEN** the system records `DIRECT` with the relevant `evidence_revision_ids`, `match_id`, and explanation

#### Scenario: Evidence covers only part or an adjacent context

- **WHEN** Evidence supports only some material dimensions or supports transferable behavior in a different context
- **THEN** the system records `PARTIAL` or `STRONG_ADJACENT` according to the decision table and records the missing or limiting boundary

#### Scenario: No supported relation is found

- **WHEN** the complete selected Evidence snapshot is evaluated and no relation is supported
- **THEN** the system records `NO_MATCH` with a `gap_id` and does not imply that the user lacks the capability

#### Scenario: Safe evaluation is impossible

- **WHEN** the source or Evidence is incomplete or materially ambiguous
- **THEN** the system records `INSUFFICIENT_EVIDENCE` with the reason and does not convert missing information into a capability gap

#### Scenario: An unknown taxonomy value is returned

- **WHEN** a matching result contains a classification outside `DIRECT`, `STRONG_ADJACENT`, `PARTIAL`, `NO_MATCH`, or `INSUFFICIENT_EVIDENCE`
- **THEN** the result fails validation, is not persisted as usable intelligence, and cannot become a current or confirmed output

### Requirement: Every material output has end-to-end traceability

The system SHALL preserve the following navigable provenance chain for every material intelligence output:

`jd_source_ref → jd_revision_id → requirement_id → match_id or gap_id → evidence_revision_id(s) when present → positioning_claim_id → positioning_version_id`.

Each `positioning_claim_id` SHALL reference at least one `requirement_id`. A claim supported by a match SHALL reference at least one `match_id` and the fixed eligible `CONFIRMED` Evidence revisions used by that match. A claim about a gap SHALL reference a `gap_id` and SHALL be framed as a limitation, unknown, or follow-up need; it SHALL NOT be represented as a verified career fact. A whole-document provenance pointer without per-claim edges is insufficient.

#### Scenario: A supported positioning claim is reviewed

- **WHEN** the user opens a positioning claim supported by Evidence
- **THEN** the application can resolve the claim to its `positioning_version_id`, `requirement_id`, `match_id`, JD source location, and fixed Evidence revision identities

#### Scenario: A gap informs positioning

- **WHEN** a positioning claim uses an identified gap or insufficient evidence
- **THEN** the claim resolves to the `gap_id`, preserves the uncertainty/limitation, and is not displayed as an established user experience

#### Scenario: A provenance edge is missing

- **WHEN** a candidate claim cannot resolve to a requirement and its match/gap source
- **THEN** the candidate fails validation and cannot become ready or confirmed

### Requirement: Positioning is versioned, reviewable, and explicitly confirmed

Each positioning candidate SHALL contain `positioning_version_id`, `opportunity_id`, `jd_revision_id`, `analysis_id`, `evidence_snapshot_id`, an explicit state, and one or more claims with `positioning_claim_id` and the required provenance edges to eligible confirmed Evidence where support is claimed. Candidate states SHALL be `DRAFT`, `CANDIDATE`, `CONFIRMED`, `STALE`, or `REJECTED`; only an explicit user confirmation may make a version `CONFIRMED` and current. A new candidate or factual-support change SHALL create a new version and preserve prior versions. A positioning lifecycle state outside this finite vocabulary SHALL fail validation and SHALL not be coerced into a valid state.

When its JD or Evidence input generation is no longer current, a positioning version SHALL become `STALE` for current use while remaining readable as history. A stale version SHALL not become the current version for a newer input. Positioning SHALL remain a strategy candidate and SHALL not be a CV, cover letter, Story Bank, Interview Pack, or submission artifact.

#### Scenario: A supported candidate is confirmed

- **WHEN** the user explicitly confirms a validated positioning candidate whose claims satisfy the traceability and uncertainty rules
- **THEN** the application stores that `positioning_version_id` as the current confirmed version and preserves all input identities

#### Scenario: A candidate contains an unsupported claim

- **WHEN** a candidate claim lacks the required requirement/match/gap edge or treats uncertainty as confirmed fact
- **THEN** the candidate is `REJECTED` or remains `CANDIDATE` for correction and cannot become `CONFIRMED`

#### Scenario: A JD revision changes

- **WHEN** a newer JD revision is selected for the same Opportunity
- **THEN** linked analysis, matches/gaps, and positioning candidates are marked `STALE` for current use; historical versions remain readable and no Evidence revision is silently changed

#### Scenario: An unknown positioning state is returned

- **WHEN** a positioning candidate contains a lifecycle state outside `DRAFT`, `CANDIDATE`, `CONFIRMED`, `STALE`, or `REJECTED`
- **THEN** the candidate fails validation, is not published as current, and is not silently mapped to another state

### Requirement: Match & Gaps and Positioning expose deterministic orthogonal UI state

Match & Gaps and Positioning SHALL each expose a content/surface state and an independent execution state. Content/surface state SHALL be one of `SELECTION_REQUIRED`, `LOADING`, `EMPTY`, `AVAILABLE_CURRENT`, `STALE`, or `FAILED_UNAVAILABLE`. Execution state SHALL be one of `IDLE`, `RUNNING`, `COMPLETED`, `CANCELLED`, `FAILED`, or `STALE_RESULT_REJECTED`. The two values SHALL not be collapsed into one status or inferred from display text.

The mapping SHALL be deterministic: no selected context is `SELECTION_REQUIRED` + `IDLE`; selected-context loading maps to `LOADING` + `IDLE`, while an active operation maps to `RUNNING` with the current content state (or `LOADING` when no result exists); a valid context with no result maps to `EMPTY` + `IDLE`; a validated result for the current generation maps to `AVAILABLE_CURRENT` + `COMPLETED`; changed JD/Evidence input makes an old result `STALE` + `IDLE`; failure or unavailable with no current result maps to `FAILED_UNAVAILABLE` + `FAILED`; failure with a current result preserves `AVAILABLE_CURRENT` + `FAILED`; cancellation preserves the current result as `AVAILABLE_CURRENT` + `CANCELLED` or remains `EMPTY` + `CANCELLED`; a late older-generation result maps to `STALE_RESULT_REJECTED` and cannot overwrite the prior current result. `EMPTY` SHALL remain distinct from `FAILED_UNAVAILABLE`.

Any content or execution state outside the declared vocabularies SHALL fail closed without coercion. Cancellation, failure, and stale-result rejection SHALL preserve the prior current result; an input generation change SHALL mark that result stale while retaining it as history.

#### Scenario: A selected context has no result

- **WHEN** a valid Opportunity/JD context is selected and no validated intelligence result exists
- **THEN** both surfaces project `EMPTY` + `IDLE` and do not represent the empty state as unavailable

#### Scenario: A current result is displayed

- **WHEN** a validated result matches the selected JD/Evidence input generation
- **THEN** the corresponding surface projects `AVAILABLE_CURRENT` + `COMPLETED`

#### Scenario: Failure or cancellation occurs with prior work

- **WHEN** an execution fails or is cancelled after a current result exists
- **THEN** the prior result remains visible as current while execution projects `FAILED` or `CANCELLED`, and no partial result replaces it

#### Scenario: A late stale result arrives

- **WHEN** a result from an older input generation arrives after a newer context or result is current
- **THEN** execution projects `STALE_RESULT_REJECTED`, the older result cannot overwrite current content, and the prior valid content or empty state is preserved

#### Scenario: An unknown UI state is returned

- **WHEN** either surface receives a content or execution state outside its declared finite vocabulary
- **THEN** the state fails closed and is not coerced to a different visible state

### Requirement: Execution uses a provider-independent structured contract

Each bounded execution request SHALL contain `execution_id`, stable `idempotency_key`, `operation_type`, `schema_version`, `opportunity_id`, `jd_revision_id`, `evidence_snapshot_id`, ordered `evidence_revision_ids`, input generation, `requested_at`, `disclosure_classification`, and an allowlisted payload containing only the selected JD and relevant Evidence material. Supported `operation_type` values SHALL be explicitly finite for this slice, such as `ANALYZE_REQUIREMENTS`, `CLASSIFY_MATCHES`, or `DRAFT_POSITIONING`; a general-purpose prompt/router contract is not implied.

Each executor response SHALL contain `execution_id`, `idempotency_key`, `schema_version`, `result_status`, `validation_status`, a structured payload only when valid and complete, and a safe error object when unsuccessful. `result_status` SHALL distinguish `SUCCEEDED`, `FAILED`, `CANCELLED`, `TIMED_OUT`, `UNAVAILABLE`, `PROVIDER_FAILURE`, `MALFORMED`, `SCHEMA_INVALID`, `PARTIAL`, `STALE`, and `DUPLICATE`; `validation_status` SHALL be `VALID`, `INVALID`, or `NOT_RUN`; error data SHALL include a finite classification and `retryable` flag without private full text by default. An unknown result or validation status SHALL fail closed, SHALL not be coerced, and SHALL not publish a candidate or overwrite a current result.

#### Scenario: An executor receives a request

- **WHEN** the user authorizes a supported operation
- **THEN** the executor receives only the allowlisted input bundle, the operation/schema identities, and the required disclosure classification, with no database handle, private-root path, unrelated private fields, or canonical-write capability

#### Scenario: A valid structured response returns

- **WHEN** the response matches the declared schema, input identities, provenance rules, and completeness requirements
- **THEN** the application records a validated candidate bound to the same `execution_id` and input generation

#### Scenario: A response is malformed or schema-invalid

- **WHEN** the response cannot be parsed or fails required structure/provenance validation
- **THEN** the application records `MALFORMED` or `SCHEMA_INVALID` with safe validation evidence, stores no candidate payload as usable intelligence, and leaves the prior valid state unchanged

#### Scenario: An executor returns an unknown status

- **WHEN** a response contains a result or validation status outside the declared finite vocabularies
- **THEN** the response is rejected as invalid, no candidate is published, and the prior valid state remains unchanged

### Requirement: Execution is bounded, cancellable, idempotent, and stale-safe

The application SHALL enforce a positive, finite, configurable execution timeout that is no greater than an application-defined maximum; a fake executor acceptance test SHALL prove return within that bound. Cancellation SHALL send a cancellation request tied to the `execution_id`, record whether acknowledgement was received within a finite cancellation grace period, and reject any result that arrives after cancellation has become terminal.

Retries SHALL be finite and use the same logical `idempotency_key`. Only `TIMED_OUT`, `UNAVAILABLE`, and explicitly retryable provider failures MAY be retried automatically or through an explicit retry action; malformed, schema-invalid, stale, duplicate, and non-retryable failures SHALL not be retried automatically. Backoff is an implementation detail, but the finite maximum-attempt value and retry eligibility are contract behavior. A duplicate completion for a terminal `execution_id` or an already completed `idempotency_key` SHALL return or retain the existing result without duplicate canonical records.

Before publishing any candidate, the main process SHALL compare the completion's Opportunity, JD, Evidence snapshot, contract/schema, and input generation with the current state. A mismatch SHALL become `STALE` or be discarded. Partial output SHALL be represented as `PARTIAL` execution evidence only; its private or incomplete payload SHALL not be saved as a usable candidate or canonical record.

#### Scenario: A task times out

- **WHEN** a controllable executor exceeds the configured bounded timeout
- **THEN** the application records `TIMED_OUT`, preserves prior work, does not publish partial output, and offers only the bounded retry behavior allowed by the contract

#### Scenario: A user cancels a task

- **WHEN** cancellation is requested for a running execution
- **THEN** the application records `CANCELLED` after the bounded acknowledgement/grace handling, and ignores any late completion for canonical publication

#### Scenario: A retryable provider failure is retried

- **WHEN** an execution returns a retryable provider failure and the finite attempt limit has not been reached
- **THEN** the retry reuses the logical `idempotency_key`, creates no duplicate canonical records, and stops after the declared maximum attempts

#### Scenario: A stale or duplicate completion arrives

- **WHEN** a completion belongs to an older input generation or a terminal execution already has a result
- **THEN** the application records `STALE` or `DUPLICATE` handling and does not overwrite newer work or create a second current result

### Requirement: Intelligence persistence is additive and uses the existing backup authority

The application SHALL retain `FOUNDATION_STORE_VERSION = 1` as the M1 foundation contract and SHALL own a separate monotonic `INTELLIGENCE_SCHEMA_VERSION`, initially migrating from absent/zero to version `1`. The migration SHALL be additive, application-owned, executed by the single canonical writer, and transactional for the intelligence records. It SHALL preserve existing foundation identity, root binding, metadata, and rows; it SHALL never reset, silently rebind, downgrade, or destructively rewrite a valid M1 store.

The intelligence schema SHALL persist input generations, requirements, matches/gaps, execution statuses, validation/error metadata, and positioning versions only through domain operations. The new schema is not ready until its migration marker and required tables/constraints are valid. If migration or validation fails, the transaction SHALL roll back or fail closed before M2 readiness is published; the existing M1 foundation SHALL remain usable and M2 SHALL be reported unavailable. Unsupported future intelligence versions SHALL fail closed without destructive action.

The existing `backup-and-restore` capability SHALL remain the sole backup/restore authority. When that authority is implemented for a store containing M2 records, a complete bundle SHALL include the intelligence records, immutable input/provenance references, and supported schema/version metadata; a restore SHALL validate them before success and shall use the existing new-root/no-silent-merge policy. M2 acceptance SHALL remain blocked until this complete-store coverage is demonstrated or the accepted backup authority explicitly records the supported M2 scope. This change creates no second backup format or backup writer.

#### Scenario: A fresh M1 store receives the additive migration

- **WHEN** the accepted M1 foundation is opened and the intelligence schema is absent
- **THEN** the application applies the version `1` additive migration, preserves foundation metadata/rows, and publishes M2 persistence ready only after validation succeeds

#### Scenario: Migration fails

- **WHEN** a migration precondition, transaction, table/constraint validation, or version check fails
- **THEN** no partial intelligence schema is reported ready, existing valid M1 state remains usable, and no reset/rebind/destructive rewrite occurs

#### Scenario: A complete backup includes intelligence state

- **WHEN** the existing backup authority captures a complete store containing validated intelligence records
- **THEN** the bundle manifest includes those records and their provenance/version identities, and restore validates them before reporting success

### Requirement: Intelligence preserves local privacy and the application boundary

The system SHALL keep canonical reads, confirmations, migrations, and persistence under the one local application writer and the configured private root. The renderer SHALL receive only purpose-specific intelligence snapshots and commands through preload/IPC and SHALL have no database, private-filesystem, raw handle, or private-root-path capability. External execution SHALL require explicit disclosure of the selected data scope and execution party, exclude unrelated private fields by default, and avoid private full-text logging.

When execution is unavailable or offline, the local Opportunity, JD revisions, and Career Evidence substrate SHALL remain usable and intelligence SHALL be visibly `UNAVAILABLE` or `FAILED`; no silent network, cloud, repository, browser-storage, or alternate-writer fallback is permitted. Repository builds, tests, and logs SHALL contain no private intelligence payloads, credentials, or personal career data.

#### Scenario: The renderer opens an intelligence view

- **WHEN** the user opens Match & Gaps or Positioning for an Opportunity
- **THEN** the renderer receives a purpose-specific snapshot with IDs, statuses, provenance links, and commands only through preload/IPC, without direct database or filesystem capability

#### Scenario: External execution is authorized

- **WHEN** a user chooses an execution path that may leave the machine
- **THEN** the application shows the data scope and execution party before sending the allowlisted payload and records the disclosure classification with the execution

#### Scenario: Execution is unavailable offline

- **WHEN** the executor cannot be invoked or network access is unavailable
- **THEN** the existing local substrate remains readable, intelligence is visibly unavailable/failed, no fallback writer is used, and no private payload is written to the repository
