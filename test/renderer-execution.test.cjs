const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const executionState = require('../src/renderer/execution-state.cjs');

const request = {
  opportunity_id: 'opportunity:renderer',
  jd_revision_id: 'jd:renderer:1',
  evidence_snapshot_id: 'evidence-snapshot:renderer:1',
  input_generation: 'generation:renderer:1',
};

function execution(executionStateValue, overrides = {}) {
  return {
    execution_id: 'execution:renderer:1',
    execution_state: executionStateValue,
    request,
    ...overrides,
  };
}

function currentResult(overrides = {}) {
  return execution('COMPLETED', {
    result_payload: { requirements: [{ requirement_id: 'requirement:renderer' }] },
    ...overrides,
  });
}

test('renderer preserves a current result for running, failed, cancelled, and timeout-terminal runs', () => {
  const current = currentResult();
  for (const state of ['RUNNING', 'FAILED', 'CANCELLED']) {
    assert.strictEqual(executionState.resolveCurrentResult(current, execution(state)), current);
  }
  assert.strictEqual(
    executionState.resolveCurrentResult(current, execution('FAILED', { result_status: 'TIMED_OUT' })),
    current,
  );
});

test('renderer rejects a stale generation and accepts a successful replacement', () => {
  const current = currentResult();
  const staleSameContext = execution('STALE_RESULT_REJECTED');
  assert.equal(executionState.resolveCurrentResult(current, staleSameContext), current);

  const stale = execution('STALE_RESULT_REJECTED', {
    request: { ...request, input_generation: 'generation:renderer:2' },
  });
  assert.equal(executionState.resolveCurrentResult(current, stale), null);

  const replacement = execution('COMPLETED', {
    request: { ...request, input_generation: 'generation:renderer:2' },
    result_payload: { requirements: [{ requirement_id: 'requirement:renderer:2' }] },
  });
  assert.equal(executionState.resolveCurrentResult(current, replacement), replacement);
});

test('renderer execution state helpers fail closed for unknown terminal states', () => {
  assert.equal(executionState.isTerminalExecution(execution('UNKNOWN')), false);
  assert.equal(executionState.sameExecutionContext(execution('COMPLETED'), execution('FAILED')), true);
  assert.equal(
    executionState.sameExecutionContext(
      execution('COMPLETED'),
      execution('FAILED', { request: { ...request, evidence_snapshot_id: 'evidence-snapshot:other' } }),
    ),
    false,
  );
});

test('renderer uses the purpose-specific begin/cancel boundary and separate current result state', () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'App.jsx'), 'utf8');
  assert.match(renderer, /api\.intelligence\.beginExecution\(/);
  assert.match(renderer, /api\.intelligence\.cancelExecution\(execution\.execution_id\)/);
  assert.match(renderer, /const payload = currentResult\?\.result_payload \|\| null/);
  assert.match(renderer, /disabled=\{!isRunning \|\| isStarting \|\| isCancelling\}/);
  assert.doesNotMatch(renderer, /ui-(?:execution|idempotency):|Date\.now\(\)/);
  assert.doesNotMatch(renderer, /disabled=\{busy \|\| execution\?\.execution_state !== 'RUNNING'\}/);
  assert.doesNotMatch(renderer, /nextExecution\?\.result_payload\?\.positioning/);
});
