## Why

M1 now provides the accepted local foundation and the canonical Career Evidence / Opportunity target contracts. The minimum Opportunity/JD and Evidence/revision substrate is implemented and separately accepted in the archived `m1-opportunity-evidence-substrate` change; the full product-domain workflows are not implemented. This change defines the smallest user-visible M2 intelligence slice, with planning acceptance and baseline close-out complete while implementation remains not started, so one selected job description can become a defensible, evidence-linked direction without weakening M1's truth, privacy, or ownership rules.

## What Changes

- Add one bounded intelligence workflow for a selected Opportunity and one selected job-description revision.
- Use the separately accepted `m1-opportunity-evidence-substrate` prerequisite before implementation; its minimum substrate is available, and this change does not assume the full Opportunity or Evidence workflows exist.
- Extract and persist stable, source-bound requirement identities and priorities with structured confidence/uncertainty and explicit-vs-inferred labels; candidate persona and concerns are not deliverables of this slice.
- Match high-priority requirements only to eligible `CONFIRMED` Career Evidence revisions using a deterministic taxonomy and stable match/gap identities, with end-to-end provenance.
- Produce a versioned positioning candidate with stable claim identities, requirement/match/gap edges, supporting confirmed Evidence, trade-offs, claims that must not be made, and an explicit user confirmation step.
- Define deterministic orthogonal content/surface and execution state projections for both Match & Gaps and Positioning, including current, empty, stale, unavailable, cancelled, failed, and stale-result-rejected behavior.
- Define a provider-independent bounded execution contract for structured requests/responses, malformed or partial output, timeout, cancellation, retry, duplicate completion, provider failure, and stale input.
- Persist only validated candidates and execution state through additive, versioned domain operations; migration failure must leave the M1 foundation usable.
- Keep the existing backup/restore capability as the sole authority for future intelligence records; no second backup format or implementation is introduced here.
- Own the smallest Opportunity selection/context surface needed by this slice: select one existing Opportunity, show its required Opportunity/JD context, and enter Match & Gaps or Positioning through the existing narrow main/preload/renderer boundary; all canonical writes remain application-owned.
- Keep the executor/provider/model replaceable and undecided until the implementation gate; this planning change selects no dependency, version, CLI, or provider.
- Keep CV generation, Story Bank/Interview Pack, cross-artifact review/repair/recheck, PDF/structured document output, and full two-JD MVP acceptance for later M2 slices.
- Do not make candidate persona, candidate concerns, a full Opportunity workspace, general Opportunity CRUD, Opportunity management, or a general navigation redesign deliverables of this slice.

## Capabilities

### New Capabilities

- `intelligence`: Evidence-linked job-description analysis, requirement matching, gap classification, and versioned positioning for an Opportunity, including bounded candidate execution and failure handling.

### Modified Capabilities

None. Existing Career Evidence, Opportunity, application-foundation, private-local-storage, and backup-and-restore requirements remain the governing boundaries; this change composes with them rather than replacing them.

## Prerequisite Gate

`m1-opportunity-evidence-substrate` is the named prerequisite change and is
now separately accepted and archived. Its accepted evidence provides the
minimum stable Opportunity/JD revision and confirmed Career Evidence/revision
operations, restart/read-back, private-root isolation, and fail-closed
migration behavior described in its planning artifacts. The planning review for
this change has passed and the baseline is accepted; M2 implementation remains
not started and SHALL begin only through the later apply workflow. The accepted
prerequisite does not imply that full Opportunity or Evidence workflows exist.

## Impact

- Future main-process/application-domain orchestration for intelligence jobs and their lifecycle state.
- Future persistence additions for analysis, matches, positioning revisions, input identities, source references, execution state, and validation status, accessed through the existing application-owned persistence boundary rather than a raw SQLite handle; the M1 foundation version remains unchanged and intelligence owns only its additive schema version.
- The M2-owned minimal Opportunity selection/context surface plus narrow preload/IPC capability additions; renderer remains non-authoritative and has no direct filesystem or database access.
- Deterministic synthetic fixtures and integration/acceptance validation for source attribution, Evidence revision binding, stale-result rejection, failure recovery, privacy, and offline/local behavior.
- No production source, dependency, version, or runtime change is authorized by this planning step.
