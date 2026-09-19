const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
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
const REQUIRED_STATE_ENTRIES = Object.freeze([
  'state/foundation.sqlite',
  'state/foundation-metadata.json',
  'state/intelligence-records.json',
]);
const STATE_ENTRY_CONTRACT = Object.freeze({
  'state/foundation.sqlite': Object.freeze({ source_class: 'CANONICAL_STRUCTURED_STATE', media_type: 'application/vnd.sqlite3' }),
  'state/foundation-metadata.json': Object.freeze({ source_class: 'CANONICAL_METADATA', media_type: 'application/json' }),
  'state/intelligence-records.json': Object.freeze({ source_class: 'CANONICAL_INTELLIGENCE_STATE', media_type: 'application/json' }),
});
const PRIVATE_ROOT_EXCLUSIONS = new Set(['.career2']);
const REFERENCE_PATH_KEYS = new Set([
  'path',
  'file_path',
  'filePath',
  'relative_path',
  'relativePath',
  'logical_path',
  'logicalPath',
  'source_path',
  'sourcePath',
]);

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

function normalizeLogicalPath(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\\') || path.isAbsolute(value)) {
    fail('BACKUP_INVALID', 'Backup logical path is invalid.');
  }
  const normalized = value.trim();
  const parts = normalized.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..' || part === '.career2')) {
    fail('BACKUP_INVALID', 'Backup logical path is unsafe.');
  }
  return parts.join('/');
}

function mediaTypeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.pdf': 'application/pdf',
  }[extension] || 'application/octet-stream';
}

function readStableFile(filePath) {
  let before;
  try {
    before = fs.lstatSync(filePath);
  } catch {
    fail('BACKUP_SOURCE_MISSING', 'A required backup source artifact is missing.');
  }
  if (!before.isFile() || before.isSymbolicLink()) fail('BACKUP_SOURCE_UNSAFE', 'A backup source artifact is not a regular file.');
  let bytes;
  try {
    bytes = fs.readFileSync(filePath);
  } catch {
    fail('BACKUP_SOURCE_MISSING', 'A required backup source artifact cannot be read.');
  }
  let after;
  try {
    after = fs.lstatSync(filePath);
  } catch {
    fail('BACKUP_SOURCE_CHANGED', 'A backup source artifact changed during capture.');
  }
  if (
    before.dev !== after.dev
    || before.ino !== after.ino
    || before.size !== after.size
    || before.mtimeNs !== after.mtimeNs
  ) fail('BACKUP_SOURCE_CHANGED', 'A backup source artifact changed during capture.');
  return bytes;
}

function walkPrivateFiles(privateRoot) {
  const entries = [];
  const visit = (directory, relativeDirectory) => {
    let children;
    try {
      children = fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      fail('BACKUP_SOURCE_MISSING', 'A private backup directory cannot be read.');
    }
    for (const child of children) {
      if (relativeDirectory === '' && PRIVATE_ROOT_EXCLUSIONS.has(child.name)) continue;
      const childPath = path.join(directory, child.name);
      const childRelative = relativeDirectory === '' ? child.name : path.join(relativeDirectory, child.name);
      if (child.isSymbolicLink()) fail('BACKUP_SOURCE_UNSAFE', 'Symbolic links are not valid backup source artifacts.');
      if (child.isDirectory()) {
        visit(childPath, childRelative);
      } else if (child.isFile()) {
        const logicalPath = normalizeLogicalPath(`private/${childRelative.split(path.sep).join('/')}`);
        entries.push(bytesEntry(logicalPath, readStableFile(childPath), 'USER_AUTHORED_BYTES', mediaTypeForPath(childPath)));
      } else {
        fail('BACKUP_SOURCE_UNSAFE', 'Unsupported private backup entry type.');
      }
    }
  };
  visit(privateRoot.canonicalPath, '');
  return entries.sort((left, right) => left.logical_path.localeCompare(right.logical_path));
}

function referenceValues(value, key = '') {
  const values = [];
  if (typeof value === 'string') {
    const hasLocalScheme = value.startsWith('private://') || value.startsWith('file://') || path.isAbsolute(value);
    const hasRelativePathKey = REFERENCE_PATH_KEYS.has(key) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value);
    if (hasLocalScheme || hasRelativePathKey) values.push({ value, key });
    return values;
  }
  if (!value || typeof value !== 'object') return values;
  if (Array.isArray(value)) {
    value.forEach((item) => values.push(...referenceValues(item, key)));
    return values;
  }
  for (const [childKey, childValue] of Object.entries(value)) {
    if (REFERENCE_PATH_KEYS.has(childKey)) values.push(...referenceValues(childValue, childKey));
    else if (childValue && typeof childValue === 'object') values.push(...referenceValues(childValue, childKey));
  }
  return values;
}

function logicalPathForReference(reference, privateRoot) {
  let candidate = reference.value;
  if (candidate.startsWith('private://')) {
    const relative = candidate.slice('private://'.length).replace(/^\/+/, '');
    return normalizeLogicalPath(`private/${relative}`);
  }
  if (candidate.startsWith('file://')) {
    try {
      candidate = fileURLToPath(candidate);
    } catch {
      fail('BACKUP_SOURCE_INVALID', 'A file source reference is invalid.');
    }
  }
  if (path.isAbsolute(candidate)) {
    const resolved = path.resolve(candidate);
    if (!isInside(resolved, privateRoot.canonicalPath)) {
      fail('BACKUP_SOURCE_OUTSIDE_ROOT', 'A required source artifact is outside the configured private root.');
    }
    return normalizeLogicalPath(`private/${path.relative(privateRoot.canonicalPath, resolved).split(path.sep).join('/')}`);
  }
  if (REFERENCE_PATH_KEYS.has(reference.key)) {
    const resolved = path.resolve(privateRoot.canonicalPath, candidate);
    if (!isInside(resolved, privateRoot.canonicalPath)) fail('BACKUP_SOURCE_OUTSIDE_ROOT', 'A source reference escapes the configured private root.');
    return normalizeLogicalPath(`private/${path.relative(privateRoot.canonicalPath, resolved).split(path.sep).join('/')}`);
  }
  return null;
}

function requiredSourceEntries(database, privateRoot) {
  const values = [];
  for (const row of database.prepare('SELECT source_ref FROM opportunities WHERE source_ref IS NOT NULL').all()) values.push(...referenceValues(row.source_ref, 'source_ref'));
  for (const row of database.prepare('SELECT source_ref FROM jd_revisions WHERE source_ref IS NOT NULL').all()) values.push(...referenceValues(row.source_ref, 'source_ref'));
  for (const row of database.prepare('SELECT source_ref_json FROM intelligence_requirements').all()) {
    try { values.push(...referenceValues(JSON.parse(row.source_ref_json), 'source_ref')); } catch { fail('BACKUP_INVALID', 'A persisted source reference is invalid JSON.'); }
  }
  for (const row of database.prepare('SELECT jd_source_ref_json FROM intelligence_provenance_edges WHERE jd_source_ref_json IS NOT NULL').all()) {
    try { values.push(...referenceValues(JSON.parse(row.jd_source_ref_json), 'source_ref')); } catch { fail('BACKUP_INVALID', 'A persisted provenance source reference is invalid JSON.'); }
  }
  for (const row of database.prepare('SELECT provenance_json FROM evidence_revisions WHERE provenance_json IS NOT NULL').all()) {
    try { values.push(...referenceValues(JSON.parse(row.provenance_json))); } catch { fail('BACKUP_INVALID', 'A persisted Evidence provenance reference is invalid JSON.'); }
  }
  const logicalPaths = new Set();
  for (const reference of values) {
    const logicalPath = logicalPathForReference(reference, privateRoot);
    if (!logicalPath) continue;
    const relative = logicalPath.slice('private/'.length).split('/').join(path.sep);
    const sourcePath = path.join(privateRoot.canonicalPath, relative);
    if (!fs.existsSync(sourcePath)) fail('BACKUP_SOURCE_MISSING', `Required source artifact is missing: ${logicalPath}`);
    const stats = fs.lstatSync(sourcePath);
    if (!stats.isFile() || stats.isSymbolicLink()) fail('BACKUP_SOURCE_UNSAFE', `Required source artifact is not a regular file: ${logicalPath}`);
    logicalPaths.add(logicalPath);
  }
  return [...logicalPaths].sort();
}

function requiredSourceEntriesForManifest(database, privateRoot, externalEntries) {
  const required = requiredSourceEntries(database, privateRoot);
  const available = new Set(externalEntries.map((entry) => entry.logical_path));
  for (const logicalPath of required) {
    if (!available.has(logicalPath)) fail('BACKUP_SOURCE_MISSING', `Required source artifact is missing from the backup: ${logicalPath}`);
  }
  return required;
}

function safeDestinationPath(rootPath, relativePath, createdDirectories) {
  const parts = normalizeLogicalPath(`private/${relativePath.split(path.sep).join('/')}`).slice('private/'.length).split('/');
  let current = rootPath;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    if (!isInside(current, rootPath)) fail('BACKUP_INVALID', 'Restore path escapes the destination root.');
    if (fs.existsSync(current)) {
      const stats = fs.lstatSync(current);
      if (!stats.isDirectory() || stats.isSymbolicLink()) fail('BACKUP_SOURCE_UNSAFE', 'Restore path contains an unsafe directory.');
    } else {
      fs.mkdirSync(current, { mode: 0o700 });
      createdDirectories.push(current);
    }
  }
  const target = path.join(current, parts.at(-1));
  if (!isInside(target, rootPath)) fail('BACKUP_INVALID', 'Restore path escapes the destination root.');
  return target;
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
  normalizeLogicalPath(entry.logical_path);
  if (typeof entry.source_class !== 'string' || entry.source_class.trim() === '' || typeof entry.media_type !== 'string' || entry.media_type.trim() === '') fail('BACKUP_INVALID', 'Backup entry identity is invalid.');
  if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256) || typeof entry.payload !== 'string') fail('BACKUP_INVALID', 'Backup entry integrity metadata is invalid.');
  let bytes;
  try {
    if (entry.payload !== '' && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.payload)) {
      fail('BACKUP_INVALID', 'Backup entry payload is not valid base64.');
    }
    bytes = Buffer.from(entry.payload, 'base64');
  } catch {
    fail('BACKUP_INVALID', 'Backup entry payload is invalid.');
  }
  if (bytes.toString('base64') !== entry.payload) fail('BACKUP_INVALID', 'Backup entry payload is not canonical base64.');
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
  if (!Array.isArray(bundle.required_entries) || bundle.required_entries.length === 0) fail('BACKUP_INCOMPLETE', 'Backup required-entry manifest is missing.');
  if (!Array.isArray(bundle.required_source_entries)) fail('BACKUP_INCOMPLETE', 'Backup required-source manifest is missing.');
  const requiredEntries = new Set(bundle.required_entries.map(normalizeLogicalPath));
  const requiredSourceEntries = new Set(bundle.required_source_entries.map(normalizeLogicalPath));
  if (requiredEntries.size !== bundle.required_entries.length || requiredSourceEntries.size !== bundle.required_source_entries.length) {
    fail('BACKUP_INVALID', 'Backup required-entry manifest contains duplicates.');
  }
  if (requiredSourceEntries.size > requiredEntries.size || [...requiredSourceEntries].some((entry) => !requiredEntries.has(entry))) {
    fail('BACKUP_INVALID', 'Backup required-source manifest is inconsistent.');
  }
  if ([...requiredSourceEntries].some((entry) => !entry.startsWith('private/'))) {
    fail('BACKUP_INVALID', 'Backup required-source manifest contains a non-private entry.');
  }
  const entries = new Map();
  for (const entry of bundle.entries) {
    const logicalPath = normalizeLogicalPath(entry?.logical_path);
    if (entries.has(logicalPath)) fail('BACKUP_INVALID', 'Backup manifest contains duplicate entries.');
    if (!logicalPath.startsWith('state/') && !logicalPath.startsWith('private/')) {
      fail('BACKUP_INVALID', 'Backup manifest contains an unsupported logical path.');
    }
    if (logicalPath.startsWith('state/') && !Object.hasOwn(STATE_ENTRY_CONTRACT, logicalPath)) {
      fail('BACKUP_INVALID', 'Backup manifest contains an unsupported state entry.');
    }
    entries.set(logicalPath, { manifest: stripPayload(entry), bytes: decodeEntry(entry) });
  }
  if (entries.size !== requiredEntries.size || [...entries.keys()].some((entry) => !requiredEntries.has(entry))) {
    fail('BACKUP_INCOMPLETE', 'Backup entries do not match the required-entry manifest.');
  }
  for (const logicalPath of REQUIRED_STATE_ENTRIES) if (!entries.has(logicalPath)) fail('BACKUP_INCOMPLETE', `Backup is missing ${logicalPath}.`);
  for (const logicalPath of requiredSourceEntries) if (!entries.has(logicalPath)) fail('BACKUP_INCOMPLETE', `Backup is missing required source ${logicalPath}.`);
  for (const [logicalPath, entry] of entries) {
    if (logicalPath.startsWith('private/') && entry.manifest.source_class !== 'USER_AUTHORED_BYTES') {
      fail('BACKUP_INVALID', 'Private backup bytes must be classified as user-authored bytes.');
    }
    const expected = STATE_ENTRY_CONTRACT[logicalPath];
    if (expected && (entry.manifest.source_class !== expected.source_class || entry.manifest.media_type !== expected.media_type)) {
      fail('BACKUP_INVALID', `Backup state entry metadata is invalid: ${logicalPath}.`);
    }
  }
  const manifest = canonicalSerialize({
    format: bundle.format,
    format_version: bundle.format_version,
    foundation_store_version: bundle.foundation_store_version,
    intelligence_schema_version: bundle.intelligence_schema_version,
    source_store_identity: bundle.source_store_identity,
    source_root_binding: bundle.source_root_binding,
    required_entries: bundle.required_entries,
    required_source_entries: bundle.required_source_entries,
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
    const stateEntries = [
      bytesEntry('state/foundation.sqlite', database.serialize(), 'CANONICAL_STRUCTURED_STATE', 'application/vnd.sqlite3'),
      bytesEntry('state/foundation-metadata.json', Buffer.from(canonicalSerialize(metadata), 'utf8'), 'CANONICAL_METADATA', 'application/json'),
      bytesEntry('state/intelligence-records.json', Buffer.from(canonicalSerialize({
        schema_version: INTELLIGENCE_SCHEMA_VERSION,
        tables: intelligenceTables,
      }), 'utf8'), 'CANONICAL_INTELLIGENCE_STATE', 'application/json'),
    ];
    const externalEntries = walkPrivateFiles(privateRoot);
    const requiredSourceEntries = requiredSourceEntriesForManifest(database, privateRoot, externalEntries);
    const entries = [...stateEntries, ...externalEntries].sort((left, right) => left.logical_path.localeCompare(right.logical_path));
    const requiredEntries = entries.map((entry) => entry.logical_path);
    assertReady();
    const manifest = {
      format: BACKUP_FORMAT,
      format_version: BACKUP_FORMAT_VERSION,
      foundation_store_version: FOUNDATION_STORE_VERSION,
      intelligence_schema_version: INTELLIGENCE_SCHEMA_VERSION,
      source_store_identity: metadata.store_identity,
      source_root_binding: metadata.root_binding,
      required_entries: requiredEntries,
      required_source_entries: requiredSourceEntries,
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
      required_entries: bundle.required_entries,
      required_source_entries: bundle.required_source_entries,
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
    const createdExternalFiles = [];
    const createdExternalDirectories = [];
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
      for (const [logicalPath, entry] of validated.entries) {
        if (!logicalPath.startsWith('private/')) continue;
        const targetPath = safeDestinationPath(destination.canonicalPath, logicalPath.slice('private/'.length), createdExternalDirectories);
        fs.writeFileSync(targetPath, entry.bytes, { mode: 0o600, flag: 'wx' });
        createdExternalFiles.push(targetPath);
      }
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
      for (const filePath of createdExternalFiles.reverse()) fs.rmSync(filePath, { force: true });
      for (const directoryPath of createdExternalDirectories.reverse()) {
        try { fs.rmdirSync(directoryPath); } catch { /* leave unrelated directories untouched */ }
      }
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
