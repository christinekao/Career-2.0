const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const Database = require('better-sqlite3');
const {
  DEFAULT_REPOSITORY_ROOT,
  foundationDatabasePath,
  validatePrivateRoot,
} = require('../src/main/private-root.cjs');
const { acquireRootOwnership } = require('../src/main/ownership.cjs');
const {
  FOUNDATION_STORE_VERSION,
  INTELLIGENCE_SCHEMA_VERSION,
  initializeFoundationStore,
  initializeOpportunityEvidenceStore,
} = require('../src/main/persistence.cjs');
const intelligence = require('../src/main/intelligence.cjs');

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'career-2-intelligence-'));
}

function removeRoot(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function revision({ id = 'evidence-revision-1', evidenceId = 'evidence-1', state = 'CONFIRMED', provenance = { kind: 'synthetic', reference: id } } = {}) {
  return {
    evidence_revision_id: id,
    evidence_id: evidenceId,
    factual_content: 'Built a synthetic local system.',
    responsibility_boundary: 'Owned the synthetic local system boundary.',
    outcome: 'Synthetic system became reliable.',
    confirmation_state: state,
    provenance,
  };
}

function snapshot(overrides = {}) {
  const revisions = overrides.evidence_revisions || [revision()];
  const ids = overrides.evidence_revision_ids || revisions.map((item) => item.evidence_revision_id);
  return intelligence.buildEvidenceSnapshot({
    evidenceRevisionIds: ids,
    evidenceRevisions: revisions,
    inputGeneration: overrides.input_generation || 'generation-1',
    expectedEvidenceId: overrides.evidence_id || revisions[0].evidence_id,
  });
}

function requirement(overrides = {}) {
  return intelligence.validateRequirement({
    jdRevisionId: overrides.jdRevisionId || 'jd-revision-1',
    sourceRef: overrides.sourceRef || 'jd:line:1',
    normalizedContent: overrides.normalizedContent || 'Build reliable local systems.',
    requirementType: overrides.requirementType || 'RESPONSIBILITY',
    priority: overrides.priority || 'HIGH',
    explicitness: overrides.explicitness || 'EXPLICIT',
    extractionStatus: overrides.extractionStatus || 'EXTRACTED',
    uncertainty: overrides.uncertainty || {
      signal_type: 'EXTRACTION_UNCERTAINTY',
      value: 0.1,
      basis: 'RULE',
    },
  });
}

function validEvaluation(classification, overrides = {}) {
  const defaults = {
    DIRECT: {
      completeSupport: true,
      evidenceComplete: true,
      supportedEvidenceRevisionIds: ['evidence-revision-1'],
      missingDimensions: [],
    },
    STRONG_ADJACENT: {
      adjacentSupport: true,
      evidenceComplete: true,
      supportedEvidenceRevisionIds: ['evidence-revision-1'],
      boundary: 'Different synthetic domain.',
    },
    PARTIAL: {
      partialSupport: true,
      evidenceComplete: true,
      supportedEvidenceRevisionIds: ['evidence-revision-1'],
      missingDimensions: ['scale'],
    },
    NO_MATCH: {
      evidenceComplete: true,
      no_match: true,
      supportedEvidenceRevisionIds: [],
    },
    INSUFFICIENT_EVIDENCE: {
      ambiguous: true,
      evidenceComplete: false,
      supportedEvidenceRevisionIds: [],
      missingDimensions: [],
    },
  }[classification];
  const evaluation = { ...defaults, ...overrides };
  const missingDimensions = evaluation.missingDimensions || [];
  const explanation_details = {
    DIRECT: { support_summary: 'Synthetic Evidence covers the requested work.', scope_summary: 'The evaluated material dimensions are covered.' },
    STRONG_ADJACENT: { transferable_support: 'The Evidence shows transferable behavior.', direct_boundary: evaluation.boundary || 'Different synthetic domain.' },
    PARTIAL: { supported_dimensions: ['core responsibility'], missing_dimensions: missingDimensions },
    NO_MATCH: { evaluation_basis: 'The complete synthetic snapshot was evaluated.', unsupported_relation_summary: 'no related support was confirmed.' },
    INSUFFICIENT_EVIDENCE: {
      insufficiency_reason: overrides.no_match || (overrides.adjacentSupport && overrides.partialSupport)
        ? 'CONFLICTING_DECISION_FACTS'
        : (overrides.ambiguous === false ? 'INCOMPLETE_EVALUATION' : 'AMBIGUOUS_EVIDENCE'),
    },
  }[classification];
  let explanation;
  if (classification === 'DIRECT') explanation = `${explanation_details.support_summary} Scope: ${explanation_details.scope_summary}`;
  if (classification === 'STRONG_ADJACENT') explanation = `${explanation_details.transferable_support} Boundary: ${explanation_details.direct_boundary}`;
  if (classification === 'PARTIAL') explanation = `${explanation_details.supported_dimensions.join(', ')} supported; missing dimensions: ${explanation_details.missing_dimensions.join(', ')}`;
  if (classification === 'NO_MATCH') explanation = `${explanation_details.evaluation_basis} No supported relation: ${explanation_details.unsupported_relation_summary}`;
  if (classification === 'INSUFFICIENT_EVIDENCE') {
    const reason = {
      MISSING_EVIDENCE: 'required Evidence is missing.',
      AMBIGUOUS_EVIDENCE: 'the Evidence is ambiguous.',
      INCOMPLETE_EVALUATION: 'the evaluation is incomplete.',
      CONFLICTING_DECISION_FACTS: 'the decision facts conflict.',
    }[explanation_details.insufficiency_reason];
    explanation = `Insufficient evidence: ${reason}`;
  }
  return { ...evaluation, explanation, explanation_details };
}

test('canonical serialization and deterministic identities are stable across retries and generations', () => {
  assert.equal(intelligence.canonicalSerialize({ b: 2, a: 1 }), intelligence.canonicalSerialize({ a: 1, b: 2 }));
  assert.notEqual(intelligence.canonicalSerialize(['a', 'b']), intelligence.canonicalSerialize(['b', 'a']));
  assert.throws(() => intelligence.canonicalSerialize(Number.NaN), { code: 'INTELLIGENCE_CANONICAL_INVALID' });

  const first = requirement();
  const second = requirement();
  assert.equal(first.requirement_id, second.requirement_id);
  const snapshotId = intelligence.buildEvidenceSnapshotId({ evidenceRevisionIds: ['a', 'b'] });
  assert.match(snapshotId, /^evidence_snapshot:[0-9a-f]{64}$/);
  assert.equal(snapshotId, intelligence.buildEvidenceSnapshotId({ evidenceRevisionIds: ['a', 'b'] }));
  assert.notEqual(
    intelligence.buildEvidenceSnapshotId({ evidenceRevisionIds: ['a', 'b'] }),
    intelligence.buildEvidenceSnapshotId({ evidenceRevisionIds: ['b', 'a'] }),
  );
  assert.notEqual(
    intelligence.buildEvidenceSnapshotId({ evidenceRevisionIds: ['a', 'b'], inputGeneration: 'g-1' }),
    intelligence.buildEvidenceSnapshotId({ evidenceRevisionIds: ['a', 'b'], inputGeneration: 'g-2' }),
  );
  assert.notEqual(
    intelligence.buildAnalysisId({ opportunityId: 'op-1', jdRevisionId: 'jd-1', analysisGeneration: 'g-1' }),
    intelligence.buildAnalysisId({ opportunityId: 'op-1', jdRevisionId: 'jd-1', analysisGeneration: 'g-2' }),
  );
  assert.notEqual(
    intelligence.buildRequirementId({ jdRevisionId: 'jd-1', sourceRef: 'jd:line:1', normalizedContent: 'A', requirementType: 'SKILL' }),
    intelligence.buildRequirementId({ jdRevisionId: 'jd-2', sourceRef: 'jd:line:1', normalizedContent: 'A', requirementType: 'SKILL' }),
  );
  const matchId = intelligence.buildMatchId({ jdRevisionId: 'jd-1', requirementId: first.requirement_id, evidenceSnapshotId: 'snapshot-1' });
  const gapId = intelligence.buildGapId({ jdRevisionId: 'jd-1', requirementId: first.requirement_id, evidenceSnapshotId: 'snapshot-1' });
  assert.notEqual(matchId, gapId);
  const positioningId = intelligence.buildPositioningVersionId({ opportunityId: 'op-1', versionNumber: 1 });
  assert.equal(intelligence.buildPositioningClaimId({ positioningVersionId: positioningId, ordinal: 1 }), `${positioningId}:claim:1`);
});

test('confirmed Evidence gate builds immutable input bundle and rejects ineligible revisions', () => {
  const confirmed = revision();
  const fixed = snapshot({ evidence_revisions: [confirmed], input_generation: 'g-1' });
  assert.equal(fixed.evidence_revision_ids[0], confirmed.evidence_revision_id);
  assert.ok(Object.isFrozen(fixed));
  assert.ok(Object.isFrozen(fixed.evidence_revision_ids));

  const bundle = intelligence.buildInputBundle({
    opportunityId: 'op-1',
    jdRevisionId: 'jd-1',
    evidenceSnapshot: fixed,
    operationType: 'ANALYZE_REQUIREMENTS',
    schemaVersion: 1,
    executionId: 'execution-1',
    idempotencyKey: 'idempotency-1',
    inputGeneration: 'g-1',
    requestedAt: '2026-09-18T00:00:00.000Z',
    disclosureClassification: 'LOCAL_ONLY',
  });
  assert.equal(bundle.evidence_snapshot_id, fixed.evidence_snapshot_id);
  assert.deepEqual(bundle.evidence_revision_ids, [confirmed.evidence_revision_id]);
  assert.equal(bundle.analysis_id, 'analysis:op-1:jd-1:g-1');

  assert.throws(() => snapshot({ evidence_revisions: [revision({ state: 'DRAFT' })] }), { code: 'INTELLIGENCE_EVIDENCE_INELIGIBLE' });
  assert.throws(() => snapshot({ evidence_revisions: [revision({ state: 'UNCONFIRMED' })] }), { code: 'INTELLIGENCE_EVIDENCE_INELIGIBLE' });
  assert.throws(() => snapshot({ evidence_revision_ids: ['missing'], evidence_revisions: [confirmed] }), { code: 'INTELLIGENCE_EVIDENCE_REVISION_MISSING' });
  assert.throws(() => snapshot({ evidence_revisions: [revision({ evidenceId: 'other' })] , evidence_id: 'evidence-1' }), { code: 'INTELLIGENCE_EVIDENCE_IDENTITY_MISMATCH' });
  assert.throws(() => snapshot({ evidence_revisions: [revision({ provenance: {} })] }), { code: 'INTELLIGENCE_PROVENANCE_INVALID' });
  assert.throws(() => intelligence.buildEvidenceSnapshot({ evidenceRevisionIds: [], evidenceRevisions: [], inputGeneration: 'g-1' }), { code: 'INTELLIGENCE_INVALID_INPUT' });
  assert.throws(() => intelligence.buildInputBundle({ ...bundle, evidenceSnapshot: fixed, input_generation: 'g-2' }), { code: 'INTELLIGENCE_GENERATION_MISMATCH' });
});

test('requirement finite vocabularies and uncertainty fail closed', () => {
  for (const requirementType of intelligence.REQUIREMENT_TYPES) {
    assert.equal(requirement({ requirementType }).requirement_type, requirementType);
  }
  for (const priority of intelligence.PRIORITIES) assert.equal(requirement({ priority }).priority, priority);
  for (const explicitness of intelligence.EXPLICITNESS) assert.equal(requirement({ explicitness }).explicitness, explicitness);
  for (const extractionStatus of intelligence.EXTRACTION_STATUSES) {
    const value = requirement({ extractionStatus });
    assert.equal(value.extraction_status, extractionStatus);
    if (extractionStatus === 'UNAVAILABLE' || extractionStatus === 'REJECTED') assert.equal(value.ready, false);
  }
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01]) {
    assert.throws(() => requirement({ uncertainty: { signal_type: 'EXTRACTION_UNCERTAINTY', value, basis: 'RULE' } }), { code: 'INTELLIGENCE_UNCERTAINTY_INVALID' });
  }
  assert.throws(() => requirement({ sourceRef: 'display text only' }), { code: 'INTELLIGENCE_SOURCE_ANCHOR_INVALID' });
  for (const sourceRef of ['section:does-not-resolve', 'paragraph:does-not-resolve', 'char:1-2', 'anchor:does-not-resolve']) {
    assert.throws(() => requirement({ sourceRef }), { code: 'INTELLIGENCE_SOURCE_ANCHOR_INVALID' });
  }
  assert.deepEqual(
    requirement({ sourceRef: { locator: 'jd:line:1', jd_revision_id: 'jd-revision-1' } }).source_ref,
    { locator: 'jd:line:1', jd_revision_id: 'jd-revision-1' },
  );
  assert.deepEqual(
    requirement({ sourceRef: { locator: 'jd:offset:0', jd_revision_id: 'jd-revision-1', start: 0, end: 0 } }).source_ref,
    { locator: 'jd:offset:0', jd_revision_id: 'jd-revision-1', start: 0, end: 0 },
  );
  assert.deepEqual(
    requirement({ sourceRef: { locator: 'jd:offset:0', jd_revision_id: 'jd-revision-1', start: 0 } }).source_ref,
    { locator: 'jd:offset:0', jd_revision_id: 'jd-revision-1', start: 0 },
  );
  assert.throws(() => requirement({ sourceRef: { locator: 'jd:line:1', jd_revision_id: 'jd-other' } }), { code: 'INTELLIGENCE_SOURCE_ANCHOR_INVALID' });
  assert.throws(() => requirement({ sourceRef: { locator: 'jd:line:1', start: 999 } }), { code: 'INTELLIGENCE_SOURCE_ANCHOR_INVALID' });
  assert.throws(() => requirement({ sourceRef: { locator: 'jd:offset:0-2', start: 0, end: 1 } }), { code: 'INTELLIGENCE_SOURCE_ANCHOR_INVALID' });
  assert.throws(() => requirement({ sourceRef: { locator: 'jd:line:1', metadata: 'ignored' } }), { code: 'INTELLIGENCE_SOURCE_ANCHOR_INVALID' });
  assert.throws(() => requirement({ requirementType: 'OTHER' }), { code: 'INTELLIGENCE_UNKNOWN_STATE' });
  assert.throws(() => requirement({ priority: 'OTHER' }), { code: 'INTELLIGENCE_UNKNOWN_STATE' });
  assert.throws(() => requirement({ explicitness: 'OTHER' }), { code: 'INTELLIGENCE_UNKNOWN_STATE' });
  assert.throws(() => requirement({ extractionStatus: 'OTHER' }), { code: 'INTELLIGENCE_UNKNOWN_STATE' });
  assert.throws(() => requirement({ uncertainty: { signal_type: 'OTHER', value: 0, basis: 'RULE' } }), { code: 'INTELLIGENCE_UNCERTAINTY_INVALID' });
  assert.throws(() => requirement({ uncertainty: { signal_type: 'EXTRACTION_UNCERTAINTY', value: 0, basis: 'OTHER' } }), { code: 'INTELLIGENCE_UNKNOWN_STATE' });
});

test('matching decision table supports many-to-many Evidence and least-claim-safe fallback', () => {
  const revisions = [revision({ id: 'evidence-revision-1' }), revision({ id: 'evidence-revision-2' })];
  const fixed = snapshot({ evidence_revisions: revisions, input_generation: 'g-1' });
  const req = requirement();
  const direct = intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: validEvaluation('DIRECT', { supportedEvidenceRevisionIds: revisions.map((item) => item.evidence_revision_id) }),
  });
  assert.equal(direct.classification, 'DIRECT');
  assert.equal(direct.gap_id, null);
  assert.equal(direct.evidence_revision_ids.length, 2);

  const adjacent = intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: validEvaluation('STRONG_ADJACENT', { supportedEvidenceRevisionIds: [revisions[0].evidence_revision_id] }),
  });
  assert.equal(adjacent.classification, 'STRONG_ADJACENT');
  assert.ok(adjacent.gap_id);

  const partial = intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: validEvaluation('PARTIAL', { supportedEvidenceRevisionIds: [revisions[0].evidence_revision_id] }),
  });
  assert.equal(partial.classification, 'PARTIAL');

  const noMatch = intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: validEvaluation('NO_MATCH'),
  });
  assert.equal(noMatch.classification, 'NO_MATCH');
  assert.ok(noMatch.gap_id);

  const insufficient = intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: validEvaluation('INSUFFICIENT_EVIDENCE'),
  });
  assert.equal(insufficient.classification, 'INSUFFICIENT_EVIDENCE');
  assert.ok(insufficient.gap_id);

  assert.throws(() => intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: { score: 1, keywords: ['build', 'systems'], explanation: 'The evaluator did not receive structured support facts.' },
  }), { code: 'INTELLIGENCE_MATCH_INVALID' });
  const incompleteSupport = intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: validEvaluation('INSUFFICIENT_EVIDENCE', {
      ambiguous: false,
      completeSupport: true,
      evidenceComplete: false,
      supportedEvidenceRevisionIds: [revisions[0].evidence_revision_id],
    }),
  });
  assert.equal(incompleteSupport.classification, 'INSUFFICIENT_EVIDENCE');
  for (const priority of ['MEDIUM', 'LOW', 'UNKNOWN']) {
    assert.throws(() => intelligence.classifyMatch({
      requirement: requirement({ priority }),
      evidenceSnapshot: fixed,
      evaluation: {
        completeSupport: true,
        evidenceComplete: true,
        supportedEvidenceRevisionIds: [revisions[0].evidence_revision_id],
        explanation: 'Complete support is unavailable for a non-high-priority requirement.',
      },
    }), { code: 'INTELLIGENCE_REQUIREMENT_NOT_READY' });
  }
  const conflict = intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: validEvaluation('INSUFFICIENT_EVIDENCE', {
      adjacentSupport: true,
      partialSupport: true,
      evidenceComplete: true,
      supportedEvidenceRevisionIds: [revisions[0].evidence_revision_id],
      boundary: 'The context differs from the requirement.',
      missingDimensions: ['scale'],
    }),
  });
  assert.equal(conflict.classification, 'INSUFFICIENT_EVIDENCE');
  assert.throws(() => intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: { completeSupport: true, evidenceComplete: true, supportedEvidenceRevisionIds: [revisions[0].evidence_revision_id] },
  }), { code: 'INTELLIGENCE_INVALID_INPUT' });
  assert.throws(() => intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: { completeSupport: true, evidenceComplete: true, supportedEvidenceRevisionIds: [revisions[0].evidence_revision_id], explanation: 'Evaluation remains limited by available evidence.' },
  }), { code: 'INTELLIGENCE_MATCH_INVALID' });
  assert.throws(() => intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: { adjacentSupport: true, evidenceComplete: true, supportedEvidenceRevisionIds: [revisions[0].evidence_revision_id], explanation: 'Transferable behavior is supported.' },
  }), { code: 'INTELLIGENCE_MATCH_INVALID' });
  assert.throws(() => intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: { partialSupport: true, evidenceComplete: true, supportedEvidenceRevisionIds: [revisions[0].evidence_revision_id], missingDimensions: ['scale'] },
  }), { code: 'INTELLIGENCE_INVALID_INPUT' });
  assert.throws(() => intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: { evidenceComplete: true },
  }), { code: 'INTELLIGENCE_INVALID_INPUT' });
  assert.throws(() => intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: { ambiguous: true, evidenceComplete: false },
  }), { code: 'INTELLIGENCE_INVALID_INPUT' });
  assert.throws(() => intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: { completeSupport: 'true', evidenceComplete: true, supportedEvidenceRevisionIds: [revisions[0].evidence_revision_id] },
  }), { code: 'INTELLIGENCE_MATCH_INVALID' });
  assert.throws(() => intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: { completeSupport: true, evidenceComplete: null, supportedEvidenceRevisionIds: [revisions[0].evidence_revision_id] },
  }), { code: 'INTELLIGENCE_MATCH_INVALID' });
  assert.throws(() => intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: { evidenceAvailable: null },
  }), { code: 'INTELLIGENCE_MATCH_INVALID' });
  assert.throws(() => intelligence.validateMatchRecord({ ...direct, decision_facts: undefined }, fixed), { code: 'INTELLIGENCE_MATCH_INVALID' });
  assert.throws(() => intelligence.validateMatchRecord({
    ...direct,
    decision_facts: { ...direct.decision_facts, complete_support: false },
  }, fixed), { code: 'INTELLIGENCE_MATCH_INVALID' });
  assert.throws(() => intelligence.classifyMatch({ requirement: req, evidenceSnapshot: fixed, classification: 'KEYWORD_MATCH', evaluation: {} }), { code: 'INTELLIGENCE_UNKNOWN_TAXONOMY' });
  assert.throws(() => intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: { noMatch: true, evidenceComplete: true, explanation: 'No supported relation.' },
  }), { code: 'INTELLIGENCE_MATCH_INVALID' });
  const explicitNoMatchConflict = intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: validEvaluation('INSUFFICIENT_EVIDENCE', {
      ambiguous: false,
      no_match: true,
      completeSupport: true,
      evidenceComplete: true,
      supportedEvidenceRevisionIds: [revisions[0].evidence_revision_id],
    }),
  });
  assert.equal(explicitNoMatchConflict.classification, 'INSUFFICIENT_EVIDENCE');
  assert.throws(() => intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: {
      completeSupport: true,
      evidenceComplete: true,
      supportedEvidenceRevisionIds: [revisions[0].evidence_revision_id],
      explanation: 'No supported relation.',
      explanation_details: { support_summary: 'Synthetic Evidence covers the requested work.', scope_summary: 'The evaluated material dimensions are covered.' },
    },
  }), { code: 'INTELLIGENCE_MATCH_INVALID' });
  assert.throws(() => intelligence.validateMatchRecord({
    ...direct,
    decision_facts: { ...direct.decision_facts, noMatch: false },
  }, fixed), { code: 'INTELLIGENCE_MATCH_INVALID' });
});

test('traceability and positioning claim edges reject unsupported or gap-as-fact claims', () => {
  const fixed = snapshot();
  const req = requirement();
  const match = intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: validEvaluation('DIRECT', { supportedEvidenceRevisionIds: fixed.evidence_revision_ids }),
  });
  const trace = intelligence.validateTraceability({ jdSourceRef: req.source_ref, jdRevisionId: req.jd_revision_id, requirement: req, match, snapshot: fixed });
  assert.equal(trace.input_generation, 'generation-1');
  assert.ok(trace.provenance_edges.some((edge) => edge.edge_type === 'MATCH_TO_CONFIRMED_EVIDENCE'));
  assert.throws(() => intelligence.validateTraceability({ jdSourceRef: req.source_ref, jdRevisionId: 'jd-other', requirement: req, match, snapshot: fixed }), { code: 'INTELLIGENCE_PROVENANCE_INVALID' });
  const posId = intelligence.buildPositioningVersionId({ opportunityId: 'op-1', versionNumber: 1 });
  const claims = intelligence.validatePositioningClaimEdges({
    positioningVersionId: posId,
    requirements: [req],
    matches: [match],
    evidenceSnapshot: fixed,
    claims: [{ requirementId: req.requirement_id, matchId: match.match_id, evidenceRevisionIds: match.evidence_revision_ids, claimText: 'Show supported ownership.' }],
  });
  assert.equal(claims[0].positioning_claim_id, `${posId}:claim:1`);
  const gap = intelligence.classifyMatch({ requirement: req, evidenceSnapshot: fixed, evaluation: validEvaluation('NO_MATCH') });
  const gapClaims = intelligence.validatePositioningClaimEdges({
    positioningVersionId: posId,
    requirements: [req],
    matches: [gap],
    evidenceSnapshot: fixed,
    claims: [{ requirementId: req.requirement_id, gapId: gap.gap_id, evidenceRevisionIds: [], claimKind: 'LIMITATION', claimText: 'Scale remains a follow-up need.' }],
  });
  assert.equal(gapClaims[0].verified, false);
  assert.throws(() => intelligence.validatePositioningClaimEdges({
    positioningVersionId: posId,
    requirements: [req],
    matches: [gap],
    evidenceSnapshot: fixed,
    claims: [{ requirementId: req.requirement_id, matchId: gap.match_id, evidenceRevisionIds: [], claimKind: 'SUPPORTED', claimText: 'Unsafe direct claim.' }],
  }), { code: 'INTELLIGENCE_PROVENANCE_INVALID' });
  assert.throws(() => intelligence.validatePositioningClaimEdges({
    positioningVersionId: posId,
    requirements: [req],
    matches: [gap],
    evidenceSnapshot: fixed,
    claims: [{ requirementId: req.requirement_id, gapId: gap.gap_id, evidenceRevisionIds: [], claimKind: 'SUPPORTED', verified: true, claimText: 'Unsupported fact.' }],
  }), { code: 'INTELLIGENCE_GAP_CLAIM_INVALID' });
  assert.throws(() => intelligence.validatePositioningClaimEdges({
    positioningVersionId: posId,
    requirements: [req],
    matches: [match],
    evidenceSnapshot: fixed,
    claims: [{ requirementId: req.requirement_id, matchId: match.match_id, evidenceRevisionIds: match.evidence_revision_ids, claimKind: 'SUPPORTED', verified: 'false', claimText: 'Invalid verification flag.' }],
  }), { code: 'INTELLIGENCE_CLAIM_INVALID' });
  assert.throws(() => intelligence.validatePositioningClaimEdges({ positioningVersionId: posId, requirements: [req], matches: [], evidenceSnapshot: fixed, claims: [{ requirementId: req.requirement_id, claimText: 'Missing edge.' }] }), { code: 'INTELLIGENCE_PROVENANCE_INVALID' });
  assert.throws(() => intelligence.validatePositioningVersion({ opportunityId: 'op-1', jdRevisionId: req.jd_revision_id, analysisId: 'analysis:op-1:jd-1:g-1', evidenceSnapshot: fixed, versionNumber: 1, state: 'UNKNOWN', requirements: [req], matches: [match], claims: [] }), { code: 'INTELLIGENCE_UNKNOWN_STATE' });
});

test('intelligence migration and domain operations preserve M1 state across restart', (t) => {
  const root = temporaryRoot();
  t.after(() => removeRoot(root));
  const privateRoot = validatePrivateRoot(root, { repositoryRoot: DEFAULT_REPOSITORY_ROOT });
  let ownership = acquireRootOwnership(privateRoot);
  let store = initializeOpportunityEvidenceStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership });
  t.after(() => {
    store?.close();
    ownership?.release();
  });
  assert.equal(store.metadata.storeVersion, FOUNDATION_STORE_VERSION);
  assert.equal(store.metadata.intelligenceSchemaVersion, INTELLIGENCE_SCHEMA_VERSION);
  assert.equal('database' in store, false);
  assert.equal('databasePath' in store, false);

  const opportunity = store.opportunity.create({ companyName: 'Synthetic Co', roleTitle: 'Platform Engineer', createdAt: '2026-09-18T00:00:00Z' });
  const jd = store.opportunity.addJdRevision(opportunity.opportunityId, { content: 'Build reliable local systems.\nOperate reliable local systems.', sourceRef: 'paste://synthetic-jd', capturedAt: '2026-09-18T00:00:00Z' });
  const evidence = store.evidence.create({ factualContent: 'Built reliable local systems.', responsibilityBoundary: 'Owned system boundary.', outcome: 'Improved reliability.', provenance: { kind: 'synthetic', source: 'fixture' }, createdAt: '2026-09-18T00:00:00Z' });
  const confirmed = store.evidence.confirmRevision(evidence.evidenceId, evidence.revisions[0].evidenceRevisionId, '2026-09-18T00:01:00Z');
  const requirementInput = {
    analysisId: null,
    jdRevisionId: jd.jdRevisionId,
    sourceRef: 'jd:line:1',
    normalizedContent: 'Build reliable local systems.',
    requirementType: 'RESPONSIBILITY',
    priority: 'HIGH',
    explicitness: 'EXPLICIT',
    extractionStatus: 'EXTRACTED',
    uncertainty: { signal_type: 'EXTRACTION_UNCERTAINTY', value: 0, basis: 'RULE' },
  };
  assert.throws(() => store.intelligence.saveRequirement({ ...requirementInput, sourceRef: 'jd:line:3' }), { code: 'INTELLIGENCE_UNAVAILABLE' });
  assert.throws(() => store.intelligence.saveRequirement({ ...requirementInput, sourceRef: 'jd:offset:999' }), { code: 'INTELLIGENCE_UNAVAILABLE' });
  assert.throws(() => store.intelligence.saveRequirement({ ...requirementInput, jdRevisionId: 'missing-jd-revision' }), { code: 'JD_REVISION_INVALID' });
  assert.throws(() => store.intelligence.createInputGeneration({
    opportunityId: opportunity.opportunityId,
    jdRevisionId: jd.jdRevisionId,
    evidenceRevisionIds: [],
    inputGeneration: 'unavailable-generation',
    operationType: 'ANALYZE_REQUIREMENTS',
    schemaVersion: 1,
    executionId: 'execution-unavailable',
    idempotencyKey: 'idempotency-unavailable',
    requestedAt: '2026-09-18T00:01:30Z',
    disclosureClassification: 'LOCAL_ONLY',
  }), { code: 'INTELLIGENCE_EVIDENCE_UNAVAILABLE' });
  const input = store.intelligence.createInputGeneration({
    opportunityId: opportunity.opportunityId,
    jdRevisionId: jd.jdRevisionId,
    evidenceRevisionIds: [confirmed.currentRevisionId],
    inputGeneration: 'generation-1',
    operationType: 'ANALYZE_REQUIREMENTS',
    schemaVersion: 1,
    executionId: 'execution-1',
    idempotencyKey: 'idempotency-1',
    requestedAt: '2026-09-18T00:02:00Z',
    disclosureClassification: 'LOCAL_ONLY',
  });
  const forgedSnapshot = intelligence.buildEvidenceSnapshot({
    evidenceRevisionIds: [confirmed.currentRevisionId],
    evidenceRevisions: [{ ...revision({ id: confirmed.currentRevisionId, evidenceId: evidence.evidenceId }), factual_content: 'Forged synthetic content.' }],
    inputGeneration: 'forged-generation',
    expectedEvidenceId: evidence.evidenceId,
  });
  assert.throws(() => store.intelligence.createInputGeneration({
    opportunityId: opportunity.opportunityId,
    jdRevisionId: jd.jdRevisionId,
    evidenceSnapshot: forgedSnapshot,
    inputGeneration: 'forged-generation',
    operationType: 'ANALYZE_REQUIREMENTS',
    schemaVersion: 1,
    executionId: 'execution-forged',
    idempotencyKey: 'idempotency-forged',
    requestedAt: '2026-09-18T00:02:01Z',
    disclosureClassification: 'LOCAL_ONLY',
  }), { code: 'INTELLIGENCE_PROVENANCE_INVALID' });
  assert.equal(store.intelligence.createInputGeneration({
    opportunityId: opportunity.opportunityId,
    jdRevisionId: jd.jdRevisionId,
    evidenceRevisionIds: [confirmed.currentRevisionId],
    inputGeneration: 'generation-1',
    operationType: 'ANALYZE_REQUIREMENTS',
    schemaVersion: 1,
    executionId: 'execution-1',
    idempotencyKey: 'idempotency-1',
    requestedAt: '2026-09-18T00:02:00Z',
    disclosureClassification: 'LOCAL_ONLY',
  }).analysis_id, input.analysis_id);
  const req = store.intelligence.saveRequirement({
    ...requirementInput,
    analysisId: input.analysis_id,
  });
  const objectReq = store.intelligence.saveRequirement({
    ...requirementInput,
    analysisId: input.analysis_id,
    sourceRef: { locator: 'jd:line:1', jd_revision_id: jd.jdRevisionId },
    normalizedContent: 'Build reliable local systems from an object source anchor.',
  });
  assert.deepEqual(objectReq.source_ref, { locator: 'jd:line:1', jd_revision_id: jd.jdRevisionId });
  assert.deepEqual(store.intelligence.getRequirement(objectReq.requirement_id).source_ref, objectReq.source_ref);
  assert.throws(() => store.intelligence.saveRequirement({
    ...requirementInput,
    analysisId: input.analysis_id,
    sourceRef: { locator: 'jd:line:1', jd_revision_id: 'wrong-jd' },
  }), { code: 'INTELLIGENCE_SOURCE_ANCHOR_INVALID' });
  assert.throws(() => store.intelligence.saveRequirement({
    ...requirementInput,
    analysisId: input.analysis_id,
    sourceRef: { locator: 'jd:offset:0-999', jd_revision_id: jd.jdRevisionId, start: 0, end: 999 },
  }), { code: 'INTELLIGENCE_UNAVAILABLE' });
  const match = store.intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: input.evidence_snapshot,
    evaluation: validEvaluation('DIRECT', { supportedEvidenceRevisionIds: [confirmed.currentRevisionId] }),
  });
  store.intelligence.saveMatch(match);
  assert.equal(store.intelligence.saveMatch(match).match_id, match.match_id);
  assert.throws(() => store.intelligence.saveMatch({ ...match, jd_revision_id: 'wrong-jd' }), { code: 'INTELLIGENCE_PROVENANCE_INVALID' });
  assert.throws(() => store.intelligence.saveMatch({
    ...match,
    evidence_snapshot: input.evidence_snapshot,
    evidence_snapshot_id: 'wrong-snapshot',
  }), { code: 'INTELLIGENCE_PROVENANCE_INVALID' });
  assert.throws(() => store.intelligence.saveMatch({
    ...match,
    explanation: 'Altered support. Scope: Altered scope.',
    explanation_details: { support_summary: 'Altered support.', scope_summary: 'Altered scope.' },
  }), { code: 'INTELLIGENCE_IDENTITY_CONFLICT' });
  const position = store.intelligence.savePositioningVersion({
    opportunityId: opportunity.opportunityId,
    jdRevisionId: jd.jdRevisionId,
    analysisId: input.analysis_id,
    evidenceSnapshot: input.evidence_snapshot,
    versionNumber: 1,
    state: 'CANDIDATE',
    requirements: [req],
    matches: [match],
    claims: [{ requirementId: req.requirement_id, matchId: match.match_id, evidenceRevisionIds: match.evidence_revision_ids, claimKind: 'SUPPORTED', claimText: 'Show system ownership.' }],
  });
  assert.equal(position.state, 'CANDIDATE');
  const gapReq = store.intelligence.saveRequirement({
    analysisId: input.analysis_id,
    jdRevisionId: jd.jdRevisionId,
    sourceRef: 'jd:line:2',
    normalizedContent: 'Operate reliable local systems.',
    requirementType: 'RESPONSIBILITY',
    priority: 'HIGH',
    explicitness: 'EXPLICIT',
    extractionStatus: 'EXTRACTED',
    uncertainty: { signal_type: 'EXTRACTION_UNCERTAINTY', value: 0, basis: 'RULE' },
  });
  const gap = store.intelligence.classifyMatch({
    requirement: gapReq,
    evidenceSnapshot: input.evidence_snapshot,
    evaluation: validEvaluation('NO_MATCH'),
  });
  store.intelligence.saveMatch(gap);
  const gapPosition = store.intelligence.savePositioningVersion({
    opportunityId: opportunity.opportunityId,
    jdRevisionId: jd.jdRevisionId,
    analysisId: input.analysis_id,
    evidenceSnapshot: input.evidence_snapshot,
    versionNumber: 2,
    state: 'CANDIDATE',
    requirements: [gapReq],
    matches: [gap],
    claims: [{ requirementId: gapReq.requirement_id, gapId: gap.gap_id, evidenceRevisionIds: [], claimKind: 'LIMITATION', claimText: 'Synthetic evidence remains insufficient.' }],
  });
  assert.equal(gapPosition.claims[0].verified, false);
  const storeIdentity = store.metadata.storeIdentity;
  store.close();
  ownership.release();
  store = null;

  ownership = acquireRootOwnership(privateRoot);
  store = initializeOpportunityEvidenceStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership });
  assert.equal(store.metadata.storeIdentity, storeIdentity);
  assert.equal(store.intelligence.getInputGeneration(input.analysis_id).evidence_revision_ids[0], confirmed.currentRevisionId);
  assert.equal(store.intelligence.getRequirement(req.requirement_id).requirement_id, req.requirement_id);
  assert.equal(store.intelligence.getRequirement(req.requirement_id).source_ref, req.source_ref);
  assert.deepEqual(store.intelligence.getRequirement(objectReq.requirement_id).source_ref, objectReq.source_ref);
  assert.equal(store.intelligence.getMatch(match.match_id).classification, 'DIRECT');
  assert.equal(store.intelligence.getPositioningVersion(position.positioning_version_id).claims[0].positioning_claim_id, position.claims[0].positioning_claim_id);
});

test('intelligence migration failure and future version leave M1 usable and M2 unavailable', (t) => {
  const failedRoot = temporaryRoot();
  const futureRoot = temporaryRoot();
  const malformedRoot = temporaryRoot();
  t.after(() => {
    removeRoot(failedRoot);
    removeRoot(futureRoot);
    removeRoot(malformedRoot);
  });

  const failedPrivateRoot = validatePrivateRoot(failedRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT });
  const failedOwnership = acquireRootOwnership(failedPrivateRoot);
  const foundation = initializeFoundationStore(failedPrivateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership: failedOwnership });
  const foundationIdentity = foundation.metadata.storeIdentity;
  foundation.close();
  const degraded = initializeOpportunityEvidenceStore(failedPrivateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership: failedOwnership,
    failurePoint: 'intelligence-before-marker',
    allowDegradedOnMigrationFailure: true,
  });
  assert.equal(degraded.metadata.storeVersion, FOUNDATION_STORE_VERSION);
  assert.equal(degraded.metadata.storeIdentity, foundationIdentity);
  assert.equal(degraded.metadata.intelligenceSchemaVersion, null);
  assert.equal(degraded.intelligenceStatus.code, 'INTELLIGENCE_MIGRATION_FAILED');
  assert.ok(degraded.opportunity);
  assert.ok(degraded.evidence);
  degraded.close();
  failedOwnership.release();
  const failedDatabase = new Database(foundationDatabasePath(failedPrivateRoot), { readonly: true });
  assert.equal(failedDatabase.prepare("SELECT value FROM foundation_metadata WHERE key = 'intelligence_schema_version'").pluck().get(), undefined);
  assert.deepEqual(failedDatabase.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'intelligence_%'").pluck().all(), []);
  failedDatabase.close();

  const futurePrivateRoot = validatePrivateRoot(futureRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT });
  const futureOwnership = acquireRootOwnership(futurePrivateRoot);
  const futureStore = initializeOpportunityEvidenceStore(futurePrivateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership: futureOwnership });
  futureStore.close();
  const futureDatabase = new Database(foundationDatabasePath(futurePrivateRoot));
  futureDatabase.prepare("UPDATE foundation_metadata SET value = '99' WHERE key = 'intelligence_schema_version'").run();
  futureDatabase.close();
  const futureDegraded = initializeOpportunityEvidenceStore(futurePrivateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership: futureOwnership,
    allowDegradedOnMigrationFailure: true,
  });
  assert.equal(futureDegraded.metadata.intelligenceSchemaVersion, null);
  assert.equal(futureDegraded.intelligenceStatus.code, 'INTELLIGENCE_VERSION_UNSUPPORTED');
  assert.ok(futureDegraded.opportunity);
  futureDegraded.close();
  futureOwnership.release();

  const malformedPrivateRoot = validatePrivateRoot(malformedRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT });
  const malformedOwnership = acquireRootOwnership(malformedPrivateRoot);
  const malformedStore = initializeOpportunityEvidenceStore(malformedPrivateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership: malformedOwnership });
  malformedStore.close();
  malformedOwnership.release();
  const malformedDatabase = new Database(foundationDatabasePath(malformedPrivateRoot));
  malformedDatabase.exec('DROP INDEX intelligence_input_execution_idx');
  malformedDatabase.close();
  const malformedReopenOwnership = acquireRootOwnership(malformedPrivateRoot);
  const malformedDegraded = initializeOpportunityEvidenceStore(malformedPrivateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership: malformedReopenOwnership,
    allowDegradedOnMigrationFailure: true,
  });
  assert.equal(malformedDegraded.metadata.intelligenceSchemaVersion, null);
  assert.equal(malformedDegraded.intelligenceStatus.code, 'INTELLIGENCE_SCHEMA_INVALID');
  assert.ok(malformedDegraded.opportunity);
  malformedDegraded.close();
  malformedReopenOwnership.release();
});

test('intelligence schema readiness rejects persisted unavailable requirements', (t) => {
  const root = temporaryRoot();
  t.after(() => removeRoot(root));
  const privateRoot = validatePrivateRoot(root, { repositoryRoot: DEFAULT_REPOSITORY_ROOT });
  const ownership = acquireRootOwnership(privateRoot);
  const store = initializeOpportunityEvidenceStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership });
  const opportunity = store.opportunity.create({ companyName: 'Synthetic Co', roleTitle: 'Platform Engineer', createdAt: '2026-09-18T00:00:00Z' });
  const jd = store.opportunity.addJdRevision(opportunity.opportunityId, { content: 'Build reliable local systems.', sourceRef: 'paste://synthetic-jd', capturedAt: '2026-09-18T00:00:00Z' });
  const unavailable = intelligence.validateRequirement({
    jdRevisionId: jd.jdRevisionId,
    sourceRef: 'unavailable:jd-source',
    normalizedContent: 'Unavailable synthetic requirement.',
    requirementType: 'UNKNOWN',
    priority: 'UNKNOWN',
    explicitness: 'INFERRED',
    extractionStatus: 'UNAVAILABLE',
    uncertainty: { signal_type: 'EXTRACTION_UNCERTAINTY', value: 1, basis: 'USER_REVIEW' },
  });
  store.close();
  ownership.release();

  const database = new Database(foundationDatabasePath(privateRoot));
  database.prepare(`
    INSERT INTO intelligence_requirements (
      requirement_id, analysis_id, jd_revision_id, source_ref_json,
      normalized_content, requirement_type, priority, explicitness,
      uncertainty_json, extraction_status, contract_version, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    unavailable.requirement_id,
    null,
    unavailable.jd_revision_id,
    intelligence.canonicalSerialize(unavailable.source_ref),
    unavailable.normalized_content,
    unavailable.requirement_type,
    unavailable.priority,
    unavailable.explicitness,
    intelligence.canonicalSerialize(unavailable.uncertainty),
    unavailable.extraction_status,
    unavailable.contract_version,
    '2026-09-18T00:01:00.000Z',
  );
  database.close();

  const reopenOwnership = acquireRootOwnership(privateRoot);
  const degraded = initializeOpportunityEvidenceStore(privateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership: reopenOwnership,
    allowDegradedOnMigrationFailure: true,
  });
  assert.equal(degraded.metadata.intelligenceSchemaVersion, null);
  assert.equal(degraded.intelligenceStatus.code, 'INTELLIGENCE_SCHEMA_INVALID');
  degraded.close();
  reopenOwnership.release();
});
