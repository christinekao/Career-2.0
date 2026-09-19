const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const {
  assertPrivateRootStable,
  ensureFoundationStateDirectory,
  foundationDatabasePath,
  validatePrivateRoot,
} = require('./private-root.cjs');

const BACKUP_FORMAT = 'career2-complete-store';
const BACKUP_FORMAT_VERSION = 1;
const FOUNDATION_STORE_VERSION = 1;
const INTELLIGENCE_SCHEMA_VERSION = 1;

class BackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new BackupError(code, message);
}

function canonicalSerialize(value) {
  const render = (candidate) => {
    if (candidate === null) return 'null';
    if (typeof candidate === 'string') return JSON.stringify(candidate);
    if (typeof candidate === 'boolean') return candidate ? 'true' : 'false';
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) fail('BACKUP_INVALID', 'Backup contains a non-finite value.');
      return Object.is(candidate, -0) ? '0' : JSON.stringify(candidate);
    }
    if (typeof candidate !== 'object') fail('BACKUP_INVALID', 'Backup contains an unsupported value.');
    if (Array.isArray(candidate)) return `[${candidate.map(render).join(',')}]`;
    return `{${Object.keys(candidate).sort().map((key) => `${JSON.stringify(key)}:${render(candidate[key])}`).join(',')}}`;
  };
  return render(value);
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function isInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function metadataRows(database) {
  return database.prepare('SELECT key, value FROM foundation_metadata ORDER BY key ASC').all();
}

function tableNames(database) {
  return database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC",
  ).pluck().all();
}

function canonicalTableRows(database, tableName) {
  const escaped = `"${String(tableName).replaceAll('"', '""')}"`;
  return database.prepare(`SELECT * FROM ${escaped}`).all()
    .map((row) => JSON.parse(canonicalSerialize(row)))
    .sort((left, right) => canonicalSerialize(left).localeCompare(canonicalSerialize(right)));
}

function assertIntelligenceRowsMatch(database, intelligence) {
  const tables = new Map();
  for (const entry of intelligence.tables) {
    if (!entry || typeof entry.table !== 'string' || !Array.isArray(entry.rows) || tables.has(entry.table)) {
      fail('BACKUP_INVALID', 'Backup intelligence table data is invalid.');
    }
    if (!entry.table.startsWith('intelligence_')) fail('BACKUP_INVALID', 'Backup contains a non-intelligence table in its intelligence manifest.');
    tables.set(entry.table, entry.rows);
  }
  const databaseTables = tableNames(database).filter((table) => table.startsWith('intelligence_'));
  if (databaseTables.length !== tables.size || databaseTables.some((table) => !tables.has(table))) {
    fail('BACKUP_INCOMPLETE', 'Backup intelligence table coverage does not match the restored store.');
  }
  for (const table of databaseTables) {
    if (canonicalSerialize(canonicalTableRows(database, table)) !== canonicalSerialize(tables.get(table))) {
      fail('BACKUP_INTEGRITY_FAILED', `Backup intelligence table does not match restored state: ${table}.`);
    }
  }
}

function bytesEntry(logicalPath, bytes, sourceClass, mediaType) {
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return {
    logical_path: logicalPath,
    source_class: sourceClass,
    media_type: mediaType,
    size: value.length,
    sha256: digest(value),
    payload: value.toString('base64'),
  };
}

function stripPayload(entry) {
  const { payload, ...manifestEntry } = entry;
  return manifestEntry;
}

function readBundle(input) {
  if (typeof input === 'string') {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(input, 'utf8'));
    } catch {
      fail('BACKUP_INVALID', 'Backup bundle cannot be read.');
    }
    return parsed;
  }
  return input;
}

function decodeEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('BACKUP_INVALID', 'Backup entry is invalid.');
  const allowed = new Set(['logical_path', 'source_class', 'media_type', 'size', 'sha256', 'payload']);
  if (Object.keys(entry).some((key) => !allowed.has(key))) fail('BACKUP_INVALID', 'Backup entry contains an unsupported field.');
  if (typeof entry.logical_path !== 'string' || typeof entry.source_class !== 'string' || typeof entry.media_type !== 'string') fail('BACKUP_INVALID', 'Backup entry identity is invalid.');
  if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256) || typeof entry.payload !== 'string') fail('BACKUP_INVALID', 'Backup entry integrity metadata is invalid.');
  let bytes;
  try {
    bytes = Buffer.from(entry.payload, 'base64');
  } catch {
    fail('BACKUP_INVALID', 'Backup entry payload is invalid.');
  }
  if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) fail('BACKUP_INTEGRITY_FAILED', 'Backup entry hash or size does not match its manifest.');
  return bytes;
}

function validateBundle(input) {
  const bundle = readBundle(input);
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) fail('BACKUP_INVALID', 'Backup bundle must be a structured object.');
  if (bundle.format !== BACKUP_FORMAT || bundle.format_version !== BACKUP_FORMAT_VERSION) {
    fail('BACKUP_VERSION_UNSUPPORTED', 'Backup format version is unsupported.');
  }
  if (bundle.foundation_store_version !== FOUNDATION_STORE_VERSION || bundle.intelligence_schema_version !== INTELLIGENCE_SCHEMA_VERSION) {
    fail('BACKUP_VERSION_UNSUPPORTED', 'Backup schema version is unsupported.');
  }
  for (const field of ['source_store_identity', 'source_root_binding', 'manifest_sha256']) {
    if (typeof bundle[field] !== 'string' || bundle[field].trim() === '') fail('BACKUP_INVALID', `Backup ${field} is invalid.`);
  }
  if (!Array.isArray(bundle.entries) || bundle.entries.length === 0) fail('BACKUP_INVALID', 'Backup manifest is empty.');
  const entries = new Map();
  for (const entry of bundle.entries) {
    if (entries.has(entry?.logical_path)) fail('BACKUP_INVALID', 'Backup manifest contains duplicate entries.');
    entries.set(entry?.logical_path, { manifest: stripPayload(entry), bytes: decodeEntry(entry) });
  }
  const required = ['state/foundation.sqlite', 'state/foundation-metadata.json', 'state/intelligence-records.json'];
  for (const logicalPath of required) if (!entries.has(logicalPath)) fail('BACKUP_INCOMPLETE', `Backup is missing ${logicalPath}.`);
  const manifest = canonicalSerialize({
    format: bundle.format,
    format_version: bundle.format_version,
    foundation_store_version: bundle.foundation_store_version,
    intelligence_schema_version: bundle.intelligence_schema_version,
    source_store_identity: bundle.source_store_identity,
    source_root_binding: bundle.source_root_binding,
    entries: bundle.entries.map(stripPayload),
  });
  if (digest(Buffer.from(manifest, 'utf8')) !== bundle.manifest_sha256) fail('BACKUP_INTEGRITY_FAILED', 'Backup manifest hash does not match its contents.');
  let metadata;
  let intelligence;
  try {
    metadata = JSON.parse(entries.get('state/foundation-metadata.json').bytes.toString('utf8'));
    intelligence = JSON.parse(entries.get('state/intelligence-records.json').bytes.toString('utf8'));
  } catch {
    fail('BACKUP_INVALID', 'Backup metadata is not valid JSON.');
  }
  if (!metadata || metadata.store_identity !== bundle.source_store_identity || metadata.root_binding !== bundle.source_root_binding
    || metadata.store_version !== String(FOUNDATION_STORE_VERSION) || metadata.intelligence_schema_version !== String(INTELLIGENCE_SCHEMA_VERSION)
    || metadata.initialization_state !== 'READY') {
    fail('BACKUP_INVALID', 'Backup foundation metadata is incomplete or inconsistent.');
  }
  if (!intelligence || intelligence.schema_version !== INTELLIGENCE_SCHEMA_VERSION || !Array.isArray(intelligence.tables)) {
    fail('BACKUP_INVALID', 'Backup intelligence records are incomplete.');
  }
  return { bundle, entries, metadata, intelligence };
}

function createBackupOperations({ database, privateRoot, ownership, repositoryRoot, isClosed } = {}) {
  if (!database || !privateRoot) throw new TypeError('Backup persistence context is required.');

  function assertReady() {
    if (isClosed?.()) fail('FOUNDATION_CLOSED', 'The foundation store is closed.');
    assertPrivateRootStable(privateRoot, { repositoryRoot });
    if (!ownership || typeof ownership.assertActive !== 'function') fail('OWNERSHIP_REQUIRED', 'Foundation ownership is unavailable.');
    ownership.assertActive();
  }

  function create(destinationPath) {
    assertReady();
    const metadata = Object.fromEntries(metadataRows(database).map((row) => [row.key, row.value]));
    if (metadata.store_version !== String(FOUNDATION_STORE_VERSION)
      || metadata.intelligence_schema_version !== String(INTELLIGENCE_SCHEMA_VERSION)
      || metadata.initialization_state !== 'READY') {
      fail('BACKUP_NOT_READY', 'The store is not ready for complete backup.');
    }
    const tables = tableNames(database);
    const intelligenceTables = tables.filter((table) => table.startsWith('intelligence_'))
      .map((table) => ({ table, rows: canonicalTableRows(database, table) }));
    const entries = [
      bytesEntry('state/foundation.sqlite', database.serialize(), 'CANONICAL_STRUCTURED_STATE', 'application/vnd.sqlite3'),
      bytesEntry('state/foundation-metadata.json', Buffer.from(canonicalSerialize(metadata), 'utf8'), 'CANONICAL_METADATA', 'application/json'),
      bytesEntry('state/intelligence-records.json', Buffer.from(canonicalSerialize({
        schema_version: INTELLIGENCE_SCHEMA_VERSION,
        tables: intelligenceTables,
      }), 'utf8'), 'CANONICAL_INTELLIGENCE_STATE', 'application/json'),
    ];
    assertReady();
    const manifest = {
      format: BACKUP_FORMAT,
      format_version: BACKUP_FORMAT_VERSION,
      foundation_store_version: FOUNDATION_STORE_VERSION,
      intelligence_schema_version: INTELLIGENCE_SCHEMA_VERSION,
      source_store_identity: metadata.store_identity,
      source_root_binding: metadata.root_binding,
      entries: entries.map(stripPayload),
    };
    const bundle = {
      ...manifest,
      manifest_sha256: digest(Buffer.from(canonicalSerialize(manifest), 'utf8')),
      entries,
    };
    if (destinationPath !== undefined) {
      if (typeof destinationPath !== 'string' || !path.isAbsolute(destinationPath)) fail('BACKUP_INVALID', 'Backup destination must be an absolute path.');
      if (isInside(destinationPath, repositoryRoot || process.cwd())) fail('BACKUP_INVALID', 'Backup destination cannot be inside the repository.');
      const parent = path.dirname(destinationPath);
      fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
      const temporaryPath = `${destinationPath}.tmp-${crypto.randomUUID()}`;
      try {
        fs.writeFileSync(temporaryPath, canonicalSerialize(bundle), { mode: 0o600, flag: 'wx' });
        fs.renameSync(temporaryPath, destinationPath);
      } finally {
        if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
      }
    }
    return Object.freeze({
      format: bundle.format,
      format_version: bundle.format_version,
      source_store_identity: bundle.source_store_identity,
      source_root_binding: bundle.source_root_binding,
      intelligence_schema_version: bundle.intelligence_schema_version,
      entries: bundle.entries.map(stripPayload),
      bundle,
      destination_path: destinationPath,
    });
  }

  function restore(input, destinationRootPath) {
    const validated = validateBundle(input);
    if (typeof destinationRootPath !== 'string' || !path.isAbsolute(destinationRootPath)) fail('BACKUP_INVALID', 'Restore destination must be an absolute path.');
    const destination = validatePrivateRoot(destinationRootPath, { repositoryRoot });
    assertPrivateRootStable(destination, { repositoryRoot });
    if (fs.readdirSync(destination.canonicalPath).length > 0) fail('BACKUP_DESTINATION_NOT_EMPTY', 'Restore destination must be empty; silent merge is not supported.');
    const stateDirectory = ensureFoundationStateDirectory(destination, { repositoryRoot });
    const databasePath = foundationDatabasePath(destination);
    const temporaryPath = path.join(stateDirectory, `foundation.sqlite.restore-${crypto.randomUUID()}`);
    let databaseCopy;
    try {
      fs.writeFileSync(temporaryPath, validated.entries.get('state/foundation.sqlite').bytes, { mode: 0o600, flag: 'wx' });
      databaseCopy = new Database(temporaryPath);
      databaseCopy.pragma('foreign_keys = ON');
      const integrity = databaseCopy.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') fail('BACKUP_INTEGRITY_FAILED', 'Restored SQLite state failed integrity validation.');
      const restoredMetadata = Object.fromEntries(metadataRows(databaseCopy).map((row) => [row.key, row.value]));
      if (restoredMetadata.store_identity !== validated.bundle.source_store_identity
        || restoredMetadata.store_version !== String(FOUNDATION_STORE_VERSION)
        || restoredMetadata.intelligence_schema_version !== String(INTELLIGENCE_SCHEMA_VERSION)
        || restoredMetadata.initialization_state !== 'READY') {
        fail('BACKUP_INVALID', 'Restored foundation metadata is incomplete.');
      }
      assertIntelligenceRowsMatch(databaseCopy, validated.intelligence);
      databaseCopy.transaction(() => {
        databaseCopy.prepare("UPDATE foundation_metadata SET value = ? WHERE key = 'root_binding'").run(destination.rootBinding);
      })();
      const reboundMetadata = Object.fromEntries(metadataRows(databaseCopy).map((row) => [row.key, row.value]));
      if (reboundMetadata.root_binding !== destination.rootBinding) fail('BACKUP_ROOT_BINDING_INVALID', 'Restored root binding is invalid.');
      databaseCopy.close();
      databaseCopy = null;
      fs.renameSync(temporaryPath, databasePath);
      assertPrivateRootStable(destination, { repositoryRoot });
      return Object.freeze({
        storeIdentity: validated.bundle.source_store_identity,
        sourceRootBinding: validated.bundle.source_root_binding,
        destinationRootBinding: destination.rootBinding,
        foundationStoreVersion: FOUNDATION_STORE_VERSION,
        intelligenceSchemaVersion: INTELLIGENCE_SCHEMA_VERSION,
        entryCount: validated.entries.size,
      });
    } catch (error) {
      databaseCopy?.close();
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
      if (fs.existsSync(databasePath)) fs.rmSync(databasePath, { force: true });
      if (fs.existsSync(stateDirectory)) fs.rmSync(stateDirectory, { recursive: true, force: true });
      if (error instanceof BackupError) throw error;
      fail('BACKUP_RESTORE_FAILED', 'Backup restore failed before publishing a ready store.');
    }
  }

  return Object.freeze({ create, restore, validate: validateBundle });
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BackupError,
  createBackupOperations,
  validateBundle,
};
