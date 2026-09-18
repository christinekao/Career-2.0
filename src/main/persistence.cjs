const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const {
  PrivateRootError,
  assertFoundationFileSafe,
  assertPrivateRootStable,
  foundationDatabasePath,
  ensureFoundationStateDirectory,
} = require('./private-root.cjs');

const FOUNDATION_STORE_VERSION = 1;
const OPPORTUNITY_EVIDENCE_SCHEMA_VERSION = 1;
const READY_STATE = 'READY';
const INITIALIZING_STATE = 'INITIALIZING';
const METADATA_TABLE = 'foundation_metadata';
const OPPORTUNITY_EVIDENCE_SCHEMA_KEY = 'opportunity_evidence_schema_version';
const SQLITE_STATE_FILES = [
  'foundation.sqlite',
  'foundation.sqlite-journal',
  'foundation.sqlite-shm',
  'foundation.sqlite-wal',
];

const DOMAIN_SCHEMA_CONTRACT = {
  tables: {
    opportunities: {
      columns: [
        { name: 'opportunity_id', type: 'TEXT', notNull: true, primaryKey: true },
        { name: 'company_name', type: 'TEXT', notNull: true },
        { name: 'role_title', type: 'TEXT', notNull: true },
        { name: 'source_ref', type: 'TEXT', notNull: false },
        { name: 'current_jd_revision_id', type: 'TEXT', notNull: false },
        { name: 'created_at', type: 'TEXT', notNull: true },
        { name: 'updated_at', type: 'TEXT', notNull: true },
      ],
      uniqueConstraints: [],
      foreignKeys: [],
      checks: [],
    },
    jd_revisions: {
      columns: [
        { name: 'jd_revision_id', type: 'TEXT', notNull: true, primaryKey: true },
        { name: 'opportunity_id', type: 'TEXT', notNull: true },
        { name: 'revision_number', type: 'INTEGER', notNull: true },
        { name: 'content', type: 'TEXT', notNull: false },
        { name: 'content_identity', type: 'TEXT', notNull: false },
        { name: 'source_ref', type: 'TEXT', notNull: false },
        { name: 'captured_at', type: 'TEXT', notNull: true },
        { name: 'availability_status', type: 'TEXT', notNull: true },
      ],
      uniqueConstraints: [['opportunity_id', 'revision_number']],
      foreignKeys: [{
        columns: ['opportunity_id'],
        referencedTable: 'opportunities',
        referencedColumns: ['opportunity_id'],
        onDelete: 'RESTRICT',
      }],
      checks: [
        `availability_status IN ('AVAILABLE', 'UNAVAILABLE')
         AND (
           (availability_status = 'AVAILABLE' AND content IS NOT NULL AND content <> '')
           OR (availability_status = 'UNAVAILABLE' AND content IS NULL)
         )`,
      ],
    },
    evidence_records: {
      columns: [
        { name: 'evidence_id', type: 'TEXT', notNull: true, primaryKey: true },
        { name: 'current_revision_id', type: 'TEXT', notNull: false },
        { name: 'created_at', type: 'TEXT', notNull: true },
        { name: 'updated_at', type: 'TEXT', notNull: true },
      ],
      uniqueConstraints: [],
      foreignKeys: [],
      checks: [],
    },
    evidence_revisions: {
      columns: [
        { name: 'evidence_revision_id', type: 'TEXT', notNull: true, primaryKey: true },
        { name: 'evidence_id', type: 'TEXT', notNull: true },
        { name: 'revision_number', type: 'INTEGER', notNull: true },
        { name: 'factual_content', type: 'TEXT', notNull: true },
        { name: 'provenance_json', type: 'TEXT', notNull: true },
        { name: 'responsibility_boundary', type: 'TEXT', notNull: true },
        { name: 'outcome', type: 'TEXT', notNull: true },
        { name: 'metric_definition', type: 'TEXT', notNull: false },
        { name: 'confirmation_state', type: 'TEXT', notNull: true },
        { name: 'created_at', type: 'TEXT', notNull: true },
      ],
      uniqueConstraints: [['evidence_id', 'revision_number']],
      foreignKeys: [{
        columns: ['evidence_id'],
        referencedTable: 'evidence_records',
        referencedColumns: ['evidence_id'],
        onDelete: 'RESTRICT',
      }],
      checks: ["confirmation_state IN ('DRAFT', 'CONFIRMED')"],
    },
  },
  indexes: [
    {
      name: 'jd_revisions_opportunity_idx',
      table: 'jd_revisions',
      unique: false,
      columns: ['opportunity_id', 'revision_number'],
    },
    {
      name: 'evidence_revisions_evidence_idx',
      table: 'evidence_revisions',
      unique: false,
      columns: ['evidence_id', 'revision_number'],
    },
  ],
};

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

function assertMigrationOwnership(privateRoot, ownership, options) {
  assertPrivateRootStable(privateRoot, { repositoryRoot: options.repositoryRoot });
  assertOwnership(ownership, privateRoot);
}

function runMigrationCheckpoint(options, checkpoint) {
  if (typeof options.onMigrationCheckpoint === 'function') {
    options.onMigrationCheckpoint(checkpoint);
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

function readOpportunityEvidenceSchemaVersion(database) {
  const value = database.prepare(`SELECT value FROM ${METADATA_TABLE} WHERE key = ?`).pluck().get(OPPORTUNITY_EVIDENCE_SCHEMA_KEY);
  if (value === undefined) return 0;
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new FoundationPersistenceError('OPPORTUNITY_EVIDENCE_SCHEMA_INVALID', 'Opportunity/Evidence schema version is invalid.');
  }
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new FoundationPersistenceError('OPPORTUNITY_EVIDENCE_SCHEMA_INVALID', 'Opportunity/Evidence schema version is invalid.');
  }
  return version;
}

function sqlIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function renderDomainSchemaSql() {
  const tableStatements = Object.entries(DOMAIN_SCHEMA_CONTRACT.tables).map(([tableName, contract]) => {
    const definitions = contract.columns.map((column) => {
      const parts = [sqlIdentifier(column.name), column.type];
      if (column.primaryKey) parts.push('PRIMARY KEY');
      if (column.notNull) parts.push('NOT NULL');
      return parts.join(' ');
    });
    for (const columns of contract.uniqueConstraints) {
      definitions.push(`UNIQUE (${columns.map(sqlIdentifier).join(', ')})`);
    }
    for (const foreignKey of contract.foreignKeys) {
      definitions.push(
        `FOREIGN KEY (${foreignKey.columns.map(sqlIdentifier).join(', ')}) `
        + `REFERENCES ${sqlIdentifier(foreignKey.referencedTable)} (${foreignKey.referencedColumns.map(sqlIdentifier).join(', ')}) `
        + `ON DELETE ${foreignKey.onDelete}`,
      );
    }
    for (const check of contract.checks) definitions.push(`CHECK (${check})`);
    return `CREATE TABLE IF NOT EXISTS ${sqlIdentifier(tableName)} (\n  ${definitions.join(',\n  ')}\n);`;
  });
  const indexStatements = DOMAIN_SCHEMA_CONTRACT.indexes.map((index) => (
    `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${sqlIdentifier(index.name)} `
    + `ON ${sqlIdentifier(index.table)} (${index.columns.map(sqlIdentifier).join(', ')});`
  ));
  return [...tableStatements, ...indexStatements].join('\n');
}

function pragmaRows(database, name, argument) {
  const suffix = argument === undefined ? '' : `(${sqlLiteral(argument)})`;
  return database.pragma(`${name}${suffix}`);
}

function schemaInvalid(message) {
  throw new FoundationPersistenceError('OPPORTUNITY_EVIDENCE_SCHEMA_INVALID', message);
}

function sameColumns(left, right) {
  return left.length === right.length && left.every((column, index) => column === right[index]);
}

function assertDomainSchemaStructure(database) {
  for (const [tableName, contract] of Object.entries(DOMAIN_SCHEMA_CONTRACT.tables)) {
    const actualColumns = pragmaRows(database, 'table_info', tableName);
    if (actualColumns.length === 0) schemaInvalid(`Opportunity/Evidence table is missing: ${tableName}`);
    const byName = new Map(actualColumns.map((column) => [column.name, column]));
    for (const expected of contract.columns) {
      const actual = byName.get(expected.name);
      if (!actual) schemaInvalid(`Opportunity/Evidence column is missing: ${tableName}`);
      if (String(actual.type || '').trim().toUpperCase() !== expected.type) {
        schemaInvalid(`Opportunity/Evidence column type is invalid: ${tableName}`);
      }
      if (Number(actual.notnull) !== (expected.notNull ? 1 : 0)) {
        schemaInvalid(`Opportunity/Evidence column nullability is invalid: ${tableName}`);
      }
    }
    const expectedNames = new Set(contract.columns.map((column) => column.name));
    for (const actual of actualColumns) {
      if (!expectedNames.has(actual.name) && Number(actual.notnull) === 1 && actual.dflt_value === null) {
        schemaInvalid(`Opportunity/Evidence mandatory extension column is unsupported: ${tableName}`);
      }
    }
    const actualPrimaryKey = actualColumns
      .filter((column) => Number(column.pk) > 0)
      .sort((left, right) => Number(left.pk) - Number(right.pk))
      .map((column) => column.name);
    const expectedPrimaryKey = contract.columns.filter((column) => column.primaryKey).map((column) => column.name);
    if (!sameColumns(actualPrimaryKey, expectedPrimaryKey)) {
      schemaInvalid(`Opportunity/Evidence primary key is invalid: ${tableName}`);
    }
  }
}

function indexColumns(database, indexName) {
  return pragmaRows(database, 'index_info', indexName)
    .sort((left, right) => Number(left.seqno) - Number(right.seqno))
    .map((column) => column.name);
}

function assertDomainSchemaIndexes(database) {
  for (const [tableName, contract] of Object.entries(DOMAIN_SCHEMA_CONTRACT.tables)) {
    const indexes = pragmaRows(database, 'index_list', tableName);
    for (const uniqueColumns of contract.uniqueConstraints) {
      const hasConstraint = indexes.some((index) => (
        Number(index.unique) === 1
        && Number(index.partial || 0) === 0
        && sameColumns(indexColumns(database, index.name), uniqueColumns)
      ));
      if (!hasConstraint) schemaInvalid(`Opportunity/Evidence unique constraint is missing: ${tableName}`);
    }
  }

  for (const expected of DOMAIN_SCHEMA_CONTRACT.indexes) {
    const indexes = pragmaRows(database, 'index_list', expected.table);
    const actual = indexes.find((index) => index.name === expected.name);
    if (!actual
      || Number(actual.unique) !== (expected.unique ? 1 : 0)
      || Number(actual.partial || 0) !== 0
      || !sameColumns(indexColumns(database, expected.name), expected.columns)) {
      schemaInvalid(`Opportunity/Evidence index is invalid: ${expected.name}`);
    }
  }
}

function assertDomainSchemaForeignKeys(database) {
  const foreignKeysEnabled = pragmaRows(database, 'foreign_keys')[0]?.foreign_keys;
  if (Number(foreignKeysEnabled) !== 1) schemaInvalid('Opportunity/Evidence foreign keys are disabled.');
  for (const [tableName, contract] of Object.entries(DOMAIN_SCHEMA_CONTRACT.tables)) {
    const actualForeignKeys = pragmaRows(database, 'foreign_key_list', tableName);
    for (const expected of contract.foreignKeys) {
      const found = actualForeignKeys.some((foreignKey) => (
        foreignKey.from === expected.columns[0]
        && foreignKey.table === expected.referencedTable
        && foreignKey.to === expected.referencedColumns[0]
        && String(foreignKey.on_delete || '').toUpperCase() === expected.onDelete
      ));
      if (!found) schemaInvalid(`Opportunity/Evidence foreign key is missing: ${tableName}`);
    }
  }
}

function assertNoIntegrityRows(database, sql, message) {
  if (database.prepare(sql).get()) schemaInvalid(message);
}

function assertDomainDataIntegrity(database) {
  assertNoIntegrityRows(
    database,
    `SELECT j.jd_revision_id
       FROM jd_revisions j
       LEFT JOIN opportunities o ON o.opportunity_id = j.opportunity_id
      WHERE o.opportunity_id IS NULL
      LIMIT 1`,
    'Opportunity/Evidence JD revision parent is invalid.',
  );
  assertNoIntegrityRows(
    database,
    `SELECT e.evidence_revision_id
       FROM evidence_revisions e
       LEFT JOIN evidence_records r ON r.evidence_id = e.evidence_id
      WHERE r.evidence_id IS NULL
      LIMIT 1`,
    'Opportunity/Evidence evidence revision parent is invalid.',
  );
  assertNoIntegrityRows(
    database,
    `SELECT opportunity_id, revision_number
       FROM jd_revisions
      GROUP BY opportunity_id, revision_number
     HAVING COUNT(*) > 1
      LIMIT 1`,
    'Opportunity/Evidence JD revision identity is not unique.',
  );
  assertNoIntegrityRows(
    database,
    `SELECT evidence_id, revision_number
       FROM evidence_revisions
      GROUP BY evidence_id, revision_number
     HAVING COUNT(*) > 1
      LIMIT 1`,
    'Opportunity/Evidence evidence revision identity is not unique.',
  );
  assertNoIntegrityRows(
    database,
    `SELECT o.opportunity_id
       FROM opportunities o
       LEFT JOIN jd_revisions j ON j.jd_revision_id = o.current_jd_revision_id
      WHERE o.current_jd_revision_id IS NOT NULL
        AND (j.jd_revision_id IS NULL OR j.opportunity_id <> o.opportunity_id)
      LIMIT 1`,
    'Opportunity/Evidence current JD revision pointer is invalid.',
  );
  assertNoIntegrityRows(
    database,
    `SELECT r.evidence_id
      FROM evidence_records r
       LEFT JOIN evidence_revisions e ON e.evidence_revision_id = r.current_revision_id
      WHERE r.current_revision_id IS NOT NULL
        AND (
          e.evidence_revision_id IS NULL
          OR COALESCE(e.evidence_id, '') <> r.evidence_id
          OR COALESCE(e.confirmation_state, '') <> 'CONFIRMED'
        )
      LIMIT 1`,
    'Opportunity/Evidence current evidence revision pointer is invalid.',
  );
}

function assertConstraintRejects(operation, message) {
  try {
    operation();
  } catch (error) {
    if (error?.code !== 'SQLITE_CONSTRAINT_CHECK') schemaInvalid(message);
    return;
  }
  schemaInvalid(message);
}

function assertDomainCheckConstraints(database) {
  const savepoint = 'career2_domain_schema_validation';
  database.exec(`SAVEPOINT ${savepoint}`);
  try {
    const timestamp = new Date().toISOString();
    const opportunityId = `schema-probe-${crypto.randomUUID()}`;
    const evidenceId = `schema-probe-${crypto.randomUUID()}`;
    database.prepare(`
      INSERT INTO opportunities (
        opportunity_id, company_name, role_title, source_ref,
        current_jd_revision_id, created_at, updated_at
      ) VALUES (?, 'schema probe', 'schema probe', NULL, NULL, ?, ?)
    `).run(opportunityId, timestamp, timestamp);
    database.prepare(`
      INSERT INTO jd_revisions (
        jd_revision_id, opportunity_id, revision_number, content,
        content_identity, source_ref, captured_at, availability_status
      ) VALUES (?, ?, 1, 'schema probe', NULL, NULL, ?, 'AVAILABLE')
    `).run(`schema-probe-${crypto.randomUUID()}`, opportunityId, timestamp);
    database.prepare(`
      INSERT INTO jd_revisions (
        jd_revision_id, opportunity_id, revision_number, content,
        content_identity, source_ref, captured_at, availability_status
      ) VALUES (?, ?, 2, NULL, NULL, NULL, ?, 'UNAVAILABLE')
    `).run(`schema-probe-${crypto.randomUUID()}`, opportunityId, timestamp);
    assertConstraintRejects(
      () => database.prepare(`
        INSERT INTO jd_revisions (
          jd_revision_id, opportunity_id, revision_number, content,
          content_identity, source_ref, captured_at, availability_status
        ) VALUES (?, ?, 3, NULL, NULL, NULL, ?, 'AVAILABLE')
      `).run(`schema-probe-${crypto.randomUUID()}`, opportunityId, timestamp),
      'Opportunity/Evidence JD availability constraint is missing.',
    );
    assertConstraintRejects(
      () => database.prepare(`
        INSERT INTO jd_revisions (
          jd_revision_id, opportunity_id, revision_number, content,
          content_identity, source_ref, captured_at, availability_status
        ) VALUES (?, ?, 4, 'schema probe', NULL, NULL, ?, 'UNAVAILABLE')
      `).run(`schema-probe-${crypto.randomUUID()}`, opportunityId, timestamp),
      'Opportunity/Evidence JD availability constraint is incomplete.',
    );
    database.prepare(`
      INSERT INTO evidence_records (evidence_id, current_revision_id, created_at, updated_at)
      VALUES (?, NULL, ?, ?)
    `).run(evidenceId, timestamp, timestamp);
    database.prepare(`
      INSERT INTO evidence_revisions (
        evidence_revision_id, evidence_id, revision_number, factual_content,
        provenance_json, responsibility_boundary, outcome, metric_definition,
        confirmation_state, created_at
      ) VALUES (?, ?, 1, 'schema probe', '{}', 'schema probe', 'schema probe', NULL, 'DRAFT', ?)
    `).run(`schema-probe-${crypto.randomUUID()}`, evidenceId, timestamp);
    database.prepare(`
      INSERT INTO evidence_revisions (
        evidence_revision_id, evidence_id, revision_number, factual_content,
        provenance_json, responsibility_boundary, outcome, metric_definition,
        confirmation_state, created_at
      ) VALUES (?, ?, 2, 'schema probe', '{}', 'schema probe', 'schema probe', NULL, 'CONFIRMED', ?)
    `).run(`schema-probe-${crypto.randomUUID()}`, evidenceId, timestamp);
    assertConstraintRejects(
      () => database.prepare(`
        INSERT INTO evidence_revisions (
          evidence_revision_id, evidence_id, revision_number, factual_content,
          provenance_json, responsibility_boundary, outcome, metric_definition,
          confirmation_state, created_at
        ) VALUES (?, ?, 3, 'schema probe', '{}', 'schema probe', 'schema probe', NULL, 'INVALID', ?)
      `).run(`schema-probe-${crypto.randomUUID()}`, evidenceId, timestamp),
      'Opportunity/Evidence confirmation-state constraint is missing.',
    );
  } finally {
    try {
      database.exec(`ROLLBACK TO ${savepoint}`);
    } finally {
      database.exec(`RELEASE ${savepoint}`);
    }
  }
}

function assertOpportunityEvidenceSchema(database) {
  assertDomainSchemaStructure(database);
  assertDomainSchemaIndexes(database);
  assertDomainSchemaForeignKeys(database);
  assertDomainDataIntegrity(database);
  assertDomainCheckConstraints(database);
}

function migrateOpportunityEvidenceSchema(database, options = {}) {
  assertMigrationOwnership(options.privateRoot, options.ownership, options);
  const currentVersion = readOpportunityEvidenceSchemaVersion(database);
  if (currentVersion > OPPORTUNITY_EVIDENCE_SCHEMA_VERSION) {
    throw new FoundationPersistenceError(
      'OPPORTUNITY_EVIDENCE_VERSION_UNSUPPORTED',
      `Unsupported Opportunity/Evidence schema version: ${currentVersion}`,
    );
  }
  if (currentVersion === OPPORTUNITY_EVIDENCE_SCHEMA_VERSION) {
    try {
      assertOpportunityEvidenceSchema(database);
    } catch (error) {
      if (error instanceof FoundationPersistenceError) throw error;
      throw new FoundationPersistenceError(
        'OPPORTUNITY_EVIDENCE_SCHEMA_INVALID',
        'Opportunity/Evidence schema validation failed.',
      );
    }
    assertMigrationOwnership(options.privateRoot, options.ownership, options);
    return;
  }

  try {
    const migrate = database.transaction(() => {
      assertMigrationOwnership(options.privateRoot, options.ownership, options);
      database.exec(renderDomainSchemaSql());
      runMigrationCheckpoint(options, 'after-schema');
      assertMigrationOwnership(options.privateRoot, options.ownership, options);
      assertOpportunityEvidenceSchema(database);
      if (options.failurePoint === 'opportunity-evidence-before-marker') {
        throw new FoundationPersistenceError(
          'OPPORTUNITY_EVIDENCE_MIGRATION_FAILED',
          'Synthetic Opportunity/Evidence migration failure before schema publication.',
        );
      }
      database.prepare(`INSERT OR REPLACE INTO ${METADATA_TABLE} (key, value) VALUES (?, ?)`).run(
        OPPORTUNITY_EVIDENCE_SCHEMA_KEY,
        String(OPPORTUNITY_EVIDENCE_SCHEMA_VERSION),
      );
      runMigrationCheckpoint(options, 'after-marker');
      assertMigrationOwnership(options.privateRoot, options.ownership, options);
      assertOpportunityEvidenceSchema(database);
    });
    migrate();
    assertMigrationOwnership(options.privateRoot, options.ownership, options);
  } catch (error) {
    if (error instanceof FoundationPersistenceError) throw error;
    throw new FoundationPersistenceError('OPPORTUNITY_EVIDENCE_MIGRATION_FAILED', error.message);
  }
}

function normalizeRequiredText(value, fieldName, errorCode) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new FoundationPersistenceError(errorCode, `${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeOptionalText(value, fieldName, errorCode) {
  if (value === undefined || value === null || value === '') return null;
  return normalizeRequiredText(value, fieldName, errorCode);
}

function normalizeTimestamp(value, fieldName, errorCode) {
  const candidate = value === undefined ? new Date().toISOString() : value;
  if (typeof candidate !== 'string' || Number.isNaN(Date.parse(candidate))) {
    throw new FoundationPersistenceError(errorCode, `${fieldName} must be a valid timestamp.`);
  }
  return new Date(candidate).toISOString();
}

function normalizeId(value, fieldName) {
  return normalizeRequiredText(value, fieldName, 'OPPORTUNITY_EVIDENCE_INVALID');
}

function contentIdentity(content) {
  return content === null ? null : crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function normalizeProvenance(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FoundationPersistenceError('EVIDENCE_INVALID', 'provenance must be a non-empty object.');
  }
  const serialized = JSON.stringify(value);
  if (!serialized || serialized === '{}') {
    throw new FoundationPersistenceError('EVIDENCE_INVALID', 'provenance must be a non-empty object.');
  }
  return serialized;
}

function normalizeEvidenceInput(input = {}) {
  return {
    factualContent: normalizeRequiredText(input.factualContent, 'factualContent', 'EVIDENCE_INVALID'),
    responsibilityBoundary: normalizeRequiredText(input.responsibilityBoundary, 'responsibilityBoundary', 'EVIDENCE_INVALID'),
    outcome: normalizeRequiredText(input.outcome, 'outcome', 'EVIDENCE_INVALID'),
    metricDefinition: normalizeOptionalText(input.metricDefinition, 'metricDefinition', 'EVIDENCE_INVALID'),
    provenanceJson: normalizeProvenance(input.provenance),
    createdAt: normalizeTimestamp(input.createdAt, 'createdAt', 'EVIDENCE_INVALID'),
  };
}

function createDomainOperations(database, privateRoot, ownership, options, isClosed) {
  const repositoryRoot = options.repositoryRoot;

  function assertDomainReady() {
    if (isClosed()) throw new FoundationPersistenceError('FOUNDATION_CLOSED', 'The Opportunity/Evidence store is closed.');
    assertPrivateRootStable(privateRoot, { repositoryRoot });
    assertOwnership(ownership, privateRoot);
    const version = readOpportunityEvidenceSchemaVersion(database);
    if (version !== OPPORTUNITY_EVIDENCE_SCHEMA_VERSION) {
      throw new FoundationPersistenceError('OPPORTUNITY_EVIDENCE_NOT_READY', 'Opportunity/Evidence schema is not ready.');
    }
  }

  function opportunityFromRows(row, revisions) {
    return {
      opportunityId: row.opportunity_id,
      companyName: row.company_name,
      roleTitle: row.role_title,
      sourceRef: row.source_ref,
      currentJdRevisionId: row.current_jd_revision_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      jdRevisions: revisions.map((revision) => ({
        jdRevisionId: revision.jd_revision_id,
        opportunityId: revision.opportunity_id,
        revisionNumber: revision.revision_number,
        content: revision.content,
        contentIdentity: revision.content_identity,
        sourceRef: revision.source_ref,
        capturedAt: revision.captured_at,
        availabilityStatus: revision.availability_status,
      })),
    };
  }

  function readOpportunity(opportunityId) {
    const row = database.prepare('SELECT * FROM opportunities WHERE opportunity_id = ?').get(opportunityId);
    if (!row) return null;
    const revisions = database.prepare(
      'SELECT * FROM jd_revisions WHERE opportunity_id = ? ORDER BY revision_number ASC',
    ).all(opportunityId);
    return opportunityFromRows(row, revisions);
  }

  function createOpportunity(input = {}) {
    assertDomainReady();
    const companyName = normalizeRequiredText(input.companyName, 'companyName', 'OPPORTUNITY_INVALID');
    const roleTitle = normalizeRequiredText(input.roleTitle, 'roleTitle', 'OPPORTUNITY_INVALID');
    const sourceRef = normalizeOptionalText(input.sourceRef, 'sourceRef', 'OPPORTUNITY_INVALID');
    const createdAt = normalizeTimestamp(input.createdAt, 'createdAt', 'OPPORTUNITY_INVALID');
    const opportunityId = crypto.randomUUID();
    database.prepare(`
      INSERT INTO opportunities (
        opportunity_id, company_name, role_title, source_ref,
        current_jd_revision_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?)
    `).run(opportunityId, companyName, roleTitle, sourceRef, createdAt, createdAt);
    return readOpportunity(opportunityId);
  }

  function getOpportunity(value) {
    assertDomainReady();
    return readOpportunity(normalizeId(value, 'opportunityId'));
  }

  function addJdRevision(opportunityValue, input = {}) {
    assertDomainReady();
    const opportunityId = normalizeId(opportunityValue, 'opportunityId');
    if (!database.prepare('SELECT 1 FROM opportunities WHERE opportunity_id = ?').get(opportunityId)) {
      throw new FoundationPersistenceError('OPPORTUNITY_NOT_FOUND', 'Opportunity does not exist.');
    }
    if (input.content !== undefined && input.content !== null && typeof input.content !== 'string') {
      throw new FoundationPersistenceError('JD_REVISION_INVALID', 'content must be a string when provided.');
    }
    const content = typeof input.content === 'string' && input.content.trim() !== '' ? input.content : null;
    const availabilityStatus = input.availabilityStatus || (content ? 'AVAILABLE' : 'UNAVAILABLE');
    if (!['AVAILABLE', 'UNAVAILABLE'].includes(availabilityStatus)) {
      throw new FoundationPersistenceError('JD_REVISION_INVALID', 'availabilityStatus is invalid.');
    }
    if ((availabilityStatus === 'AVAILABLE' && content === null) || (availabilityStatus === 'UNAVAILABLE' && content !== null)) {
      throw new FoundationPersistenceError('JD_REVISION_INVALID', 'JD content and availabilityStatus are inconsistent.');
    }
    const sourceRef = normalizeOptionalText(input.sourceRef, 'sourceRef', 'JD_REVISION_INVALID');
    const capturedAt = normalizeTimestamp(input.capturedAt, 'capturedAt', 'JD_REVISION_INVALID');
    const jdRevisionId = crypto.randomUUID();
    const insert = database.transaction(() => {
      const revisionNumber = database.prepare(
        'SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_revision FROM jd_revisions WHERE opportunity_id = ?',
      ).get(opportunityId).next_revision;
      database.prepare(`
        INSERT INTO jd_revisions (
          jd_revision_id, opportunity_id, revision_number, content,
          content_identity, source_ref, captured_at, availability_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        jdRevisionId,
        opportunityId,
        revisionNumber,
        content,
        contentIdentity(content),
        sourceRef,
        capturedAt,
        availabilityStatus,
      );
      database.prepare(
        'UPDATE opportunities SET current_jd_revision_id = ?, updated_at = ? WHERE opportunity_id = ?',
      ).run(jdRevisionId, capturedAt, opportunityId);
    });
    insert();
    return readOpportunity(opportunityId).jdRevisions.at(-1);
  }

  function getJdRevision(opportunityValue, revisionValue) {
    assertDomainReady();
    const opportunityId = normalizeId(opportunityValue, 'opportunityId');
    const jdRevisionId = normalizeId(revisionValue, 'jdRevisionId');
    const row = database.prepare(
      'SELECT * FROM jd_revisions WHERE opportunity_id = ? AND jd_revision_id = ?',
    ).get(opportunityId, jdRevisionId);
    if (!row) return null;
    return readOpportunity(opportunityId).jdRevisions.find((revision) => revision.jdRevisionId === jdRevisionId) || null;
  }

  function evidenceRevisionFromRow(row) {
    let provenance;
    try {
      provenance = JSON.parse(row.provenance_json);
    } catch {
      throw new FoundationPersistenceError('EVIDENCE_CORRUPT', 'Evidence provenance is not valid JSON.');
    }
    return {
      evidenceRevisionId: row.evidence_revision_id,
      evidenceId: row.evidence_id,
      revisionNumber: row.revision_number,
      factualContent: row.factual_content,
      provenance,
      responsibilityBoundary: row.responsibility_boundary,
      outcome: row.outcome,
      metricDefinition: row.metric_definition,
      confirmationState: row.confirmation_state,
      createdAt: row.created_at,
    };
  }

  function readEvidence(evidenceId) {
    const row = database.prepare('SELECT * FROM evidence_records WHERE evidence_id = ?').get(evidenceId);
    if (!row) return null;
    const revisions = database.prepare(
      'SELECT * FROM evidence_revisions WHERE evidence_id = ? ORDER BY revision_number ASC',
    ).all(evidenceId).map(evidenceRevisionFromRow);
    return {
      evidenceId: row.evidence_id,
      currentRevisionId: row.current_revision_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      currentRevision: revisions.find((revision) => revision.evidenceRevisionId === row.current_revision_id) || null,
      revisions,
    };
  }

  function createEvidence(input = {}) {
    assertDomainReady();
    const normalized = normalizeEvidenceInput(input);
    const evidenceId = crypto.randomUUID();
    const evidenceRevisionId = crypto.randomUUID();
    const insert = database.transaction(() => {
      database.prepare(`
        INSERT INTO evidence_records (evidence_id, current_revision_id, created_at, updated_at)
        VALUES (?, NULL, ?, ?)
      `).run(evidenceId, normalized.createdAt, normalized.createdAt);
      database.prepare(`
        INSERT INTO evidence_revisions (
          evidence_revision_id, evidence_id, revision_number, factual_content,
          provenance_json, responsibility_boundary, outcome, metric_definition,
          confirmation_state, created_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'DRAFT', ?)
      `).run(
        evidenceRevisionId,
        evidenceId,
        normalized.factualContent,
        normalized.provenanceJson,
        normalized.responsibilityBoundary,
        normalized.outcome,
        normalized.metricDefinition,
        normalized.createdAt,
      );
    });
    insert();
    return readEvidence(evidenceId);
  }

  function getEvidence(value) {
    assertDomainReady();
    return readEvidence(normalizeId(value, 'evidenceId'));
  }

  function createEvidenceRevision(evidenceValue, input = {}) {
    assertDomainReady();
    const evidenceId = normalizeId(evidenceValue, 'evidenceId');
    if (!database.prepare('SELECT 1 FROM evidence_records WHERE evidence_id = ?').get(evidenceId)) {
      throw new FoundationPersistenceError('EVIDENCE_NOT_FOUND', 'Evidence does not exist.');
    }
    const normalized = normalizeEvidenceInput(input);
    const evidenceRevisionId = crypto.randomUUID();
    const insert = database.transaction(() => {
      const revisionNumber = database.prepare(
        'SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_revision FROM evidence_revisions WHERE evidence_id = ?',
      ).get(evidenceId).next_revision;
      database.prepare(`
        INSERT INTO evidence_revisions (
          evidence_revision_id, evidence_id, revision_number, factual_content,
          provenance_json, responsibility_boundary, outcome, metric_definition,
          confirmation_state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)
      `).run(
        evidenceRevisionId,
        evidenceId,
        revisionNumber,
        normalized.factualContent,
        normalized.provenanceJson,
        normalized.responsibilityBoundary,
        normalized.outcome,
        normalized.metricDefinition,
        normalized.createdAt,
      );
      database.prepare('UPDATE evidence_records SET updated_at = ? WHERE evidence_id = ?').run(normalized.createdAt, evidenceId);
    });
    insert();
    return readEvidence(evidenceId);
  }

  function confirmEvidenceRevision(evidenceValue, revisionValue, confirmedAt) {
    assertDomainReady();
    const evidenceId = normalizeId(evidenceValue, 'evidenceId');
    const evidenceRevisionId = normalizeId(revisionValue, 'evidenceRevisionId');
    const timestamp = normalizeTimestamp(confirmedAt, 'confirmedAt', 'EVIDENCE_INVALID');
    const row = database.prepare(
      'SELECT * FROM evidence_revisions WHERE evidence_id = ? AND evidence_revision_id = ?',
    ).get(evidenceId, evidenceRevisionId);
    if (!row) throw new FoundationPersistenceError('EVIDENCE_REVISION_NOT_FOUND', 'Evidence revision does not exist.');

    const confirm = database.transaction(() => {
      let currentRevisionId = evidenceRevisionId;
      if (row.confirmation_state === 'DRAFT') {
        const nextRevision = database.prepare(
          'SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_revision FROM evidence_revisions WHERE evidence_id = ?',
        ).get(evidenceId).next_revision;
        currentRevisionId = crypto.randomUUID();
        database.prepare(`
          INSERT INTO evidence_revisions (
            evidence_revision_id, evidence_id, revision_number, factual_content,
            provenance_json, responsibility_boundary, outcome, metric_definition,
            confirmation_state, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?)
        `).run(
          currentRevisionId,
          evidenceId,
          nextRevision,
          row.factual_content,
          row.provenance_json,
          row.responsibility_boundary,
          row.outcome,
          row.metric_definition,
          timestamp,
        );
      }
      database.prepare(
        'UPDATE evidence_records SET current_revision_id = ?, updated_at = ? WHERE evidence_id = ?',
      ).run(currentRevisionId, timestamp, evidenceId);
    });
    confirm();
    return readEvidence(evidenceId);
  }

  return {
    opportunity: Object.freeze({
      create: createOpportunity,
      get: getOpportunity,
      addJdRevision,
      getJdRevision,
    }),
    evidence: Object.freeze({
      create: createEvidence,
      get: getEvidence,
      createRevision: createEvidenceRevision,
      confirmRevision: confirmEvidenceRevision,
    }),
  };
}

function openFoundationStore(privateRoot, options = {}) {
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
    database.pragma('foreign_keys = ON');
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
      database,
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

function initializeFoundationStore(privateRoot, options = {}) {
  const store = openFoundationStore(privateRoot, options);
  return {
    metadata: store.metadata,
    close: store.close,
  };
}

function initializeOpportunityEvidenceStore(privateRoot, options = {}) {
  const store = openFoundationStore(privateRoot, options);
  let closed = false;
  try {
    migrateOpportunityEvidenceSchema(store.database, { ...options, privateRoot });
    assertMigrationOwnership(privateRoot, options.ownership, options);
    const operations = createDomainOperations(
      store.database,
      privateRoot,
      options.ownership,
      options,
      () => closed,
    );
    assertMigrationOwnership(privateRoot, options.ownership, options);
    return {
      metadata: {
        ...store.metadata,
        opportunityEvidenceSchemaVersion: OPPORTUNITY_EVIDENCE_SCHEMA_VERSION,
      },
      ...operations,
      close() {
        if (closed) return;
        closed = true;
        store.close();
      },
    };
  } catch (error) {
    if (options.allowDegradedOnMigrationFailure && typeof error?.code === 'string' && error.code.startsWith('OPPORTUNITY_EVIDENCE_')) {
      return {
        metadata: {
          ...store.metadata,
          opportunityEvidenceSchemaVersion: null,
        },
        substrateStatus: {
          phase: 'unavailable',
          code: error.code,
          message: error.message,
        },
        close() {
          if (closed) return;
          closed = true;
          store.close();
        },
      };
    }
    closed = true;
    store.close();
    throw error;
  }
}

module.exports = {
  FOUNDATION_STORE_VERSION,
  FoundationPersistenceError,
  initializeFoundationStore,
  initializeOpportunityEvidenceStore,
  OPPORTUNITY_EVIDENCE_SCHEMA_VERSION,
};
