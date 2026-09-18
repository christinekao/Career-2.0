const path = require('node:path');

const {
  DEFAULT_REPOSITORY_ROOT,
  validatePrivateRoot,
} = require('./private-root.cjs');
const {
  configuredRoot,
  readRuntimeConfig,
  writeRuntimeConfig,
} = require('./runtime-config.cjs');
const { acquireRootOwnership } = require('./ownership.cjs');
const { initializeOpportunityEvidenceStore } = require('./persistence.cjs');

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  PRIVATE_ROOT_NOT_CONFIGURED: 'Configure a private root to initialize foundation state.',
  PRIVATE_ROOT_NOT_ABSOLUTE: 'The private root must be an absolute path.',
  PRIVATE_ROOT_REPOSITORY_LOCAL: 'The private root cannot be inside the repository.',
  PRIVATE_ROOT_UNAVAILABLE: 'The private root is unavailable.',
  PRIVATE_ROOT_NOT_DIRECTORY: 'The private root must be a directory.',
  PRIVATE_ROOT_UNREADABLE: 'The private root must be readable and writable.',
  PRIVATE_ROOT_CHANGED: 'The private root changed during the operation.',
  PRIVATE_STATE_PATH_INVALID: 'The foundation state path is invalid.',
  PRIVATE_STATE_PATH_UNSAFE: 'The foundation state path is unsafe.',
  RUNTIME_CONFIG_INVALID: 'The runtime configuration is invalid.',
  OWNERSHIP_REQUIRED: 'Foundation ownership is unavailable.',
  OWNERSHIP_CONFLICT: 'Another process owns the private root.',
  OWNERSHIP_RECOVERY_IN_PROGRESS: 'Private-root recovery is in progress.',
  OWNERSHIP_UNCERTAIN: 'Foundation ownership could not be verified.',
  OWNERSHIP_LOST: 'Foundation ownership was lost.',
  OWNERSHIP_RELEASED: 'Foundation ownership is no longer active.',
  FOUNDATION_INIT_FAILED: 'Foundation initialization failed.',
  FOUNDATION_METADATA_INCOMPLETE: 'Foundation metadata is incomplete.',
  FOUNDATION_METADATA_INVALID: 'Foundation metadata is invalid.',
  FOUNDATION_NOT_READY: 'Foundation is not ready.',
  FOUNDATION_ROOT_BINDING_MISMATCH: 'The foundation store belongs to a different private root.',
  FOUNDATION_VERSION_UNSUPPORTED: 'The foundation store version is unsupported.',
  FOUNDATION_CLOSED: 'The foundation store is closed.',
  OPPORTUNITY_EVIDENCE_MIGRATION_FAILED: 'Opportunity/Evidence substrate migration failed.',
  OPPORTUNITY_EVIDENCE_SCHEMA_INVALID: 'The Opportunity/Evidence schema is invalid.',
  OPPORTUNITY_EVIDENCE_VERSION_UNSUPPORTED: 'The Opportunity/Evidence schema version is unsupported.',
  OPPORTUNITY_EVIDENCE_NOT_READY: 'The Opportunity/Evidence substrate is unavailable.',
  OPPORTUNITY_EVIDENCE_INVALID: 'The Opportunity/Evidence input is invalid.',
  INTELLIGENCE_MIGRATION_FAILED: 'Intelligence persistence migration failed.',
  INTELLIGENCE_SCHEMA_INVALID: 'The intelligence schema is invalid.',
  INTELLIGENCE_VERSION_UNSUPPORTED: 'The intelligence schema version is unsupported.',
  INTELLIGENCE_NOT_READY: 'Intelligence persistence is unavailable.',
  INTELLIGENCE_UNAVAILABLE: 'Intelligence is unavailable for the selected input.',
  OPPORTUNITY_NOT_FOUND: 'The Opportunity was not found.',
  OPPORTUNITY_INVALID: 'The Opportunity input is invalid.',
  JD_REVISION_INVALID: 'The JD revision input is invalid.',
  EVIDENCE_INVALID: 'The Evidence input is invalid.',
  EVIDENCE_CORRUPT: 'The Evidence data is corrupt.',
  EVIDENCE_NOT_FOUND: 'The Evidence was not found.',
  EVIDENCE_REVISION_NOT_FOUND: 'The Evidence revision was not found.',
  DOMAIN_NOT_READY: 'The Opportunity/Evidence substrate is not ready.',
  DOMAIN_OPERATION_FAILED: 'The domain operation failed.',
});

function toPublicError(error, fallbackCode = 'FOUNDATION_INIT_FAILED') {
  const candidateCode = typeof error?.code === 'string' ? error.code : '';
  const code = Object.prototype.hasOwnProperty.call(PUBLIC_ERROR_MESSAGES, candidateCode)
    ? candidateCode
    : fallbackCode;
  return {
    code,
    message: PUBLIC_ERROR_MESSAGES[code] || PUBLIC_ERROR_MESSAGES.FOUNDATION_INIT_FAILED,
  };
}

function toPublicFoundationStatus(status) {
  if (!status || typeof status !== 'object') return { phase: 'starting' };

  const publicStatus = {};
  for (const field of [
    'phase',
    'foundationPhase',
    'opportunityEvidencePhase',
    'storeIdentity',
    'storeVersion',
    'opportunityEvidenceSchemaVersion',
    'intelligencePhase',
    'intelligenceSchemaVersion',
  ]) {
    if (status[field] !== undefined) publicStatus[field] = status[field];
  }

  if (status.code !== undefined || status.message !== undefined) {
    Object.assign(publicStatus, toPublicError(status));
  }

  if (status.opportunityEvidenceStatus && typeof status.opportunityEvidenceStatus === 'object') {
    const substrateStatus = status.opportunityEvidenceStatus;
    publicStatus.opportunityEvidenceStatus = {
      phase: substrateStatus.phase || 'unavailable',
      ...toPublicError(substrateStatus, 'OPPORTUNITY_EVIDENCE_NOT_READY'),
    };
  }

  if (status.intelligenceStatus && typeof status.intelligenceStatus === 'object') {
    const intelligenceStatus = status.intelligenceStatus;
    publicStatus.intelligenceStatus = {
      phase: intelligenceStatus.phase || 'unavailable',
      ...toPublicError(intelligenceStatus, 'INTELLIGENCE_NOT_READY'),
    };
  }

  return publicStatus;
}

function bootstrapFoundation({ configPath, argv, env, repositoryRoot = DEFAULT_REPOSITORY_ROOT, persistenceOptions = {} } = {}) {
  let store;
  let ownership;

  try {
    const config = readRuntimeConfig(configPath);
    const selectedRoot = configuredRoot({ argv, env, config });
    if (!selectedRoot) {
      return {
        status: toPublicFoundationStatus({
          phase: 'private-root-required',
          code: 'PRIVATE_ROOT_NOT_CONFIGURED',
          message: 'Configure a private root to initialize foundation state.',
        }),
        close() {},
      };
    }

    const privateRoot = validatePrivateRoot(selectedRoot, { repositoryRoot });
    writeRuntimeConfig(configPath, privateRoot.canonicalPath);
    ownership = acquireRootOwnership(privateRoot, { repositoryRoot });
    store = initializeOpportunityEvidenceStore(privateRoot, {
      ...persistenceOptions,
      repositoryRoot,
      ownership,
      allowDegradedOnMigrationFailure: true,
    });
    const substrateAvailable = Boolean(store.opportunity && store.evidence);
    const intelligenceAvailable = Boolean(store.intelligence);

    return {
      status: toPublicFoundationStatus({
        phase: 'ready',
        foundationPhase: 'ready',
        opportunityEvidencePhase: substrateAvailable ? 'ready' : 'unavailable',
        intelligencePhase: intelligenceAvailable ? 'ready' : 'unavailable',
        storeIdentity: store.metadata.storeIdentity,
        storeVersion: store.metadata.storeVersion,
        opportunityEvidenceSchemaVersion: substrateAvailable ? store.metadata.opportunityEvidenceSchemaVersion : null,
        intelligenceSchemaVersion: intelligenceAvailable ? store.metadata.intelligenceSchemaVersion : null,
        ...(store.substrateStatus ? { opportunityEvidenceStatus: store.substrateStatus } : {}),
        ...(store.intelligenceStatus ? { intelligenceStatus: store.intelligenceStatus } : {}),
      }),
      ...(substrateAvailable ? { opportunity: store.opportunity, evidence: store.evidence } : {}),
      close() {
        try {
          store?.close();
        } finally {
          ownership?.release();
        }
      },
    };
  } catch (error) {
    try {
      store?.close();
    } finally {
      ownership?.release();
    }
    return {
      status: toPublicFoundationStatus({
        phase: 'error',
        ...toPublicError(error),
      }),
      close() {},
    };
  }
}

function runtimeConfigPath(userDataPath) {
  return path.join(userDataPath, 'config.json');
}

module.exports = {
  bootstrapFoundation,
  runtimeConfigPath,
  toPublicError,
  toPublicFoundationStatus,
};
