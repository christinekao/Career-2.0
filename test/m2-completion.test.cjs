const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { acquireRootOwnership } = require('../src/main/ownership.cjs');
const { DEFAULT_REPOSITORY_ROOT, foundationDatabasePath, validatePrivateRoot } = require('../src/main/private-root.cjs');
const { initializeOpportunityEvidenceStore } = require('../src/main/persistence.cjs');
const intelligence = require('../src/main/intelligence.cjs');
const Database = require('better-sqlite3');

function fixtureRoot(prefix = 'career-2-m2-completion-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { root, privateRoot: validatePrivateRoot(root, { repositoryRoot: DEFAULT_REPOSITORY_ROOT }) };
}

function closeFixture(fixture) {
  fixture.store?.close();
  fixture.ownership?.release();
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

function directEvaluation(evidenceRevisionId) {
  return {
    completeSupport: true,
    evidenceComplete: true,
    supportedEvidenceRevisionIds: [evidenceRevisionId],
    missingDimensions: [],
    explanation: 'Synthetic Evidence covers the requested work. Scope: The evaluated material dimensions are covered.',
    explanation_details: {
      support_summary: 'Synthetic Evidence covers the requested work.',
      scope_summary: 'The evaluated material dimensions are covered.',
    },
  };
}

function setupStore(options = {}) {
  const fixture = fixtureRoot();
  fixture.ownership = acquireRootOwnership(fixture.privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT });
  fixture.store = initializeOpportunityEvidenceStore(fixture.privateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership: fixture.ownership,
    ...options,
  });
  return fixture;
}

function buildSyntheticResponse(request) {
  const evidence = request.payload.evidence.map((item) => ({
    evidence_revision_id: item.evidence_revision_id,
    evidence_id: item.evidence_id,
    factual_content: item.factual_content,
    responsibility_boundary: item.responsibility_boundary,
    outcome: item.outcome,
    confirmation_state: 'CONFIRMED',
    provenance: item.provenance,
  }));
  const snapshot = intelligence.buildEvidenceSnapshot({
    evidenceRevisionIds: evidence.map((item) => item.evidence_revision_id),
    evidenceRevisions: evidence,
    expectedEvidenceId: evidence[0].evidence_id,
    inputGeneration: request.input_generation,
  });
  const requirement = intelligence.validateRequirement({
    jdRevisionId: request.jd_revision_id,
    sourceRef: 'jd:line:1',
    normalizedContent: 'Build reliable local systems.',
    requirementType: 'RESPONSIBILITY',
    priority: 'HIGH',
    explicitness: 'EXPLICIT',
    extractionStatus: 'EXTRACTED',
    uncertainty: { signal_type: 'EXTRACTION_UNCERTAINTY', value: 0, basis: 'RULE' },
  });
  const match = intelligence.classifyMatch({
    requirement,
    evidenceSnapshot: snapshot,
    evaluation: directEvaluation(evidence[0].evidence_revision_id),
  });
  const versionNumber = Number(/(\d+)$/.exec(request.input_generation)?.[1] || 1);
  const positioningVersionId = intelligence.buildPositioningVersionId({ opportunityId: request.opportunity_id, versionNumber });
  const positioning = intelligence.validatePositioningVersion({
    positioningVersionId,
    opportunityId: request.opportunity_id,
    jdRevisionId: request.jd_revision_id,
    analysisId: `analysis:${request.opportunity_id}:${request.jd_revision_id}:${request.input_generation}`,
    evidenceSnapshotId: request.evidence_snapshot_id,
    inputGeneration: request.input_generation,
    evidenceSnapshot: snapshot,
    versionNumber,
    state: 'CANDIDATE',
    requirements: [requirement],
    matches: [match],
    claims: [{
      requirementId: requirement.requirement_id,
      matchId: match.match_id,
      evidenceRevisionIds: match.evidence_revision_ids,
      claimKind: 'SUPPORTED',
      claimText: 'Show reliable system ownership.',
    }],
  });
  return {
    execution_id: request.execution_id,
    idempotency_key: request.idempotency_key,
    operation_type: request.operation_type,
    schema_version: request.schema_version,
    opportunity_id: request.opportunity_id,
    jd_revision_id: request.jd_revision_id,
    evidence_snapshot_id: request.evidence_snapshot_id,
    input_generation: request.input_generation,
    result_status: 'SUCCEEDED',
    validation_status: 'VALID',
    payload: { requirements: [requirement], matches: [match], positioning },
  };
}

function seedStore(store, generation = 'generation-1', jdSourceRef = 'paste://synthetic-jd', evidenceProvenance = { kind: 'synthetic', reference: 'm2' }) {
  const opportunity = store.opportunity.create({ companyName: 'Synthetic Systems', roleTitle: 'Platform Engineer', sourceRef: 'https://example.test/opportunity' });
  const jd = store.opportunity.addJdRevision(opportunity.opportunityId, {
    content: 'Build reliable local systems.\nOwn safe delivery.',
    sourceRef: jdSourceRef,
  });
  const evidence = store.evidence.create({
    factualContent: 'Built a synthetic local system.',
    responsibilityBoundary: 'Owned the synthetic local system boundary.',
    outcome: 'Synthetic system became reliable.',
    provenance: evidenceProvenance,
  });
  const confirmed = store.evidence.confirmRevision(evidence.evidenceId, evidence.revisions[0].evidenceRevisionId);
  const input = store.intelligence.createInputGeneration({
    opportunityId: opportunity.opportunityId,
    jdRevisionId: jd.jdRevisionId,
    evidenceRevisionIds: [confirmed.currentRevisionId],
    inputGeneration: generation,
    operationType: 'ANALYZE_REQUIREMENTS',
    executionId: `execution-${generation}`,
    idempotencyKey: `idempotency-${generation}`,
    disclosureClassification: 'LOCAL_SYNTHETIC',
    requestedAt: '2026-09-19T00:00:00.000Z',
  });
  return { opportunity, jd, evidence, confirmed, input };
}

test('positioning lifecycle requires explicit confirmation, preserves history, and rejects stale current state', () => {
  const fixture = setupStore();
  try {
    const seeded = seedStore(fixture.store);
    const req = fixture.store.intelligence.saveRequirement({
      analysisId: seeded.input.analysis_id,
      jdRevisionId: seeded.jd.jdRevisionId,
      sourceRef: 'jd:line:1',
      normalizedContent: 'Build reliable local systems.',
      requirementType: 'RESPONSIBILITY',
      priority: 'HIGH',
      explicitness: 'EXPLICIT',
      extractionStatus: 'EXTRACTED',
      uncertainty: { signal_type: 'EXTRACTION_UNCERTAINTY', value: 0, basis: 'RULE' },
    });
    const match = fixture.store.intelligence.classifyMatch({
      requirement: req,
      evidenceSnapshot: seeded.input.evidence_snapshot,
      evaluation: directEvaluation(seeded.confirmed.currentRevisionId),
    });
    fixture.store.intelligence.saveMatch(match);
    const candidate = fixture.store.intelligence.savePositioningVersion({
      opportunityId: seeded.opportunity.opportunityId,
      jdRevisionId: seeded.jd.jdRevisionId,
      analysisId: seeded.input.analysis_id,
      evidenceSnapshot: seeded.input.evidence_snapshot,
      versionNumber: 1,
      state: 'CANDIDATE',
      requirements: [req],
      matches: [match],
      claims: [{ requirementId: req.requirement_id, matchId: match.match_id, evidenceRevisionIds: match.evidence_revision_ids, claimKind: 'SUPPORTED', claimText: 'Show reliable ownership.' }],
    });
    assert.throws(() => fixture.store.intelligence.savePositioningVersion({
      ...candidate,
      state: 'CONFIRMED',
      requirements: [req],
      matches: [match],
      evidenceSnapshot: seeded.input.evidence_snapshot,
    }), { code: 'INTELLIGENCE_CONFIRMATION_REQUIRED' });
    const confirmed = fixture.store.intelligence.confirmPositioningVersion(candidate.positioning_version_id, '2026-09-19T00:01:00.000Z');
    assert.equal(confirmed.state, 'CONFIRMED');
    assert.equal(fixture.store.intelligence.getCurrentPositioning(seeded.opportunity.opportunityId).positioning_version_id, candidate.positioning_version_id);
    const newerJd = fixture.store.opportunity.addJdRevision(seeded.opportunity.opportunityId, { content: 'Build reliable local systems.\nLead safe delivery.', sourceRef: 'paste://synthetic-jd-v2' });
    assert.notEqual(newerJd.jdRevisionId, seeded.jd.jdRevisionId);
    assert.equal(fixture.store.intelligence.getPositioningVersion(candidate.positioning_version_id).state, 'STALE');
    assert.equal(fixture.store.intelligence.getCurrentPositioning(seeded.opportunity.opportunityId), null);
    assert.throws(() => fixture.store.intelligence.confirmPositioningVersion(candidate.positioning_version_id), { code: 'INTELLIGENCE_CONFIRMATION_REQUIRED' });
  } finally {
    closeFixture(fixture);
  }
});

test('execution publishes validated candidates atomically and explicit confirmation creates the current pointer', async () => {
  const fixture = setupStore({ executor: { execute: async (request) => buildSyntheticResponse(request) } });
  try {
    const seeded = seedStore(fixture.store, 'execution-generation');
    const execution = await fixture.store.intelligence.startExecution({
      ...seeded.input,
      maxAttempts: 1,
    });
    assert.equal(execution.execution_state, 'COMPLETED');
    assert.equal(fixture.store.intelligence.getRequirement(execution.result_payload.requirements[0].requirement_id).jd_revision_id, seeded.jd.jdRevisionId);
    assert.equal(fixture.store.intelligence.getMatch(execution.result_payload.matches[0].match_id).classification, 'DIRECT');
    const candidateId = execution.result_payload.positioning.positioning_version_id;
    assert.equal(fixture.store.intelligence.getPositioningVersion(candidateId).state, 'CANDIDATE');
    const confirmed = fixture.store.intelligence.confirmPositioningVersion(candidateId);
    assert.equal(confirmed.state, 'CONFIRMED');
    assert.equal(fixture.store.intelligence.getCurrentPositioning(seeded.opportunity.opportunityId).positioning_version_id, candidateId);
  } finally {
    closeFixture(fixture);
  }
});

test('generation changes de-project completed executions and preserve stale history across restart', async () => {
  const fixture = setupStore({ executor: { execute: async (request) => buildSyntheticResponse(request) } });
  try {
    const seeded = seedStore(fixture.store, 'generation-1');
    const first = await fixture.store.intelligence.startExecution({ ...seeded.input, maxAttempts: 1 });
    const firstPositioningId = first.result_payload.positioning.positioning_version_id;
    fixture.store.intelligence.confirmPositioningVersion(firstPositioningId, '2026-09-19T00:01:00.000Z');
    assert.equal(fixture.store.intelligence.getExecution(first.execution_id).is_current, true);

    const newerDraft = fixture.store.evidence.createRevision(seeded.evidence.evidenceId, {
      factualContent: 'Built a synthetic local system and migration checks.',
      responsibilityBoundary: 'Owned the synthetic local system and migration boundary.',
      outcome: 'Synthetic recovery remained repeatable after migration.',
      provenance: { kind: 'synthetic', reference: 'm2-new-evidence' },
    });
    const newerEvidence = fixture.store.evidence.confirmRevision(
      seeded.evidence.evidenceId,
      newerDraft.revisions.at(-1).evidenceRevisionId,
      '2026-09-19T00:02:00.000Z',
    );
    assert.equal(fixture.store.intelligence.getExecution(first.execution_id).is_current, false);
    assert.equal(fixture.store.intelligence.getPositioningVersion(firstPositioningId).state, 'STALE');
    const afterEvidence = fixture.store.intelligence.loadContext({
      opportunityId: seeded.opportunity.opportunityId,
      jdRevisionId: seeded.jd.jdRevisionId,
    });
    assert.equal(afterEvidence.currentExecution, null);
    assert.equal(afterEvidence.currentPositioning, null);
    assert.equal(fixture.store.intelligence.getExecution(first.execution_id).execution_state, 'COMPLETED');

    const secondInput = fixture.store.intelligence.createInputGeneration({
      opportunityId: seeded.input.opportunity_id,
      jdRevisionId: seeded.input.jd_revision_id,
      evidenceRevisionIds: [newerEvidence.currentRevisionId],
      inputGeneration: 'generation-2',
      operationType: seeded.input.operation_type,
      schemaVersion: seeded.input.schema_version,
      executionId: 'execution-generation-2',
      idempotencyKey: 'idempotency-generation-2',
      requestedAt: '2026-09-19T00:03:00.000Z',
      disclosureClassification: seeded.input.disclosure_classification,
    });
    const second = await fixture.store.intelligence.startExecution({ ...secondInput, maxAttempts: 1 });
    assert.equal(second.execution_state, 'COMPLETED', JSON.stringify(second));
    assert.equal(second.is_current, true);

    const newerJd = fixture.store.opportunity.addJdRevision(seeded.opportunity.opportunityId, {
      content: 'Build reliable local systems.\nLead safe delivery.',
      sourceRef: 'paste://synthetic-jd-v2',
      capturedAt: '2026-09-19T00:04:00.000Z',
    });
    assert.equal(fixture.store.intelligence.getExecution(second.execution_id).is_current, false);
    const afterJd = fixture.store.intelligence.loadContext({
      opportunityId: seeded.opportunity.opportunityId,
      jdRevisionId: newerJd.jdRevisionId,
    });
    assert.equal(afterJd.currentExecution, null);
    assert.equal(afterJd.currentPositioning, null);

    const root = fixture.root;
    const privateRoot = fixture.privateRoot;
    fixture.store.close();
    fixture.ownership.release();
    fixture.ownership = acquireRootOwnership(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT });
    fixture.store = initializeOpportunityEvidenceStore(privateRoot, {
      repositoryRoot: DEFAULT_REPOSITORY_ROOT,
      ownership: fixture.ownership,
    });
    const reopened = fixture.store.intelligence.loadContext({
      opportunityId: seeded.opportunity.opportunityId,
      jdRevisionId: newerJd.jdRevisionId,
    });
    assert.equal(reopened.currentExecution, null);
    assert.equal(reopened.currentPositioning, null);
    assert.equal(fixture.store.intelligence.getExecution(first.execution_id).is_current, false);
    assert.equal(fixture.store.intelligence.getExecution(second.execution_id).is_current, false);
    assert.equal(fs.existsSync(root), true);
  } finally {
    closeFixture(fixture);
  }
});

test('complete backup covers M1 and M2 records and restore rejects future versions or non-empty destinations', async () => {
  const source = setupStore({ executor: { execute: async (request) => buildSyntheticResponse(request) } });
  const destination = fixtureRoot();
  try {
    const seeded = seedStore(source.store, 'backup-generation', 'private://sources/job-description.txt', {
      kind: 'file',
      path: 'attachments/evidence-source.txt',
    });
    fs.mkdirSync(path.join(source.root, 'attachments'), { recursive: true });
    fs.mkdirSync(path.join(source.root, 'submissions'), { recursive: true });
    fs.mkdirSync(path.join(source.root, 'working'), { recursive: true });
    fs.writeFileSync(path.join(source.root, 'attachments', 'evidence-source.txt'), 'Synthetic Evidence source bytes.');
    fs.writeFileSync(path.join(source.root, 'submissions', 'submitted-snapshot.txt'), 'Synthetic submitted snapshot bytes.');
    fs.writeFileSync(path.join(source.root, 'working', 'working-notes.md'), '# Synthetic working notes');
    fs.mkdirSync(path.join(source.root, 'sources'), { recursive: true });
    fs.writeFileSync(path.join(source.root, 'sources', 'job-description.txt'), 'Synthetic source bytes for restore.');
    const completed = await source.store.intelligence.startExecution({ ...seeded.input, maxAttempts: 1 });
    const candidate = source.store.intelligence.getPositioningVersion(completed.result_payload.positioning.positioning_version_id);
    source.store.intelligence.confirmPositioningVersion(candidate.positioning_version_id, '2026-09-19T00:01:00.000Z');
    const bundle = source.store.backup.create();
    assert.equal(bundle.intelligence_schema_version, 1);
    assert.deepEqual(bundle.entries.map((entry) => entry.logical_path).sort(), [
      'private/attachments/evidence-source.txt',
      'private/sources/job-description.txt',
      'private/submissions/submitted-snapshot.txt',
      'private/working/working-notes.md',
      'state/foundation-metadata.json', 'state/foundation.sqlite', 'state/intelligence-records.json',
    ]);
    assert.deepEqual(bundle.required_source_entries, [
      'private/attachments/evidence-source.txt',
      'private/sources/job-description.txt',
    ]);
    const intelligenceEntry = JSON.parse(Buffer.from(bundle.bundle.entries.find((entry) => entry.logical_path === 'state/intelligence-records.json').payload, 'base64').toString('utf8'));
    const backedUpTables = new Set(intelligenceEntry.tables.map((entry) => entry.table));
    assert.equal(backedUpTables.has('intelligence_executions'), true);
    assert.equal(backedUpTables.has('intelligence_positioning_current'), true);
    assert.equal(backedUpTables.has('intelligence_provenance_edges'), true);
    const restored = source.store.backup.restore(bundle.bundle, destination.root);
    assert.equal(restored.storeIdentity, source.store.metadata.storeIdentity);
    const restoredOwnership = acquireRootOwnership(destination.privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT });
    const restoredStore = initializeOpportunityEvidenceStore(destination.privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership: restoredOwnership });
    assert.equal(restoredStore.metadata.storeIdentity, source.store.metadata.storeIdentity);
    assert.equal(restoredStore.metadata.intelligenceSchemaVersion, 1);
    assert.equal(restoredStore.opportunity.get(seeded.opportunity.opportunityId).jdRevisions.length, 1);
    assert.equal(restoredStore.evidence.get(seeded.evidence.evidenceId).currentRevision.confirmationState, 'CONFIRMED');
    assert.equal(restoredStore.intelligence.getInputGeneration(seeded.input.analysis_id).input_generation, 'backup-generation');
    assert.equal(restoredStore.intelligence.getExecution(seeded.input.execution_id).execution_state, 'COMPLETED');
    assert.equal(restoredStore.intelligence.getExecution(seeded.input.execution_id).attempt, completed.attempt);
    assert.equal(restoredStore.intelligence.getCurrentPositioning(seeded.opportunity.opportunityId).positioning_version_id, candidate.positioning_version_id);
    assert.equal(fs.readFileSync(path.join(destination.root, 'attachments', 'evidence-source.txt'), 'utf8'), 'Synthetic Evidence source bytes.');
    assert.equal(fs.readFileSync(path.join(destination.root, 'sources', 'job-description.txt'), 'utf8'), 'Synthetic source bytes for restore.');
    assert.equal(fs.readFileSync(path.join(destination.root, 'submissions', 'submitted-snapshot.txt'), 'utf8'), 'Synthetic submitted snapshot bytes.');
    assert.equal(fs.readFileSync(path.join(destination.root, 'working', 'working-notes.md'), 'utf8'), '# Synthetic working notes');
    restoredStore.close();
    restoredOwnership.release();
    const futureBundle = JSON.parse(JSON.stringify(bundle.bundle));
    futureBundle.intelligence_schema_version = 2;
    const futureDestination = fixtureRoot();
    try {
      assert.throws(() => source.store.backup.restore(futureBundle, futureDestination.root), { code: 'BACKUP_VERSION_UNSUPPORTED' });
      assert.deepEqual(fs.readdirSync(futureDestination.root), []);
    } finally {
      fs.rmSync(futureDestination.root, { recursive: true, force: true });
    }
    const incompleteBundle = JSON.parse(JSON.stringify(bundle.bundle));
    incompleteBundle.entries = incompleteBundle.entries.filter((entry) => entry.logical_path !== 'private/sources/job-description.txt');
    const incompleteDestination = fixtureRoot();
    try {
      assert.throws(() => source.store.backup.restore(incompleteBundle, incompleteDestination.root), { code: 'BACKUP_INCOMPLETE' });
      assert.deepEqual(fs.readdirSync(incompleteDestination.root), []);
    } finally {
      fs.rmSync(incompleteDestination.root, { recursive: true, force: true });
    }
    const tamperedBundle = JSON.parse(JSON.stringify(bundle.bundle));
    const tamperedEntry = tamperedBundle.entries.find((entry) => entry.logical_path === 'private/sources/job-description.txt');
    tamperedEntry.payload = Buffer.from('tampered').toString('base64');
    const tamperedDestination = fixtureRoot();
    try {
      assert.throws(() => source.store.backup.restore(tamperedBundle, tamperedDestination.root), { code: 'BACKUP_INTEGRITY_FAILED' });
      assert.deepEqual(fs.readdirSync(tamperedDestination.root), []);
    } finally {
      fs.rmSync(tamperedDestination.root, { recursive: true, force: true });
    }
    const nonEmpty = fixtureRoot();
    fs.writeFileSync(path.join(nonEmpty.root, 'keep.txt'), 'must not merge');
    assert.throws(() => source.store.backup.restore(bundle.bundle, nonEmpty.root), { code: 'BACKUP_DESTINATION_NOT_EMPTY' });
    fs.rmSync(nonEmpty.root, { recursive: true, force: true });
    assert.throws(() => source.store.backup.create(path.join(DEFAULT_REPOSITORY_ROOT, '.career2-test-backup.json')), { code: 'BACKUP_INVALID' });
  } finally {
    closeFixture(source);
    fs.rmSync(destination.root, { recursive: true, force: true });
  }
});

test('backup rejects a missing required source artifact before publishing a bundle', () => {
  const fixture = setupStore();
  try {
    seedStore(fixture.store, 'missing-source-generation', 'private://sources/missing.txt');
    assert.throws(() => fixture.store.backup.create(), { code: 'BACKUP_SOURCE_MISSING' });
  } finally {
    closeFixture(fixture);
  }
});

test('an existing intelligence v1 store receives additive current-positioning schema on reopen', () => {
  const fixture = setupStore();
  try {
    fixture.store.close();
    fixture.ownership.release();
    const database = new Database(foundationDatabasePath(fixture.privateRoot));
    database.exec('DROP INDEX intelligence_positioning_current_generation_idx; DROP TABLE intelligence_positioning_current;');
    database.close();

    fixture.ownership = acquireRootOwnership(fixture.privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT });
    fixture.store = initializeOpportunityEvidenceStore(fixture.privateRoot, {
      repositoryRoot: DEFAULT_REPOSITORY_ROOT,
      ownership: fixture.ownership,
    });
    assert.deepEqual(
      fixture.store.intelligence.listPositioningVersions('missing-opportunity'),
      [],
    );
    const reopened = new Database(foundationDatabasePath(fixture.privateRoot));
    assert.equal(reopened.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'intelligence_positioning_current'").get()?.['1'], 1);
    reopened.close();
  } finally {
    closeFixture(fixture);
  }
});

test('main/preload surfaces stay finite and renderer source has no private persistence capability', () => {
  const main = fs.readFileSync(path.join(DEFAULT_REPOSITORY_ROOT, 'src/main/index.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(DEFAULT_REPOSITORY_ROOT, 'src/preload/index.cjs'), 'utf8');
  const renderer = fs.readFileSync(path.join(DEFAULT_REPOSITORY_ROOT, 'src/renderer/App.jsx'), 'utf8');
  for (const channel of [
    'intelligence:load-context', 'intelligence:begin-execution', 'intelligence:start-execution', 'intelligence:cancel-execution',
    'intelligence:get-execution', 'intelligence:get-positioning', 'intelligence:get-current-positioning',
    'intelligence:list-positioning', 'intelligence:confirm-positioning',
  ]) {
    assert.match(main, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(preload, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(preload, /exposeInMainWorld\([^,]+,\s*\{[^}]*ipcRenderer/);
  assert.doesNotMatch(preload, /node:fs|node:path|better-sqlite3|foundation\.sqlite|privateRoot/);
  assert.doesNotMatch(renderer, /better-sqlite3|node:fs|node:path|node:sqlite|ipcRenderer|foundation\.sqlite/);
  assert.doesNotMatch(renderer, /nextExecution\?\.result_payload\?\.positioning/);
  assert.match(renderer, /Confirm positioning/);
  assert.match(renderer, /No confirmed Evidence is available/);
});
