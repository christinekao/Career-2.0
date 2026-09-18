const crypto = require('node:crypto');

const IDENTITY_CONTRACT_VERSION = 1;
const MATCHING_CONTRACT_VERSION = 1;
const GAP_CONTRACT_VERSION = 1;
const POSITIONING_CONTRACT_VERSION = 1;

const REQUIREMENT_TYPES = Object.freeze([
  'RESPONSIBILITY',
  'OUTCOME',
  'SKILL',
  'CONSTRAINT',
  'QUALIFICATION',
  'PREFERENCE',
  'UNKNOWN',
]);
const PRIORITIES = Object.freeze(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);
const EXPLICITNESS = Object.freeze(['EXPLICIT', 'INFERRED']);
const EXTRACTION_STATUSES = Object.freeze(['EXTRACTED', 'INFERRED', 'UNAVAILABLE', 'REJECTED']);
const UNCERTAINTY_BASES = Object.freeze(['RULE', 'MODEL', 'USER_REVIEW']);
const MATCH_CLASSIFICATIONS = Object.freeze([
  'DIRECT',
  'STRONG_ADJACENT',
  'PARTIAL',
  'NO_MATCH',
  'INSUFFICIENT_EVIDENCE',
]);
const POSITIONING_STATES = Object.freeze(['DRAFT', 'CANDIDATE', 'CONFIRMED', 'STALE', 'REJECTED']);
const OPERATION_TYPES = Object.freeze(['ANALYZE_REQUIREMENTS', 'CLASSIFY_MATCHES', 'DRAFT_POSITIONING']);
const CLAIM_KINDS = Object.freeze(['SUPPORTED', 'LIMITATION', 'UNKNOWN', 'FOLLOW_UP']);
const SOURCE_LOCATOR_PATTERN = /^(?:jd:)?(?:line:\d+|offset:\d+(?:-\d+)?)$/i;
const UNAVAILABLE_LOCATOR_PATTERN = /^unavailable:[^\s]+$/i;

class IntelligenceValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IntelligenceValidationError';
    this.code = code;
  }
}

function invalid(code, message) {
  throw new IntelligenceValidationError(code, message);
}

function assertFiniteInteger(value, fieldName, { minimum = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    invalid('INTELLIGENCE_INVALID_INPUT', `${fieldName} must be a safe integer >= ${minimum}.`);
  }
  return value;
}

function requiredText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    invalid('INTELLIGENCE_INVALID_INPUT', `${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalText(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, fieldName);
}

function normalizeTimestamp(value, fieldName = 'requested_at') {
  const candidate = value === undefined ? new Date().toISOString() : value;
  if (typeof candidate !== 'string' || Number.isNaN(Date.parse(candidate))) {
    invalid('INTELLIGENCE_INVALID_INPUT', `${fieldName} must be a valid timestamp.`);
  }
  return new Date(candidate).toISOString();
}

function canonicalSerialize(value) {
  const render = (candidate) => {
    if (candidate === null) return 'null';
    if (typeof candidate === 'string') return JSON.stringify(candidate);
    if (typeof candidate === 'boolean') return candidate ? 'true' : 'false';
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) invalid('INTELLIGENCE_CANONICAL_INVALID', 'Canonical input contains a non-finite number.');
      return Object.is(candidate, -0) ? '0' : JSON.stringify(candidate);
    }
    if (typeof candidate !== 'object') {
      invalid('INTELLIGENCE_CANONICAL_INVALID', 'Canonical input contains an unsupported value.');
    }
    if (Array.isArray(candidate)) return `[${candidate.map(render).join(',')}]`;
    return `{${Object.keys(candidate).sort().map((key) => `${JSON.stringify(key)}:${render(candidate[key])}`).join(',')}}`;
  };
  return render(value);
}

function digestCanonical(value) {
  return crypto.createHash('sha256').update(canonicalSerialize(value), 'utf8').digest('hex');
}

function identity(prefix, value) {
  return `${prefix}:${digestCanonical(value)}`;
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDeep);
  return Object.freeze(value);
}

function asArray(value, fieldName, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    invalid('INTELLIGENCE_INVALID_INPUT', `${fieldName} must be a non-empty array.`);
  }
  return value;
}

function orderedIds(value, fieldName, { allowEmpty = false } = {}) {
  const values = asArray(value, fieldName, { allowEmpty });
  const result = values.map((item) => requiredText(item, `${fieldName}[]`));
  if (new Set(result).size !== result.length) {
    invalid('INTELLIGENCE_DUPLICATE_ID', `${fieldName} must not contain duplicate identities.`);
  }
  return result;
}

function buildAnalysisId({ opportunityId, jdRevisionId, analysisGeneration }) {
  const generation = analysisGeneration === undefined || analysisGeneration === null
    ? invalid('INTELLIGENCE_INVALID_INPUT', 'analysis_generation must be provided.')
    : requiredText(String(analysisGeneration), 'analysis_generation');
  return `analysis:${requiredText(opportunityId, 'opportunity_id')}:${requiredText(jdRevisionId, 'jd_revision_id')}:${generation}`;
}

function buildEvidenceSnapshotId({ contractVersion = IDENTITY_CONTRACT_VERSION, evidenceRevisionIds, inputGeneration }) {
  const ids = orderedIds(evidenceRevisionIds, 'evidence_revision_ids');
  // Preserve the application-owned generation so a re-evaluation cannot reuse
  // a relation identity from an older current input even when revision IDs repeat.
  return identity('evidence_snapshot', {
    contract_version: assertFiniteInteger(contractVersion, 'contract_version', { minimum: 1 }),
    evidence_revision_ids: ids,
    input_generation: inputGeneration === undefined || inputGeneration === null ? null : String(inputGeneration),
  });
}

function buildRequirementId({ contractVersion = IDENTITY_CONTRACT_VERSION, jdRevisionId, sourceRef, normalizedContent, requirementType }) {
  return identity('requirement', {
    contract_version: assertFiniteInteger(contractVersion, 'contract_version', { minimum: 1 }),
    jd_revision_id: requiredText(jdRevisionId, 'jd_revision_id'),
    source_ref: normalizeSourceRef(sourceRef),
    normalized_content: requiredText(normalizedContent, 'normalized_content'),
    requirement_type: requireEnum(requirementType, REQUIREMENT_TYPES, 'requirement_type'),
  });
}

function buildMatchId({ contractVersion = MATCHING_CONTRACT_VERSION, jdRevisionId, requirementId, evidenceSnapshotId }) {
  return identity('match', {
    contract_version: assertFiniteInteger(contractVersion, 'contract_version', { minimum: 1 }),
    jd_revision_id: requiredText(jdRevisionId, 'jd_revision_id'),
    requirement_id: requiredText(requirementId, 'requirement_id'),
    evidence_snapshot_id: requiredText(evidenceSnapshotId, 'evidence_snapshot_id'),
  });
}

function buildGapId({ contractVersion = GAP_CONTRACT_VERSION, jdRevisionId, requirementId, evidenceSnapshotId }) {
  return identity('gap', {
    gap_contract: 'gap',
    contract_version: assertFiniteInteger(contractVersion, 'contract_version', { minimum: 1 }),
    jd_revision_id: requiredText(jdRevisionId, 'jd_revision_id'),
    requirement_id: requiredText(requirementId, 'requirement_id'),
    evidence_snapshot_id: requiredText(evidenceSnapshotId, 'evidence_snapshot_id'),
  });
}

function buildPositioningVersionId({ opportunityId, versionNumber }) {
  return `pos:${requiredText(opportunityId, 'opportunity_id')}:${assertFiniteInteger(versionNumber, 'version_number', { minimum: 1 })}`;
}

function buildPositioningClaimId({ positioningVersionId, ordinal }) {
  return `${requiredText(positioningVersionId, 'positioning_version_id')}:claim:${assertFiniteInteger(ordinal, 'claim_ordinal', { minimum: 1 })}`;
}

function requireEnum(value, allowed, fieldName) {
  if (!allowed.includes(value)) invalid('INTELLIGENCE_UNKNOWN_STATE', `${fieldName} is not an accepted finite value.`);
  return value;
}

function normalizeSourceRef(value) {
  const isSupportedLocator = (locator) => SOURCE_LOCATOR_PATTERN.test(locator) || UNAVAILABLE_LOCATOR_PATTERN.test(locator);
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text || /\s/.test(text) || !isSupportedLocator(text)) {
      invalid('INTELLIGENCE_SOURCE_ANCHOR_INVALID', 'source_ref must be a deterministic JD source anchor.');
    }
    return text;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('INTELLIGENCE_SOURCE_ANCHOR_INVALID', 'source_ref must identify a deterministic JD source anchor.');
  }
  const allowedFields = new Set(['locator', 'jd_revision_id', 'start', 'end']);
  if (Object.keys(value).some((key) => !allowedFields.has(key))) {
    invalid('INTELLIGENCE_SOURCE_ANCHOR_INVALID', 'source_ref object contains an unsupported field.');
  }
  const locator = value.locator;
  if (typeof locator !== 'string' || locator.trim() === '' || /\s/.test(locator) || !isSupportedLocator(locator.trim())) {
    invalid('INTELLIGENCE_SOURCE_ANCHOR_INVALID', 'source_ref object must contain a deterministic locator.');
  }
  const normalizedLocator = locator.trim();
  const normalized = { locator: normalizedLocator };
  if (value.jd_revision_id !== undefined) normalized.jd_revision_id = requiredText(value.jd_revision_id, 'source_ref.jd_revision_id');
  if (value.end !== undefined && value.start === undefined) {
    invalid('INTELLIGENCE_SOURCE_ANCHOR_INVALID', 'source_ref.end requires source_ref.start.');
  }
  if (value.start !== undefined) normalized.start = assertFiniteInteger(value.start, 'source_ref.start', { minimum: 0 });
  if (value.end !== undefined) normalized.end = assertFiniteInteger(value.end, 'source_ref.end', { minimum: 0 });
  if (normalized.start !== undefined && normalized.end !== undefined && normalized.end < normalized.start) {
    invalid('INTELLIGENCE_SOURCE_ANCHOR_INVALID', 'source_ref.end must not precede source_ref.start.');
  }
  if (UNAVAILABLE_LOCATOR_PATTERN.test(normalizedLocator) && (normalized.jd_revision_id || normalized.start !== undefined || normalized.end !== undefined)) {
    invalid('INTELLIGENCE_SOURCE_ANCHOR_INVALID', 'Unavailable source anchors cannot carry JD or range metadata.');
  }
  const lineLocator = /^(?:jd:)?line:\d+$/i.test(normalizedLocator);
  const offsetMatch = /^(?:jd:)?offset:(\d+)(?:-(\d+))?$/i.exec(normalizedLocator);
  if (lineLocator && (normalized.start !== undefined || normalized.end !== undefined)) {
    invalid('INTELLIGENCE_SOURCE_ANCHOR_INVALID', 'Line source anchors cannot carry offset range metadata.');
  }
  if (normalized.start !== undefined && !offsetMatch) {
    invalid('INTELLIGENCE_SOURCE_ANCHOR_INVALID', 'Offset range metadata requires an offset source locator.');
  }
  if (offsetMatch && normalized.start !== undefined) {
    const locatorStart = Number(offsetMatch[1]);
    const locatorEnd = offsetMatch[2] === undefined ? locatorStart : Number(offsetMatch[2]);
    const metadataEnd = normalized.end === undefined ? normalized.start : normalized.end;
    if (normalized.start !== locatorStart || metadataEnd !== locatorEnd) {
      invalid('INTELLIGENCE_SOURCE_ANCHOR_INVALID', 'source_ref range metadata does not match its locator.');
    }
  }
  return JSON.parse(canonicalSerialize(normalized));
}

function normalizeUncertainty(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('INTELLIGENCE_UNCERTAINTY_INVALID', 'uncertainty must be a structured object.');
  }
  const signalType = value.signal_type ?? value.signalType;
  const basis = value.basis;
  const numericValue = value.value;
  if (signalType !== 'EXTRACTION_UNCERTAINTY') {
    invalid('INTELLIGENCE_UNCERTAINTY_INVALID', 'uncertainty.signal_type is invalid.');
  }
  if (typeof numericValue !== 'number' || !Number.isFinite(numericValue) || numericValue < 0 || numericValue > 1) {
    invalid('INTELLIGENCE_UNCERTAINTY_INVALID', 'uncertainty.value must be a finite decimal from 0 through 1.');
  }
  requireEnum(basis, UNCERTAINTY_BASES, 'uncertainty.basis');
  return { signal_type: signalType, value: numericValue, basis };
}

function validateRequirement(input = {}) {
  const contractVersion = input.contract_version ?? input.contractVersion ?? IDENTITY_CONTRACT_VERSION;
  const jdRevisionId = requiredText(resolveAliasedField(input, 'jd_revision_id', 'jdRevisionId', 'jd_revision_id'), 'jd_revision_id');
  const sourceRef = normalizeSourceRef(resolveAliasedField(input, 'source_ref', 'sourceRef', 'source_ref'));
  if (typeof sourceRef === 'object' && sourceRef.jd_revision_id !== undefined && sourceRef.jd_revision_id !== jdRevisionId) {
    invalid('INTELLIGENCE_SOURCE_ANCHOR_INVALID', 'source_ref.jd_revision_id must match jd_revision_id.');
  }
  const normalizedContent = requiredText(input.normalized_content ?? input.normalizedContent, 'normalized_content');
  const requirementType = requireEnum(input.requirement_type ?? input.requirementType, REQUIREMENT_TYPES, 'requirement_type');
  const priority = requireEnum(input.priority, PRIORITIES, 'priority');
  const explicitness = requireEnum(input.explicitness, EXPLICITNESS, 'explicitness');
  const extractionStatus = requireEnum(input.extraction_status ?? input.extractionStatus, EXTRACTION_STATUSES, 'extraction_status');
  const uncertainty = normalizeUncertainty(input.uncertainty);
  const requirementId = buildRequirementId({
    contractVersion,
    jdRevisionId,
    sourceRef,
    normalizedContent,
    requirementType,
  });
  const suppliedId = resolveAliasedField(input, 'requirement_id', 'requirementId', 'requirement_id');
  if (suppliedId !== undefined && suppliedId !== requirementId) {
    invalid('INTELLIGENCE_IDENTITY_MISMATCH', 'requirement_id does not match immutable requirement inputs.');
  }
  const sourceLocator = typeof sourceRef === 'string' ? sourceRef : sourceRef.locator ?? sourceRef.anchor ?? sourceRef.source;
  const sourceUnavailable = typeof sourceLocator === 'string' && /^unavailable:/i.test(sourceLocator);
  const ready = !sourceUnavailable && extractionStatus !== 'UNAVAILABLE' && extractionStatus !== 'REJECTED';
  return freezeDeep({
    requirement_id: requirementId,
    jd_revision_id: jdRevisionId,
    source_ref: sourceRef,
    normalized_content: normalizedContent,
    requirement_type: requirementType,
    priority,
    explicitness,
    uncertainty,
    extraction_status: extractionStatus,
    contract_version: assertFiniteInteger(contractVersion, 'contract_version', { minimum: 1 }),
    ready,
  });
}

function validateMatchableRequirement(input = {}) {
  const requirement = validateRequirement(input);
  if (!requirement.ready) invalid('INTELLIGENCE_REQUIREMENT_NOT_READY', 'Requirement is not ready for matching.');
  if (requirement.priority !== 'HIGH') {
    invalid('INTELLIGENCE_REQUIREMENT_NOT_READY', 'Only HIGH-priority requirements may be matched.');
  }
  return requirement;
}

function evidenceRevisionObject(revision) {
  if (!revision || typeof revision !== 'object' || Array.isArray(revision)) {
    invalid('INTELLIGENCE_EVIDENCE_INELIGIBLE', 'Evidence revision is missing.');
  }
  const evidenceRevisionId = requiredText(resolveAliasedField(revision, 'evidence_revision_id', 'evidenceRevisionId', 'evidence_revision_id'), 'evidence_revision_id');
  const evidenceId = requiredText(resolveAliasedField(revision, 'evidence_id', 'evidenceId', 'evidence_id'), 'evidence_id');
  const confirmationState = revision.confirmation_state ?? revision.confirmationState;
  if (confirmationState !== 'CONFIRMED') {
    invalid('INTELLIGENCE_EVIDENCE_INELIGIBLE', `Evidence revision ${evidenceRevisionId} is not CONFIRMED.`);
  }
  const provenance = revision.provenance ?? (revision.provenance_json ? parseJson(revision.provenance_json, 'provenance_json') : null);
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance) || Object.keys(provenance).length === 0) {
    invalid('INTELLIGENCE_PROVENANCE_INVALID', `Evidence revision ${evidenceRevisionId} has invalid provenance.`);
  }
  const factualContent = requiredText(revision.factual_content ?? revision.factualContent, 'factual_content');
  const responsibilityBoundary = requiredText(revision.responsibility_boundary ?? revision.responsibilityBoundary, 'responsibility_boundary');
  const outcome = requiredText(revision.outcome, 'outcome');
  return {
    evidence_revision_id: evidenceRevisionId,
    evidence_id: evidenceId,
    confirmation_state: confirmationState,
    provenance: JSON.parse(canonicalSerialize(provenance)),
    factual_content: factualContent,
    responsibility_boundary: responsibilityBoundary,
    outcome,
  };
}

function parseJson(value, fieldName) {
  try {
    return JSON.parse(value);
  } catch {
    invalid('INTELLIGENCE_PROVENANCE_INVALID', `${fieldName} is not valid JSON.`);
  }
}

function buildEvidenceSnapshot(input = {}) {
  const ids = orderedIds(resolveAliasedField(input, 'evidence_revision_ids', 'evidenceRevisionIds', 'evidence_revision_ids'), 'evidence_revision_ids');
  const revisions = asArray(resolveAliasedField(input, 'evidence_revisions', 'evidenceRevisions', 'evidence_revisions'), 'evidence_revisions');
  const byId = new Map();
  revisions.forEach((revision) => {
    const normalized = evidenceRevisionObject(revision);
    if (byIdHasDuplicate(byId, normalized.evidence_revision_id)) {
      invalid('INTELLIGENCE_DUPLICATE_ID', `Duplicate Evidence revision ${normalized.evidence_revision_id}.`);
    }
    byId.set(normalized.evidence_revision_id, normalized);
  });
  const selected = ids.map((id) => {
    const revision = byId.get(id);
    if (!revision) invalid('INTELLIGENCE_EVIDENCE_REVISION_MISSING', `Evidence revision ${id} is missing.`);
    return revision;
  });
  const expectedEvidenceId = resolveAliasedField(input, 'expected_evidence_id', 'expectedEvidenceId', 'expected_evidence_id');
  const evidenceId = expectedEvidenceId ? requiredText(expectedEvidenceId, 'expected_evidence_id') : selected[0].evidence_id;
  if (selected.some((revision) => revision.evidence_id !== evidenceId)) {
    invalid('INTELLIGENCE_EVIDENCE_IDENTITY_MISMATCH', 'Selected Evidence revisions do not belong to one expected Evidence identity.');
  }
  const rawGeneration = resolveAliasedField(input, 'input_generation', 'inputGeneration', 'input_generation');
  if (rawGeneration === undefined || rawGeneration === null) invalid('INTELLIGENCE_INVALID_INPUT', 'input_generation must be provided.');
  const inputGeneration = requiredText(String(rawGeneration), 'input_generation');
  const contractVersion = input.contract_version ?? input.contractVersion ?? IDENTITY_CONTRACT_VERSION;
  const snapshot = {
    evidence_snapshot_id: buildEvidenceSnapshotId({ contractVersion, evidenceRevisionIds: ids, inputGeneration }),
    contract_version: assertFiniteInteger(contractVersion, 'contract_version', { minimum: 1 }),
    evidence_id: evidenceId,
    evidence_revision_ids: ids,
    evidence_revisions: selected,
    input_generation: inputGeneration,
  };
  return freezeDeep(snapshot);
}

function byIdHasDuplicate(map, id) {
  return map.has(id);
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') invalid('INTELLIGENCE_EVIDENCE_INELIGIBLE', 'Evidence snapshot is missing.');
  const rebuilt = buildEvidenceSnapshot({
    contractVersion: snapshot.contract_version ?? snapshot.contractVersion,
    evidenceRevisionIds: resolveAliasedField(snapshot, 'evidence_revision_ids', 'evidenceRevisionIds', 'evidence_revision_ids'),
    evidenceRevisions: resolveAliasedField(snapshot, 'evidence_revisions', 'evidenceRevisions', 'evidence_revisions'),
    expectedEvidenceId: resolveAliasedField(snapshot, 'evidence_id', 'evidenceId', 'evidence_id'),
    inputGeneration: resolveAliasedField(snapshot, 'input_generation', 'inputGeneration', 'input_generation'),
  });
  const suppliedId = resolveAliasedField(snapshot, 'evidence_snapshot_id', 'evidenceSnapshotId', 'evidence_snapshot_id');
  if (suppliedId !== rebuilt.evidence_snapshot_id) invalid('INTELLIGENCE_IDENTITY_MISMATCH', 'evidence_snapshot_id does not match immutable snapshot inputs.');
  return rebuilt;
}

function buildInputBundle(input = {}) {
  const snapshot = validateSnapshot(resolveAliasedField(input, 'evidence_snapshot', 'evidenceSnapshot', 'evidence_snapshot'));
  const opportunityId = requiredText(input.opportunity_id ?? input.opportunityId, 'opportunity_id');
  const jdRevisionId = requiredText(resolveAliasedField(input, 'jd_revision_id', 'jdRevisionId', 'jd_revision_id'), 'jd_revision_id');
  const operationType = requireEnum(input.operation_type ?? input.operationType, OPERATION_TYPES, 'operation_type');
  const schemaVersion = input.schema_version ?? input.schemaVersion ?? 1;
  const executionId = requiredText(input.execution_id ?? input.executionId, 'execution_id');
  const idempotencyKey = requiredText(input.idempotency_key ?? input.idempotencyKey, 'idempotency_key');
  const rawGeneration = resolveAliasedField(input, 'input_generation', 'inputGeneration', 'input_generation');
  if (rawGeneration === undefined || rawGeneration === null) invalid('INTELLIGENCE_INVALID_INPUT', 'input_generation must be provided.');
  const inputGeneration = requiredText(String(rawGeneration), 'input_generation');
  const requestedAt = normalizeTimestamp(input.requested_at ?? input.requestedAt);
  const disclosureClassification = requiredText(input.disclosure_classification ?? input.disclosureClassification, 'disclosure_classification');
  if (snapshot.input_generation !== inputGeneration) invalid('INTELLIGENCE_GENERATION_MISMATCH', 'Input generation does not match Evidence snapshot generation.');
  const suppliedAnalysisGeneration = input.analysis_generation ?? input.analysisGeneration;
  if (suppliedAnalysisGeneration !== undefined && String(suppliedAnalysisGeneration) !== inputGeneration) {
    invalid('INTELLIGENCE_GENERATION_MISMATCH', 'analysis_generation must match input_generation.');
  }
  const analysisGeneration = inputGeneration;
  const bundle = {
    analysis_id: buildAnalysisId({ opportunityId, jdRevisionId, analysisGeneration }),
    opportunity_id: opportunityId,
    jd_revision_id: jdRevisionId,
    evidence_snapshot_id: snapshot.evidence_snapshot_id,
    evidence_revision_ids: snapshot.evidence_revision_ids,
    operation_type: operationType,
    schema_version: assertFiniteInteger(schemaVersion, 'schema_version', { minimum: 1 }),
    execution_id: executionId,
    idempotency_key: idempotencyKey,
    input_generation: inputGeneration,
    requested_at: requestedAt,
    disclosure_classification: disclosureClassification,
  };
  return freezeDeep(bundle);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function aliasedValuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  try {
    return canonicalSerialize(left) === canonicalSerialize(right);
  } catch {
    return false;
  }
}

function resolveAliasedField(value, snake, camel, fieldName = snake, conflictCode = 'INTELLIGENCE_IDENTITY_MISMATCH') {
  const hasSnake = hasOwn(value, snake);
  const hasCamel = camel ? hasOwn(value, camel) : false;
  if (hasSnake && hasCamel && !aliasedValuesEqual(value[snake], value[camel])) {
    invalid(conflictCode, `${fieldName} aliases do not agree.`);
  }
  if (hasSnake) return value[snake];
  if (hasCamel) return value[camel];
  return undefined;
}

function readAliased(value, snake, camel) {
  return resolveAliasedField(value, snake, camel, snake, 'INTELLIGENCE_MATCH_INVALID');
}

const EVALUATION_FIELDS = new Set([
  'complete_support',
  'completeSupport',
  'adjacent_support',
  'adjacentSupport',
  'partial_support',
  'partialSupport',
  'evidence_complete',
  'evidenceComplete',
  'ambiguous',
  'isAmbiguous',
  'evidence_available',
  'evidenceAvailable',
  'no_match',
  'supported_evidence_revision_ids',
  'supportedEvidenceRevisionIds',
  'missing_dimensions',
  'missingDimensions',
  'boundary',
  'explanation',
  'explanation_details',
]);

function normalizeEvaluation(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    invalid('INTELLIGENCE_MATCH_INVALID', 'matching input must be a structured object.');
  }
  const hasNestedEvaluation = hasOwn(input, 'evaluation');
  const topLevelFields = new Set(['requirement', 'evidence_snapshot', 'evidenceSnapshot', 'classification', 'evaluation']);
  const allowedInputFields = hasNestedEvaluation
    ? topLevelFields
    : new Set([...EVALUATION_FIELDS, ...topLevelFields]);
  if (Object.keys(input).some((key) => !allowedInputFields.has(key))) {
    invalid('INTELLIGENCE_MATCH_INVALID', 'matching input contains an unsupported field.');
  }
  const value = hasNestedEvaluation ? input.evaluation : input;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('INTELLIGENCE_MATCH_INVALID', 'evaluation must be a structured decision record.');
  }
  const allowedFields = hasNestedEvaluation ? EVALUATION_FIELDS : allowedInputFields;
  if (Object.keys(value).some((key) => !allowedFields.has(key))) {
    invalid('INTELLIGENCE_MATCH_INVALID', 'evaluation contains an unsupported decision field.');
  }
  const readBoolean = (snake, camel, fallback = false) => {
    const candidate = readAliased(value, snake, camel);
    if (candidate === undefined) return fallback;
    if (typeof candidate !== 'boolean') invalid('INTELLIGENCE_MATCH_INVALID', `${snake} must be boolean.`);
    return candidate;
  };
  const rawMissingDimensions = readAliased(value, 'missing_dimensions', 'missingDimensions');
  const missingDimensions = rawMissingDimensions === undefined ? [] : rawMissingDimensions;
  if (!Array.isArray(missingDimensions)) invalid('INTELLIGENCE_MATCH_INVALID', 'missing_dimensions must be an array.');
  const rawEvidenceAvailable = readAliased(value, 'evidence_available', 'evidenceAvailable');
  const evidenceAvailable = rawEvidenceAvailable === undefined ? true : rawEvidenceAvailable;
  if (typeof evidenceAvailable !== 'boolean') invalid('INTELLIGENCE_MATCH_INVALID', 'evidence_available must be boolean.');
  return {
    complete_support: readBoolean('complete_support', 'completeSupport'),
    adjacent_support: readBoolean('adjacent_support', 'adjacentSupport'),
    partial_support: readBoolean('partial_support', 'partialSupport'),
    evidence_complete: readBoolean('evidence_complete', 'evidenceComplete'),
    ambiguous: readBoolean('ambiguous', 'isAmbiguous'),
    evidence_available: evidenceAvailable,
    no_match: readBoolean('no_match', null),
    supported_evidence_revision_ids: (() => {
      const raw = readAliased(value, 'supported_evidence_revision_ids', 'supportedEvidenceRevisionIds');
      return raw === undefined ? [] : raw;
    })(),
    missing_dimensions: missingDimensions,
    boundary: hasOwn(value, 'boundary') ? value.boundary : undefined,
    explanation: hasOwn(value, 'explanation') ? value.explanation : undefined,
    explanation_details: hasOwn(value, 'explanation_details') ? value.explanation_details : undefined,
  };
}

const DECISION_FACT_FIELDS = Object.freeze([
  'complete_support',
  'adjacent_support',
  'partial_support',
  'evidence_complete',
  'ambiguous',
  'evidence_available',
  'no_match',
]);

function normalizeDecisionFacts(input = {}) {
  const raw = readAliased(input, 'decision_facts', 'decisionFacts');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    invalid('INTELLIGENCE_MATCH_INVALID', 'decision_facts must be a structured decision record.');
  }
  if (Object.keys(raw).some((field) => !DECISION_FACT_FIELDS.includes(field))) {
    invalid('INTELLIGENCE_MATCH_INVALID', 'decision_facts contains an unsupported decision field.');
  }
  const facts = {};
  for (const field of DECISION_FACT_FIELDS) {
    if (field === 'no_match' && !hasOwn(raw, field)) {
      facts[field] = false;
      continue;
    }
    if (!hasOwn(raw, field)) {
      invalid('INTELLIGENCE_MATCH_INVALID', `decision_facts.${field} must be provided.`);
    }
    const value = raw[field];
    if (typeof value !== 'boolean') invalid('INTELLIGENCE_MATCH_INVALID', `decision_facts.${field} must be boolean.`);
    facts[field] = value;
  }
  return facts;
}

function deriveClassification({ decisionFacts, evidenceIds, missingDimensions }) {
  if (decisionFacts.ambiguous || decisionFacts.evidence_available === false) return 'INSUFFICIENT_EVIDENCE';
  if (hasUnsafeDecisionConflict({ decisionFacts, evidenceIds, missingDimensions })) return 'INSUFFICIENT_EVIDENCE';
  if (decisionFacts.evidence_complete && decisionFacts.complete_support && evidenceIds.length > 0 && missingDimensions.length === 0) return 'DIRECT';
  if (decisionFacts.evidence_complete && decisionFacts.adjacent_support && evidenceIds.length > 0) return 'STRONG_ADJACENT';
  if (decisionFacts.evidence_complete && decisionFacts.partial_support && evidenceIds.length > 0 && missingDimensions.length > 0) return 'PARTIAL';
  if (decisionFacts.evidence_complete) return 'NO_MATCH';
  return 'INSUFFICIENT_EVIDENCE';
}

function hasUnsafeDecisionConflict({ decisionFacts, evidenceIds, missingDimensions }) {
  const supportedRelations = [
    decisionFacts.complete_support,
    decisionFacts.adjacent_support,
    decisionFacts.partial_support,
  ].filter(Boolean).length;
  if (supportedRelations > 1) return true;
  if (decisionFacts.no_match && supportedRelations > 0) return true;
  if (decisionFacts.complete_support && (evidenceIds.length === 0 || missingDimensions.length > 0)) return true;
  if (decisionFacts.partial_support && missingDimensions.length === 0) return true;
  if (decisionFacts.evidence_complete && supportedRelations === 0 && missingDimensions.length > 0) return true;
  return false;
}

const GENERIC_EXPLANATIONS = new Set([
  'complete evaluation found no supported relation.',
  'evaluation remains limited by available evidence.',
  'insufficient evidence.',
  'n/a',
  'na',
  'none',
  'unknown',
  'tbd',
  'placeholder',
]);

const EXPLANATION_FIELDS_BY_CLASSIFICATION = Object.freeze({
  DIRECT: Object.freeze(['support_summary', 'scope_summary']),
  STRONG_ADJACENT: Object.freeze(['transferable_support', 'direct_boundary']),
  PARTIAL: Object.freeze(['supported_dimensions', 'missing_dimensions']),
  NO_MATCH: Object.freeze(['evaluation_basis', 'unsupported_relation_summary']),
  INSUFFICIENT_EVIDENCE: Object.freeze(['insufficiency_reason']),
});
const INSUFFICIENCY_REASONS = new Set([
  'MISSING_EVIDENCE',
  'AMBIGUOUS_EVIDENCE',
  'INCOMPLETE_EVALUATION',
  'CONFLICTING_DECISION_FACTS',
]);

function normalizeExplanationDetails(classification, value, missingDimensions) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('INTELLIGENCE_MATCH_INVALID', `${classification} requires structured explanation_details.`);
  }
  const fields = EXPLANATION_FIELDS_BY_CLASSIFICATION[classification];
  if (!fields || Object.keys(value).some((field) => !fields.includes(field))) {
    invalid('INTELLIGENCE_MATCH_INVALID', `${classification} explanation_details contains an unsupported field.`);
  }
  const details = {};
  const requiredDetailText = (field) => {
    details[field] = requiredText(value[field], `explanation_details.${field}`);
  };
  const requiredDetailList = (field) => {
    if (!Array.isArray(value[field]) || value[field].length === 0) {
      invalid('INTELLIGENCE_MATCH_INVALID', `explanation_details.${field} must be a non-empty array.`);
    }
    details[field] = value[field].map((item) => requiredText(item, `explanation_details.${field}[]`));
  };
  if (classification === 'PARTIAL') {
    requiredDetailList('supported_dimensions');
    requiredDetailList('missing_dimensions');
    if (canonicalSerialize(details.missing_dimensions) !== canonicalSerialize(missingDimensions)) {
      invalid('INTELLIGENCE_MATCH_INVALID', 'PARTIAL explanation_details.missing_dimensions must match missing_dimensions.');
    }
  } else if (classification === 'INSUFFICIENT_EVIDENCE') {
    requiredDetailText('insufficiency_reason');
    if (!INSUFFICIENCY_REASONS.has(details.insufficiency_reason)) {
      invalid('INTELLIGENCE_MATCH_INVALID', 'INSUFFICIENT_EVIDENCE explanation_details.insufficiency_reason is not an accepted reason.');
    }
  } else {
    fields.forEach(requiredDetailText);
  }
  return details;
}

function renderClassificationExplanation(classification, details) {
  switch (classification) {
    case 'DIRECT':
      return `${details.support_summary} Scope: ${details.scope_summary}`;
    case 'STRONG_ADJACENT':
      return `${details.transferable_support} Boundary: ${details.direct_boundary}`;
    case 'PARTIAL':
      return `${details.supported_dimensions.join(', ')} supported; missing dimensions: ${details.missing_dimensions.join(', ')}`;
    case 'NO_MATCH':
      return `${details.evaluation_basis} No supported relation: ${details.unsupported_relation_summary}`;
    case 'INSUFFICIENT_EVIDENCE':
      return `Insufficient evidence: ${{
        MISSING_EVIDENCE: 'required Evidence is missing.',
        AMBIGUOUS_EVIDENCE: 'the Evidence is ambiguous.',
        INCOMPLETE_EVALUATION: 'the evaluation is incomplete.',
        CONFLICTING_DECISION_FACTS: 'the decision facts conflict.',
      }[details.insufficiency_reason]}`;
    default:
      invalid('INTELLIGENCE_MATCH_INVALID', 'Match classification is outside the explanation contract.');
  }
}

function validateClassificationExplanation(classification, value, rawDetails, missingDimensions) {
  const explanation = requiredText(value, 'explanation');
  const details = normalizeExplanationDetails(classification, rawDetails, missingDimensions);
  const expected = renderClassificationExplanation(classification, details);
  const normalized = explanation.toLowerCase().replace(/\s+/g, ' ').trim();
  if (GENERIC_EXPLANATIONS.has(normalized) || explanation !== expected) {
    invalid('INTELLIGENCE_MATCH_INVALID', `${classification} requires a classification-specific explanation.`);
  }
  return { explanation, explanation_details: details };
}

function classifyMatch(input = {}) {
  const requirement = validateMatchableRequirement(input.requirement);
  const snapshot = validateSnapshot(resolveAliasedField(input, 'evidence_snapshot', 'evidenceSnapshot', 'evidence_snapshot'));
  const evaluation = normalizeEvaluation(input);
  const evidenceIds = orderedIds(evaluation.supported_evidence_revision_ids, 'supported_evidence_revision_ids', { allowEmpty: true });
  const missingDimensions = orderedIds(evaluation.missing_dimensions, 'missing_dimensions', { allowEmpty: true });
  if (evidenceIds.some((id) => !snapshot.evidence_revision_ids.includes(id))) {
    invalid('INTELLIGENCE_PROVENANCE_INVALID', 'Match references Evidence outside its immutable snapshot.');
  }
  const requestedClassification = input.classification;
  if (requestedClassification !== undefined && !MATCH_CLASSIFICATIONS.includes(requestedClassification)) {
    invalid('INTELLIGENCE_UNKNOWN_TAXONOMY', 'Match classification is outside the accepted taxonomy.');
  }
  const decisionFacts = {
    complete_support: evaluation.complete_support,
    adjacent_support: evaluation.adjacent_support,
    partial_support: evaluation.partial_support,
    evidence_complete: evaluation.evidence_complete,
    ambiguous: evaluation.ambiguous,
    evidence_available: evaluation.evidence_available,
    no_match: evaluation.no_match,
  };
  const derivedClassification = deriveClassification({ decisionFacts, evidenceIds, missingDimensions });
  if (requestedClassification !== undefined && requestedClassification !== derivedClassification) {
    invalid('INTELLIGENCE_MATCH_INVALID', 'classification does not match the validated decision facts.');
  }
  const classification = derivedClassification;
  const { explanation, explanation_details: explanationDetails } = validateClassificationExplanation(
    classification,
    evaluation.explanation,
    evaluation.explanation_details,
    missingDimensions,
  );
  if (classification === 'DIRECT') {
    if (!evaluation.evidence_available || !evaluation.evidence_complete || !evaluation.complete_support || evidenceIds.length === 0 || missingDimensions.length > 0 || evaluation.ambiguous) {
      invalid('INTELLIGENCE_MATCH_INVALID', 'DIRECT requires complete, unambiguous material support.');
    }
  } else if (classification === 'STRONG_ADJACENT') {
    if (!evaluation.evidence_available || !evaluation.evidence_complete || !evaluation.adjacent_support || evidenceIds.length === 0 || !optionalText(evaluation.boundary, 'boundary')) {
      invalid('INTELLIGENCE_MATCH_INVALID', 'STRONG_ADJACENT requires transferable support and an explicit boundary.');
    }
  } else if (classification === 'PARTIAL') {
    if (!evaluation.evidence_available || !evaluation.evidence_complete || !evaluation.partial_support || evidenceIds.length === 0 || missingDimensions.length === 0) {
      invalid('INTELLIGENCE_MATCH_INVALID', 'PARTIAL requires supported material dimensions and missing dimensions.');
    }
  } else if (classification === 'NO_MATCH') {
    if (!evaluation.evidence_complete || evaluation.ambiguous || evaluation.complete_support || evaluation.adjacent_support || evaluation.partial_support || missingDimensions.length > 0) {
      invalid('INTELLIGENCE_MATCH_INVALID', 'NO_MATCH requires complete evaluation and no supported relation.');
    }
  } else if (
    classification === 'INSUFFICIENT_EVIDENCE'
    && !evaluation.ambiguous
    && evaluation.evidence_available !== false
    && evaluation.evidence_complete
    && !hasUnsafeDecisionConflict({ decisionFacts, evidenceIds, missingDimensions })
  ) {
    invalid('INTELLIGENCE_MATCH_INVALID', 'INSUFFICIENT_EVIDENCE requires an unsafe or incomplete evaluation.');
  }
  const matchId = buildMatchId({
    jdRevisionId: requirement.jd_revision_id,
    requirementId: requirement.requirement_id,
    evidenceSnapshotId: snapshot.evidence_snapshot_id,
  });
  const result = {
    match_id: matchId,
    gap_id: classification === 'DIRECT' ? null : buildGapId({
      jdRevisionId: requirement.jd_revision_id,
      requirementId: requirement.requirement_id,
      evidenceSnapshotId: snapshot.evidence_snapshot_id,
    }),
    jd_revision_id: requirement.jd_revision_id,
    requirement_id: requirement.requirement_id,
    evidence_snapshot_id: snapshot.evidence_snapshot_id,
    input_generation: snapshot.input_generation,
    classification,
    decision_facts: decisionFacts,
    evidence_revision_ids: evidenceIds,
    missing_dimensions: missingDimensions,
    explanation,
    explanation_details: explanationDetails,
    ...(classification === 'STRONG_ADJACENT' ? { boundary: optionalText(evaluation.boundary, 'boundary') } : {}),
  };
  return freezeDeep(result);
}

function validateMatchRecord(input = {}, snapshot, requirement) {
  if (!MATCH_CLASSIFICATIONS.includes(input.classification)) invalid('INTELLIGENCE_UNKNOWN_TAXONOMY', 'Match classification is outside the accepted taxonomy.');
  const matchId = resolveAliasedField(input, 'match_id', 'matchId', 'match_id');
  const jdRevisionId = resolveAliasedField(input, 'jd_revision_id', 'jdRevisionId', 'jd_revision_id');
  const requirementId = resolveAliasedField(input, 'requirement_id', 'requirementId', 'requirement_id');
  const evidenceSnapshotId = resolveAliasedField(input, 'evidence_snapshot_id', 'evidenceSnapshotId', 'evidence_snapshot_id');
  const suppliedInputGeneration = resolveAliasedField(input, 'input_generation', 'inputGeneration', 'input_generation');
  const suppliedGapId = resolveAliasedField(input, 'gap_id', 'gapId', 'gap_id') ?? null;
  if (requirement !== undefined) {
    const matchableRequirement = validateMatchableRequirement(requirement);
    if (matchableRequirement.requirement_id !== requirementId) invalid('INTELLIGENCE_PROVENANCE_INVALID', 'Match requirement does not match the validated requirement.');
    if (matchableRequirement.jd_revision_id !== jdRevisionId) invalid('INTELLIGENCE_PROVENANCE_INVALID', 'Match JD revision does not match the validated requirement.');
  }
  const fixedSnapshot = validateSnapshot(snapshot);
  if (evidenceSnapshotId !== undefined && evidenceSnapshotId !== fixedSnapshot.evidence_snapshot_id) {
    invalid('INTELLIGENCE_PROVENANCE_INVALID', 'Match Evidence snapshot does not match the immutable snapshot.');
  }
  if (suppliedInputGeneration !== undefined && suppliedInputGeneration !== fixedSnapshot.input_generation) {
    invalid('INTELLIGENCE_GENERATION_MISMATCH', 'Match input generation does not match the immutable snapshot.');
  }
  const expectedMatchId = buildMatchId({
    jdRevisionId,
    requirementId,
    evidenceSnapshotId: fixedSnapshot.evidence_snapshot_id,
  });
  if (matchId !== expectedMatchId) invalid('INTELLIGENCE_IDENTITY_MISMATCH', 'match_id does not match immutable inputs.');
  const evidenceIds = orderedIds(input.evidence_revision_ids, 'evidence_revision_ids', { allowEmpty: true });
  if (evidenceIds.some((id) => !fixedSnapshot.evidence_revision_ids.includes(id))) invalid('INTELLIGENCE_PROVENANCE_INVALID', 'Match Evidence is outside its snapshot.');
  const missingDimensions = orderedIds(input.missing_dimensions ?? [], 'missing_dimensions', { allowEmpty: true });
  const decisionFacts = normalizeDecisionFacts(input);
  const expectedClassification = deriveClassification({ decisionFacts, evidenceIds, missingDimensions });
  if (input.classification !== expectedClassification) invalid('INTELLIGENCE_MATCH_INVALID', 'classification does not match the persisted decision facts.');
  const { explanation, explanation_details: explanationDetails } = validateClassificationExplanation(
    input.classification,
    input.explanation,
    input.explanation_details,
    missingDimensions,
  );
  if (
    input.classification === 'INSUFFICIENT_EVIDENCE'
    && !decisionFacts.ambiguous
    && decisionFacts.evidence_available !== false
    && decisionFacts.evidence_complete
    && !hasUnsafeDecisionConflict({ decisionFacts, evidenceIds, missingDimensions })
  ) {
    invalid('INTELLIGENCE_MATCH_INVALID', 'INSUFFICIENT_EVIDENCE requires an unsafe or incomplete evaluation.');
  }
  if (input.classification === 'DIRECT' && (evidenceIds.length === 0 || missingDimensions.length > 0 || suppliedGapId !== null)) {
    invalid('INTELLIGENCE_MATCH_INVALID', 'DIRECT requires confirmed Evidence references and no material limitation.');
  }
  if (input.classification === 'STRONG_ADJACENT' && (evidenceIds.length === 0 || !optionalText(input.boundary, 'boundary'))) {
    invalid('INTELLIGENCE_MATCH_INVALID', 'STRONG_ADJACENT requires confirmed Evidence references and an explicit boundary.');
  }
  if (input.classification === 'PARTIAL' && (evidenceIds.length === 0 || missingDimensions.length === 0)) {
    invalid('INTELLIGENCE_MATCH_INVALID', 'PARTIAL requires confirmed Evidence references and missing dimensions.');
  }
  const gapId = input.classification === 'DIRECT' ? null : buildGapId({
    jdRevisionId,
    requirementId,
    evidenceSnapshotId: fixedSnapshot.evidence_snapshot_id,
  });
  if (input.classification !== 'DIRECT' && suppliedGapId !== gapId) invalid('INTELLIGENCE_IDENTITY_MISMATCH', 'gap_id does not match immutable inputs.');
  return freezeDeep({
    match_id: matchId,
    gap_id: gapId,
    jd_revision_id: jdRevisionId,
    requirement_id: requirementId,
    evidence_snapshot_id: fixedSnapshot.evidence_snapshot_id,
    input_generation: fixedSnapshot.input_generation,
    classification: input.classification,
    decision_facts: decisionFacts,
    evidence_revision_ids: evidenceIds,
    missing_dimensions: missingDimensions,
    explanation,
    explanation_details: explanationDetails,
    ...(input.classification === 'STRONG_ADJACENT' ? { boundary: optionalText(input.boundary, 'boundary') } : {}),
  });
}

function serializeMatchExplanation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('INTELLIGENCE_MATCH_INVALID', 'Match explanation must be structured.');
  }
  return canonicalSerialize({
    explanation: requiredText(value.explanation, 'explanation'),
    explanation_details: value.explanation_details,
  });
}

function parseMatchExplanation(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    invalid('INTELLIGENCE_MATCH_INVALID', 'Persisted match explanation is missing.');
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    invalid('INTELLIGENCE_MATCH_INVALID', 'Persisted match explanation is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    invalid('INTELLIGENCE_MATCH_INVALID', 'Persisted match explanation must be structured.');
  }
  if (Object.keys(parsed).some((key) => !['explanation', 'explanation_details'].includes(key))) {
    invalid('INTELLIGENCE_MATCH_INVALID', 'Persisted match explanation contains an unsupported field.');
  }
  return {
    explanation: requiredText(parsed.explanation, 'explanation'),
    explanation_details: parsed.explanation_details,
  };
}

function validateTraceability({ jdSourceRef, jdRevisionId, requirement, match, snapshot }) {
  const validRequirement = validateMatchableRequirement(requirement);
  const fixedSnapshot = validateSnapshot(snapshot);
  const validMatch = validateMatchRecord(match, fixedSnapshot, validRequirement);
  if (validRequirement.jd_revision_id !== requiredText(jdRevisionId, 'jd_revision_id')) invalid('INTELLIGENCE_PROVENANCE_INVALID', 'Requirement JD revision does not match provenance chain.');
  if (validMatch.requirement_id !== validRequirement.requirement_id || validMatch.jd_revision_id !== validRequirement.jd_revision_id) {
    invalid('INTELLIGENCE_PROVENANCE_INVALID', 'Match does not resolve to its requirement and JD revision.');
  }
  const sourceRef = jdSourceRef === undefined ? validRequirement.source_ref : normalizeSourceRef(jdSourceRef);
  if (canonicalSerialize(sourceRef) !== canonicalSerialize(validRequirement.source_ref)) {
    invalid('INTELLIGENCE_PROVENANCE_INVALID', 'JD source anchor does not resolve to the requirement source anchor.');
  }
  const edges = [
    { edge_type: 'JD_SOURCE_TO_REVISION', jd_source_ref: sourceRef, jd_revision_id: validRequirement.jd_revision_id },
    { edge_type: 'REVISION_TO_REQUIREMENT', jd_revision_id: validRequirement.jd_revision_id, requirement_id: validRequirement.requirement_id },
    { edge_type: validMatch.gap_id ? 'REQUIREMENT_TO_GAP' : 'REQUIREMENT_TO_MATCH', requirement_id: validRequirement.requirement_id, match_id: validMatch.match_id, gap_id: validMatch.gap_id },
  ];
  for (const evidenceRevisionId of validMatch.evidence_revision_ids) {
    edges.push({ edge_type: 'MATCH_TO_CONFIRMED_EVIDENCE', match_id: validMatch.match_id, gap_id: validMatch.gap_id, evidence_revision_id: evidenceRevisionId });
  }
  return freezeDeep({
    jd_source_ref: sourceRef,
    jd_revision_id: validRequirement.jd_revision_id,
    requirement_id: validRequirement.requirement_id,
    match_id: validMatch.match_id,
    gap_id: validMatch.gap_id,
    evidence_revision_ids: validMatch.evidence_revision_ids,
    input_generation: fixedSnapshot.input_generation,
    provenance_edges: edges,
  });
}

function validatePositioningClaimEdges(input = {}) {
  const positioningVersionId = requiredText(resolveAliasedField(input, 'positioning_version_id', 'positioningVersionId', 'positioning_version_id'), 'positioning_version_id');
  const requirements = new Map(asArray(input.requirements, 'requirements').map((item) => {
    const requirement = validateRequirement(item);
    return [requirement.requirement_id, requirement];
  }));
  const rawMatches = asArray(input.matches, 'matches', { allowEmpty: true });
  const snapshot = validateSnapshot(resolveAliasedField(input, 'evidence_snapshot', 'evidenceSnapshot', 'evidence_snapshot'));
  const matches = new Map(rawMatches.map((item) => {
    const requirement = requirements.get(resolveAliasedField(item, 'requirement_id', 'requirementId', 'requirement_id'));
    const match = validateMatchRecord(item, snapshot, requirement);
    return [match.match_id, match];
  }));
  const gaps = new Map([...matches.values()].map((item) => [item.gap_id, item]).filter(([key]) => key));
  const claims = asArray(input.claims, 'claims');
  const normalizedClaims = claims.map((claim, index) => {
    const ordinal = claim.ordinal ?? claim.claim_ordinal ?? index + 1;
    const requirementId = requiredText(resolveAliasedField(claim, 'requirement_id', 'requirementId', 'requirement_id'), 'requirement_id');
    if (!requirements.has(requirementId)) invalid('INTELLIGENCE_PROVENANCE_INVALID', 'Positioning claim requirement edge is missing.');
    const matchId = resolveAliasedField(claim, 'match_id', 'matchId', 'match_id') ?? null;
    const gapId = resolveAliasedField(claim, 'gap_id', 'gapId', 'gap_id') ?? null;
    if ((matchId && gapId) || (!matchId && !gapId)) invalid('INTELLIGENCE_PROVENANCE_INVALID', 'Positioning claim must reference exactly one match or gap edge.');
    const source = matchId ? matches.get(matchId) : gaps.get(gapId);
    if (!source || source.requirement_id !== requirementId) invalid('INTELLIGENCE_PROVENANCE_INVALID', 'Positioning claim edge does not resolve to its requirement.');
    if (source.evidence_snapshot_id !== snapshot.evidence_snapshot_id || source.input_generation !== snapshot.input_generation) {
      invalid('INTELLIGENCE_PROVENANCE_INVALID', 'Positioning claim source does not resolve to its immutable snapshot generation.');
    }
    if (matchId && source.classification !== 'DIRECT') {
      invalid('INTELLIGENCE_PROVENANCE_INVALID', 'Non-direct relations must be referenced through their gap edge.');
    }
    const evidenceRevisionIds = orderedIds(claim.evidence_revision_ids ?? source.evidence_revision_ids ?? [], 'evidence_revision_ids', { allowEmpty: true });
    const sourceEvidenceIds = orderedIds(source.evidence_revision_ids ?? [], 'source.evidence_revision_ids', { allowEmpty: true });
    if (canonicalSerialize(evidenceRevisionIds) !== canonicalSerialize(sourceEvidenceIds)) invalid('INTELLIGENCE_PROVENANCE_INVALID', 'Positioning claim Evidence edges do not match its source relation.');
    if (evidenceRevisionIds.some((id) => !snapshot.evidence_revision_ids.includes(id))) invalid('INTELLIGENCE_PROVENANCE_INVALID', 'Positioning claim references Evidence outside its snapshot.');
    const claimKind = claim.claim_kind ?? claim.claimKind ?? (gapId ? 'LIMITATION' : 'SUPPORTED');
    requireEnum(claimKind, CLAIM_KINDS, 'claim_kind');
    if (hasOwn(claim, 'verified') && typeof claim.verified !== 'boolean') {
      invalid('INTELLIGENCE_CLAIM_INVALID', 'verified must be boolean.');
    }
    if (gapId && (!['LIMITATION', 'UNKNOWN', 'FOLLOW_UP'].includes(claimKind) || claim.verified === true)) invalid('INTELLIGENCE_GAP_CLAIM_INVALID', 'Gap-based claims must remain explicit limitations, unknowns, or follow-up needs.');
    if (matchId && (source.classification !== 'DIRECT' || claimKind !== 'SUPPORTED' || claim.verified === false)) invalid('INTELLIGENCE_MATCH_INVALID', 'Supported claims must resolve to a direct match with confirmed Evidence.');
    const claimId = buildPositioningClaimId({ positioningVersionId, ordinal });
    const suppliedId = resolveAliasedField(claim, 'positioning_claim_id', 'positioningClaimId', 'positioning_claim_id');
    if (suppliedId !== undefined && suppliedId !== claimId) invalid('INTELLIGENCE_IDENTITY_MISMATCH', 'positioning_claim_id does not match version and ordinal.');
    return {
      positioning_claim_id: claimId,
      positioning_version_id: positioningVersionId,
      ordinal: assertFiniteInteger(ordinal, 'claim_ordinal', { minimum: 1 }),
      requirement_id: requirementId,
      match_id: matchId,
      gap_id: gapId,
      evidence_revision_ids: evidenceRevisionIds,
      claim_kind: claimKind,
      claim_text: requiredText(claim.claim_text ?? claim.claimText, 'claim_text'),
      verified: gapId ? false : claim.verified !== false,
    };
  });
  if (new Set(normalizedClaims.map((claim) => claim.ordinal)).size !== normalizedClaims.length) invalid('INTELLIGENCE_DUPLICATE_ID', 'Positioning claim ordinals must be unique.');
  return freezeDeep(normalizedClaims);
}

function validatePositioningVersion(input = {}) {
  const opportunityId = requiredText(input.opportunity_id ?? input.opportunityId, 'opportunity_id');
  const jdRevisionId = requiredText(resolveAliasedField(input, 'jd_revision_id', 'jdRevisionId', 'jd_revision_id'), 'jd_revision_id');
  const analysisId = requiredText(input.analysis_id ?? input.analysisId, 'analysis_id');
  const snapshot = validateSnapshot(resolveAliasedField(input, 'evidence_snapshot', 'evidenceSnapshot', 'evidence_snapshot'));
  const evidenceSnapshotId = resolveAliasedField(input, 'evidence_snapshot_id', 'evidenceSnapshotId', 'evidence_snapshot_id');
  if (evidenceSnapshotId !== undefined && evidenceSnapshotId !== snapshot.evidence_snapshot_id) {
    invalid('INTELLIGENCE_PROVENANCE_INVALID', 'Positioning Evidence snapshot does not match the immutable snapshot.');
  }
  const suppliedInputGeneration = resolveAliasedField(input, 'input_generation', 'inputGeneration', 'input_generation');
  if (suppliedInputGeneration !== undefined && suppliedInputGeneration !== snapshot.input_generation) {
    invalid('INTELLIGENCE_GENERATION_MISMATCH', 'Positioning input generation does not match the immutable snapshot.');
  }
  const state = requireEnum(input.state, POSITIONING_STATES, 'state');
  const versionNumber = assertFiniteInteger(input.version_number ?? input.versionNumber, 'version_number', { minimum: 1 });
  const positioningVersionId = buildPositioningVersionId({ opportunityId, versionNumber });
  const suppliedId = resolveAliasedField(input, 'positioning_version_id', 'positioningVersionId', 'positioning_version_id');
  if (suppliedId !== undefined && suppliedId !== positioningVersionId) invalid('INTELLIGENCE_IDENTITY_MISMATCH', 'positioning_version_id does not match opportunity and version number.');
  if (asArray(input.requirements, 'requirements').some((requirement) => (requirement.jd_revision_id ?? requirement.jdRevisionId) !== jdRevisionId)) {
    invalid('INTELLIGENCE_PROVENANCE_INVALID', 'Positioning requirements do not resolve to the selected JD revision.');
  }
  if (asArray(input.matches, 'matches', { allowEmpty: true }).some((match) => resolveAliasedField(match, 'jd_revision_id', 'jdRevisionId', 'jd_revision_id') !== jdRevisionId)) {
    invalid('INTELLIGENCE_PROVENANCE_INVALID', 'Positioning relations do not resolve to the selected JD revision.');
  }
  const claims = validatePositioningClaimEdges({
    positioningVersionId,
    claims: input.claims,
    requirements: input.requirements,
    matches: input.matches,
    evidenceSnapshot: snapshot,
  });
  return freezeDeep({
    positioning_version_id: positioningVersionId,
    opportunity_id: opportunityId,
    jd_revision_id: jdRevisionId,
    analysis_id: analysisId,
    evidence_snapshot_id: snapshot.evidence_snapshot_id,
    input_generation: snapshot.input_generation,
    version_number: versionNumber,
    state,
    claims,
  });
}

module.exports = {
  CLAIM_KINDS,
  EXPLICITNESS,
  EXTRACTION_STATUSES,
  GAP_CONTRACT_VERSION,
  IDENTITY_CONTRACT_VERSION,
  IntelligenceValidationError,
  MATCH_CLASSIFICATIONS,
  MATCHING_CONTRACT_VERSION,
  OPERATION_TYPES,
  POSITIONING_CONTRACT_VERSION,
  POSITIONING_STATES,
  PRIORITIES,
  REQUIREMENT_TYPES,
  UNCERTAINTY_BASES,
  buildAnalysisId,
  buildEvidenceSnapshot,
  buildEvidenceSnapshotId,
  buildGapId,
  buildInputBundle,
  buildMatchId,
  buildPositioningClaimId,
  buildPositioningVersionId,
  buildRequirementId,
  canonicalSerialize,
  classifyMatch,
  digestCanonical,
  normalizeSourceRef,
  parseMatchExplanation,
  resolveAliasedField,
  serializeMatchExplanation,
  validateMatchRecord,
  validateMatchableRequirement,
  validatePositioningClaimEdges,
  validatePositioningVersion,
  validateRequirement,
  validateSnapshot,
  validateTraceability,
};
