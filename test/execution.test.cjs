const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_REPOSITORY_ROOT,
  foundationDatabasePath,
  validatePrivateRoot,
} = require('../src/main/private-root.cjs');
const { acquireRootOwnership } = require('../src/main/ownership.cjs');
const { initializeOpportunityEvidenceStore } = require('../src/main/persistence.cjs');
const intelligence = require('../src/main/intelligence.cjs');
const {
  buildExecutionRequest,
  normalizeExecutionResponse,
} = require('../src/main/execution.cjs');

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'career-2-execution-'));
}

function removeRoot(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function setup({ operationType = 'ANALYZE_REQUIREMENTS', generation = 'generation-1', executor, executionDefaults } = {}) {
  const root = temporaryRoot();
  const privateRoot = validatePrivateRoot(root, { repositoryRoot: DEFAULT_REPOSITORY_ROOT });
  const ownership = acquireRootOwnership(privateRoot);
  const store = initializeOpportunityEvidenceStore(privateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership,
    executor,
    executionDefaults,
  });
  const opportunity = store.opportunity.create({ companyName: 'Synthetic Co', roleTitle: 'Platform Engineer', createdAt: '2026-09-18T00:00:00Z' });
  const jd = store.opportunity.addJdRevision(opportunity.opportunityId, {
    content: 'Build reliable local systems.\nOperate reliable local systems.',
    sourceRef: 'paste://synthetic-jd',
    capturedAt: '2026-09-18T00:00:00Z',
  });
  const evidence = store.evidence.create({
    factualContent: 'Built reliable local systems.',
    responsibilityBoundary: 'Owned system boundary.',
    outcome: 'Improved reliability.',
    provenance: { kind: 'synthetic', source: 'fixture' },
    createdAt: '2026-09-18T00:00:00Z',
  });
  const confirmed = store.evidence.confirmRevision(evidence.evidenceId, evidence.revisions[0].evidenceRevisionId, '2026-09-18T00:01:00Z');
  const input = store.intelligence.createInputGeneration({
    opportunityId: opportunity.opportunityId,
    jdRevisionId: jd.jdRevisionId,
    evidenceRevisionIds: [confirmed.currentRevisionId],
    inputGeneration: generation,
    operationType,
    schemaVersion: 1,
    executionId: `execution-${generation}`,
    idempotencyKey: `idempotency-${generation}`,
    requestedAt: '2026-09-18T00:02:00Z',
    disclosureClassification: 'LOCAL_ONLY',
  });
  return {
    root,
    privateRoot,
    ownership,
    store,
    opportunity,
    jd,
    evidence,
    confirmed,
    input,
    close() {
      store.close();
      ownership.release();
      removeRoot(root);
    },
  };
}

function responseFor(request, overrides = {}) {
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
    payload: { requirements: [] },
    ...overrides,
  };
}

function waitForTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('provider-independent execution contract sends immutable confirmed input and completes once', async (t) => {
  let observedRequest;
  const ctx = setup({
    executor: {
      async execute(request) {
        observedRequest = request;
        return responseFor(request);
      },
    },
  });
  t.after(() => ctx.close());

  const result = await ctx.store.intelligence.execute({ analysisId: ctx.input.analysis_id });
  assert.equal(result.execution_state, 'COMPLETED');
  assert.equal(result.result_status, 'SUCCEEDED');
  assert.equal(result.attempt, 1);
  assert.equal(result.is_current, true);
  assert.equal(result.request.evidence_snapshot_id, ctx.input.evidence_snapshot_id);
  assert.deepEqual(Object.keys(observedRequest).sort(), [
    'contract_version', 'disclosure_classification', 'evidence_revision_ids',
    'evidence_snapshot_id', 'execution_id', 'idempotency_key', 'input_generation',
    'jd_revision_id', 'operation_type', 'opportunity_id', 'payload', 'requested_at',
    'schema_version',
  ].sort());
  assert.equal('database' in observedRequest, false);
  assert.equal('private_root' in observedRequest, false);
  assert.deepEqual(result.result_payload, { requirements: [] });
  const minimalResponse = normalizeExecutionResponse({
    execution_id: observedRequest.execution_id,
    idempotency_key: observedRequest.idempotency_key,
    schema_version: observedRequest.schema_version,
    result_status: 'SUCCEEDED',
    validation_status: 'VALID',
    payload: {},
  }, observedRequest);
  assert.equal(minimalResponse.operation_type, observedRequest.operation_type);
  assert.equal(minimalResponse.input_generation, observedRequest.input_generation);
});

test('draft or ineligible input is rejected before executor invocation', async (t) => {
  let calls = 0;
  const ctx = setup({ executor: { async execute() { calls += 1; return null; } } });
  t.after(() => ctx.close());
  const draftInput = {
    opportunityId: ctx.opportunity.opportunityId,
    jdRevisionId: ctx.jd.jdRevisionId,
    evidenceRevisionIds: [ctx.evidence.revisions[0].evidenceRevisionId],
    inputGeneration: 'draft-generation',
    operationType: 'ANALYZE_REQUIREMENTS',
    schemaVersion: 1,
    executionId: 'execution-draft',
    idempotencyKey: 'idempotency-draft',
    requestedAt: '2026-09-18T00:02:01Z',
    disclosureClassification: 'LOCAL_ONLY',
  };
  assert.throws(() => ctx.store.intelligence.createInputGeneration(draftInput), { code: 'INTELLIGENCE_EVIDENCE_INELIGIBLE' });
  assert.equal(calls, 0);
});

test('timeout is bounded, retries are finite, and late provider completion is ignored', async (t) => {
  let calls = 0;
  const ctx = setup({
    executionDefaults: { timeoutMs: 15, cancellationGraceMs: 5, maxAttempts: 2 },
    executor: { async execute() { calls += 1; return new Promise(() => {}); } },
  });
  t.after(() => ctx.close());
  const started = Date.now();
  const result = await ctx.store.intelligence.execute({ analysisId: ctx.input.analysis_id });
  assert.ok(Date.now() - started < 250);
  assert.equal(result.execution_state, 'FAILED');
  assert.equal(result.result_status, 'TIMED_OUT');
  assert.equal(result.attempt, 2);
  assert.equal(result.max_attempts, 2);
  assert.equal(calls, 2);
  assert.equal(result.result_payload, null);
});

test('retryable provider failure reuses identity and stops at the configured limit', async (t) => {
  let calls = 0;
  const ctx = setup({
    executionDefaults: { timeoutMs: 100, maxAttempts: 2 },
    executor: {
      async execute(request) {
        calls += 1;
        if (calls === 1) {
          const error = new Error('synthetic provider unavailable');
          error.retryable = true;
          throw error;
        }
        return responseFor(request);
      },
    },
  });
  t.after(() => ctx.close());
  const result = await ctx.store.intelligence.execute({ analysisId: ctx.input.analysis_id });
  assert.equal(result.execution_state, 'COMPLETED');
  assert.equal(result.attempt, 2);
  assert.equal(calls, 2);
  assert.equal(result.request.idempotency_key, ctx.input.idempotency_key);
});

test('missing executor capability fails closed without retry or provider invocation', async (t) => {
  const ctx = setup({ executionDefaults: { maxAttempts: 3 } });
  t.after(() => ctx.close());
  const result = await ctx.store.intelligence.execute({ analysisId: ctx.input.analysis_id });
  assert.equal(result.execution_state, 'FAILED');
  assert.equal(result.result_status, 'UNAVAILABLE');
  assert.equal(result.attempt, 1);
  assert.equal(result.max_attempts, 3);
  assert.equal(result.result_payload, null);
});

test('non-promise executor output fails closed at the capability boundary', async (t) => {
  const ctx = setup({ executor: { execute() { return { result_status: 'SUCCEEDED' }; } } });
  t.after(() => ctx.close());
  const result = await ctx.store.intelligence.execute({ analysisId: ctx.input.analysis_id });
  assert.equal(result.execution_state, 'FAILED');
  assert.equal(result.result_status, 'PROVIDER_FAILURE');
  assert.equal(result.attempt, 1);
  assert.equal(result.result_payload, null);
});

test('cancellation becomes terminal and preserves the previous current result', async (t) => {
  let calls = 0;
  const ctx = setup({
    executionDefaults: { timeoutMs: 200, cancellationGraceMs: 5, maxAttempts: 1 },
    executor: {
      async execute() {
        calls += 1;
        return new Promise((resolve) => setTimeout(resolve, 100, null));
      },
    },
  });
  t.after(() => ctx.close());
  const first = await ctx.store.intelligence.execute({
    analysisId: ctx.input.analysis_id,
    executor: { async execute(request) { return responseFor(request); } },
  });
  assert.equal(first.is_current, true);

  const secondInput = ctx.store.intelligence.createInputGeneration({
    opportunityId: ctx.opportunity.opportunityId,
    jdRevisionId: ctx.jd.jdRevisionId,
    evidenceRevisionIds: [ctx.confirmed.currentRevisionId],
    inputGeneration: 'generation-2',
    operationType: 'ANALYZE_REQUIREMENTS',
    schemaVersion: 1,
    executionId: 'execution-generation-2',
    idempotencyKey: 'idempotency-generation-2',
    requestedAt: '2026-09-18T00:03:00Z',
    disclosureClassification: 'LOCAL_ONLY',
  });
  const pending = ctx.store.intelligence.execute({ analysisId: secondInput.analysis_id });
  await waitForTurn();
  const cancelled = await ctx.store.intelligence.cancelExecution(secondInput.execution_id);
  const result = await pending;
  assert.equal(calls, 1);
  assert.equal(cancelled.execution_state, 'CANCELLED');
  assert.equal(result.execution_state, 'CANCELLED');
  assert.equal(result.cancellation_acknowledged, false);
  assert.equal(ctx.store.intelligence.getExecution(ctx.input.execution_id).is_current, true);
});

test('duplicate completion is idempotent and conflicting completion cannot overwrite it', async (t) => {
  const ctx = setup();
  t.after(() => ctx.close());
  const record = ctx.store.intelligence.createInputGeneration({
    opportunityId: ctx.opportunity.opportunityId,
    jdRevisionId: ctx.jd.jdRevisionId,
    evidenceRevisionIds: [ctx.confirmed.currentRevisionId],
    inputGeneration: 'generation-duplicate',
    operationType: 'ANALYZE_REQUIREMENTS',
    schemaVersion: 1,
    executionId: 'execution-duplicate',
    idempotencyKey: 'idempotency-duplicate',
    requestedAt: '2026-09-18T00:04:00Z',
    disclosureClassification: 'LOCAL_ONLY',
  });
  const initial = await ctx.store.intelligence.execute({ analysisId: record.analysis_id, executor: { async execute(request) { return responseFor(request); } } });
  const duplicate = ctx.store.intelligence.completeExecution(record.execution_id, responseFor(initial.request));
  assert.equal(duplicate.execution_state, 'COMPLETED');
  assert.equal(duplicate.result_payload.requirements.length, 0);
  const conflicting = responseFor(initial.request, { result_status: 'FAILED', validation_status: 'NOT_RUN', error: { classification: 'PROVIDER_FAILURE', retryable: false } });
  delete conflicting.payload;
  assert.throws(() => ctx.store.intelligence.completeExecution(record.execution_id, conflicting), { code: 'INTELLIGENCE_DUPLICATE_COMPLETION' });
  assert.equal(ctx.store.intelligence.getExecution(record.execution_id).result_status, 'SUCCEEDED');
});

test('stale completion is rejected after a newer generation succeeds', async (t) => {
  let resolveOld;
  const oldExecutor = {
    execute(request) {
      return new Promise((resolve) => { resolveOld = () => resolve(responseFor(request)); });
    },
  };
  const ctx = setup({ executor: oldExecutor, executionDefaults: { timeoutMs: 200, maxAttempts: 1 } });
  t.after(() => ctx.close());
  const oldPending = ctx.store.intelligence.execute({ analysisId: ctx.input.analysis_id });
  await waitForTurn();
  const newerInput = ctx.store.intelligence.createInputGeneration({
    opportunityId: ctx.opportunity.opportunityId,
    jdRevisionId: ctx.jd.jdRevisionId,
    evidenceRevisionIds: [ctx.confirmed.currentRevisionId],
    inputGeneration: 'generation-newer',
    operationType: 'ANALYZE_REQUIREMENTS',
    schemaVersion: 1,
    executionId: 'execution-newer',
    idempotencyKey: 'idempotency-newer',
    requestedAt: '2026-09-18T00:05:00Z',
    disclosureClassification: 'LOCAL_ONLY',
  });
  const newer = await ctx.store.intelligence.execute({
    analysisId: newerInput.analysis_id,
    executor: { async execute(request) { return responseFor(request); } },
  });
  assert.equal(newer.execution_state, 'COMPLETED');
  resolveOld();
  const stale = await oldPending;
  assert.equal(stale.execution_state, 'STALE_RESULT_REJECTED');
  assert.equal(stale.result_status, 'STALE');
  assert.equal(ctx.store.intelligence.getExecution(newerInput.execution_id).is_current, true);
  assert.equal(ctx.store.intelligence.getExecution(ctx.input.execution_id).result_payload, null);
});

test('superseded retryable work becomes stale without invoking another attempt', async (t) => {
  let rejectOld;
  let calls = 0;
  const ctx = setup({
    executor: {
      execute() {
        calls += 1;
        return new Promise((resolve, reject) => { rejectOld = () => reject(Object.assign(new Error('retryable'), { retryable: true })); });
      },
    },
    executionDefaults: { timeoutMs: 200, maxAttempts: 2 },
  });
  t.after(() => ctx.close());
  const oldPending = ctx.store.intelligence.execute({ analysisId: ctx.input.analysis_id });
  await waitForTurn();
  const newerInput = ctx.store.intelligence.createInputGeneration({
    opportunityId: ctx.opportunity.opportunityId,
    jdRevisionId: ctx.jd.jdRevisionId,
    evidenceRevisionIds: [ctx.confirmed.currentRevisionId],
    inputGeneration: 'generation-retry-newer',
    operationType: 'ANALYZE_REQUIREMENTS',
    schemaVersion: 1,
    executionId: 'execution-retry-newer',
    idempotencyKey: 'idempotency-retry-newer',
    requestedAt: '2026-09-18T00:06:00Z',
    disclosureClassification: 'LOCAL_ONLY',
  });
  const newer = await ctx.store.intelligence.execute({
    analysisId: newerInput.analysis_id,
    executor: { async execute(request) { return responseFor(request); } },
  });
  assert.equal(newer.execution_state, 'COMPLETED');
  rejectOld();
  const stale = await oldPending;
  assert.equal(stale.execution_state, 'STALE_RESULT_REJECTED');
  assert.equal(stale.result_status, 'STALE');
  assert.equal(calls, 1);
});

test('external completion cannot race an active bounded executor attempt', async (t) => {
  const ctx = setup({
    executionDefaults: { timeoutMs: 200, cancellationGraceMs: 5, maxAttempts: 1 },
    executor: { async execute() { return new Promise(() => {}); } },
  });
  t.after(() => ctx.close());
  const pending = ctx.store.intelligence.execute({ analysisId: ctx.input.analysis_id });
  await waitForTurn();
  assert.throws(() => ctx.store.intelligence.completeExecution(ctx.input.execution_id, {
    execution_id: ctx.input.execution_id,
    idempotency_key: ctx.input.idempotency_key,
    schema_version: 1,
    result_status: 'SUCCEEDED',
    validation_status: 'VALID',
    payload: { requirements: [] },
  }), { code: 'EXECUTION_COMPLETION_IN_FLIGHT' });
  await ctx.store.intelligence.cancelExecution(ctx.input.execution_id);
  await pending;
});

test('malformed, unknown taxonomy, and unknown execution states fail closed without partial writes', async (t) => {
  const malformed = setup({ executor: { async execute() { return null; } } });
  t.after(() => malformed.close());
  const malformedResult = await malformed.store.intelligence.execute({ analysisId: malformed.input.analysis_id });
  assert.equal(malformedResult.result_status, 'MALFORMED');
  assert.equal(malformedResult.result_payload, null);

  const taxonomy = setup({ operationType: 'CLASSIFY_MATCHES' });
  t.after(() => taxonomy.close());
  const candidateRequirement = intelligence.validateRequirement({
    jdRevisionId: taxonomy.jd.jdRevisionId,
    sourceRef: 'jd:line:1',
    normalizedContent: 'Build reliable local systems.',
    requirementType: 'RESPONSIBILITY',
    priority: 'HIGH',
    explicitness: 'EXPLICIT',
    extractionStatus: 'EXTRACTED',
    uncertainty: { signal_type: 'EXTRACTION_UNCERTAINTY', value: 0, basis: 'RULE' },
  });
  const taxonomyResult = await taxonomy.store.intelligence.execute({
    analysisId: taxonomy.input.analysis_id,
    executor: { async execute(request) {
      return responseFor(request, {
        payload: {
          requirements: [candidateRequirement],
          matches: [{
            match_id: 'unknown-match',
            gap_id: 'unknown-gap',
            jd_revision_id: request.jd_revision_id,
            requirement_id: candidateRequirement.requirement_id,
            evidence_snapshot_id: request.evidence_snapshot_id,
            input_generation: request.input_generation,
            classification: 'UNKNOWN_TAXONOMY',
            decision_facts: {},
            evidence_revision_ids: [],
            missing_dimensions: [],
            explanation: 'unknown',
            explanation_details: {},
          }],
        },
      });
    } },
  });
  assert.equal(taxonomyResult.result_status, 'SCHEMA_INVALID');
  assert.equal(taxonomyResult.result_payload, null);
  assert.equal(taxonomy.store.intelligence.getRequirement(candidateRequirement.requirement_id), null);
  assert.equal(taxonomy.store.intelligence.getMatch('unknown-match'), null);

  const partial = setup({ executor: { async execute(request) {
    const partialResponse = responseFor(request, {
      result_status: 'PARTIAL',
      validation_status: 'INVALID',
      error: { classification: 'MALFORMED_RESPONSE', retryable: false },
    });
    delete partialResponse.payload;
    return partialResponse;
  } } });
  t.after(() => partial.close());
  const partialResult = await partial.store.intelligence.execute({ analysisId: partial.input.analysis_id });
  assert.equal(partialResult.result_status, 'PARTIAL');
  assert.equal(partialResult.result_payload, null);

  assert.throws(() => normalizeExecutionResponse({
    execution_id: 'e', idempotency_key: 'i', operation_type: 'ANALYZE_REQUIREMENTS',
    schema_version: 1, opportunity_id: 'o', jd_revision_id: 'j', evidence_snapshot_id: 's',
    input_generation: 'g', result_status: 'UNKNOWN', validation_status: 'VALID', payload: {},
  }), { code: 'EXECUTION_STATUS_UNSUPPORTED' });
  assert.throws(() => normalizeExecutionResponse({
    execution_id: 'e', idempotency_key: 'i', schema_version: 1,
    result_status: 'SUCCEEDED', validation_status: 'VALID', payload: {},
    error: { classification: 'PROVIDER_FAILURE', retryable: false },
  }), { code: 'EXECUTION_SCHEMA_INVALID' });
  assert.throws(() => normalizeExecutionResponse({
    execution_id: 'e', idempotency_key: 'i', schema_version: 2,
    result_status: 'SUCCEEDED', validation_status: 'VALID', payload: {},
  }), { code: 'EXECUTION_SCHEMA_UNSUPPORTED' });
  assert.throws(() => buildExecutionRequest({
    inputBundle: {
      execution_id: 'e', idempotency_key: 'i', operation_type: 'ANALYZE_REQUIREMENTS', schema_version: 1,
      opportunity_id: 'o', jd_revision_id: 'j', evidence_snapshot_id: 's', evidence_revision_ids: ['r'],
      input_generation: 'g', requested_at: '2026-09-18T00:00:00Z', disclosure_classification: 'LOCAL_ONLY',
    },
    payload: { jd: { jd_revision_id: 'j', content: 'JD', source_ref: null, private_field: 'reject' }, evidence: [{ evidence_revision_id: 'r', evidence_id: 'e', factual_content: 'fact', responsibility_boundary: 'boundary', outcome: 'outcome', provenance: { source: 'fixture' } }] },
  }), { code: 'EXECUTION_SCHEMA_INVALID' });

  assert.deepEqual(malformed.store.intelligence.projectSurfaceState({ hasSelection: false }), {
    content_state: 'SELECTION_REQUIRED', execution_state: 'IDLE',
  });
  assert.deepEqual(malformed.store.intelligence.projectSurfaceState({ hasSelection: true, hasCurrentResult: false, executionState: 'RUNNING' }), {
    content_state: 'LOADING', execution_state: 'RUNNING',
  });
  assert.deepEqual(malformed.store.intelligence.projectSurfaceState({ hasSelection: true, hasCurrentResult: true, executionState: 'FAILED' }), {
    content_state: 'AVAILABLE_CURRENT', execution_state: 'FAILED',
  });
  assert.deepEqual(malformed.store.intelligence.projectSurfaceState({ hasSelection: true, hasCurrentResult: true, currentResultFresh: false, executionState: 'FAILED' }), {
    content_state: 'STALE', execution_state: 'FAILED',
  });
  assert.deepEqual(malformed.store.intelligence.projectSurfaceState({ hasSelection: true, hasCurrentResult: true, currentResultFresh: false, executionState: 'CANCELLED' }), {
    content_state: 'STALE', execution_state: 'CANCELLED',
  });
  assert.deepEqual(malformed.store.intelligence.projectSurfaceState({ hasSelection: true, hasCurrentResult: true, currentResultFresh: false, executionState: 'STALE_RESULT_REJECTED' }), {
    content_state: 'STALE', execution_state: 'STALE_RESULT_REJECTED',
  });
  assert.throws(() => malformed.store.intelligence.projectSurfaceState({ hasSelection: true, contentState: 'UNKNOWN' }), { code: 'EXECUTION_UI_STATE_UNSUPPORTED' });
  assert.throws(() => malformed.store.intelligence.projectSurfaceState({ hasSelection: true, executionState: 'UNKNOWN' }), { code: 'EXECUTION_UI_STATE_UNSUPPORTED' });
});

test('execution state and result persist across close and reopen', async (t) => {
  const ctx = setup({ executor: { async execute(request) { return responseFor(request); } } });
  const root = ctx.root;
  const inputId = ctx.input.analysis_id;
  const executionId = ctx.input.execution_id;
  const result = await ctx.store.intelligence.execute({ analysisId: inputId });
  ctx.store.close();
  ctx.ownership.release();
  const privateRoot = validatePrivateRoot(root, { repositoryRoot: DEFAULT_REPOSITORY_ROOT });
  const ownership = acquireRootOwnership(privateRoot);
  const reopened = initializeOpportunityEvidenceStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership });
  t.after(() => {
    reopened.close();
    ownership.release();
    removeRoot(root);
  });
  const readBack = reopened.intelligence.getExecution(executionId);
  assert.equal(readBack.execution_state, result.execution_state);
  assert.equal(readBack.result_status, 'SUCCEEDED');
  assert.deepEqual(readBack.result_payload, { requirements: [] });
});

test('restart recovers an interrupted running execution to a deterministic terminal state', async (t) => {
  const ctx = setup({
    executionDefaults: { timeoutMs: 20, maxAttempts: 1 },
    executor: { async execute() { return new Promise(() => {}); } },
  });
  const pending = ctx.store.intelligence.execute({ analysisId: ctx.input.analysis_id });
  pending.catch(() => {});
  await waitForTurn();
  const root = ctx.root;
  ctx.store.close();
  ctx.ownership.release();
  let reopened;
  let ownership;
  t.after(() => {
    reopened?.close();
    ownership?.release();
    removeRoot(root);
  });
  const privateRoot = validatePrivateRoot(root, { repositoryRoot: DEFAULT_REPOSITORY_ROOT });
  ownership = acquireRootOwnership(privateRoot);
  reopened = initializeOpportunityEvidenceStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership });
  const readBack = reopened.intelligence.getExecution(ctx.input.execution_id);
  assert.equal(readBack.execution_state, 'FAILED');
  assert.equal(readBack.result_status, 'UNAVAILABLE');
  assert.equal(readBack.result_payload, null);
  assert.equal(readBack.is_current, false);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(fs.existsSync(foundationDatabasePath(privateRoot)), true);
});

test('restart fails closed when a persisted successful candidate is malformed', async (t) => {
  const ctx = setup({ executor: { async execute(request) { return responseFor(request); } } });
  const result = await ctx.store.intelligence.execute({ analysisId: ctx.input.analysis_id });
  assert.equal(result.result_status, 'SUCCEEDED');
  const root = ctx.root;
  const privateRoot = ctx.privateRoot;
  ctx.store.close();
  ctx.ownership.release();
  const database = new Database(foundationDatabasePath(privateRoot));
  database.prepare('UPDATE intelligence_executions SET result_payload_json = ? WHERE execution_id = ?').run(JSON.stringify({ unknown: true }), ctx.input.execution_id);
  database.close();
  let ownership;
  t.after(() => {
    ownership?.release();
    removeRoot(root);
  });
  ownership = acquireRootOwnership(privateRoot);
  assert.throws(() => initializeOpportunityEvidenceStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership }), { code: 'INTELLIGENCE_SCHEMA_INVALID' });
});

test('restart fails closed when a successful payload has a non-completed execution state', async (t) => {
  const ctx = setup({ executor: { async execute(request) { return responseFor(request); } } });
  const result = await ctx.store.intelligence.execute({ analysisId: ctx.input.analysis_id });
  assert.equal(result.result_status, 'SUCCEEDED');
  const root = ctx.root;
  const privateRoot = ctx.privateRoot;
  ctx.store.close();
  ctx.ownership.release();
  const database = new Database(foundationDatabasePath(privateRoot));
  database.prepare('UPDATE intelligence_executions SET execution_state = \'FAILED\' WHERE execution_id = ?').run(ctx.input.execution_id);
  database.close();
  let ownership;
  t.after(() => {
    ownership?.release();
    removeRoot(root);
  });
  ownership = acquireRootOwnership(privateRoot);
  assert.throws(() => initializeOpportunityEvidenceStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership }), { code: 'INTELLIGENCE_SCHEMA_INVALID' });
});
