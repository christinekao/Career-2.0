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
const { initializeFoundationStore } = require('./persistence.cjs');

function bootstrapFoundation({ configPath, argv, env, repositoryRoot = DEFAULT_REPOSITORY_ROOT } = {}) {
  let store;
  let ownership;

  try {
    const config = readRuntimeConfig(configPath);
    const selectedRoot = configuredRoot({ argv, env, config });
    if (!selectedRoot) {
      return {
        status: {
          phase: 'private-root-required',
          code: 'PRIVATE_ROOT_NOT_CONFIGURED',
          message: 'Configure a private root to initialize foundation state.',
        },
        close() {},
      };
    }

    const privateRoot = validatePrivateRoot(selectedRoot, { repositoryRoot });
    writeRuntimeConfig(configPath, privateRoot.canonicalPath);
    ownership = acquireRootOwnership(privateRoot, { repositoryRoot });
    store = initializeFoundationStore(privateRoot, { repositoryRoot, ownership });

    return {
      status: {
        phase: 'ready',
        storeIdentity: store.metadata.storeIdentity,
        storeVersion: store.metadata.storeVersion,
      },
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
      status: {
        phase: 'error',
        code: error.code || 'FOUNDATION_INIT_FAILED',
        message: error.message,
      },
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
};
