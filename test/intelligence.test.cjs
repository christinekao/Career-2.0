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
    evaluation: {
      completeSupport: true,
      evidenceComplete: true,
      supportedEvidenceRevisionIds: revisions.map((item) => item.evidence_revision_id),
      missingDimensions: [],
      explanation: 'Both synthetic Evidence revisions cover all material dimensions.',
    },
  });
  assert.equal(direct.classification, 'DIRECT');
  assert.equal(direct.gap_id, null);
  assert.equal(direct.evidence_revision_ids.length, 2);

  const adjacent = intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: {
      adjacentSupport: true,
      evidenceComplete: true,
      supportedEvidenceRevisionIds: [revisions[0].evidence_revision_id],
      boundary: 'Different synthetic domain.',
      explanation: 'Transferable behavior with a different context.',
    },
  });
  assert.equal(adjacent.classification, 'STRONG_ADJACENT');
  assert.ok(adjacent.gap_id);

  const partial = intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: {
      partialSupport: true,
      evidenceComplete: true,
      supportedEvidenceRevisionIds: [revisions[0].evidence_revision_id],
      missingDimensions: ['scale'],
      explanation: 'Core responsibility supported; scale remains unknown.',
    },
  });
  assert.equal(partial.classification, 'PARTIAL');

  const noMatch = intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: { evidenceComplete: true, explanation: 'Complete synthetic snapshot contains no related support.' },
  });
  assert.equal(noMatch.classification, 'NO_MATCH');
  assert.ok(noMatch.gap_id);

  const insufficient = intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: { ambiguous: true, evidenceComplete: false, explanation: 'Source anchor is ambiguous.' },
  });
  assert.equal(insufficient.classification, 'INSUFFICIENT_EVIDENCE');
  assert.ok(insufficient.gap_id);

  const keywordOnly = intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: { score: 1, keywords: ['build', 'systems'] },
  });
  assert.equal(keywordOnly.classification, 'INSUFFICIENT_EVIDENCE');
  const incompleteSupport = intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: { completeSupport: true, evidenceComplete: false, supportedEvidenceRevisionIds: [revisions[0].evidence_revision_id] },
  });
  assert.equal(incompleteSupport.classification, 'INSUFFICIENT_EVIDENCE');
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
});

test('traceability and positioning claim edges reject unsupported or gap-as-fact claims', () => {
  const fixed = snapshot();
  const req = requirement();
  const match = intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: fixed,
    evaluation: { completeSupport: true, evidenceComplete: true, supportedEvidenceRevisionIds: fixed.evidence_revision_ids, explanation: 'Complete support.' },
  });
  const trace = intelligence.validateTraceability({ jdSourceRef: req.source_ref, jdRevisionId: req.jd_revision_id, requirement: req, match, snapshot: fixed });
  assert.equal(trace.input_generation, 'generation-1');
  assert.ok(trace.provenance_edges.some((edge) => edge.edge_type === 'MATCH_TO_CONFIRMED_EVIDENCE'));
  const posId = intelligence.buildPositioningVersionId({ opportunityId: 'op-1', versionNumber: 1 });
  const claims = intelligence.validatePositioningClaimEdges({
    positioningVersionId: posId,
    requirements: [req],
    matches: [match],
    evidenceSnapshot: fixed,
    claims: [{ requirementId: req.requirement_id, matchId: match.match_id, evidenceRevisionIds: match.evidence_revision_ids, claimText: 'Show supported ownership.' }],
  });
  assert.equal(claims[0].positioning_claim_id, `${posId}:claim:1`);
  const gap = intelligence.classifyMatch({ requirement: req, evidenceSnapshot: fixed, evaluation: { evidenceComplete: true, explanation: 'No relation.' } });
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
    analysisId: input.analysis_id,
    jdRevisionId: jd.jdRevisionId,
    sourceRef: 'jd:line:1',
    normalizedContent: 'Build reliable local systems.',
    requirementType: 'RESPONSIBILITY',
    priority: 'HIGH',
    explicitness: 'EXPLICIT',
    extractionStatus: 'EXTRACTED',
    uncertainty: { signal_type: 'EXTRACTION_UNCERTAINTY', value: 0, basis: 'RULE' },
  });
  const match = store.intelligence.classifyMatch({
    requirement: req,
    evidenceSnapshot: input.evidence_snapshot,
    evaluation: { completeSupport: true, evidenceComplete: true, supportedEvidenceRevisionIds: [confirmed.currentRevisionId], explanation: 'Synthetic direct support.' },
  });
  store.intelligence.saveMatch(match);
  assert.equal(store.intelligence.saveMatch(match).match_id, match.match_id);
  assert.throws(() => store.intelligence.saveMatch({
    ...match,
    explanation: 'Conflicting immutable match result.',
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
    priority: 'MEDIUM',
    explicitness: 'EXPLICIT',
    extractionStatus: 'EXTRACTED',
    uncertainty: { signal_type: 'EXTRACTION_UNCERTAINTY', value: 0, basis: 'RULE' },
  });
  const gap = store.intelligence.classifyMatch({
    requirement: gapReq,
    evidenceSnapshot: input.evidence_snapshot,
    evaluation: { evidenceComplete: true, explanation: 'Synthetic evaluation found no supported relation.' },
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
