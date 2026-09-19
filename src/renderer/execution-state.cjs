const TERMINAL_EXECUTION_STATES = new Set([
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'STALE_RESULT_REJECTED',
]);

const CONTEXT_FIELDS = ['opportunity_id', 'jd_revision_id', 'evidence_snapshot_id', 'input_generation'];

function requestFor(execution) {
  return execution?.request || execution || null;
}

function sameExecutionContext(left, right) {
  const leftRequest = requestFor(left);
  const rightRequest = requestFor(right);
  return Boolean(leftRequest && rightRequest)
    && CONTEXT_FIELDS.every((field) => leftRequest[field] === rightRequest[field]);
}

function preserveCurrentResult(currentResult, nextExecution) {
  return Boolean(currentResult?.result_payload)
    && sameExecutionContext(currentResult, nextExecution);
}

function resolveCurrentResult(currentResult, nextExecution) {
  if (nextExecution?.execution_state === 'COMPLETED' && nextExecution.result_payload) return nextExecution;
  return preserveCurrentResult(currentResult, nextExecution) ? currentResult : null;
}

function isTerminalExecution(execution) {
  return TERMINAL_EXECUTION_STATES.has(execution?.execution_state);
}

module.exports = {
  CONTEXT_FIELDS,
  TERMINAL_EXECUTION_STATES,
  isTerminalExecution,
  preserveCurrentResult,
  requestFor,
  resolveCurrentResult,
  sameExecutionContext,
};
