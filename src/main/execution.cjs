const {
  OPERATION_TYPES,
  canonicalSerialize,
} = require('./intelligence.cjs');

const EXECUTION_CONTRACT_VERSION = 1;
const EXECUTION_STATES = Object.freeze([
  'RUNNING',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'STALE_RESULT_REJECTED',
]);
const RESULT_STATUSES = Object.freeze([
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
  'UNAVAILABLE',
  'PROVIDER_FAILURE',
  'MALFORMED',
  'SCHEMA_INVALID',
  'PARTIAL',
  'STALE',
  'DUPLICATE',
]);
const VALIDATION_STATUSES = Object.freeze(['VALID', 'INVALID', 'NOT_RUN']);
const CONTENT_STATES = Object.freeze([
  'SELECTION_REQUIRED',
  'LOADING',
  'EMPTY',
  'AVAILABLE_CURRENT',
  'STALE',
  'FAILED_UNAVAILABLE',
]);
const UI_EXECUTION_STATES = Object.freeze([
  'IDLE',
  'RUNNING',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'STALE_RESULT_REJECTED',
]);
const ERROR_CLASSES = Object.freeze([
  'CANCELLED',
  'DUPLICATE_COMPLETION',
  'MALFORMED_RESPONSE',
  'NON_RETRYABLE_PROVIDER_FAILURE',
  'PROVIDER_FAILURE',
  'SCHEMA_INVALID',
  'STALE_RESULT',
  'TIMEOUT',
  'UNAVAILABLE',
]);
const PAYLOAD_KEYS = Object.freeze(['jd', 'evidence']);
const JD_PAYLOAD_KEYS = Object.freeze(['jd_revision_id', 'content', 'source_ref']);
const EVIDENCE_PAYLOAD_KEYS = Object.freeze([
  'evidence_revision_id',
  'evidence_id',
  'factual_content',
  'responsibility_boundary',
  'outcome',
  'provenance',
]);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_CANCELLATION_GRACE_MS = 100;
const MAX_CANCELLATION_GRACE_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 3;

class ExecutionValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExecutionValidationError';
    this.code = code;
  }
}

function invalid(code, message) {
  throw new ExecutionValidationError(code, message);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('EXECUTION_SCHEMA_INVALID', `${fieldName} must be a structured object.`);
  }
  return value;
}

function assertKeys(value, allowed, fieldName) {
  assertObject(value, fieldName);
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    invalid('EXECUTION_SCHEMA_INVALID', `${fieldName} contains an unsupported field.`);
  }
}

function requiredText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    invalid('EXECUTION_SCHEMA_INVALID', `${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function finiteInteger(value, fieldName, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    invalid('EXECUTION_SCHEMA_INVALID', `${fieldName} must be a safe integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function normalizeTimestamp(value, fieldName) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    invalid('EXECUTION_SCHEMA_INVALID', `${fieldName} must be a valid timestamp.`);
  }
  return new Date(value).toISOString();
}

function cloneCanonical(value) {
  return JSON.parse(canonicalSerialize(value));
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
}

function normalizePayload(input) {
  assertKeys(input, PAYLOAD_KEYS, 'payload');
  const jd = input.jd;
  assertKeys(jd, JD_PAYLOAD_KEYS, 'payload.jd');
  const normalizedJd = {
    jd_revision_id: requiredText(jd.jd_revision_id, 'payload.jd.jd_revision_id'),
    content: requiredText(jd.content, 'payload.jd.content'),
    source_ref: cloneCanonical(jd.source_ref),
  };
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) {
    invalid('EXECUTION_EVIDENCE_INELIGIBLE', 'payload.evidence must contain at least one confirmed revision.');
  }
  const evidence = input.evidence.map((item, index) => {
    assertKeys(item, EVIDENCE_PAYLOAD_KEYS, `payload.evidence[${index}]`);
    return {
      evidence_revision_id: requiredText(item.evidence_revision_id, `payload.evidence[${index}].evidence_revision_id`),
      evidence_id: requiredText(item.evidence_id, `payload.evidence[${index}].evidence_id`),
      factual_content: requiredText(item.factual_content, `payload.evidence[${index}].factual_content`),
      responsibility_boundary: requiredText(item.responsibility_boundary, `payload.evidence[${index}].responsibility_boundary`),
      outcome: requiredText(item.outcome, `payload.evidence[${index}].outcome`),
      provenance: cloneCanonical(assertObject(item.provenance, `payload.evidence[${index}].provenance`)),
    };
  });
  return { jd: normalizedJd, evidence };
}

function buildExecutionRequest({ inputBundle, payload }) {
  assertObject(inputBundle, 'input_bundle');
  const operationType = requiredText(inputBundle.operation_type, 'input_bundle.operation_type');
  if (!OPERATION_TYPES.includes(operationType)) {
    invalid('EXECUTION_SCHEMA_INVALID', 'input_bundle.operation_type is unsupported.');
  }
  const schemaVersion = finiteInteger(inputBundle.schema_version, 'input_bundle.schema_version');
  if (schemaVersion !== EXECUTION_CONTRACT_VERSION) {
    invalid('EXECUTION_SCHEMA_UNSUPPORTED', 'input_bundle.schema_version is outside the accepted execution contract.');
  }
  const evidenceRevisionIds = inputBundle.evidence_revision_ids;
  if (!Array.isArray(evidenceRevisionIds) || evidenceRevisionIds.length === 0 || evidenceRevisionIds.some((id) => typeof id !== 'string' || id.trim() === '')) {
    invalid('EXECUTION_EVIDENCE_INELIGIBLE', 'input_bundle.evidence_revision_ids must be non-empty text identities.');
  }
  if (new Set(evidenceRevisionIds).size !== evidenceRevisionIds.length) {
    invalid('EXECUTION_EVIDENCE_INELIGIBLE', 'input_bundle.evidence_revision_ids must not contain duplicates.');
  }
  const normalizedPayload = normalizePayload(payload);
  if (normalizedPayload.jd.jd_revision_id !== inputBundle.jd_revision_id) {
    invalid('EXECUTION_PROVENANCE_INVALID', 'payload.jd.jd_revision_id does not match input_bundle.jd_revision_id.');
  }
  const payloadEvidenceIds = normalizedPayload.evidence.map((item) => item.evidence_revision_id);
  if (canonicalSerialize(payloadEvidenceIds) !== canonicalSerialize(evidenceRevisionIds)) {
    invalid('EXECUTION_PROVENANCE_INVALID', 'payload evidence identities do not match the immutable snapshot.');
  }
  return freezeDeep({
    contract_version: EXECUTION_CONTRACT_VERSION,
    execution_id: requiredText(inputBundle.execution_id, 'input_bundle.execution_id'),
    idempotency_key: requiredText(inputBundle.idempotency_key, 'input_bundle.idempotency_key'),
    operation_type: operationType,
    schema_version: schemaVersion,
    opportunity_id: requiredText(inputBundle.opportunity_id, 'input_bundle.opportunity_id'),
    jd_revision_id: requiredText(inputBundle.jd_revision_id, 'input_bundle.jd_revision_id'),
    evidence_snapshot_id: requiredText(inputBundle.evidence_snapshot_id, 'input_bundle.evidence_snapshot_id'),
    evidence_revision_ids: Object.freeze([...evidenceRevisionIds]),
    input_generation: requiredText(inputBundle.input_generation, 'input_bundle.input_generation'),
    requested_at: normalizeTimestamp(inputBundle.requested_at, 'input_bundle.requested_at'),
    disclosure_classification: requiredText(inputBundle.disclosure_classification, 'input_bundle.disclosure_classification'),
    payload: normalizedPayload,
  });
}

function normalizeError(input, fieldName = 'error') {
  assertKeys(input, ['classification', 'message', 'retryable'], fieldName);
  const classification = requiredText(input.classification, `${fieldName}.classification`);
  if (!ERROR_CLASSES.includes(classification)) {
    invalid('EXECUTION_SCHEMA_INVALID', `${fieldName}.classification is unsupported.`);
  }
  if (typeof input.retryable !== 'boolean') {
    invalid('EXECUTION_SCHEMA_INVALID', `${fieldName}.retryable must be boolean.`);
  }
  if (input.message !== undefined && (typeof input.message !== 'string' || input.message.length > 256)) {
    invalid('EXECUTION_SCHEMA_INVALID', `${fieldName}.message must be at most 256 characters.`);
  }
  return {
    classification,
    ...(input.message === undefined ? {} : { message: input.message }),
    retryable: input.retryable,
  };
}

function normalizeExecutionResponse(input, request) {
  assertKeys(input, [
    'execution_id',
    'idempotency_key',
    'operation_type',
    'schema_version',
    'opportunity_id',
    'jd_revision_id',
    'evidence_snapshot_id',
    'input_generation',
    'result_status',
    'validation_status',
    'payload',
    'error',
  ], 'execution_response');
  const response = {
    execution_id: requiredText(input.execution_id, 'execution_response.execution_id'),
    idempotency_key: requiredText(input.idempotency_key, 'execution_response.idempotency_key'),
    schema_version: finiteInteger(input.schema_version, 'execution_response.schema_version'),
    result_status: requiredText(input.result_status, 'execution_response.result_status'),
    validation_status: requiredText(input.validation_status, 'execution_response.validation_status'),
  };
  if (response.schema_version !== EXECUTION_CONTRACT_VERSION) {
    invalid('EXECUTION_SCHEMA_UNSUPPORTED', 'execution_response.schema_version is outside the accepted execution contract.');
  }
  const echoedIdentityFields = [
    ['operation_type', requiredText],
    ['opportunity_id', requiredText],
    ['jd_revision_id', requiredText],
    ['evidence_snapshot_id', requiredText],
    ['input_generation', requiredText],
  ];
  for (const [field, normalizer] of echoedIdentityFields) {
    if (hasOwn(input, field)) {
      response[field] = normalizer(input[field], `execution_response.${field}`);
    } else if (request && request[field] !== undefined) {
      response[field] = request[field];
    }
  }
  if (!RESULT_STATUSES.includes(response.result_status)) {
    invalid('EXECUTION_STATUS_UNSUPPORTED', 'execution_response.result_status is unsupported.');
  }
  if (!VALIDATION_STATUSES.includes(response.validation_status)) {
    invalid('EXECUTION_STATUS_UNSUPPORTED', 'execution_response.validation_status is unsupported.');
  }
  if (request) {
    for (const field of ['execution_id', 'idempotency_key', 'schema_version', 'operation_type', 'opportunity_id', 'jd_revision_id', 'evidence_snapshot_id', 'input_generation']) {
      if (response[field] === undefined) continue;
      if (response[field] !== request[field]) {
        invalid('EXECUTION_PROVENANCE_INVALID', `execution_response.${field} does not match the request.`);
      }
    }
  }
  const success = response.result_status === 'SUCCEEDED';
  if (hasOwn(input, 'payload')) {
    if (input.payload === null) {
      invalid('EXECUTION_SCHEMA_INVALID', 'execution_response.payload cannot be null.');
    }
    response.payload = cloneCanonical(assertObject(input.payload, 'execution_response.payload'));
  }
  if (success) {
    if (response.validation_status !== 'VALID' || !hasOwn(response, 'payload')) {
      invalid('EXECUTION_SCHEMA_INVALID', 'SUCCEEDED response requires VALID validation and a structured payload.');
    }
  } else if (hasOwn(response, 'payload')) {
    invalid('EXECUTION_SCHEMA_INVALID', 'Non-success response cannot carry a usable payload.');
  } else if (response.validation_status === 'VALID') {
    invalid('EXECUTION_SCHEMA_INVALID', 'Non-success response cannot declare a VALID payload.');
  }
  if (hasOwn(input, 'error')) {
    if (success) invalid('EXECUTION_SCHEMA_INVALID', 'Successful response cannot carry an error classification.');
    response.error = normalizeError(input.error);
  } else if (!success) {
    invalid('EXECUTION_SCHEMA_INVALID', 'Non-success response requires a safe error classification.');
  }
  if (success && response.validation_status !== 'VALID') {
    invalid('EXECUTION_SCHEMA_INVALID', 'Successful response validation status is invalid.');
  }
  return freezeDeep(response);
}

function responseForFailure(request, resultStatus, classification, retryable, message) {
  return normalizeExecutionResponse({
    execution_id: request.execution_id,
    idempotency_key: request.idempotency_key,
    operation_type: request.operation_type,
    schema_version: request.schema_version,
    opportunity_id: request.opportunity_id,
    jd_revision_id: request.jd_revision_id,
    evidence_snapshot_id: request.evidence_snapshot_id,
    input_generation: request.input_generation,
    result_status: resultStatus,
    validation_status: 'NOT_RUN',
    error: { classification, retryable, ...(message ? { message } : {}) },
  }, request);
}

function isRetryableResponse(response) {
  return ['TIMED_OUT', 'UNAVAILABLE', 'PROVIDER_FAILURE'].includes(response.result_status)
    && response.error?.retryable === true;
}

function projectSurfaceState(input = {}) {
  assertObject(input, 'surface_state_input');
  const hasSelection = input.hasSelection ?? input.has_selection ?? false;
  const loading = input.loading === true;
  const hasCurrentResult = input.hasCurrentResult ?? input.has_current_result ?? false;
  const currentResultFresh = input.currentResultFresh ?? input.current_result_fresh ?? true;
  const executionState = input.executionState ?? input.execution_state ?? 'IDLE';
  const assertedContentState = input.contentState ?? input.content_state;
  for (const [value, field] of [[hasSelection, 'hasSelection'], [loading, 'loading'], [hasCurrentResult, 'hasCurrentResult'], [currentResultFresh, 'currentResultFresh']]) {
    if (typeof value !== 'boolean') invalid('EXECUTION_UI_STATE_INVALID', `${field} must be boolean.`);
  }
  if (!UI_EXECUTION_STATES.includes(executionState)) invalid('EXECUTION_UI_STATE_UNSUPPORTED', 'execution state is outside the accepted UI vocabulary.');
  if (assertedContentState !== undefined && !CONTENT_STATES.includes(assertedContentState)) invalid('EXECUTION_UI_STATE_UNSUPPORTED', 'content state is outside the accepted UI vocabulary.');
  if (!hasSelection) return Object.freeze({ content_state: 'SELECTION_REQUIRED', execution_state: 'IDLE' });
  if (loading) return Object.freeze({ content_state: 'LOADING', execution_state: 'IDLE' });
  const baseContent = hasCurrentResult ? (currentResultFresh ? 'AVAILABLE_CURRENT' : 'STALE') : 'EMPTY';
  if (executionState === 'RUNNING') {
    return Object.freeze({ content_state: hasCurrentResult ? baseContent : 'LOADING', execution_state: 'RUNNING' });
  }
  if (executionState === 'COMPLETED') {
    return Object.freeze({ content_state: currentResultFresh && hasCurrentResult ? 'AVAILABLE_CURRENT' : 'STALE', execution_state: currentResultFresh && hasCurrentResult ? 'COMPLETED' : 'IDLE' });
  }
  if (executionState === 'FAILED') {
    return Object.freeze({ content_state: hasCurrentResult ? (currentResultFresh ? 'AVAILABLE_CURRENT' : 'STALE') : 'FAILED_UNAVAILABLE', execution_state: 'FAILED' });
  }
  if (executionState === 'CANCELLED') {
    return Object.freeze({ content_state: hasCurrentResult ? (currentResultFresh ? 'AVAILABLE_CURRENT' : 'STALE') : 'EMPTY', execution_state: 'CANCELLED' });
  }
  if (executionState === 'STALE_RESULT_REJECTED') {
    return Object.freeze({ content_state: hasCurrentResult ? (currentResultFresh ? 'AVAILABLE_CURRENT' : 'STALE') : 'EMPTY', execution_state: 'STALE_RESULT_REJECTED' });
  }
  return Object.freeze({ content_state: baseContent, execution_state: 'IDLE' });
}

function createUnavailableExecutor() {
  return Object.freeze({
    async execute() {
      return null;
    },
  });
}

function createExecutionService({ persistence, executor, now = () => new Date(), defaults = {} } = {}) {
  if (!persistence || typeof persistence.createExecutionRecord !== 'function') {
    throw new TypeError('Execution persistence adapter is required.');
  }
  const defaultTimeoutMs = defaults.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultCancellationGraceMs = defaults.cancellationGraceMs ?? DEFAULT_CANCELLATION_GRACE_MS;
  const defaultMaxAttempts = defaults.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  finiteInteger(defaultTimeoutMs, 'timeoutMs', 1, MAX_TIMEOUT_MS);
  finiteInteger(defaultCancellationGraceMs, 'cancellationGraceMs', 0, MAX_CANCELLATION_GRACE_MS);
  finiteInteger(defaultMaxAttempts, 'maxAttempts', 1, 10);
  const inFlight = new Map();
  const activeAttempts = new Map();

  const currentTime = () => {
    const value = now();
    return value instanceof Date ? value : new Date(value);
  };

  function configFor(input = {}) {
    const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
    const cancellationGraceMs = input.cancellationGraceMs ?? defaultCancellationGraceMs;
    const maxAttempts = input.maxAttempts ?? defaultMaxAttempts;
    finiteInteger(timeoutMs, 'timeoutMs', 1, MAX_TIMEOUT_MS);
    finiteInteger(cancellationGraceMs, 'cancellationGraceMs', 0, MAX_CANCELLATION_GRACE_MS);
    finiteInteger(maxAttempts, 'maxAttempts', 1, 10);
    return { timeoutMs, cancellationGraceMs, maxAttempts };
  }

  async function runAttempt(record, input, config) {
    const attemptRecord = persistence.beginExecutionAttempt(record.execution_id);
    if (attemptRecord.execution_state !== 'RUNNING') return attemptRecord;
    const request = attemptRecord.request;
    const selectedExecutor = input.executor || executor;
    if (!selectedExecutor || typeof selectedExecutor.execute !== 'function') {
      const response = responseForFailure(request, 'UNAVAILABLE', 'UNAVAILABLE', false, 'No executor capability is available.');
      return persistence.recordExecutionResult(record.execution_id, response, { now: currentTime().toISOString() });
    }
    const controller = new AbortController();
    let cancelRequested = false;
    let cancelTimer;
    let resolveCancellation;
    const cancellation = new Promise((resolve) => { resolveCancellation = resolve; });
    const context = {
      requestCancellation() {
        if (cancelRequested) return;
        cancelRequested = true;
        controller.abort();
        cancelTimer = setTimeout(() => resolveCancellation('grace-expired'), config.cancellationGraceMs);
      },
    };
    activeAttempts.set(record.execution_id, context);
    const providerPromise = Promise.resolve().then(() => {
      const result = selectedExecutor.execute(request, {
        signal: controller.signal,
        execution_id: request.execution_id,
        attempt: attemptRecord.attempt,
      });
      if (!result || typeof result.then !== 'function') {
        const error = new Error('Executor capability must return a promise-like result.');
        error.retryable = false;
        throw error;
      }
      return result;
    });
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve('timeout'), config.timeoutMs);
    });
    let outcome;
    try {
      outcome = await Promise.race([
        providerPromise.then(
          (value) => ({ kind: 'response', value }),
          (error) => ({ kind: 'error', error }),
        ),
        timeout,
        cancellation.then(() => 'cancel'),
      ]);
    } finally {
      clearTimeout(timer);
      if (cancelTimer) clearTimeout(cancelTimer);
      activeAttempts.delete(record.execution_id);
    }
    if (cancelRequested || outcome === 'cancel') {
      const cancellationAcknowledged = Boolean(outcome && (outcome.kind === 'response' || outcome.kind === 'error'));
      return persistence.recordExecutionResult(
        record.execution_id,
        responseForFailure(request, 'CANCELLED', 'CANCELLED', false, 'Execution was cancelled.'),
        { cancellationAcknowledged, now: currentTime().toISOString() },
      );
    }
    if (outcome === 'timeout') {
      controller.abort();
      const response = responseForFailure(request, 'TIMED_OUT', 'TIMEOUT', true, 'Execution exceeded its bounded timeout.');
      if (attemptRecord.attempt < config.maxAttempts) {
        const retryRecord = persistence.recordExecutionResult(record.execution_id, response, { retrying: true, now: currentTime().toISOString() });
        if (retryRecord.execution_state !== 'RUNNING') return retryRecord;
        return runAttempt(record, input, config);
      }
      return persistence.recordExecutionResult(record.execution_id, response, { now: currentTime().toISOString() });
    }
    let response;
    if (outcome?.kind === 'response') {
      try {
        response = normalizeExecutionResponse(outcome.value, request);
      } catch (error) {
        const status = ['EXECUTION_STATUS_UNSUPPORTED', 'EXECUTION_SCHEMA_UNSUPPORTED'].includes(error.code)
          ? 'SCHEMA_INVALID'
          : 'MALFORMED';
        response = responseForFailure(
          request,
          status,
          status === 'MALFORMED' ? 'MALFORMED_RESPONSE' : 'SCHEMA_INVALID',
          false,
          'Executor response failed the finite execution contract.',
        );
      }
    } else {
      const retryable = outcome?.error?.retryable === true;
      response = responseForFailure(
        request,
        retryable ? 'PROVIDER_FAILURE' : 'PROVIDER_FAILURE',
        retryable ? 'PROVIDER_FAILURE' : 'NON_RETRYABLE_PROVIDER_FAILURE',
        retryable,
        'Executor failed before returning a structured response.',
      );
    }
    if (isRetryableResponse(response) && attemptRecord.attempt < config.maxAttempts) {
      const retryRecord = persistence.recordExecutionResult(record.execution_id, response, { retrying: true, now: currentTime().toISOString() });
      if (retryRecord.execution_state !== 'RUNNING') return retryRecord;
      return runAttempt(record, input, config);
    }
    return persistence.recordExecutionResult(record.execution_id, response, { now: currentTime().toISOString() });
  }

  function begin(input = {}) {
    const config = configFor(input);
    const record = persistence.createExecutionRecord({ ...input, maxAttempts: config.maxAttempts });
    if (['COMPLETED', 'CANCELLED', 'FAILED', 'STALE_RESULT_REJECTED'].includes(record.execution_state)) {
      return Object.freeze({ record, promise: Promise.resolve(record) });
    }
    if (inFlight.has(record.execution_id)) {
      return Object.freeze({ record, promise: inFlight.get(record.execution_id) });
    }
    const promise = runAttempt(record, input, config).catch((error) => {
      let current;
      try {
        current = persistence.getExecutionRecord(record.execution_id);
        if (current?.execution_state === 'RUNNING') {
          return persistence.recordExecutionResult(
            record.execution_id,
            responseForFailure(current.request, 'FAILED', 'UNAVAILABLE', false, 'Execution failed before reaching a terminal result.'),
          );
        }
      } catch {
        // Preserve the original failure when the persistence boundary cannot record the safe terminal state.
      }
      throw error;
    }).finally(() => inFlight.delete(record.execution_id));
    inFlight.set(record.execution_id, promise);
    return Object.freeze({ record, promise });
  }

  async function execute(input = {}) {
    return begin(input).promise;
  }

  async function cancel(executionId) {
    const id = requiredText(executionId, 'execution_id');
    const active = activeAttempts.get(id);
    if (active) {
      active.requestCancellation();
      return inFlight.get(id) || persistence.getExecutionRecord(id);
    }
    return persistence.cancelExecutionRecord(id, { now: currentTime().toISOString() });
  }

  function complete(executionId, response) {
    const id = requiredText(executionId, 'execution_id');
    if (inFlight.has(id)) invalid('EXECUTION_COMPLETION_IN_FLIGHT', 'External completion is not accepted while the bounded executor call is active.');
    const record = persistence.getExecutionRecord(id);
    if (!record) invalid('EXECUTION_NOT_FOUND', 'Execution does not exist.');
    const normalized = normalizeExecutionResponse(response, record.request);
    return persistence.recordExecutionResult(record.execution_id, normalized, { now: currentTime().toISOString() });
  }

  return Object.freeze({
    buildRequest: buildExecutionRequest,
    begin,
    cancel,
    complete,
    execute,
    get: (executionId) => persistence.getExecutionRecord(requiredText(executionId, 'execution_id')),
    projectSurfaceState,
    constants: Object.freeze({
      contentStates: CONTENT_STATES,
      contractVersion: EXECUTION_CONTRACT_VERSION,
      errorClasses: ERROR_CLASSES,
      executionStates: EXECUTION_STATES,
      maxCancellationGraceMs: MAX_CANCELLATION_GRACE_MS,
      maxTimeoutMs: MAX_TIMEOUT_MS,
      resultStatuses: RESULT_STATUSES,
      uiExecutionStates: UI_EXECUTION_STATES,
      validationStatuses: VALIDATION_STATUSES,
    }),
  });
}

module.exports = {
  DEFAULT_CANCELLATION_GRACE_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
  CONTENT_STATES,
  ERROR_CLASSES,
  EXECUTION_CONTRACT_VERSION,
  EXECUTION_STATES,
  ExecutionValidationError,
  MAX_CANCELLATION_GRACE_MS,
  MAX_TIMEOUT_MS,
  RESULT_STATUSES,
  VALIDATION_STATUSES,
  UI_EXECUTION_STATES,
  buildExecutionRequest,
  createExecutionService,
  isRetryableResponse,
  normalizeExecutionResponse,
  normalizePayload,
  projectSurfaceState,
  responseForFailure,
};
