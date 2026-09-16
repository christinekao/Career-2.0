const Database = require('better-sqlite3');

const {
  PrivateRootError,
  assertFoundationFileSafe,
  assertPrivateRootStable,
  foundationDatabasePath,
  ensureFoundationStateDirectory,
} = require('./private-root.cjs');

const FOUNDATION_STORE_VERSION = 1;
const READY_STATE = 'READY';
const INITIALIZING_STATE = 'INITIALIZING';
const METADATA_TABLE = 'foundation_metadata';
const SQLITE_STATE_FILES = [
  'foundation.sqlite',
  'foundation.sqlite-journal',
  'foundation.sqlite-shm',
  'foundation.sqlite-wal',
];

class FoundationPersistenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FoundationPersistenceError';
    this.code = code;
  }
}

function metadataMap(database) {
  return new Map(database.prepare(`SELECT key, value FROM ${METADATA_TABLE}`).all().map((row) => [row.key, row.value]));
}

function assertOwnership(ownership, privateRoot) {
  if (!ownership || ownership.rootBinding !== privateRoot.rootBinding || typeof ownership.assertActive !== 'function') {
    throw new FoundationPersistenceError('OWNERSHIP_REQUIRED', 'Foundation persistence requires active root ownership.');
  }
  try {
    ownership.assertActive();
  } catch (error) {
    throw new FoundationPersistenceError(error.code || 'OWNERSHIP_REQUIRED', error.message);
  }
}

function foundationMetadata(database) {
  const values = metadataMap(database);
  const required = ['store_identity', 'root_binding', 'store_version', 'initialization_state'];
  if (values.size === 0) return null;
  if (required.every((key) => values.has(key)) === false) {
    throw new FoundationPersistenceError('FOUNDATION_METADATA_INCOMPLETE', 'Foundation store metadata is incomplete.');
  }
  return {
    storeIdentity: values.get('store_identity'),
    rootBinding: values.get('root_binding'),
    storeVersion: Number(values.get('store_version')),
    initializationState: values.get('initialization_state'),
  };
}

function assertSQLitePathsSafe(privateRoot, options) {
  for (const fileName of SQLITE_STATE_FILES) {
    assertFoundationFileSafe(privateRoot, fileName, options);
  }
}

function initializeFoundationStore(privateRoot, options = {}) {
  const repositoryRoot = options.repositoryRoot;
  const ownership = options.ownership;
  assertOwnership(ownership, privateRoot);
  assertPrivateRootStable(privateRoot, { repositoryRoot });

  ensureFoundationStateDirectory(privateRoot, { repositoryRoot });
  const databasePath = foundationDatabasePath(privateRoot);
  assertSQLitePathsSafe(privateRoot, { repositoryRoot });

  let database;
  try {
    database = new Database(databasePath);
    ensureFoundationStateDirectory(privateRoot, { repositoryRoot });
    assertSQLitePathsSafe(privateRoot, { repositoryRoot });
    database.exec(`CREATE TABLE IF NOT EXISTS ${METADATA_TABLE} (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`);
    let metadata = foundationMetadata(database);

    if (metadata && metadata.storeVersion !== FOUNDATION_STORE_VERSION) {
      throw new FoundationPersistenceError('FOUNDATION_VERSION_UNSUPPORTED', `Unsupported foundation store version: ${metadata.storeVersion}`);
    }
    if (metadata && metadata.rootBinding !== privateRoot.rootBinding) {
      throw new FoundationPersistenceError('FOUNDATION_ROOT_BINDING_MISMATCH', 'Foundation store belongs to a different private root.');
    }
    if (metadata && metadata.initializationState !== READY_STATE && metadata.initializationState !== INITIALIZING_STATE) {
      throw new FoundationPersistenceError('FOUNDATION_NOT_READY', 'Foundation store initialization state is invalid.');
    }

    if (!metadata || metadata.initializationState === INITIALIZING_STATE) {
      const storeIdentity = metadata?.storeIdentity || require('node:crypto').randomUUID();
      const initialize = database.transaction(() => {
        database.prepare(`INSERT OR REPLACE INTO ${METADATA_TABLE} (key, value) VALUES (?, ?)`).run('store_identity', storeIdentity);
        database.prepare(`INSERT OR REPLACE INTO ${METADATA_TABLE} (key, value) VALUES (?, ?)`).run('root_binding', privateRoot.rootBinding);
        database.prepare(`INSERT OR REPLACE INTO ${METADATA_TABLE} (key, value) VALUES (?, ?)`).run('store_version', String(FOUNDATION_STORE_VERSION));
        database.prepare(`INSERT OR REPLACE INTO ${METADATA_TABLE} (key, value) VALUES (?, ?)`).run('initialization_state', INITIALIZING_STATE);
        assertOwnership(ownership, privateRoot);
        if (options.failurePoint === 'before-ready') {
          throw new FoundationPersistenceError('FOUNDATION_INIT_FAILED', 'Synthetic initialization failure before ready state.');
        }
        database.prepare(`INSERT OR REPLACE INTO ${METADATA_TABLE} (key, value) VALUES (?, ?)`).run('initialization_state', READY_STATE);
      });
      initialize();
      metadata = foundationMetadata(database);
    }

    if (!metadata || metadata.initializationState !== READY_STATE || metadata.storeVersion !== FOUNDATION_STORE_VERSION) {
      throw new FoundationPersistenceError('FOUNDATION_NOT_READY', 'Foundation store is not ready.');
    }
    if (!metadata.storeIdentity || !metadata.rootBinding || !Number.isSafeInteger(metadata.storeVersion)) {
      throw new FoundationPersistenceError('FOUNDATION_METADATA_INVALID', 'Foundation store metadata is invalid.');
    }
    if (metadata.rootBinding !== privateRoot.rootBinding) {
      throw new FoundationPersistenceError('FOUNDATION_ROOT_BINDING_MISMATCH', 'Foundation store belongs to a different private root.');
    }
    assertPrivateRootStable(privateRoot, { repositoryRoot });
    ensureFoundationStateDirectory(privateRoot, { repositoryRoot });
    assertSQLitePathsSafe(privateRoot, { repositoryRoot });
    assertOwnership(ownership, privateRoot);

    let closed = false;
    return {
      metadata,
      close() {
        if (closed) return;
        closed = true;
        database.close();
      },
    };
  } catch (error) {
    if (database) database.close();
    if (error instanceof FoundationPersistenceError || error instanceof PrivateRootError) throw error;
    throw new FoundationPersistenceError('FOUNDATION_INIT_FAILED', error.message);
  }
}

module.exports = {
  FOUNDATION_STORE_VERSION,
  FoundationPersistenceError,
  initializeFoundationStore,
};
