const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const {
  CLAIM_KINDS,
  EXPLICITNESS,
  EXTRACTION_STATUSES,
  IntelligenceValidationError,
  MATCH_CLASSIFICATIONS,
  OPERATION_TYPES,
  POSITIONING_STATES,
  PRIORITIES,
  REQUIREMENT_TYPES,
  buildEvidenceSnapshot,
  buildInputBundle,
  canonicalSerialize,
  classifyMatch,
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
} = require('./intelligence.cjs');

const {
  EXECUTION_STATES,
  RESULT_STATUSES,
  VALIDATION_STATUSES,
  buildExecutionRequest,
  createExecutionService,
  normalizeExecutionResponse,
} = require('./execution.cjs');

const {
  PrivateRootError,
  assertFoundationFileSafe,
  assertPrivateRootStable,
  foundationDatabasePath,
  ensureFoundationStateDirectory,
} = require('./private-root.cjs');
const { createBackupOperations } = require('./backup.cjs');

const FOUNDATION_STORE_VERSION = 1;
const OPPORTUNITY_EVIDENCE_SCHEMA_VERSION = 1;
const INTELLIGENCE_SCHEMA_VERSION = 1;
const READY_STATE = 'READY';
const INITIALIZING_STATE = 'INITIALIZING';
const METADATA_TABLE = 'foundation_metadata';
const OPPORTUNITY_EVIDENCE_SCHEMA_KEY = 'opportunity_evidence_schema_version';
const INTELLIGENCE_SCHEMA_KEY = 'intelligence_schema_version';
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

const INTELLIGENCE_SCHEMA_CONTRACT = {
  tables: {
    intelligence_evidence_snapshots: {
      columns: [
        { name: 'evidence_snapshot_id', type: 'TEXT', notNull: true, primaryKey: true },
        { name: 'evidence_id', type: 'TEXT', notNull: true },
        { name: 'evidence_revision_ids_json', type: 'TEXT', notNull: true },
        { name: 'input_generation', type: 'TEXT', notNull: true },
        { name: 'contract_version', type: 'INTEGER', notNull: true },
        { name: 'created_at', type: 'TEXT', notNull: true },
      ],
      uniqueConstraints: [],
      foreignKeys: [],
      checks: [
        'contract_version >= 1',
      ],
    },
    intelligence_input_generations: {
      columns: [
        { name: 'analysis_id', type: 'TEXT', notNull: true, primaryKey: true },
        { name: 'opportunity_id', type: 'TEXT', notNull: true },
        { name: 'jd_revision_id', type: 'TEXT', notNull: true },
        { name: 'evidence_snapshot_id', type: 'TEXT', notNull: true },
        { name: 'evidence_revision_ids_json', type: 'TEXT', notNull: true },
        { name: 'operation_type', type: 'TEXT', notNull: true },
        { name: 'schema_version', type: 'INTEGER', notNull: true },
        { name: 'execution_id', type: 'TEXT', notNull: true },
        { name: 'idempotency_key', type: 'TEXT', notNull: true },
        { name: 'input_generation', type: 'TEXT', notNull: true },
        { name: 'requested_at', type: 'TEXT', notNull: true },
        { name: 'disclosure_classification', type: 'TEXT', notNull: true },
        { name: 'created_at', type: 'TEXT', notNull: true },
      ],
      uniqueConstraints: [['execution_id'], ['idempotency_key']],
      foreignKeys: [{
        columns: ['evidence_snapshot_id'],
        referencedTable: 'intelligence_evidence_snapshots',
        referencedColumns: ['evidence_snapshot_id'],
        onDelete: 'RESTRICT',
      }],
      checks: [
        "operation_type IN ('ANALYZE_REQUIREMENTS', 'CLASSIFY_MATCHES', 'DRAFT_POSITIONING')",
        'schema_version >= 1',
      ],
    },
    intelligence_executions: {
      columns: [
        { name: 'execution_id', type: 'TEXT', notNull: true, primaryKey: true },
        { name: 'analysis_id', type: 'TEXT', notNull: true },
        { name: 'idempotency_key', type: 'TEXT', notNull: true },
        { name: 'opportunity_id', type: 'TEXT', notNull: true },
        { name: 'jd_revision_id', type: 'TEXT', notNull: true },
        { name: 'evidence_snapshot_id', type: 'TEXT', notNull: true },
        { name: 'input_generation', type: 'TEXT', notNull: true },
        { name: 'operation_type', type: 'TEXT', notNull: true },
        { name: 'schema_version', type: 'INTEGER', notNull: true },
        { name: 'requested_at', type: 'TEXT', notNull: true },
        { name: 'disclosure_classification', type: 'TEXT', notNull: true },
        { name: 'request_payload_json', type: 'TEXT', notNull: true },
        { name: 'attempt', type: 'INTEGER', notNull: true },
        { name: 'max_attempts', type: 'INTEGER', notNull: true },
        { name: 'execution_state', type: 'TEXT', notNull: true },
        { name: 'result_status', type: 'TEXT', notNull: false },
        { name: 'validation_status', type: 'TEXT', notNull: true },
        { name: 'result_payload_json', type: 'TEXT', notNull: false },
        { name: 'error_json', type: 'TEXT', notNull: false },
        { name: 'cancel_requested_at', type: 'TEXT', notNull: false },
        { name: 'cancellation_acknowledged', type: 'INTEGER', notNull: false },
        { name: 'superseded_by_execution_id', type: 'TEXT', notNull: false },
        { name: 'is_current', type: 'INTEGER', notNull: true },
        { name: 'created_at', type: 'TEXT', notNull: true },
        { name: 'updated_at', type: 'TEXT', notNull: true },
        { name: 'completed_at', type: 'TEXT', notNull: false },
      ],
      uniqueConstraints: [['idempotency_key']],
      foreignKeys: [
        {
          columns: ['analysis_id'],
          referencedTable: 'intelligence_input_generations',
          referencedColumns: ['analysis_id'],
          onDelete: 'RESTRICT',
        },
        {
          columns: ['evidence_snapshot_id'],
          referencedTable: 'intelligence_evidence_snapshots',
          referencedColumns: ['evidence_snapshot_id'],
          onDelete: 'RESTRICT',
        },
      ],
      checks: [
        "operation_type IN ('ANALYZE_REQUIREMENTS', 'CLASSIFY_MATCHES', 'DRAFT_POSITIONING')",
        'schema_version >= 1',
        "execution_state IN ('RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED', 'STALE_RESULT_REJECTED')",
        "(result_status IS NULL OR result_status IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'UNAVAILABLE', 'PROVIDER_FAILURE', 'MALFORMED', 'SCHEMA_INVALID', 'PARTIAL', 'STALE', 'DUPLICATE'))",
        "validation_status IN ('VALID', 'INVALID', 'NOT_RUN')",
        'attempt >= 0',
        'max_attempts >= 1',
        'attempt <= max_attempts',
        '(cancellation_acknowledged IS NULL OR cancellation_acknowledged IN (0, 1))',
        'is_current IN (0, 1)',
      ],
    },
    intelligence_requirements: {
      columns: [
        { name: 'requirement_id', type: 'TEXT', notNull: true, primaryKey: true },
        { name: 'analysis_id', type: 'TEXT', notNull: false },
        { name: 'jd_revision_id', type: 'TEXT', notNull: true },
        { name: 'source_ref_json', type: 'TEXT', notNull: true },
        { name: 'normalized_content', type: 'TEXT', notNull: true },
        { name: 'requirement_type', type: 'TEXT', notNull: true },
        { name: 'priority', type: 'TEXT', notNull: true },
        { name: 'explicitness', type: 'TEXT', notNull: true },
        { name: 'uncertainty_json', type: 'TEXT', notNull: true },
        { name: 'extraction_status', type: 'TEXT', notNull: true },
        { name: 'contract_version', type: 'INTEGER', notNull: true },
        { name: 'created_at', type: 'TEXT', notNull: true },
      ],
      uniqueConstraints: [],
      foreignKeys: [{
        columns: ['analysis_id'],
        referencedTable: 'intelligence_input_generations',
        referencedColumns: ['analysis_id'],
        onDelete: 'RESTRICT',
      }],
      checks: [
        "requirement_type IN ('RESPONSIBILITY', 'OUTCOME', 'SKILL', 'CONSTRAINT', 'QUALIFICATION', 'PREFERENCE', 'UNKNOWN')",
        "priority IN ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')",
        "explicitness IN ('EXPLICIT', 'INFERRED')",
        "extraction_status IN ('EXTRACTED', 'INFERRED', 'UNAVAILABLE', 'REJECTED')",
        'contract_version >= 1',
      ],
    },
    intelligence_matches: {
      columns: [
        { name: 'match_id', type: 'TEXT', notNull: true, primaryKey: true },
        { name: 'gap_id', type: 'TEXT', notNull: false },
        { name: 'jd_revision_id', type: 'TEXT', notNull: true },
        { name: 'requirement_id', type: 'TEXT', notNull: true },
        { name: 'evidence_snapshot_id', type: 'TEXT', notNull: true },
        { name: 'input_generation', type: 'TEXT', notNull: true },
        { name: 'classification', type: 'TEXT', notNull: true },
        { name: 'decision_facts_json', type: 'TEXT', notNull: true },
        { name: 'evidence_revision_ids_json', type: 'TEXT', notNull: true },
        { name: 'missing_dimensions_json', type: 'TEXT', notNull: true },
        { name: 'explanation', type: 'TEXT', notNull: true },
        { name: 'boundary', type: 'TEXT', notNull: false },
        { name: 'created_at', type: 'TEXT', notNull: true },
      ],
      uniqueConstraints: [['requirement_id', 'evidence_snapshot_id'], ['gap_id']],
      foreignKeys: [
        {
          columns: ['requirement_id'],
          referencedTable: 'intelligence_requirements',
          referencedColumns: ['requirement_id'],
          onDelete: 'RESTRICT',
        },
        {
          columns: ['evidence_snapshot_id'],
          referencedTable: 'intelligence_evidence_snapshots',
          referencedColumns: ['evidence_snapshot_id'],
          onDelete: 'RESTRICT',
        },
      ],
      checks: [
        "classification IN ('DIRECT', 'STRONG_ADJACENT', 'PARTIAL', 'NO_MATCH', 'INSUFFICIENT_EVIDENCE')",
        '((classification = \'DIRECT\' AND gap_id IS NULL) OR (classification <> \'DIRECT\' AND gap_id IS NOT NULL))',
      ],
    },
    intelligence_positioning_versions: {
      columns: [
        { name: 'positioning_version_id', type: 'TEXT', notNull: true, primaryKey: true },
        { name: 'opportunity_id', type: 'TEXT', notNull: true },
        { name: 'jd_revision_id', type: 'TEXT', notNull: true },
        { name: 'analysis_id', type: 'TEXT', notNull: true },
        { name: 'evidence_snapshot_id', type: 'TEXT', notNull: true },
        { name: 'input_generation', type: 'TEXT', notNull: true },
        { name: 'version_number', type: 'INTEGER', notNull: true },
        { name: 'state', type: 'TEXT', notNull: true },
        { name: 'claims_json', type: 'TEXT', notNull: true },
        { name: 'created_at', type: 'TEXT', notNull: true },
      ],
      uniqueConstraints: [['opportunity_id', 'version_number']],
      foreignKeys: [
        {
          columns: ['analysis_id'],
          referencedTable: 'intelligence_input_generations',
          referencedColumns: ['analysis_id'],
          onDelete: 'RESTRICT',
        },
        {
          columns: ['evidence_snapshot_id'],
          referencedTable: 'intelligence_evidence_snapshots',
          referencedColumns: ['evidence_snapshot_id'],
          onDelete: 'RESTRICT',
        },
      ],
      checks: [
        "state IN ('DRAFT', 'CANDIDATE', 'CONFIRMED', 'STALE', 'REJECTED')",
        'version_number >= 1',
      ],
    },
    intelligence_positioning_current: {
      columns: [
        { name: 'opportunity_id', type: 'TEXT', notNull: true, primaryKey: true },
        { name: 'positioning_version_id', type: 'TEXT', notNull: true },
        { name: 'input_generation', type: 'TEXT', notNull: true },
        { name: 'updated_at', type: 'TEXT', notNull: true },
      ],
      uniqueConstraints: [['positioning_version_id']],
      foreignKeys: [{
        columns: ['positioning_version_id'],
        referencedTable: 'intelligence_positioning_versions',
        referencedColumns: ['positioning_version_id'],
        onDelete: 'RESTRICT',
      }],
      checks: [],
    },
    intelligence_positioning_claims: {
      columns: [
        { name: 'positioning_claim_id', type: 'TEXT', notNull: true, primaryKey: true },
        { name: 'positioning_version_id', type: 'TEXT', notNull: true },
        { name: 'ordinal', type: 'INTEGER', notNull: true },
        { name: 'requirement_id', type: 'TEXT', notNull: true },
        { name: 'match_id', type: 'TEXT', notNull: false },
        { name: 'gap_id', type: 'TEXT', notNull: false },
        { name: 'evidence_revision_ids_json', type: 'TEXT', notNull: true },
        { name: 'claim_kind', type: 'TEXT', notNull: true },
        { name: 'claim_text', type: 'TEXT', notNull: true },
        { name: 'verified', type: 'INTEGER', notNull: true },
      ],
      uniqueConstraints: [['positioning_version_id', 'ordinal']],
      foreignKeys: [
        {
          columns: ['positioning_version_id'],
          referencedTable: 'intelligence_positioning_versions',
          referencedColumns: ['positioning_version_id'],
          onDelete: 'CASCADE',
        },
        {
          columns: ['requirement_id'],
          referencedTable: 'intelligence_requirements',
          referencedColumns: ['requirement_id'],
          onDelete: 'RESTRICT',
        },
        {
          columns: ['match_id'],
          referencedTable: 'intelligence_matches',
          referencedColumns: ['match_id'],
          onDelete: 'RESTRICT',
        },
        {
          columns: ['gap_id'],
          referencedTable: 'intelligence_matches',
          referencedColumns: ['gap_id'],
          onDelete: 'RESTRICT',
        },
      ],
      checks: [
        "claim_kind IN ('SUPPORTED', 'LIMITATION', 'UNKNOWN', 'FOLLOW_UP')",
        '((match_id IS NOT NULL AND gap_id IS NULL) OR (match_id IS NULL AND gap_id IS NOT NULL))',
        'verified IN (0, 1)',
      ],
    },
    intelligence_provenance_edges: {
      columns: [
        { name: 'edge_id', type: 'TEXT', notNull: true, primaryKey: true },
        { name: 'edge_type', type: 'TEXT', notNull: true },
        { name: 'jd_source_ref_json', type: 'TEXT', notNull: false },
        { name: 'jd_revision_id', type: 'TEXT', notNull: false },
        { name: 'requirement_id', type: 'TEXT', notNull: false },
        { name: 'match_id', type: 'TEXT', notNull: false },
        { name: 'gap_id', type: 'TEXT', notNull: false },
        { name: 'evidence_revision_id', type: 'TEXT', notNull: false },
        { name: 'positioning_claim_id', type: 'TEXT', notNull: false },
        { name: 'positioning_version_id', type: 'TEXT', notNull: false },
        { name: 'input_generation', type: 'TEXT', notNull: true },
      ],
      uniqueConstraints: [],
      foreignKeys: [],
      checks: [
        "edge_type IN ('JD_SOURCE_TO_REVISION', 'REVISION_TO_REQUIREMENT', 'REQUIREMENT_TO_MATCH', 'REQUIREMENT_TO_GAP', 'MATCH_TO_CONFIRMED_EVIDENCE', 'CLAIM_TO_REQUIREMENT', 'CLAIM_TO_MATCH', 'CLAIM_TO_GAP', 'CLAIM_TO_EVIDENCE', 'CLAIM_TO_VERSION')",
      ],
    },
  },
  indexes: [
    { name: 'intelligence_input_execution_idx', table: 'intelligence_input_generations', unique: true, columns: ['execution_id'] },
    { name: 'intelligence_input_idempotency_idx', table: 'intelligence_input_generations', unique: true, columns: ['idempotency_key'] },
    { name: 'intelligence_execution_opportunity_idx', table: 'intelligence_executions', unique: false, columns: ['opportunity_id', 'operation_type', 'created_at'] },
    { name: 'intelligence_execution_current_idx', table: 'intelligence_executions', unique: false, columns: ['opportunity_id', 'operation_type', 'is_current'] },
    { name: 'intelligence_requirements_jd_idx', table: 'intelligence_requirements', unique: false, columns: ['jd_revision_id'] },
    { name: 'intelligence_matches_requirement_idx', table: 'intelligence_matches', unique: false, columns: ['requirement_id', 'evidence_snapshot_id'] },
    { name: 'intelligence_positioning_opportunity_idx', table: 'intelligence_positioning_versions', unique: false, columns: ['opportunity_id', 'version_number'] },
    { name: 'intelligence_claim_version_idx', table: 'intelligence_positioning_claims', unique: false, columns: ['positioning_version_id', 'ordinal'] },
    { name: 'intelligence_positioning_current_generation_idx', table: 'intelligence_positioning_current', unique: false, columns: ['opportunity_id', 'input_generation'] },
    { name: 'intelligence_edges_requirement_idx', table: 'intelligence_provenance_edges', unique: false, columns: ['requirement_id'] },
  ],
};

function renderIntelligenceSchemaSql() {
  const tableStatements = Object.entries(INTELLIGENCE_SCHEMA_CONTRACT.tables).map(([tableName, contract]) => {
    const definitions = contract.columns.map((column) => {
      const parts = [sqlIdentifier(column.name), column.type];
      if (column.primaryKey) parts.push('PRIMARY KEY');
      if (column.notNull) parts.push('NOT NULL');
      return parts.join(' ');
    });
    for (const columns of contract.uniqueConstraints) definitions.push(`UNIQUE (${columns.map(sqlIdentifier).join(', ')})`);
    for (const foreignKey of contract.foreignKeys) {
      definitions.push(
        `FOREIGN KEY (${foreignKey.columns.map(sqlIdentifier).join(', ')}) REFERENCES `
        + `${sqlIdentifier(foreignKey.referencedTable)} (${foreignKey.referencedColumns.map(sqlIdentifier).join(', ')}) `
        + `ON DELETE ${foreignKey.onDelete}`,
      );
    }
    for (const check of contract.checks) definitions.push(`CHECK (${check})`);
    return `CREATE TABLE IF NOT EXISTS ${sqlIdentifier(tableName)} (\n  ${definitions.join(',\n  ')}\n);`;
  });
  const indexStatements = INTELLIGENCE_SCHEMA_CONTRACT.indexes.map((index) => (
    `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${sqlIdentifier(index.name)} `
    + `ON ${sqlIdentifier(index.table)} (${index.columns.map(sqlIdentifier).join(', ')});`
  ));
  return [...tableStatements, ...indexStatements].join('\n');
}

function renderIntelligenceExecutionSchemaSql() {
  const contract = INTELLIGENCE_SCHEMA_CONTRACT.tables.intelligence_executions;
  const definitions = contract.columns.map((column) => {
    const parts = [sqlIdentifier(column.name), column.type];
    if (column.primaryKey) parts.push('PRIMARY KEY');
    if (column.notNull) parts.push('NOT NULL');
    return parts.join(' ');
  });
  for (const columns of contract.uniqueConstraints) definitions.push(`UNIQUE (${columns.map(sqlIdentifier).join(', ')})`);
  for (const foreignKey of contract.foreignKeys) {
    definitions.push(
      `FOREIGN KEY (${foreignKey.columns.map(sqlIdentifier).join(', ')}) REFERENCES `
      + `${sqlIdentifier(foreignKey.referencedTable)} (${foreignKey.referencedColumns.map(sqlIdentifier).join(', ')}) `
      + `ON DELETE ${foreignKey.onDelete}`,
    );
  }
  for (const check of contract.checks) definitions.push(`CHECK (${check})`);
  const tableStatement = `CREATE TABLE IF NOT EXISTS "intelligence_executions" (\n  ${definitions.join(',\n  ')}\n);`;
  const indexStatements = INTELLIGENCE_SCHEMA_CONTRACT.indexes
    .filter((index) => index.table === 'intelligence_executions')
    .map((index) => (
      `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${sqlIdentifier(index.name)} `
      + `ON ${sqlIdentifier(index.table)} (${index.columns.map(sqlIdentifier).join(', ')});`
    ));
  return [tableStatement, ...indexStatements].join('\n');
}

function renderIntelligencePositioningCurrentSchemaSql() {
  const tableName = 'intelligence_positioning_current';
  const contract = INTELLIGENCE_SCHEMA_CONTRACT.tables[tableName];
  const definitions = contract.columns.map((column) => {
    const parts = [sqlIdentifier(column.name), column.type];
    if (column.primaryKey) parts.push('PRIMARY KEY');
    if (column.notNull) parts.push('NOT NULL');
    return parts.join(' ');
  });
  for (const columns of contract.uniqueConstraints) definitions.push(`UNIQUE (${columns.map(sqlIdentifier).join(', ')})`);
  for (const foreignKey of contract.foreignKeys) {
    definitions.push(
      `FOREIGN KEY (${foreignKey.columns.map(sqlIdentifier).join(', ')}) REFERENCES `
      + `${sqlIdentifier(foreignKey.referencedTable)} (${foreignKey.referencedColumns.map(sqlIdentifier).join(', ')}) `
      + `ON DELETE ${foreignKey.onDelete}`,
    );
  }
  const tableStatement = `CREATE TABLE IF NOT EXISTS ${sqlIdentifier(tableName)} (\n  ${definitions.join(',\n  ')}\n);`;
  const index = INTELLIGENCE_SCHEMA_CONTRACT.indexes.find((candidate) => candidate.name === 'intelligence_positioning_current_generation_idx');
  const indexStatement = `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${sqlIdentifier(index.name)} `
    + `ON ${sqlIdentifier(index.table)} (${index.columns.map(sqlIdentifier).join(', ')});`;
  return `${tableStatement}\n${indexStatement}`;
}

function readIntelligenceSchemaVersion(database) {
  const value = database.prepare(`SELECT value FROM ${METADATA_TABLE} WHERE key = ?`).pluck().get(INTELLIGENCE_SCHEMA_KEY);
  if (value === undefined) return 0;
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new FoundationPersistenceError('INTELLIGENCE_SCHEMA_INVALID', 'Intelligence schema version is invalid.');
  }
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new FoundationPersistenceError('INTELLIGENCE_SCHEMA_INVALID', 'Intelligence schema version is invalid.');
  }
  return version;
}

function assertIntelligenceTableStructure(database) {
  for (const [tableName, contract] of Object.entries(INTELLIGENCE_SCHEMA_CONTRACT.tables)) {
    const actualColumns = pragmaRows(database, 'table_info', tableName);
    if (actualColumns.length === 0) {
      throw new FoundationPersistenceError('INTELLIGENCE_SCHEMA_INVALID', `Intelligence table is missing: ${tableName}`);
    }
    const byName = new Map(actualColumns.map((column) => [column.name, column]));
    for (const expected of contract.columns) {
      const actual = byName.get(expected.name);
      if (!actual || String(actual.type || '').trim().toUpperCase() !== expected.type || Number(actual.notnull) !== (expected.notNull ? 1 : 0)) {
        throw new FoundationPersistenceError('INTELLIGENCE_SCHEMA_INVALID', `Intelligence column is invalid: ${tableName}.${expected.name}`);
      }
    }
    const actualPrimaryKey = actualColumns
      .filter((column) => Number(column.pk) > 0)
      .sort((left, right) => Number(left.pk) - Number(right.pk))
      .map((column) => column.name);
    const expectedPrimaryKey = contract.columns.filter((column) => column.primaryKey).map((column) => column.name);
    if (!sameColumns(actualPrimaryKey, expectedPrimaryKey)) {
      throw new FoundationPersistenceError('INTELLIGENCE_SCHEMA_INVALID', `Intelligence primary key is invalid: ${tableName}`);
    }
  }
}

function assertIntelligenceIndexes(database) {
  for (const [tableName, contract] of Object.entries(INTELLIGENCE_SCHEMA_CONTRACT.tables)) {
    const indexes = pragmaRows(database, 'index_list', tableName);
    for (const uniqueColumns of contract.uniqueConstraints) {
      const hasConstraint = indexes.some((index) => (
        Number(index.unique) === 1
        && Number(index.partial || 0) === 0
        && sameColumns(indexColumns(database, index.name), uniqueColumns)
      ));
      if (!hasConstraint) throw new FoundationPersistenceError('INTELLIGENCE_SCHEMA_INVALID', `Intelligence unique constraint is missing: ${tableName}`);
    }
  }
  for (const index of INTELLIGENCE_SCHEMA_CONTRACT.indexes) {
    const row = pragmaRows(database, 'index_list', index.table).find((candidate) => candidate.name === index.name);
    if (
      !row
      || Number(row.unique) !== (index.unique ? 1 : 0)
      || Number(row.partial || 0) !== 0
      || !sameColumns(indexColumns(database, index.name), index.columns)
    ) {
      throw new FoundationPersistenceError('INTELLIGENCE_SCHEMA_INVALID', `Intelligence index is invalid: ${index.name}`);
    }
  }
}

function assertIntelligenceForeignKeys(database) {
  for (const [tableName, contract] of Object.entries(INTELLIGENCE_SCHEMA_CONTRACT.tables)) {
    const foreignKeys = pragmaRows(database, 'foreign_key_list', tableName);
    for (const expected of contract.foreignKeys) {
      const found = foreignKeys.some((foreignKey) => (
        foreignKey.table === expected.referencedTable
        && foreignKey.from === expected.columns[0]
        && foreignKey.to === expected.referencedColumns[0]
        && String(foreignKey.on_delete).toUpperCase() === expected.onDelete
      ));
      if (!found) throw new FoundationPersistenceError('INTELLIGENCE_SCHEMA_INVALID', `Intelligence foreign key is invalid: ${tableName}`);
    }
  }
  const integrity = database.pragma('foreign_key_check');
  if (integrity.length > 0) throw new FoundationPersistenceError('INTELLIGENCE_SCHEMA_INVALID', 'Intelligence foreign-key integrity check failed.');
}

function assertIntelligenceChecks(database) {
  for (const [tableName, contract] of Object.entries(INTELLIGENCE_SCHEMA_CONTRACT.tables)) {
    const row = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
    const sql = String(row?.sql || '').toLowerCase();
    for (const check of contract.checks) {
      const token = check.toLowerCase().replace(/\s+/g, '');
      if (!sql.replace(/\s+/g, '').includes(token)) {
        throw new FoundationPersistenceError('INTELLIGENCE_SCHEMA_INVALID', `Intelligence constraint is missing: ${tableName}`);
      }
    }
  }
}

function assertIntelligenceDataIntegrity(database) {
  const invalidData = (message) => {
    throw new FoundationPersistenceError('INTELLIGENCE_SCHEMA_INVALID', message);
  };
  const parseRecordJson = (value, fieldName) => {
    try {
      return JSON.parse(value);
    } catch {
      invalidData(`Intelligence ${fieldName} is not valid JSON.`);
    }
  };
  const snapshots = new Map();
  const loadSnapshot = (row) => {
    if (!row) invalidData('Intelligence Evidence snapshot is missing.');
    if (snapshots.has(row.evidence_snapshot_id)) return snapshots.get(row.evidence_snapshot_id);
    const ids = parseRecordJson(row.evidence_revision_ids_json, 'Evidence snapshot revisions');
    if (!Array.isArray(ids) || ids.length === 0) invalidData('Intelligence Evidence snapshot revisions are invalid.');
    const revisions = ids.map((evidenceRevisionId) => {
      const revision = database.prepare('SELECT * FROM evidence_revisions WHERE evidence_revision_id = ?').get(evidenceRevisionId);
      if (!revision) invalidData('Intelligence Evidence snapshot references a missing Evidence revision.');
      let provenance;
      try {
        provenance = JSON.parse(revision.provenance_json);
      } catch {
        invalidData('Intelligence Evidence snapshot references invalid Evidence provenance.');
      }
      return {
        evidence_revision_id: revision.evidence_revision_id,
        evidence_id: revision.evidence_id,
        factual_content: revision.factual_content,
        responsibility_boundary: revision.responsibility_boundary,
        outcome: revision.outcome,
        confirmation_state: revision.confirmation_state,
        provenance,
      };
    });
    let rebuilt;
    try {
      rebuilt = buildEvidenceSnapshot({
        evidenceRevisionIds: ids,
        evidenceRevisions: revisions,
        expectedEvidenceId: row.evidence_id,
        inputGeneration: row.input_generation,
        contractVersion: row.contract_version,
      });
    } catch (error) {
      invalidData(`Intelligence Evidence snapshot is ineligible: ${error.message}`);
    }
    if (rebuilt.evidence_snapshot_id !== row.evidence_snapshot_id) invalidData('Intelligence Evidence snapshot identity is invalid.');
    snapshots.set(row.evidence_snapshot_id, rebuilt);
    return rebuilt;
  };

  const validateStoredExecutionCandidate = (request, payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) invalidData('Intelligence execution candidate payload is not structured.');
    const allowed = new Set(['requirements', 'matches', 'positioning']);
    if (Object.keys(payload).some((key) => !allowed.has(key))) invalidData('Intelligence execution candidate contains an unsupported field.');
    const snapshot = loadSnapshot(database.prepare('SELECT * FROM intelligence_evidence_snapshots WHERE evidence_snapshot_id = ?').get(request.evidence_snapshot_id));
    const jd = database.prepare('SELECT content, availability_status FROM jd_revisions WHERE jd_revision_id = ?').get(request.jd_revision_id);
    if (!jd || jd.availability_status !== 'AVAILABLE') invalidData('Intelligence execution candidate JD is unavailable.');
    const requirements = Array.isArray(payload.requirements) ? payload.requirements.map((item) => {
      let requirement;
      try {
        requirement = validateRequirement(item);
      } catch (error) {
        invalidData(`Intelligence execution requirement is invalid: ${error.message}`);
      }
      if (!requirement.ready || requirement.jd_revision_id !== request.jd_revision_id || !intelligenceSourceResolvesToJd(requirement.source_ref, jd.content, request.jd_revision_id)) {
        invalidData('Intelligence execution requirement is unavailable or its source anchor is not resolvable.');
      }
      return requirement;
    }) : [];
    const requirementMap = new Map(requirements.map((item) => [item.requirement_id, item]));
    const matches = Array.isArray(payload.matches) ? payload.matches.map((item) => {
      const requirement = requirementMap.get(resolveAliasedField(item, 'requirement_id', 'requirementId', 'requirement_id'));
      if (!requirement) invalidData('Intelligence execution match is missing its candidate requirement.');
      try {
        const match = validateMatchRecord(item, snapshot, requirement);
        validateTraceability({
          jdSourceRef: requirement.source_ref,
          jdRevisionId: requirement.jd_revision_id,
          requirement,
          match,
          snapshot,
        });
        return match;
      } catch (error) {
        invalidData(`Intelligence execution match is invalid: ${error.message}`);
      }
    }) : [];
    if (request.operation_type === 'ANALYZE_REQUIREMENTS' && !Array.isArray(payload.requirements)) invalidData('Requirement analysis output is missing requirements.');
    if (request.operation_type === 'CLASSIFY_MATCHES' && !Array.isArray(payload.matches)) invalidData('Match classification output is missing matches.');
    if (payload.positioning !== undefined) {
      if (!payload.positioning || typeof payload.positioning !== 'object' || Array.isArray(payload.positioning) || !Array.isArray(payload.positioning.claims)) invalidData('Positioning candidate is invalid.');
      const analysis = database.prepare('SELECT analysis_id FROM intelligence_input_generations WHERE execution_id = ?').get(request.execution_id);
      try {
        validatePositioningVersion({
          ...payload.positioning,
          opportunity_id: request.opportunity_id,
          jd_revision_id: request.jd_revision_id,
          analysis_id: analysis?.analysis_id,
          evidence_snapshot_id: request.evidence_snapshot_id,
          input_generation: request.input_generation,
          evidence_snapshot: snapshot,
          requirements,
          matches,
        });
      } catch (error) {
        invalidData(`Intelligence execution positioning candidate is invalid: ${error.message}`);
      }
    }
    if (request.operation_type === 'DRAFT_POSITIONING' && payload.positioning === undefined) invalidData('Positioning output is missing a candidate.');
  };

  const orphanClaims = database.prepare(`
    SELECT c.positioning_claim_id
      FROM intelligence_positioning_claims c
      LEFT JOIN intelligence_positioning_versions v ON v.positioning_version_id = c.positioning_version_id
     WHERE v.positioning_version_id IS NULL
  `).all();
  if (orphanClaims.length > 0) throw new FoundationPersistenceError('INTELLIGENCE_SCHEMA_INVALID', 'Intelligence positioning claim parent is invalid.');
  const malformedJson = database.prepare(`
    SELECT evidence_snapshot_id AS record_id FROM intelligence_evidence_snapshots WHERE json_valid(evidence_revision_ids_json) = 0
    UNION ALL
    SELECT analysis_id FROM intelligence_input_generations WHERE json_valid(evidence_revision_ids_json) = 0
    UNION ALL
    SELECT requirement_id FROM intelligence_requirements WHERE json_valid(source_ref_json) = 0 OR json_valid(uncertainty_json) = 0
    UNION ALL
    SELECT match_id FROM intelligence_matches WHERE json_valid(decision_facts_json) = 0 OR json_valid(evidence_revision_ids_json) = 0 OR json_valid(missing_dimensions_json) = 0 OR json_valid(explanation) = 0
    UNION ALL
    SELECT positioning_version_id FROM intelligence_positioning_versions WHERE json_valid(claims_json) = 0
    UNION ALL
    SELECT positioning_claim_id FROM intelligence_positioning_claims WHERE json_valid(evidence_revision_ids_json) = 0
    UNION ALL
    SELECT edge_id FROM intelligence_provenance_edges WHERE jd_source_ref_json IS NOT NULL AND json_valid(jd_source_ref_json) = 0
  `).all();
  if (malformedJson.length > 0) throw new FoundationPersistenceError('INTELLIGENCE_SCHEMA_INVALID', 'Intelligence JSON record is invalid.');

  for (const row of database.prepare('SELECT * FROM intelligence_evidence_snapshots').all()) loadSnapshot(row);

  for (const row of database.prepare('SELECT * FROM intelligence_input_generations').all()) {
    const snapshot = loadSnapshot(database.prepare('SELECT * FROM intelligence_evidence_snapshots WHERE evidence_snapshot_id = ?').get(row.evidence_snapshot_id));
    const evidenceRevisionIds = parseRecordJson(row.evidence_revision_ids_json, 'input generation revisions');
    if (canonicalSerialize(evidenceRevisionIds) !== canonicalSerialize(snapshot.evidence_revision_ids)) invalidData('Intelligence input generation Evidence identities are inconsistent.');
    const opportunity = database.prepare('SELECT opportunity_id FROM opportunities WHERE opportunity_id = ?').get(row.opportunity_id);
    const jd = database.prepare('SELECT opportunity_id, availability_status FROM jd_revisions WHERE jd_revision_id = ?').get(row.jd_revision_id);
    if (!opportunity || !jd || jd.opportunity_id !== row.opportunity_id || jd.availability_status !== 'AVAILABLE') invalidData('Intelligence input generation context is invalid.');
    try {
      const expected = buildInputBundle({
        opportunityId: row.opportunity_id,
        jdRevisionId: row.jd_revision_id,
        evidenceSnapshot: snapshot,
        operationType: row.operation_type,
        schemaVersion: row.schema_version,
        executionId: row.execution_id,
        idempotencyKey: row.idempotency_key,
        inputGeneration: row.input_generation,
        requestedAt: row.requested_at,
        disclosureClassification: row.disclosure_classification,
      });
      if (expected.analysis_id !== row.analysis_id) invalidData('Intelligence analysis identity is invalid.');
    } catch (error) {
      invalidData(`Intelligence input generation is invalid: ${error.message}`);
    }
  }

  for (const row of database.prepare('SELECT * FROM intelligence_executions').all()) {
    const analysis = database.prepare('SELECT * FROM intelligence_input_generations WHERE analysis_id = ?').get(row.analysis_id);
    if (!analysis
      || row.execution_id !== analysis.execution_id
      || row.idempotency_key !== analysis.idempotency_key
      || row.opportunity_id !== analysis.opportunity_id
      || row.jd_revision_id !== analysis.jd_revision_id
      || row.evidence_snapshot_id !== analysis.evidence_snapshot_id
      || row.input_generation !== analysis.input_generation
      || row.operation_type !== analysis.operation_type
      || row.schema_version !== analysis.schema_version
      || row.requested_at !== analysis.requested_at
      || row.disclosure_classification !== analysis.disclosure_classification) {
      invalidData('Intelligence execution identity is inconsistent with its immutable input generation.');
    }
    const payload = parseRecordJson(row.request_payload_json, 'execution request payload');
    let request;
    try {
      request = buildExecutionRequest({
        inputBundle: {
          execution_id: analysis.execution_id,
          idempotency_key: analysis.idempotency_key,
          operation_type: analysis.operation_type,
          schema_version: analysis.schema_version,
          opportunity_id: analysis.opportunity_id,
          jd_revision_id: analysis.jd_revision_id,
          evidence_snapshot_id: analysis.evidence_snapshot_id,
          evidence_revision_ids: parseRecordJson(analysis.evidence_revision_ids_json, 'execution input revisions'),
          input_generation: analysis.input_generation,
          requested_at: analysis.requested_at,
          disclosure_classification: analysis.disclosure_classification,
        },
        payload,
      });
    } catch (error) {
      invalidData(`Intelligence execution request is invalid: ${error.message}`);
    }
    if (row.attempt < 0 || row.max_attempts < 1 || row.attempt > row.max_attempts) invalidData('Intelligence execution attempt bounds are invalid.');
    if (!EXECUTION_STATES.includes(row.execution_state)) invalidData('Intelligence execution state is unsupported.');
    if (row.result_status !== null && !RESULT_STATUSES.includes(row.result_status)) invalidData('Intelligence execution result status is unsupported.');
    if (!VALIDATION_STATUSES.includes(row.validation_status)) invalidData('Intelligence execution validation status is unsupported.');
    if (row.error_json !== null) {
      const error = parseRecordJson(row.error_json, 'execution error');
      if (!error || typeof error !== 'object' || typeof error.classification !== 'string' || typeof error.retryable !== 'boolean') invalidData('Intelligence execution error metadata is invalid.');
    }
    if (row.result_payload_json !== null) {
      if (row.result_status !== 'SUCCEEDED' || row.validation_status !== 'VALID') invalidData('Intelligence execution result payload is not bound to a valid completion.');
      validateStoredExecutionCandidate(request, parseRecordJson(row.result_payload_json, 'execution result payload'));
    }
    if (row.result_status === 'SUCCEEDED' && row.execution_state !== 'COMPLETED') {
      invalidData('Successful execution results require the COMPLETED execution state.');
    }
    if (row.execution_state === 'COMPLETED' && row.result_status !== 'SUCCEEDED') invalidData('Completed execution must have a successful result.');
    if (row.execution_state === 'CANCELLED' && row.result_status !== 'CANCELLED') invalidData('Cancelled execution must have a cancelled result.');
    if (row.execution_state === 'STALE_RESULT_REJECTED' && row.result_status !== 'STALE') invalidData('Stale execution must have a stale result.');
    if (row.is_current === 1 && (row.execution_state !== 'COMPLETED' || row.result_status !== 'SUCCEEDED')) invalidData('Only a successful completed execution may be current.');
    if (row.superseded_by_execution_id !== null
      && !database.prepare('SELECT execution_id FROM intelligence_executions WHERE execution_id = ?').get(row.superseded_by_execution_id)) {
      invalidData('Intelligence execution supersession reference is invalid.');
    }
    if (row.execution_state !== 'RUNNING') {
      try {
        normalizeExecutionResponse({
          execution_id: request.execution_id,
          idempotency_key: request.idempotency_key,
          operation_type: request.operation_type,
          schema_version: request.schema_version,
          opportunity_id: request.opportunity_id,
          jd_revision_id: request.jd_revision_id,
          evidence_snapshot_id: request.evidence_snapshot_id,
          input_generation: request.input_generation,
          result_status: row.result_status,
          validation_status: row.validation_status,
          ...(row.result_payload_json === null ? {} : { payload: parseRecordJson(row.result_payload_json, 'execution result payload') }),
          ...(row.error_json === null ? {} : { error: parseRecordJson(row.error_json, 'execution error') }),
        }, request);
      } catch (error) {
        invalidData(`Intelligence execution response is invalid: ${error.message}`);
      }
    }
  }

  const requirements = new Map();
  for (const row of database.prepare('SELECT * FROM intelligence_requirements').all()) {
    const jd = database.prepare('SELECT jd_revision_id, content, availability_status FROM jd_revisions WHERE jd_revision_id = ?').get(row.jd_revision_id);
    if (!jd) invalidData('Intelligence requirement JD revision is missing.');
    if (row.analysis_id) {
      const analysis = database.prepare('SELECT jd_revision_id FROM intelligence_input_generations WHERE analysis_id = ?').get(row.analysis_id);
      if (!analysis || analysis.jd_revision_id !== row.jd_revision_id) invalidData('Intelligence requirement analysis edge is invalid.');
    }
    let requirement;
    try {
      requirement = validateRequirement({
        requirement_id: row.requirement_id,
        jd_revision_id: row.jd_revision_id,
        source_ref: parseRecordJson(row.source_ref_json, 'requirement source'),
        normalized_content: row.normalized_content,
        requirement_type: row.requirement_type,
        priority: row.priority,
        explicitness: row.explicitness,
        uncertainty: parseRecordJson(row.uncertainty_json, 'requirement uncertainty'),
        extraction_status: row.extraction_status,
        contract_version: row.contract_version,
      });
    } catch (error) {
      invalidData(`Intelligence requirement is invalid: ${error.message}`);
    }
    if (requirement.requirement_id !== row.requirement_id) invalidData('Intelligence requirement identity is invalid.');
    if (!requirement.ready || jd.availability_status !== 'AVAILABLE' || !intelligenceSourceResolvesToJd(requirement.source_ref, jd.content, requirement.jd_revision_id)) invalidData('Intelligence requirement is unavailable or its source anchor is not resolvable.');
    requirements.set(row.requirement_id, requirement);
  }

  const matches = new Map();
  for (const row of database.prepare('SELECT * FROM intelligence_matches').all()) {
    const requirement = requirements.get(row.requirement_id);
    const snapshot = loadSnapshot(database.prepare('SELECT * FROM intelligence_evidence_snapshots WHERE evidence_snapshot_id = ?').get(row.evidence_snapshot_id));
    if (!requirement || requirement.jd_revision_id !== row.jd_revision_id || row.input_generation !== snapshot.input_generation) invalidData('Intelligence match provenance is invalid.');
    let match;
    try {
      const storedExplanation = parseMatchExplanation(row.explanation);
      match = validateMatchRecord({
        match_id: row.match_id,
        gap_id: row.gap_id,
        jd_revision_id: row.jd_revision_id,
        requirement_id: row.requirement_id,
        evidence_snapshot_id: row.evidence_snapshot_id,
        input_generation: row.input_generation,
        classification: row.classification,
        decision_facts: parseRecordJson(row.decision_facts_json, 'match decision facts'),
        evidence_revision_ids: parseRecordJson(row.evidence_revision_ids_json, 'match Evidence'),
        missing_dimensions: parseRecordJson(row.missing_dimensions_json, 'match missing dimensions'),
        explanation: storedExplanation.explanation,
        explanation_details: storedExplanation.explanation_details,
        boundary: row.boundary,
      }, snapshot, requirement);
    } catch (error) {
      invalidData(`Intelligence match is invalid: ${error.message}`);
    }
    matches.set(row.match_id, match);
  }

  const provenanceEdges = database.prepare('SELECT * FROM intelligence_provenance_edges').all();
  const hasEdge = (edgeType, fields, inputGeneration) => provenanceEdges.some((edge) => (
    edge.edge_type === edgeType
    && edge.input_generation === inputGeneration
    && Object.entries(fields).every(([key, value]) => {
      const actual = key === 'jd_source_ref'
        ? (edge.jd_source_ref_json === null ? null : parseRecordJson(edge.jd_source_ref_json, 'provenance source'))
        : edge[key];
      return canonicalSerialize(actual ?? null) === canonicalSerialize(value ?? null);
    })
  ));
  for (const edge of provenanceEdges) {
    if (!database.prepare('SELECT analysis_id FROM intelligence_input_generations WHERE input_generation = ? LIMIT 1').get(edge.input_generation)) invalidData('Intelligence provenance edge generation is invalid.');
    if (edge.jd_revision_id && !database.prepare('SELECT jd_revision_id FROM jd_revisions WHERE jd_revision_id = ?').get(edge.jd_revision_id)) invalidData('Intelligence provenance JD edge is invalid.');
    if (edge.requirement_id && !requirements.has(edge.requirement_id)) invalidData('Intelligence provenance requirement edge is invalid.');
    if (edge.match_id && !matches.has(edge.match_id)) invalidData('Intelligence provenance match edge is invalid.');
    if (edge.gap_id && !database.prepare('SELECT match_id FROM intelligence_matches WHERE gap_id = ?').get(edge.gap_id)) invalidData('Intelligence provenance gap edge is invalid.');
    if (edge.evidence_revision_id) {
      const revision = database.prepare('SELECT confirmation_state FROM evidence_revisions WHERE evidence_revision_id = ?').get(edge.evidence_revision_id);
      if (!revision || revision.confirmation_state !== 'CONFIRMED') invalidData('Intelligence provenance Evidence edge is invalid.');
    }
    if (edge.positioning_claim_id && !database.prepare('SELECT positioning_claim_id FROM intelligence_positioning_claims WHERE positioning_claim_id = ?').get(edge.positioning_claim_id)) invalidData('Intelligence provenance claim edge is invalid.');
    if (edge.positioning_version_id && !database.prepare('SELECT positioning_version_id FROM intelligence_positioning_versions WHERE positioning_version_id = ?').get(edge.positioning_version_id)) invalidData('Intelligence provenance positioning edge is invalid.');
  }
  for (const match of matches.values()) {
    const requirement = requirements.get(match.requirement_id);
    const snapshot = loadSnapshot(database.prepare('SELECT * FROM intelligence_evidence_snapshots WHERE evidence_snapshot_id = ?').get(match.evidence_snapshot_id));
    const trace = validateTraceability({
      jdSourceRef: requirement.source_ref,
      jdRevisionId: requirement.jd_revision_id,
      requirement,
      match,
      snapshot,
    });
    for (const edge of trace.provenance_edges) {
      if (!hasEdge(edge.edge_type, edge, match.input_generation)) invalidData('Intelligence match provenance edge is missing.');
    }
  }

  for (const row of database.prepare('SELECT * FROM intelligence_positioning_versions').all()) {
    const snapshot = loadSnapshot(database.prepare('SELECT * FROM intelligence_evidence_snapshots WHERE evidence_snapshot_id = ?').get(row.evidence_snapshot_id));
    const analysis = database.prepare('SELECT opportunity_id, jd_revision_id, evidence_snapshot_id, input_generation FROM intelligence_input_generations WHERE analysis_id = ?').get(row.analysis_id);
    const jd = database.prepare('SELECT opportunity_id FROM jd_revisions WHERE jd_revision_id = ?').get(row.jd_revision_id);
    if (!analysis || !jd || jd.opportunity_id !== row.opportunity_id
      || analysis.opportunity_id !== row.opportunity_id
      || analysis.jd_revision_id !== row.jd_revision_id
      || analysis.evidence_snapshot_id !== row.evidence_snapshot_id
      || analysis.input_generation !== row.input_generation) {
      invalidData('Intelligence positioning version provenance is invalid.');
    }
    const claimRows = database.prepare('SELECT * FROM intelligence_positioning_claims WHERE positioning_version_id = ? ORDER BY ordinal').all(row.positioning_version_id);
    const claims = parseRecordJson(row.claims_json, 'positioning claims');
    const claimRequirements = claimRows.map((claim) => requirements.get(claim.requirement_id)).filter(Boolean);
    const relationRows = claimRows.map((claim) => {
      if (claim.match_id) return matches.get(claim.match_id);
      const relation = database.prepare('SELECT match_id FROM intelligence_matches WHERE gap_id = ?').get(claim.gap_id);
      return relation ? matches.get(relation.match_id) : null;
    }).filter(Boolean);
    let version;
    try {
      version = validatePositioningVersion({
        positioning_version_id: row.positioning_version_id,
        opportunity_id: row.opportunity_id,
        jd_revision_id: row.jd_revision_id,
        analysis_id: row.analysis_id,
        evidence_snapshot: snapshot,
        version_number: row.version_number,
        state: row.state,
        requirements: claimRequirements,
        matches: relationRows,
        claims,
      });
    } catch (error) {
      invalidData(`Intelligence positioning version is invalid: ${error.message}`);
    }
    if (version.positioning_version_id !== row.positioning_version_id || canonicalSerialize(version.claims) !== canonicalSerialize(claims)) invalidData('Intelligence positioning claim identities are invalid.');
    if (claimRows.length !== version.claims.length) invalidData('Intelligence positioning claim rows are incomplete.');
    for (let index = 0; index < claimRows.length; index += 1) {
      const claim = claimRows[index];
      const normalized = version.claims[index];
      const storedEvidenceIds = parseRecordJson(claim.evidence_revision_ids_json, 'positioning claim Evidence');
      if (
        claim.positioning_claim_id !== normalized.positioning_claim_id
        || claim.ordinal !== normalized.ordinal
        || claim.requirement_id !== normalized.requirement_id
        || (claim.match_id ?? null) !== (normalized.match_id ?? null)
        || (claim.gap_id ?? null) !== (normalized.gap_id ?? null)
        || canonicalSerialize(storedEvidenceIds) !== canonicalSerialize(normalized.evidence_revision_ids)
        || claim.claim_kind !== normalized.claim_kind
        || claim.claim_text !== normalized.claim_text
        || Boolean(claim.verified) !== Boolean(normalized.verified)
      ) invalidData('Intelligence positioning claim row is inconsistent.');
    }
    const versionInputGeneration = row.input_generation;
    for (const claim of version.claims) {
      const edgeChecks = [
        ['CLAIM_TO_REQUIREMENT', { requirement_id: claim.requirement_id, positioning_claim_id: claim.positioning_claim_id, positioning_version_id: row.positioning_version_id }],
        [claim.match_id ? 'CLAIM_TO_MATCH' : 'CLAIM_TO_GAP', claim.match_id
          ? { match_id: claim.match_id, positioning_claim_id: claim.positioning_claim_id, positioning_version_id: row.positioning_version_id }
          : { gap_id: claim.gap_id, positioning_claim_id: claim.positioning_claim_id, positioning_version_id: row.positioning_version_id }],
        ['CLAIM_TO_VERSION', { positioning_claim_id: claim.positioning_claim_id, positioning_version_id: row.positioning_version_id }],
        ...claim.evidence_revision_ids.map((evidenceRevisionId) => ['CLAIM_TO_EVIDENCE', { evidence_revision_id: evidenceRevisionId, positioning_claim_id: claim.positioning_claim_id, positioning_version_id: row.positioning_version_id }]),
      ];
      for (const [edgeType, fields] of edgeChecks) {
        if (!hasEdge(edgeType, fields, versionInputGeneration)) invalidData('Intelligence positioning provenance edge is missing.');
      }
    }
  }

  for (const current of database.prepare('SELECT * FROM intelligence_positioning_current').all()) {
    const version = database.prepare('SELECT * FROM intelligence_positioning_versions WHERE positioning_version_id = ?').get(current.positioning_version_id);
    if (!version
      || version.opportunity_id !== current.opportunity_id
      || version.input_generation !== current.input_generation
      || version.state !== 'CONFIRMED') {
      invalidData('Intelligence current positioning pointer is invalid.');
    }
    const analysis = database.prepare('SELECT input_generation FROM intelligence_input_generations WHERE analysis_id = ?').get(version.analysis_id);
    if (!analysis || analysis.input_generation !== current.input_generation) {
      invalidData('Intelligence current positioning pointer generation is invalid.');
    }
    const opportunity = database.prepare('SELECT current_jd_revision_id FROM opportunities WHERE opportunity_id = ?').get(current.opportunity_id);
    if (!opportunity || opportunity.current_jd_revision_id !== version.jd_revision_id) {
      invalidData('Intelligence current positioning pointer is stale.');
    }
    const snapshot = loadSnapshot(database.prepare('SELECT * FROM intelligence_evidence_snapshots WHERE evidence_snapshot_id = ?').get(version.evidence_snapshot_id));
    const evidence = database.prepare('SELECT current_revision_id FROM evidence_records WHERE evidence_id = ?').get(snapshot.evidence_id);
    if (evidence?.current_revision_id && !snapshot.evidence_revision_ids.includes(evidence.current_revision_id)) {
      invalidData('Intelligence current positioning pointer Evidence generation is stale.');
    }
  }
}

function assertIntelligenceSchema(database) {
  assertIntelligenceTableStructure(database);
  assertIntelligenceIndexes(database);
  assertIntelligenceForeignKeys(database);
  assertIntelligenceChecks(database);
  assertIntelligenceDataIntegrity(database);
}

function markPositioningStaleForContext(database, { opportunityId, evidenceId } = {}) {
  const table = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'intelligence_positioning_versions'",
  ).get();
  if (!table) return;
  database.transaction(() => {
    if (opportunityId) {
      database.prepare(`
        UPDATE intelligence_positioning_versions
           SET state = 'STALE'
         WHERE opportunity_id = ? AND state IN ('DRAFT', 'CANDIDATE', 'CONFIRMED')
           AND jd_revision_id <> COALESCE((SELECT current_jd_revision_id FROM opportunities WHERE opportunity_id = ?), '')
      `).run(opportunityId, opportunityId);
      database.prepare(`
        DELETE FROM intelligence_positioning_current
         WHERE opportunity_id = ?
           AND positioning_version_id IN (
             SELECT positioning_version_id FROM intelligence_positioning_versions WHERE state <> 'CONFIRMED'
           )
      `).run(opportunityId);
    }
    if (evidenceId) {
      database.prepare(`
        UPDATE intelligence_positioning_versions
           SET state = 'STALE'
         WHERE state IN ('DRAFT', 'CANDIDATE', 'CONFIRMED')
           AND evidence_snapshot_id IN (
             SELECT evidence_snapshot_id FROM intelligence_evidence_snapshots WHERE evidence_id = ?
           )
      `).run(evidenceId);
      database.prepare(`
        DELETE FROM intelligence_positioning_current
         WHERE positioning_version_id IN (
           SELECT positioning_version_id FROM intelligence_positioning_versions WHERE state <> 'CONFIRMED'
        )
      `).run();
    }
  })();
}

function migrateIntelligenceSchema(database, options = {}) {
  assertMigrationOwnership(options.privateRoot, options.ownership, options);
  const currentVersion = readIntelligenceSchemaVersion(database);
  if (currentVersion > INTELLIGENCE_SCHEMA_VERSION) {
    throw new FoundationPersistenceError(
      'INTELLIGENCE_VERSION_UNSUPPORTED',
      `Unsupported intelligence schema version: ${currentVersion}`,
    );
  }
  if (currentVersion === INTELLIGENCE_SCHEMA_VERSION) {
    const upgradeExisting = database.transaction(() => {
      assertMigrationOwnership(options.privateRoot, options.ownership, options);
      // Keep the monotonic schema marker at v1. Existing v1 stores may predate
      // the current-positioning pointer, so add only that new table/index;
      // older structures remain subject to the normal fail-closed checks.
      database.exec(renderIntelligenceExecutionSchemaSql());
      const currentTable = database.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'intelligence_positioning_current'",
      ).get();
      if (!currentTable) database.exec(renderIntelligencePositioningCurrentSchemaSql());
      runMigrationCheckpoint(options, 'intelligence-after-execution-schema');
      assertMigrationOwnership(options.privateRoot, options.ownership, options);
      assertIntelligenceSchema(database);
    });
    upgradeExisting();
    assertMigrationOwnership(options.privateRoot, options.ownership, options);
    return;
  }
  try {
    const migrate = database.transaction(() => {
      assertMigrationOwnership(options.privateRoot, options.ownership, options);
      database.exec(renderIntelligenceSchemaSql());
      runMigrationCheckpoint(options, 'intelligence-after-schema');
      assertMigrationOwnership(options.privateRoot, options.ownership, options);
      assertIntelligenceSchema(database);
      if (options.failurePoint === 'intelligence-before-marker') {
        throw new FoundationPersistenceError('INTELLIGENCE_MIGRATION_FAILED', 'Synthetic intelligence migration failure before schema publication.');
      }
      database.prepare(`INSERT OR REPLACE INTO ${METADATA_TABLE} (key, value) VALUES (?, ?)`).run(
        INTELLIGENCE_SCHEMA_KEY,
        String(INTELLIGENCE_SCHEMA_VERSION),
      );
      runMigrationCheckpoint(options, 'intelligence-after-marker');
      assertMigrationOwnership(options.privateRoot, options.ownership, options);
      assertIntelligenceSchema(database);
    });
    migrate();
    assertMigrationOwnership(options.privateRoot, options.ownership, options);
  } catch (error) {
    if (error instanceof FoundationPersistenceError) throw error;
    throw new FoundationPersistenceError('INTELLIGENCE_MIGRATION_FAILED', error.message);
  }
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

  function listOpportunities() {
    assertDomainReady();
    return database.prepare('SELECT opportunity_id FROM opportunities ORDER BY created_at ASC, opportunity_id ASC')
      .all().map((row) => readOpportunity(row.opportunity_id));
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
    markPositioningStaleForContext(database, { opportunityId });
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
    markPositioningStaleForContext(database, { evidenceId });
    return readEvidence(evidenceId);
  }

  function getEvidence(value) {
    assertDomainReady();
    return readEvidence(normalizeId(value, 'evidenceId'));
  }

  function listEvidence() {
    assertDomainReady();
    return database.prepare('SELECT evidence_id FROM evidence_records ORDER BY created_at ASC, evidence_id ASC')
      .all().map((row) => readEvidence(row.evidence_id));
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
    markPositioningStaleForContext(database, { evidenceId });
    return readEvidence(evidenceId);
  }

  return {
    opportunity: Object.freeze({
      create: createOpportunity,
      get: getOpportunity,
      list: listOpportunities,
      addJdRevision,
      getJdRevision,
    }),
    evidence: Object.freeze({
      create: createEvidence,
      get: getEvidence,
      list: listEvidence,
      createRevision: createEvidenceRevision,
      confirmRevision: confirmEvidenceRevision,
    }),
  };
}

function intelligenceStoredJson(value, fieldName) {
  try {
    return JSON.parse(value);
  } catch {
    throw new FoundationPersistenceError('INTELLIGENCE_RECORD_INVALID', `${fieldName} is not valid JSON.`);
  }
}

function intelligenceEdgeId(edge) {
  return `edge:${crypto.createHash('sha256').update(canonicalSerialize(edge), 'utf8').digest('hex')}`;
}

function asIntelligencePersistenceError(error) {
  if (error instanceof FoundationPersistenceError) return error;
  if (error instanceof IntelligenceValidationError) return new FoundationPersistenceError(error.code, error.message);
  return new FoundationPersistenceError('INTELLIGENCE_OPERATION_FAILED', error.message || 'Intelligence operation failed.');
}

function intelligenceSourceIsUnavailable(sourceRef) {
  const locator = typeof sourceRef === 'string' ? sourceRef : sourceRef?.locator ?? sourceRef?.anchor ?? sourceRef?.source;
  return typeof locator === 'string' && /^unavailable:/i.test(locator);
}

function intelligenceSourceResolvesToJd(sourceRef, content, expectedJdRevisionId) {
  if (intelligenceSourceIsUnavailable(sourceRef) || typeof content !== 'string' || content.length === 0) return false;
  const locator = typeof sourceRef === 'string' ? sourceRef : sourceRef?.locator ?? sourceRef?.anchor ?? sourceRef?.source;
  if (typeof sourceRef === 'object' && sourceRef?.jd_revision_id !== undefined && sourceRef.jd_revision_id !== expectedJdRevisionId) return false;
  const lineMatch = /^(?:jd:)?line:(\d+)$/i.exec(locator);
  if (lineMatch) {
    const lineNumber = Number(lineMatch[1]);
    return lineNumber >= 1 && lineNumber <= content.split(/\r?\n/).length
      && (typeof sourceRef !== 'object' || (sourceRef.start === undefined && sourceRef.end === undefined));
  }
  const offsetMatch = /^(?:jd:)?offset:(\d+)(?:-(\d+))?$/i.exec(locator);
  if (offsetMatch) {
    const locatorStart = Number(offsetMatch[1]);
    const locatorEnd = offsetMatch[2] === undefined ? locatorStart : Number(offsetMatch[2]);
    const start = typeof sourceRef === 'object' && sourceRef.start !== undefined ? sourceRef.start : locatorStart;
    const end = typeof sourceRef === 'object' && sourceRef.end !== undefined ? sourceRef.end : locatorEnd;
    if (start !== locatorStart || end !== locatorEnd) return false;
    return start >= 0 && end >= start && end <= content.length;
  }
  return false;
}

function createIntelligenceOperations(database, privateRoot, ownership, options, isClosed) {
  const repositoryRoot = options.repositoryRoot;

  function assertIntelligenceReady() {
    if (isClosed()) throw new FoundationPersistenceError('FOUNDATION_CLOSED', 'The intelligence store is closed.');
    assertPrivateRootStable(privateRoot, { repositoryRoot });
    assertOwnership(ownership, privateRoot);
    if (readIntelligenceSchemaVersion(database) !== INTELLIGENCE_SCHEMA_VERSION) {
      throw new FoundationPersistenceError('INTELLIGENCE_NOT_READY', 'Intelligence schema is not ready.');
    }
  }

  function run(operation) {
    try {
      assertIntelligenceReady();
      return operation();
    } catch (error) {
      throw asIntelligencePersistenceError(error);
    }
  }

  function readEvidenceRevision(evidenceRevisionId) {
    const row = database.prepare('SELECT * FROM evidence_revisions WHERE evidence_revision_id = ?').get(evidenceRevisionId);
    if (!row) return null;
    let provenance;
    try {
      provenance = JSON.parse(row.provenance_json);
    } catch {
      throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Evidence provenance is not valid JSON.');
    }
    return {
      evidence_revision_id: row.evidence_revision_id,
      evidence_id: row.evidence_id,
      revision_number: row.revision_number,
      factual_content: row.factual_content,
      provenance,
      responsibility_boundary: row.responsibility_boundary,
      outcome: row.outcome,
      metric_definition: row.metric_definition,
      confirmation_state: row.confirmation_state,
      created_at: row.created_at,
    };
  }

  function resolveEvidenceSnapshot(input = {}) {
    const suppliedSnapshot = resolveAliasedField(input, 'evidence_snapshot', 'evidenceSnapshot', 'evidence_snapshot') ?? input.snapshot;
    if (suppliedSnapshot) {
      const suppliedIds = resolveAliasedField(suppliedSnapshot, 'evidence_revision_ids', 'evidenceRevisionIds', 'evidence_revision_ids');
      if (Array.isArray(suppliedIds) && suppliedIds.length === 0) {
        throw new FoundationPersistenceError('INTELLIGENCE_EVIDENCE_UNAVAILABLE', 'No eligible confirmed Evidence revisions were selected.');
      }
      const supplied = validateSnapshot(suppliedSnapshot);
      const requestedIds = resolveAliasedField(input, 'evidence_revision_ids', 'evidenceRevisionIds', 'evidence_revision_ids');
      if (requestedIds !== undefined && canonicalSerialize(requestedIds) !== canonicalSerialize(supplied.evidence_revision_ids)) {
        throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Evidence revision identities do not match the supplied snapshot.');
      }
      const suppliedGeneration = resolveAliasedField(input, 'input_generation', 'inputGeneration', 'input_generation');
      if (suppliedGeneration !== undefined && String(suppliedGeneration) !== supplied.input_generation) {
        throw new FoundationPersistenceError('INTELLIGENCE_GENERATION_MISMATCH', 'Input generation does not match the supplied Evidence snapshot.');
      }
      const suppliedEvidenceId = resolveAliasedField(input, 'evidence_id', 'evidenceId', 'evidence_id');
      if (suppliedEvidenceId !== undefined && suppliedEvidenceId !== supplied.evidence_id) {
        throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Evidence identity does not match the supplied snapshot.');
      }
      const suppliedSnapshotId = resolveAliasedField(input, 'evidence_snapshot_id', 'evidenceSnapshotId', 'evidence_snapshot_id');
      if (suppliedSnapshotId !== undefined && suppliedSnapshotId !== supplied.evidence_snapshot_id) {
        throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Evidence snapshot identity does not match the supplied snapshot.');
      }
      const canonical = buildEvidenceSnapshot({
        evidenceRevisionIds: supplied.evidence_revision_ids,
        evidenceRevisions: supplied.evidence_revision_ids.map((id) => readEvidenceRevision(id)),
        expectedEvidenceId: supplied.evidence_id,
        inputGeneration: supplied.input_generation,
        contractVersion: supplied.contract_version,
      });
      if (canonicalSerialize(canonical) !== canonicalSerialize(supplied)) {
        throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Supplied Evidence snapshot does not match canonical confirmed Evidence revisions.');
      }
      return canonical;
    }
    const ids = resolveAliasedField(input, 'evidence_revision_ids', 'evidenceRevisionIds', 'evidence_revision_ids');
    if (!Array.isArray(ids) || ids.length === 0) throw new FoundationPersistenceError('INTELLIGENCE_EVIDENCE_UNAVAILABLE', 'No eligible confirmed Evidence revisions were selected.');
    const revisions = ids.map((id) => readEvidenceRevision(id));
    return buildEvidenceSnapshot({
      evidenceRevisionIds: ids,
      evidenceRevisions: revisions,
      expectedEvidenceId: resolveAliasedField(input, 'evidence_id', 'evidenceId', 'evidence_id'),
      inputGeneration: resolveAliasedField(input, 'input_generation', 'inputGeneration', 'input_generation'),
      contractVersion: input.contract_version ?? input.contractVersion,
    });
  }

  function assertSelectedContext(bundle) {
    const opportunity = database.prepare('SELECT opportunity_id FROM opportunities WHERE opportunity_id = ?').get(bundle.opportunity_id);
    if (!opportunity) throw new FoundationPersistenceError('OPPORTUNITY_NOT_FOUND', 'Opportunity does not exist.');
    const revision = database.prepare('SELECT opportunity_id, availability_status FROM jd_revisions WHERE jd_revision_id = ?').get(bundle.jd_revision_id);
    if (!revision || revision.opportunity_id !== bundle.opportunity_id) {
      throw new FoundationPersistenceError('JD_REVISION_INVALID', 'JD revision does not belong to the selected Opportunity.');
    }
    if (revision.availability_status !== 'AVAILABLE') {
      throw new FoundationPersistenceError('INTELLIGENCE_UNAVAILABLE', 'Selected JD revision is unavailable.');
    }
  }

  function readSnapshot(snapshotId) {
    const row = database.prepare('SELECT * FROM intelligence_evidence_snapshots WHERE evidence_snapshot_id = ?').get(snapshotId);
    if (!row) throw new FoundationPersistenceError('INTELLIGENCE_EVIDENCE_UNAVAILABLE', 'Evidence snapshot does not exist.');
    const ids = intelligenceStoredJson(row.evidence_revision_ids_json, 'evidence_revision_ids_json');
    const revisions = ids.map((id) => readEvidenceRevision(id));
    return validateSnapshot({
      evidence_snapshot_id: row.evidence_snapshot_id,
      evidence_id: row.evidence_id,
      evidence_revision_ids: ids,
      evidence_revisions: revisions,
      input_generation: row.input_generation,
      contract_version: row.contract_version,
    });
  }

  function persistSnapshot(snapshot, requestedAt) {
    const serializedIds = canonicalSerialize(snapshot.evidence_revision_ids);
    const existing = database.prepare('SELECT * FROM intelligence_evidence_snapshots WHERE evidence_snapshot_id = ?').get(snapshot.evidence_snapshot_id);
    if (existing) {
      if (
        existing.evidence_id !== snapshot.evidence_id
        || existing.input_generation !== snapshot.input_generation
        || existing.contract_version !== snapshot.contract_version
        || existing.evidence_revision_ids_json !== serializedIds
      ) {
        throw new FoundationPersistenceError('INTELLIGENCE_IDENTITY_CONFLICT', 'Evidence snapshot identity is already bound to different immutable inputs.');
      }
      return;
    }
    database.prepare(`
      INSERT INTO intelligence_evidence_snapshots (
        evidence_snapshot_id, evidence_id, evidence_revision_ids_json, input_generation, contract_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.evidence_snapshot_id,
      snapshot.evidence_id,
      serializedIds,
      snapshot.input_generation,
      snapshot.contract_version,
      requestedAt,
    );
  }

  function buildSnapshot(input = {}) {
    return run(() => resolveEvidenceSnapshot(input));
  }

  function createInputGeneration(input = {}) {
    return run(() => {
      const snapshot = resolveEvidenceSnapshot(input);
      const bundle = buildInputBundle({ ...input, evidenceSnapshot: snapshot });
      assertSelectedContext(bundle);
      const existing = database.prepare('SELECT * FROM intelligence_input_generations WHERE analysis_id = ?').get(bundle.analysis_id);
      const conflictingIdentity = database.prepare(
        'SELECT analysis_id FROM intelligence_input_generations WHERE execution_id = ? OR idempotency_key = ? LIMIT 1',
      ).get(bundle.execution_id, bundle.idempotency_key);
      if (conflictingIdentity && conflictingIdentity.analysis_id !== bundle.analysis_id) {
        throw new FoundationPersistenceError('INTELLIGENCE_IDENTITY_CONFLICT', 'Execution or idempotency identity is already bound to a different analysis.');
      }
      const requestedAt = bundle.requested_at;
      const persisted = database.transaction(() => {
        persistSnapshot(snapshot, requestedAt);
        if (existing) {
          const existingIds = intelligenceStoredJson(existing.evidence_revision_ids_json, 'evidence_revision_ids_json');
          if (
            existing.opportunity_id !== bundle.opportunity_id
            || existing.jd_revision_id !== bundle.jd_revision_id
            || existing.evidence_snapshot_id !== bundle.evidence_snapshot_id
            || existing.input_generation !== bundle.input_generation
            || existing.operation_type !== bundle.operation_type
            || existing.schema_version !== bundle.schema_version
            || existing.execution_id !== bundle.execution_id
            || existing.idempotency_key !== bundle.idempotency_key
            || canonicalSerialize(existingIds) !== canonicalSerialize(bundle.evidence_revision_ids)
            || existing.requested_at !== bundle.requested_at
            || existing.disclosure_classification !== bundle.disclosure_classification
          ) {
            throw new FoundationPersistenceError('INTELLIGENCE_IDENTITY_CONFLICT', 'Analysis identity is already bound to different immutable inputs.');
          }
        } else {
          database.prepare(`
            INSERT INTO intelligence_input_generations (
              analysis_id, opportunity_id, jd_revision_id, evidence_snapshot_id,
              evidence_revision_ids_json, operation_type, schema_version,
              execution_id, idempotency_key, input_generation, requested_at,
              disclosure_classification, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            bundle.analysis_id,
            bundle.opportunity_id,
            bundle.jd_revision_id,
            bundle.evidence_snapshot_id,
            canonicalSerialize(bundle.evidence_revision_ids),
            bundle.operation_type,
            bundle.schema_version,
            bundle.execution_id,
            bundle.idempotency_key,
            bundle.input_generation,
            bundle.requested_at,
            bundle.disclosure_classification,
            bundle.requested_at,
          );
        }
        database.prepare(`
          UPDATE intelligence_positioning_versions
             SET state = 'STALE'
           WHERE opportunity_id = ? AND input_generation <> ?
             AND state IN ('DRAFT', 'CANDIDATE', 'CONFIRMED')
        `).run(bundle.opportunity_id, bundle.input_generation);
        database.prepare(`
          DELETE FROM intelligence_positioning_current
           WHERE opportunity_id = ?
             AND positioning_version_id IN (
               SELECT positioning_version_id FROM intelligence_positioning_versions WHERE state <> 'CONFIRMED'
             )
        `).run(bundle.opportunity_id);
      });
      persisted();
      return Object.freeze({ ...bundle, evidence_snapshot: snapshot });
    });
  }

  function getInputGeneration(analysisId) {
    return run(() => {
      const row = database.prepare('SELECT * FROM intelligence_input_generations WHERE analysis_id = ?').get(analysisId);
      if (!row) return null;
      return Object.freeze({
        analysis_id: row.analysis_id,
        opportunity_id: row.opportunity_id,
        jd_revision_id: row.jd_revision_id,
        evidence_snapshot_id: row.evidence_snapshot_id,
        evidence_revision_ids: intelligenceStoredJson(row.evidence_revision_ids_json, 'evidence_revision_ids_json'),
        operation_type: row.operation_type,
        schema_version: row.schema_version,
        execution_id: row.execution_id,
        idempotency_key: row.idempotency_key,
        input_generation: row.input_generation,
        requested_at: row.requested_at,
        disclosure_classification: row.disclosure_classification,
        evidence_snapshot: readSnapshot(row.evidence_snapshot_id),
      });
    });
  }

  function executionNow(value) {
    const timestamp = value === undefined ? new Date().toISOString() : value;
    if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
      throw new FoundationPersistenceError('INTELLIGENCE_EXECUTION_INVALID', 'Execution timestamp is invalid.');
    }
    return new Date(timestamp).toISOString();
  }

  function recoverInterruptedExecutions() {
    const updatedAt = executionNow();
    database.prepare(`
      UPDATE intelligence_executions
         SET execution_state = 'FAILED', result_status = 'UNAVAILABLE',
             validation_status = 'NOT_RUN', result_payload_json = NULL,
             error_json = ?, is_current = 0, updated_at = ?, completed_at = ?
       WHERE execution_state = 'RUNNING'
    `).run(
      canonicalSerialize({
        classification: 'UNAVAILABLE',
        message: 'Execution was interrupted before completion; a new bounded execution is required.',
        retryable: false,
      }),
      updatedAt,
      updatedAt,
    );
  }

  recoverInterruptedExecutions();

  function readExecutionRow(executionId) {
    const row = database.prepare('SELECT * FROM intelligence_executions WHERE execution_id = ?').get(executionId);
    if (!row) return null;
    const analysis = database.prepare('SELECT * FROM intelligence_input_generations WHERE analysis_id = ?').get(row.analysis_id);
    if (!analysis) throw new FoundationPersistenceError('INTELLIGENCE_RECORD_INVALID', 'Execution input generation does not exist.');
    const payload = intelligenceStoredJson(row.request_payload_json, 'request_payload_json');
    const request = buildExecutionRequest({
      inputBundle: {
        execution_id: analysis.execution_id,
        idempotency_key: analysis.idempotency_key,
        operation_type: analysis.operation_type,
        schema_version: analysis.schema_version,
        opportunity_id: analysis.opportunity_id,
        jd_revision_id: analysis.jd_revision_id,
        evidence_snapshot_id: analysis.evidence_snapshot_id,
        evidence_revision_ids: intelligenceStoredJson(analysis.evidence_revision_ids_json, 'evidence_revision_ids_json'),
        input_generation: analysis.input_generation,
        requested_at: analysis.requested_at,
        disclosure_classification: analysis.disclosure_classification,
      },
      payload,
    });
    return Object.freeze({
      execution_id: row.execution_id,
      analysis_id: row.analysis_id,
      idempotency_key: row.idempotency_key,
      opportunity_id: row.opportunity_id,
      jd_revision_id: row.jd_revision_id,
      evidence_snapshot_id: row.evidence_snapshot_id,
      input_generation: row.input_generation,
      operation_type: row.operation_type,
      schema_version: row.schema_version,
      requested_at: row.requested_at,
      disclosure_classification: row.disclosure_classification,
      attempt: row.attempt,
      max_attempts: row.max_attempts,
      execution_state: row.execution_state,
      result_status: row.result_status,
      validation_status: row.validation_status,
      result_payload: row.result_payload_json === null ? null : intelligenceStoredJson(row.result_payload_json, 'result_payload_json'),
      error: row.error_json === null ? null : intelligenceStoredJson(row.error_json, 'error_json'),
      cancel_requested_at: row.cancel_requested_at,
      cancellation_acknowledged: row.cancellation_acknowledged === null ? null : Boolean(row.cancellation_acknowledged),
      superseded_by_execution_id: row.superseded_by_execution_id,
      is_current: Boolean(row.is_current),
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
      request,
    });
  }

  function executionInputFor(input = {}) {
    const analysisId = input.analysis_id ?? input.analysisId;
    const executionId = input.execution_id ?? input.executionId;
    const idempotencyKey = input.idempotency_key ?? input.idempotencyKey;
    let row = analysisId
      ? database.prepare('SELECT * FROM intelligence_input_generations WHERE analysis_id = ?').get(analysisId)
      : null;
    if (!row && executionId) row = database.prepare('SELECT * FROM intelligence_input_generations WHERE execution_id = ?').get(executionId);
    if (!row && idempotencyKey) row = database.prepare('SELECT * FROM intelligence_input_generations WHERE idempotency_key = ?').get(idempotencyKey);
    if (!row) throw new FoundationPersistenceError('INTELLIGENCE_INPUT_NOT_FOUND', 'Execution requires an existing immutable input generation.');
    if (analysisId && row.analysis_id !== analysisId) throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Execution analysis identity does not match the immutable input generation.');
    if (executionId && row.execution_id !== executionId) throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Execution identity does not match the immutable input generation.');
    if (idempotencyKey && row.idempotency_key !== idempotencyKey) throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Execution idempotency identity does not match the immutable input generation.');
    return row;
  }

  function executionPayloadForInput(row) {
    const jd = database.prepare('SELECT jd_revision_id, content, source_ref, availability_status FROM jd_revisions WHERE jd_revision_id = ?').get(row.jd_revision_id);
    if (!jd || jd.availability_status !== 'AVAILABLE' || typeof jd.content !== 'string' || jd.content.length === 0) {
      throw new FoundationPersistenceError('INTELLIGENCE_UNAVAILABLE', 'Execution JD input is unavailable.');
    }
    const snapshot = readSnapshot(row.evidence_snapshot_id);
    return {
      jd: {
        jd_revision_id: jd.jd_revision_id,
        content: jd.content,
        source_ref: jd.source_ref,
      },
      evidence: snapshot.evidence_revisions.map((revision) => ({
        evidence_revision_id: revision.evidence_revision_id,
        evidence_id: revision.evidence_id,
        factual_content: revision.factual_content,
        responsibility_boundary: revision.responsibility_boundary,
        outcome: revision.outcome,
        provenance: revision.provenance,
      })),
    };
  }

  function requestForExecutionInput(row) {
    return buildExecutionRequest({
      inputBundle: {
        execution_id: row.execution_id,
        idempotency_key: row.idempotency_key,
        operation_type: row.operation_type,
        schema_version: row.schema_version,
        opportunity_id: row.opportunity_id,
        jd_revision_id: row.jd_revision_id,
        evidence_snapshot_id: row.evidence_snapshot_id,
        evidence_revision_ids: intelligenceStoredJson(row.evidence_revision_ids_json, 'evidence_revision_ids_json'),
        input_generation: row.input_generation,
        requested_at: row.requested_at,
        disclosure_classification: row.disclosure_classification,
      },
      payload: executionPayloadForInput(row),
    });
  }

  function validateExecutionCandidate(request, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new FoundationPersistenceError('INTELLIGENCE_EXECUTION_SCHEMA_INVALID', 'Execution candidate payload must be structured.');
    const allowed = new Set(['requirements', 'matches', 'positioning']);
    if (Object.keys(payload).some((key) => !allowed.has(key))) throw new FoundationPersistenceError('INTELLIGENCE_EXECUTION_SCHEMA_INVALID', 'Execution candidate payload contains an unsupported field.');
    const snapshot = readSnapshot(request.evidence_snapshot_id);
    const jd = database.prepare('SELECT content, availability_status FROM jd_revisions WHERE jd_revision_id = ?').get(request.jd_revision_id);
    if (!jd || jd.availability_status !== 'AVAILABLE') throw new FoundationPersistenceError('INTELLIGENCE_UNAVAILABLE', 'Execution candidate JD is unavailable.');
    const analysisId = database.prepare('SELECT analysis_id FROM intelligence_input_generations WHERE execution_id = ?').get(request.execution_id)?.analysis_id;
    if (!analysisId) throw new FoundationPersistenceError('INTELLIGENCE_INPUT_NOT_FOUND', 'Execution input generation does not exist.');
    const requirements = Array.isArray(payload.requirements) ? payload.requirements.map((item) => {
      const requirement = validateRequirement(item);
      if (!requirement.ready || requirement.jd_revision_id !== request.jd_revision_id || !intelligenceSourceResolvesToJd(requirement.source_ref, jd.content, request.jd_revision_id)) {
        throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Execution requirement is not resolvable to the selected JD revision.');
      }
      const existing = database.prepare('SELECT analysis_id FROM intelligence_requirements WHERE requirement_id = ?').get(requirement.requirement_id);
      if (existing) {
        const persisted = readRequirement(requirement.requirement_id);
        if (existing.analysis_id !== analysisId || canonicalSerialize(persisted) !== canonicalSerialize(requirement)) {
          throw new FoundationPersistenceError('INTELLIGENCE_IDENTITY_CONFLICT', 'Execution requirement identity is already bound to different immutable inputs.');
        }
      }
      return requirement;
    }) : [];
    const requirementMap = new Map(requirements.map((item) => [item.requirement_id, item]));
    const matches = Array.isArray(payload.matches) ? payload.matches.map((item) => {
      const requirement = requirementMap.get(resolveAliasedField(item, 'requirement_id', 'requirementId', 'requirement_id'));
      if (!requirement) throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Execution match is missing its candidate requirement.');
      const match = validateMatchRecord(item, snapshot, requirement);
      const trace = validateTraceability({
        jdSourceRef: requirement.source_ref,
        jdRevisionId: requirement.jd_revision_id,
        requirement,
        match,
        snapshot,
      });
      const existing = database.prepare('SELECT match_id, input_generation FROM intelligence_matches WHERE match_id = ?').get(match.match_id);
      if (existing) {
        if (existing.input_generation !== request.input_generation || canonicalSerialize(readMatch(match.match_id)) !== canonicalSerialize(match)) {
          throw new FoundationPersistenceError('INTELLIGENCE_IDENTITY_CONFLICT', 'Execution match identity is already bound to different immutable inputs.');
        }
      }
      return { ...match, provenance_edges: trace.provenance_edges };
    }) : [];
    if (request.operation_type === 'ANALYZE_REQUIREMENTS' && !Array.isArray(payload.requirements)) {
      throw new FoundationPersistenceError('INTELLIGENCE_EXECUTION_SCHEMA_INVALID', 'Requirement analysis output must contain requirements.');
    }
    if (request.operation_type === 'CLASSIFY_MATCHES' && !Array.isArray(payload.matches)) {
      throw new FoundationPersistenceError('INTELLIGENCE_EXECUTION_SCHEMA_INVALID', 'Match classification output must contain matches.');
    }
    let positioning;
    if (payload.positioning !== undefined) {
      if (!payload.positioning || typeof payload.positioning !== 'object' || Array.isArray(payload.positioning)) throw new FoundationPersistenceError('INTELLIGENCE_EXECUTION_SCHEMA_INVALID', 'Positioning candidate must be structured.');
      if (!Array.isArray(payload.positioning.claims)) throw new FoundationPersistenceError('INTELLIGENCE_EXECUTION_SCHEMA_INVALID', 'Positioning candidate claims must be an array.');
      positioning = validatePositioningVersion({
        ...payload.positioning,
        opportunity_id: request.opportunity_id,
        jd_revision_id: request.jd_revision_id,
        analysis_id: analysisId,
        evidence_snapshot_id: request.evidence_snapshot_id,
        input_generation: request.input_generation,
        evidence_snapshot: snapshot,
        requirements,
        matches,
      });
      const existing = database.prepare('SELECT * FROM intelligence_positioning_versions WHERE positioning_version_id = ?').get(positioning.positioning_version_id);
      if (existing && canonicalSerialize(readPositioningVersion(positioning.positioning_version_id)) !== canonicalSerialize(positioning)) {
        throw new FoundationPersistenceError('INTELLIGENCE_IDENTITY_CONFLICT', 'Execution positioning identity is already bound to different immutable inputs.');
      }
    }
    if (request.operation_type === 'DRAFT_POSITIONING' && !positioning) {
      throw new FoundationPersistenceError('INTELLIGENCE_EXECUTION_SCHEMA_INVALID', 'Positioning output must contain a positioning candidate.');
    }
    return JSON.parse(canonicalSerialize({
      ...(Array.isArray(payload.requirements) ? { requirements } : {}),
      ...(Array.isArray(payload.matches) ? { matches: matches.map(({ provenance_edges, ...match }) => match) } : {}),
      ...(positioning ? { positioning } : {}),
    }));
  }

  function createExecutionRecord(input = {}) {
    return run(() => {
      const inputRow = executionInputFor(input);
      const request = requestForExecutionInput(inputRow);
      if (input.payload !== undefined && canonicalSerialize(input.payload) !== canonicalSerialize(request.payload)) {
        throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Execution payload does not match the persisted immutable input snapshot.');
      }
      const maxAttempts = input.maxAttempts ?? input.max_attempts ?? 3;
      if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new FoundationPersistenceError('INTELLIGENCE_EXECUTION_INVALID', 'maxAttempts must be a bounded positive integer.');
      const existing = database.prepare('SELECT execution_id FROM intelligence_executions WHERE execution_id = ? OR idempotency_key = ? LIMIT 1').get(request.execution_id, request.idempotency_key);
      if (existing) {
        const record = readExecutionRow(existing.execution_id);
        if (record.analysis_id !== inputRow.analysis_id || record.max_attempts !== maxAttempts || canonicalSerialize(record.request) !== canonicalSerialize(request)) {
          throw new FoundationPersistenceError('INTELLIGENCE_IDENTITY_CONFLICT', 'Execution identity is already bound to different immutable inputs.');
        }
        return record;
      }
      const createdAt = executionNow(input.requested_at ?? request.requested_at);
      database.transaction(() => {
        database.prepare(`
          UPDATE intelligence_executions
             SET superseded_by_execution_id = ?, updated_at = ?
           WHERE opportunity_id = ? AND operation_type = ?
             AND execution_state = 'RUNNING'
             AND execution_id <> ?
             AND superseded_by_execution_id IS NULL
        `).run(request.execution_id, createdAt, request.opportunity_id, request.operation_type, request.execution_id);
        database.prepare(`
          INSERT INTO intelligence_executions (
            execution_id, analysis_id, idempotency_key, opportunity_id, jd_revision_id,
            evidence_snapshot_id, input_generation, operation_type, schema_version,
            requested_at, disclosure_classification, request_payload_json, attempt,
            max_attempts, execution_state, result_status, validation_status,
            result_payload_json, error_json, cancel_requested_at,
            cancellation_acknowledged, superseded_by_execution_id, is_current,
            created_at, updated_at, completed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'RUNNING', NULL, 'NOT_RUN', NULL, NULL, NULL, NULL, NULL, 0, ?, ?, NULL)
        `).run(
          request.execution_id,
          inputRow.analysis_id,
          request.idempotency_key,
          request.opportunity_id,
          request.jd_revision_id,
          request.evidence_snapshot_id,
          request.input_generation,
          request.operation_type,
          request.schema_version,
          request.requested_at,
          request.disclosure_classification,
          canonicalSerialize(request.payload),
          maxAttempts,
          createdAt,
          createdAt,
        );
      })();
      return readExecutionRow(request.execution_id);
    });
  }

  function beginExecutionAttempt(executionId) {
    return run(() => {
      const record = readExecutionRow(executionId);
      if (!record) throw new FoundationPersistenceError('EXECUTION_NOT_FOUND', 'Execution does not exist.');
      if (record.execution_state !== 'RUNNING') return record;
      if (currentContextIsStale(record)) {
        return recordExecutionResult(executionId, staleExecutionResponse(record), { now: new Date().toISOString() });
      }
      if (record.attempt >= record.max_attempts) throw new FoundationPersistenceError('INTELLIGENCE_EXECUTION_INVALID', 'Execution attempt limit has been reached.');
      const updatedAt = new Date().toISOString();
      database.prepare('UPDATE intelligence_executions SET attempt = attempt + 1, updated_at = ? WHERE execution_id = ? AND execution_state = \'RUNNING\'').run(updatedAt, executionId);
      return readExecutionRow(executionId);
    });
  }

  function currentContextIsStale(record) {
    if (record.superseded_by_execution_id) return true;
    const opportunity = database.prepare('SELECT current_jd_revision_id FROM opportunities WHERE opportunity_id = ?').get(record.opportunity_id);
    if (!opportunity || opportunity.current_jd_revision_id !== record.jd_revision_id) return true;
    const snapshot = readSnapshot(record.evidence_snapshot_id);
    const currentRevision = database.prepare('SELECT current_revision_id FROM evidence_records WHERE evidence_id = ?').get(snapshot.evidence_id);
    return Boolean(currentRevision && currentRevision.current_revision_id && !snapshot.evidence_revision_ids.includes(currentRevision.current_revision_id));
  }

  function staleExecutionResponse(record) {
    return normalizeExecutionResponse({
      execution_id: record.request.execution_id,
      idempotency_key: record.request.idempotency_key,
      operation_type: record.request.operation_type,
      schema_version: record.request.schema_version,
      opportunity_id: record.request.opportunity_id,
      jd_revision_id: record.request.jd_revision_id,
      evidence_snapshot_id: record.request.evidence_snapshot_id,
      input_generation: record.request.input_generation,
      result_status: 'STALE',
      validation_status: 'NOT_RUN',
      error: { classification: 'STALE_RESULT', retryable: false, message: 'Execution result no longer matches the current input context.' },
    }, record.request);
  }

  function terminalResponseForRecord(record) {
    return normalizeExecutionResponse({
      execution_id: record.request.execution_id,
      idempotency_key: record.request.idempotency_key,
      operation_type: record.request.operation_type,
      schema_version: record.request.schema_version,
      opportunity_id: record.request.opportunity_id,
      jd_revision_id: record.request.jd_revision_id,
      evidence_snapshot_id: record.request.evidence_snapshot_id,
      input_generation: record.request.input_generation,
      result_status: record.result_status,
      validation_status: record.validation_status,
      ...(record.result_payload === null ? {} : { payload: record.result_payload }),
      ...(record.error === null ? {} : { error: record.error }),
    }, record.request);
  }

  function recordExecutionResult(executionId, response, optionsInput = {}) {
    return run(() => {
      const record = readExecutionRow(executionId);
      if (!record) throw new FoundationPersistenceError('EXECUTION_NOT_FOUND', 'Execution does not exist.');
      const responseValue = normalizeExecutionResponse(response, record.request);
      const updatedAt = executionNow(optionsInput.now);
      const terminal = record.execution_state !== 'RUNNING';
      if (terminal) {
        if (optionsInput.retrying) return record;
        try {
          if (canonicalSerialize(terminalResponseForRecord(record)) === canonicalSerialize(responseValue)) return record;
        } catch {
          // Fall through to the immutable conflict below.
        }
        throw new FoundationPersistenceError('INTELLIGENCE_DUPLICATE_COMPLETION', 'Terminal execution cannot be overwritten by a different completion.');
      }
      if (optionsInput.retrying) {
        if (currentContextIsStale(record)) return recordExecutionResult(executionId, staleExecutionResponse(record), { now: updatedAt });
        database.prepare(`
          UPDATE intelligence_executions
             SET result_status = ?, validation_status = ?, result_payload_json = NULL,
                 error_json = ?, updated_at = ?, completed_at = NULL
           WHERE execution_id = ? AND execution_state = 'RUNNING'
        `).run(
          responseValue.result_status,
          responseValue.validation_status,
          responseValue.error ? canonicalSerialize(responseValue.error) : null,
          updatedAt,
          executionId,
        );
        return readExecutionRow(executionId);
      }
      let normalized = responseValue;
      let executionState;
      let resultPayload = null;
      let error = normalized.error ?? null;
      if (currentContextIsStale(record)) {
        normalized = staleExecutionResponse(record);
        executionState = 'STALE_RESULT_REJECTED';
        error = normalized.error;
      } else if (normalized.result_status === 'SUCCEEDED') {
        try {
          resultPayload = validateExecutionCandidate(record.request, normalized.payload);
          executionState = 'COMPLETED';
        } catch (validationError) {
          normalized = normalizeExecutionResponse({
            execution_id: record.request.execution_id,
            idempotency_key: record.request.idempotency_key,
            operation_type: record.request.operation_type,
            schema_version: record.request.schema_version,
            opportunity_id: record.request.opportunity_id,
            jd_revision_id: record.request.jd_revision_id,
            evidence_snapshot_id: record.request.evidence_snapshot_id,
            input_generation: record.request.input_generation,
            result_status: 'SCHEMA_INVALID',
            validation_status: 'INVALID',
            error: { classification: 'SCHEMA_INVALID', retryable: false, message: 'Execution candidate failed application validation.' },
          }, record.request);
          executionState = 'FAILED';
          error = normalized.error;
        }
      } else if (normalized.result_status === 'CANCELLED') {
        executionState = 'CANCELLED';
      } else if (normalized.result_status === 'STALE') {
        executionState = 'STALE_RESULT_REJECTED';
      } else {
        executionState = 'FAILED';
      }
      const isCurrent = executionState === 'COMPLETED' && normalized.result_status === 'SUCCEEDED';
      const cancellationAcknowledged = normalized.result_status === 'CANCELLED'
        ? (optionsInput.cancellationAcknowledged === undefined ? null : (optionsInput.cancellationAcknowledged ? 1 : 0))
        : null;
      database.transaction(() => {
        if (isCurrent && resultPayload !== null) {
          persistValidatedCandidatePayload(record.request, resultPayload);
        }
        if (isCurrent) {
          database.prepare(`
            UPDATE intelligence_executions
               SET is_current = 0
             WHERE opportunity_id = ? AND operation_type = ? AND execution_id <> ?
          `).run(record.opportunity_id, record.operation_type, executionId);
        }
        database.prepare(`
          UPDATE intelligence_executions
             SET execution_state = ?, result_status = ?, validation_status = ?,
                 result_payload_json = ?, error_json = ?, cancellation_acknowledged = ?,
                 cancel_requested_at = CASE WHEN ? = 1 THEN COALESCE(cancel_requested_at, ?) ELSE cancel_requested_at END,
                 is_current = ?, updated_at = ?, completed_at = ?
           WHERE execution_id = ? AND execution_state = 'RUNNING'
        `).run(
          executionState,
          normalized.result_status,
          normalized.validation_status,
          resultPayload === null ? null : canonicalSerialize(resultPayload),
          error === null ? null : canonicalSerialize(error),
          cancellationAcknowledged,
          normalized.result_status === 'CANCELLED' ? 1 : 0,
          updatedAt,
          isCurrent ? 1 : 0,
          updatedAt,
          updatedAt,
          executionId,
        );
      })();
      return readExecutionRow(executionId);
    });
  }

  function cancelExecutionRecord(executionId, optionsInput = {}) {
    return run(() => {
      const record = readExecutionRow(executionId);
      if (!record) throw new FoundationPersistenceError('EXECUTION_NOT_FOUND', 'Execution does not exist.');
      if (record.execution_state !== 'RUNNING') return record;
      const updatedAt = executionNow(optionsInput.now);
      database.prepare(`
        UPDATE intelligence_executions
           SET execution_state = 'CANCELLED', result_status = 'CANCELLED',
               validation_status = 'NOT_RUN', result_payload_json = NULL,
               error_json = ?, cancel_requested_at = ?,
               cancellation_acknowledged = 0, is_current = 0,
               updated_at = ?, completed_at = ?
         WHERE execution_id = ? AND execution_state = 'RUNNING'
      `).run(
        canonicalSerialize({ classification: 'CANCELLED', message: 'Execution was cancelled.', retryable: false }),
        updatedAt,
        updatedAt,
        updatedAt,
        executionId,
      );
      return readExecutionRow(executionId);
    });
  }

  function persistValidatedCandidatePayload(request, payload) {
    const analysisId = database.prepare(
      'SELECT analysis_id FROM intelligence_input_generations WHERE execution_id = ?',
    ).get(request.execution_id)?.analysis_id;
    if (!analysisId) throw new FoundationPersistenceError('INTELLIGENCE_INPUT_NOT_FOUND', 'Execution input generation does not exist.');
    const createdAt = request.requested_at;
    const requirements = Array.isArray(payload.requirements) ? payload.requirements : [];
    for (const requirement of requirements) {
      const existing = database.prepare('SELECT * FROM intelligence_requirements WHERE requirement_id = ?').get(requirement.requirement_id);
      if (existing) {
        const current = readRequirement(requirement.requirement_id);
        if (existing.analysis_id !== analysisId || canonicalSerialize(current) !== canonicalSerialize(requirement)) {
          throw new FoundationPersistenceError('INTELLIGENCE_IDENTITY_CONFLICT', 'Execution requirement identity is already bound to different immutable inputs.');
        }
        continue;
      }
      database.prepare(`
        INSERT INTO intelligence_requirements (
          requirement_id, analysis_id, jd_revision_id, source_ref_json,
          normalized_content, requirement_type, priority, explicitness,
          uncertainty_json, extraction_status, contract_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        requirement.requirement_id,
        analysisId,
        requirement.jd_revision_id,
        canonicalSerialize(requirement.source_ref),
        requirement.normalized_content,
        requirement.requirement_type,
        requirement.priority,
        requirement.explicitness,
        canonicalSerialize(requirement.uncertainty),
        requirement.extraction_status,
        requirement.contract_version,
        createdAt,
      );
    }
    const snapshot = readSnapshot(request.evidence_snapshot_id);
    const persistedRequirements = new Map(requirements.map((item) => [item.requirement_id, item]));
    const matches = Array.isArray(payload.matches) ? payload.matches : [];
    for (const match of matches) {
      const existing = database.prepare('SELECT * FROM intelligence_matches WHERE match_id = ?').get(match.match_id);
      if (existing) {
        if (canonicalSerialize(readMatch(match.match_id)) !== canonicalSerialize(match)) {
          throw new FoundationPersistenceError('INTELLIGENCE_IDENTITY_CONFLICT', 'Execution match identity is already bound to different immutable inputs.');
        }
        continue;
      }
      const requirement = persistedRequirements.get(match.requirement_id) || readRequirement(match.requirement_id);
      if (!requirement) throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Execution match requirement is not persisted.');
      const provenance = validateTraceability({
        jdSourceRef: requirement.source_ref,
        jdRevisionId: requirement.jd_revision_id,
        requirement,
        match,
        snapshot,
      });
      database.prepare(`
        INSERT INTO intelligence_matches (
          match_id, gap_id, jd_revision_id, requirement_id, evidence_snapshot_id,
          input_generation, classification, decision_facts_json,
          evidence_revision_ids_json, missing_dimensions_json, explanation, boundary, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        match.match_id,
        match.gap_id,
        match.jd_revision_id,
        match.requirement_id,
        match.evidence_snapshot_id,
        match.input_generation,
        match.classification,
        canonicalSerialize(match.decision_facts),
        canonicalSerialize(match.evidence_revision_ids),
        canonicalSerialize(match.missing_dimensions),
        serializeMatchExplanation(match),
        match.boundary ?? null,
        createdAt,
      );
      persistProvenanceEdges(provenance.provenance_edges, match.input_generation);
    }
    if (payload.positioning !== undefined) {
      const position = payload.positioning;
      if (position.state === 'CONFIRMED') {
        throw new FoundationPersistenceError('INTELLIGENCE_CONFIRMATION_REQUIRED', 'Execution output cannot confirm positioning implicitly.');
      }
      const existing = database.prepare('SELECT positioning_version_id FROM intelligence_positioning_versions WHERE positioning_version_id = ?').get(position.positioning_version_id);
      if (existing) {
        const existingVersion = readPositioningVersion(position.positioning_version_id);
        if (canonicalSerialize(existingVersion) !== canonicalSerialize(position)) {
          throw new FoundationPersistenceError('INTELLIGENCE_IDENTITY_CONFLICT', 'Execution positioning identity is already bound to different immutable inputs.');
        }
      } else {
        const relationIds = [...new Set(position.claims.flatMap((claim) => [claim.match_id, claim.gap_id].filter(Boolean)))];
        const relationRows = relationIds.map((id) => readMatchOrGap(id)).filter(Boolean);
        const requirementRows = [...new Set(position.claims.map((claim) => claim.requirement_id))].map((id) => readRequirement(id)).filter(Boolean);
        const version = validatePositioningVersion({
          ...position,
          opportunity_id: request.opportunity_id,
          jd_revision_id: request.jd_revision_id,
          analysis_id: analysisId,
          evidence_snapshot: snapshot,
          requirements: requirementRows,
          matches: relationRows,
        });
        database.prepare(`
          INSERT INTO intelligence_positioning_versions (
            positioning_version_id, opportunity_id, jd_revision_id, analysis_id,
            evidence_snapshot_id, input_generation, version_number, state,
            claims_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          version.positioning_version_id,
          version.opportunity_id,
          version.jd_revision_id,
          version.analysis_id,
          version.evidence_snapshot_id,
          version.input_generation,
          version.version_number,
          version.state,
          canonicalSerialize(version.claims),
          createdAt,
        );
        for (const claim of version.claims) {
          database.prepare(`
            INSERT INTO intelligence_positioning_claims (
              positioning_claim_id, positioning_version_id, ordinal, requirement_id,
              match_id, gap_id, evidence_revision_ids_json, claim_kind, claim_text, verified
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            claim.positioning_claim_id,
            version.positioning_version_id,
            claim.ordinal,
            claim.requirement_id,
            claim.match_id,
            claim.gap_id,
            canonicalSerialize(claim.evidence_revision_ids),
            claim.claim_kind,
            claim.claim_text,
            claim.verified ? 1 : 0,
          );
          persistProvenanceEdges([
            { edge_type: 'CLAIM_TO_REQUIREMENT', requirement_id: claim.requirement_id, positioning_claim_id: claim.positioning_claim_id, positioning_version_id: version.positioning_version_id },
            ...(claim.match_id ? [{ edge_type: 'CLAIM_TO_MATCH', match_id: claim.match_id, positioning_claim_id: claim.positioning_claim_id, positioning_version_id: version.positioning_version_id }] : []),
            ...(claim.gap_id ? [{ edge_type: 'CLAIM_TO_GAP', gap_id: claim.gap_id, positioning_claim_id: claim.positioning_claim_id, positioning_version_id: version.positioning_version_id }] : []),
            ...claim.evidence_revision_ids.map((evidenceRevisionId) => ({ edge_type: 'CLAIM_TO_EVIDENCE', evidence_revision_id: evidenceRevisionId, positioning_claim_id: claim.positioning_claim_id, positioning_version_id: version.positioning_version_id })),
            { edge_type: 'CLAIM_TO_VERSION', positioning_claim_id: claim.positioning_claim_id, positioning_version_id: version.positioning_version_id },
          ], version.input_generation);
        }
      }
    }
  }

  const executionService = createExecutionService({
    persistence: {
      createExecutionRecord,
      beginExecutionAttempt,
      recordExecutionResult,
      getExecutionRecord: (executionId) => run(() => readExecutionRow(executionId)),
      cancelExecutionRecord,
    },
    executor: options.executor,
    defaults: options.executionDefaults,
  });

  function saveRequirement(input = {}) {
    return run(() => {
      const requirement = validateRequirement(input);
      if (!requirement.ready) throw new FoundationPersistenceError('INTELLIGENCE_REQUIREMENT_NOT_READY', 'Requirement is not ready for persistence.');
      const jd = database.prepare('SELECT jd_revision_id, content, availability_status FROM jd_revisions WHERE jd_revision_id = ?').get(requirement.jd_revision_id);
      if (!jd) throw new FoundationPersistenceError('JD_REVISION_INVALID', 'Requirement JD revision does not exist.');
      if (jd.availability_status !== 'AVAILABLE' || !intelligenceSourceResolvesToJd(requirement.source_ref, jd.content, requirement.jd_revision_id)) {
        throw new FoundationPersistenceError('INTELLIGENCE_UNAVAILABLE', 'Requirement source is unavailable.');
      }
      const analysisId = input.analysis_id ?? input.analysisId ?? null;
      if (analysisId) {
        const analysis = database.prepare('SELECT jd_revision_id FROM intelligence_input_generations WHERE analysis_id = ?').get(analysisId);
        if (!analysis) throw new FoundationPersistenceError('INTELLIGENCE_INPUT_NOT_FOUND', 'Requirement analysis input generation does not exist.');
        if (analysis.jd_revision_id !== requirement.jd_revision_id) throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Requirement does not belong to its analysis JD revision.');
      }
      const existing = database.prepare('SELECT * FROM intelligence_requirements WHERE requirement_id = ?').get(requirement.requirement_id);
      if (existing) {
        const existingValue = readRequirement(requirement.requirement_id);
        if (existing.analysis_id !== analysisId || canonicalSerialize(existingValue) !== canonicalSerialize(requirement)) throw new FoundationPersistenceError('INTELLIGENCE_IDENTITY_CONFLICT', 'Requirement identity is already bound to different immutable inputs.');
        return existingValue;
      }
      database.prepare(`
        INSERT INTO intelligence_requirements (
          requirement_id, analysis_id, jd_revision_id, source_ref_json,
          normalized_content, requirement_type, priority, explicitness,
          uncertainty_json, extraction_status, contract_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        requirement.requirement_id,
        analysisId,
        requirement.jd_revision_id,
        canonicalSerialize(requirement.source_ref),
        requirement.normalized_content,
        requirement.requirement_type,
        requirement.priority,
        requirement.explicitness,
        canonicalSerialize(requirement.uncertainty),
        requirement.extraction_status,
        requirement.contract_version,
        input.created_at ?? input.createdAt ?? new Date().toISOString(),
      );
      return requirement;
    });
  }

  function readRequirement(requirementId) {
    const row = database.prepare('SELECT * FROM intelligence_requirements WHERE requirement_id = ?').get(requirementId);
    if (!row) return null;
    return validateRequirement({
      requirement_id: row.requirement_id,
      analysis_id: row.analysis_id,
      jd_revision_id: row.jd_revision_id,
      source_ref: intelligenceStoredJson(row.source_ref_json, 'source_ref_json'),
      normalized_content: row.normalized_content,
      requirement_type: row.requirement_type,
      priority: row.priority,
      explicitness: row.explicitness,
      uncertainty: intelligenceStoredJson(row.uncertainty_json, 'uncertainty_json'),
      extraction_status: row.extraction_status,
      contract_version: row.contract_version,
    });
  }

  function saveMatch(input = {}) {
    return run(() => {
      const snapshot = input.evidence_snapshot || input.evidenceSnapshot || input.snapshot
        ? resolveEvidenceSnapshot(input)
        : readSnapshot(resolveAliasedField(input, 'evidence_snapshot_id', 'evidenceSnapshotId', 'evidence_snapshot_id'));
      const suppliedRequirement = input.requirement?.requirement_id ? input.requirement : null;
      const suppliedRequirementId = resolveAliasedField(input, 'requirement_id', 'requirementId', 'requirement_id');
      const requestedRequirementId = suppliedRequirementId ?? suppliedRequirement?.requirement_id;
      if (suppliedRequirement && requestedRequirementId && suppliedRequirement.requirement_id !== requestedRequirementId) {
        throw new FoundationPersistenceError('INTELLIGENCE_IDENTITY_CONFLICT', 'Match requirement identity is inconsistent.');
      }
      const requirement = readRequirement(requestedRequirementId);
      if (!requirement) throw new FoundationPersistenceError('INTELLIGENCE_REQUIREMENT_NOT_FOUND', 'Match requirement does not exist.');
      validateMatchableRequirement(requirement);
      const suppliedJdRevisionId = resolveAliasedField(input, 'jd_revision_id', 'jdRevisionId', 'jd_revision_id');
      if (suppliedJdRevisionId !== undefined && suppliedJdRevisionId !== requirement.jd_revision_id) {
        throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Match JD revision identity does not match the canonical requirement.');
      }
      if (suppliedRequirementId !== undefined && suppliedRequirementId !== requirement.requirement_id) {
        throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Match requirement identity does not match the canonical requirement.');
      }
      if (suppliedRequirement && canonicalSerialize(validateRequirement(suppliedRequirement)) !== canonicalSerialize(requirement)) {
        throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Match requirement does not match the canonical persisted requirement.');
      }
      const analysisId = input.analysis_id ?? input.analysisId;
      if (analysisId) {
        const analysis = database.prepare('SELECT jd_revision_id, evidence_snapshot_id, input_generation FROM intelligence_input_generations WHERE analysis_id = ?').get(analysisId);
        if (!analysis) throw new FoundationPersistenceError('INTELLIGENCE_INPUT_NOT_FOUND', 'Match analysis input generation does not exist.');
        if (analysis.jd_revision_id !== requirement.jd_revision_id || analysis.evidence_snapshot_id !== snapshot.evidence_snapshot_id || analysis.input_generation !== snapshot.input_generation) {
          throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Match does not resolve to its immutable input generation.');
        }
      }
      const suppliedInputGeneration = resolveAliasedField(input, 'input_generation', 'inputGeneration', 'input_generation');
      if (suppliedInputGeneration !== undefined && String(suppliedInputGeneration) !== snapshot.input_generation) {
        throw new FoundationPersistenceError('INTELLIGENCE_GENERATION_MISMATCH', 'Match input generation does not match its Evidence snapshot.');
      }
      const match = validateMatchRecord({
        ...input,
        requirement_id: requirement.requirement_id,
        jd_revision_id: requirement.jd_revision_id,
        evidence_snapshot_id: snapshot.evidence_snapshot_id,
        input_generation: snapshot.input_generation,
      }, snapshot, requirement);
      const existing = database.prepare('SELECT * FROM intelligence_matches WHERE match_id = ?').get(match.match_id);
      if (existing) {
        const existingMatch = readMatch(match.match_id);
        if (canonicalSerialize(existingMatch) !== canonicalSerialize(match)) {
          throw new FoundationPersistenceError('INTELLIGENCE_IDENTITY_CONFLICT', 'Match identity is already bound to different immutable inputs.');
        }
        return existingMatch;
      }
      const provenance = validateTraceability({
        jdSourceRef: requirement.source_ref,
        jdRevisionId: requirement.jd_revision_id,
        requirement,
        match,
        snapshot,
      });
      database.transaction(() => {
        database.prepare(`
          INSERT INTO intelligence_matches (
            match_id, gap_id, jd_revision_id, requirement_id, evidence_snapshot_id,
            input_generation, classification, decision_facts_json,
            evidence_revision_ids_json, missing_dimensions_json, explanation, boundary, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          match.match_id,
          match.gap_id,
          match.jd_revision_id,
          match.requirement_id,
          match.evidence_snapshot_id,
          match.input_generation,
          match.classification,
          canonicalSerialize(match.decision_facts),
          canonicalSerialize(match.evidence_revision_ids),
          canonicalSerialize(match.missing_dimensions),
          serializeMatchExplanation(match),
          match.boundary ?? null,
          new Date().toISOString(),
        );
        persistProvenanceEdges(provenance.provenance_edges, match.input_generation);
      })();
      return match;
    });
  }

  function readMatch(matchId) {
    const row = database.prepare('SELECT * FROM intelligence_matches WHERE match_id = ?').get(matchId);
    if (!row) return null;
    const snapshot = readSnapshot(row.evidence_snapshot_id);
    const requirement = readRequirement(row.requirement_id);
    const storedExplanation = parseMatchExplanation(row.explanation);
    return validateMatchRecord({
      match_id: row.match_id,
      gap_id: row.gap_id,
      jd_revision_id: row.jd_revision_id,
      requirement_id: row.requirement_id,
      evidence_snapshot_id: row.evidence_snapshot_id,
      input_generation: row.input_generation,
      classification: row.classification,
      decision_facts: intelligenceStoredJson(row.decision_facts_json, 'decision_facts_json'),
      evidence_revision_ids: intelligenceStoredJson(row.evidence_revision_ids_json, 'evidence_revision_ids_json'),
      missing_dimensions: intelligenceStoredJson(row.missing_dimensions_json, 'missing_dimensions_json'),
      explanation: storedExplanation.explanation,
      explanation_details: storedExplanation.explanation_details,
      ...(row.boundary ? { boundary: row.boundary } : {}),
    }, snapshot, requirement);
  }

  function readMatchOrGap(relationId) {
    return readMatch(relationId) || (() => {
      const row = database.prepare('SELECT match_id FROM intelligence_matches WHERE gap_id = ?').get(relationId);
      return row ? readMatch(row.match_id) : null;
    })();
  }

  function persistProvenanceEdges(edges, inputGeneration) {
    for (const edge of edges) {
      const edgeWithGeneration = { ...edge, input_generation: inputGeneration };
      database.prepare(`
        INSERT OR IGNORE INTO intelligence_provenance_edges (
          edge_id, edge_type, jd_source_ref_json, jd_revision_id, requirement_id,
          match_id, gap_id, evidence_revision_id, positioning_claim_id,
          positioning_version_id, input_generation
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        intelligenceEdgeId(edgeWithGeneration),
        edge.edge_type,
        edge.jd_source_ref === undefined ? null : canonicalSerialize(edge.jd_source_ref),
        edge.jd_revision_id ?? null,
        edge.requirement_id ?? null,
        edge.match_id ?? null,
        edge.gap_id ?? null,
        edge.evidence_revision_id ?? null,
        edge.positioning_claim_id ?? null,
        edge.positioning_version_id ?? null,
        inputGeneration,
      );
    }
  }

  function savePositioningVersion(input = {}) {
    return run(() => {
      const snapshot = input.evidence_snapshot || input.evidenceSnapshot || input.snapshot
        ? resolveEvidenceSnapshot(input)
        : readSnapshot(resolveAliasedField(input, 'evidence_snapshot_id', 'evidenceSnapshotId', 'evidence_snapshot_id'));
      const opportunityId = input.opportunity_id ?? input.opportunityId;
      const versionNumber = input.version_number ?? input.versionNumber ?? (
        database.prepare('SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM intelligence_positioning_versions WHERE opportunity_id = ?').get(opportunityId).next_version
      );
      const claims = input.claims || [];
      const requirements = [...new Set(claims.map((claim) => resolveAliasedField(claim, 'requirement_id', 'requirementId', 'requirement_id')))]
        .map((id) => readRequirement(id)).filter(Boolean);
      const matchIds = [...new Set(claims.flatMap((claim) => [
        resolveAliasedField(claim, 'match_id', 'matchId', 'match_id'),
        resolveAliasedField(claim, 'gap_id', 'gapId', 'gap_id'),
      ]).filter(Boolean))];
      const matches = matchIds.map((id) => readMatchOrGap(id)).filter(Boolean);
      const version = validatePositioningVersion({
        ...input,
        opportunity_id: opportunityId,
        version_number: versionNumber,
        evidenceSnapshot: snapshot,
        requirements,
        matches,
      });
      if (version.state === 'CONFIRMED') {
        throw new FoundationPersistenceError(
          'INTELLIGENCE_CONFIRMATION_REQUIRED',
          'Positioning versions cannot enter CONFIRMED through candidate persistence; confirmation is an explicit separate action.',
        );
      }
      if (version.state === 'STALE') {
        throw new FoundationPersistenceError('INTELLIGENCE_STALE_POSITIONING', 'Stale positioning is produced by input invalidation, not direct publication.');
      }
      const existing = database.prepare('SELECT positioning_version_id FROM intelligence_positioning_versions WHERE positioning_version_id = ?').get(version.positioning_version_id);
      if (existing) {
        const existingVersion = readPositioningVersion(version.positioning_version_id);
        if (canonicalSerialize(existingVersion) !== canonicalSerialize(version)) {
          throw new FoundationPersistenceError('INTELLIGENCE_IDENTITY_CONFLICT', 'Positioning version identity is already bound to different immutable inputs.');
        }
        return existingVersion;
      }
      const jd = database.prepare('SELECT opportunity_id FROM jd_revisions WHERE jd_revision_id = ?').get(version.jd_revision_id);
      if (!jd || jd.opportunity_id !== version.opportunity_id) throw new FoundationPersistenceError('JD_REVISION_INVALID', 'Positioning JD revision does not belong to its Opportunity.');
      if (!database.prepare('SELECT analysis_id FROM intelligence_input_generations WHERE analysis_id = ?').get(version.analysis_id)) {
        throw new FoundationPersistenceError('INTELLIGENCE_INPUT_NOT_FOUND', 'Positioning analysis input generation does not exist.');
      }
      const analysis = database.prepare(`
        SELECT opportunity_id, jd_revision_id, evidence_snapshot_id, input_generation
          FROM intelligence_input_generations
         WHERE analysis_id = ?
      `).get(version.analysis_id);
      if (
        analysis.opportunity_id !== version.opportunity_id
        || analysis.jd_revision_id !== version.jd_revision_id
        || analysis.evidence_snapshot_id !== version.evidence_snapshot_id
        || analysis.input_generation !== version.input_generation
      ) {
        throw new FoundationPersistenceError('INTELLIGENCE_PROVENANCE_INVALID', 'Positioning version does not resolve to its immutable input generation.');
      }
      database.transaction(() => {
        database.prepare(`
          INSERT INTO intelligence_positioning_versions (
            positioning_version_id, opportunity_id, jd_revision_id, analysis_id,
            evidence_snapshot_id, input_generation, version_number, state,
            claims_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          version.positioning_version_id,
          version.opportunity_id,
          version.jd_revision_id,
          version.analysis_id,
          version.evidence_snapshot_id,
          version.input_generation,
          version.version_number,
          version.state,
          canonicalSerialize(version.claims),
          new Date().toISOString(),
        );
        for (const claim of version.claims) {
          database.prepare(`
            INSERT INTO intelligence_positioning_claims (
              positioning_claim_id, positioning_version_id, ordinal, requirement_id,
              match_id, gap_id, evidence_revision_ids_json, claim_kind, claim_text, verified
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            claim.positioning_claim_id,
            version.positioning_version_id,
            claim.ordinal,
            claim.requirement_id,
            claim.match_id,
            claim.gap_id,
            canonicalSerialize(claim.evidence_revision_ids),
            claim.claim_kind,
            claim.claim_text,
            claim.verified ? 1 : 0,
          );
          persistProvenanceEdges([
            { edge_type: 'CLAIM_TO_REQUIREMENT', requirement_id: claim.requirement_id, positioning_claim_id: claim.positioning_claim_id, positioning_version_id: version.positioning_version_id },
            ...(claim.match_id ? [{ edge_type: 'CLAIM_TO_MATCH', match_id: claim.match_id, positioning_claim_id: claim.positioning_claim_id, positioning_version_id: version.positioning_version_id }] : []),
            ...(claim.gap_id ? [{ edge_type: 'CLAIM_TO_GAP', gap_id: claim.gap_id, positioning_claim_id: claim.positioning_claim_id, positioning_version_id: version.positioning_version_id }] : []),
            ...claim.evidence_revision_ids.map((evidenceRevisionId) => ({ edge_type: 'CLAIM_TO_EVIDENCE', evidence_revision_id: evidenceRevisionId, positioning_claim_id: claim.positioning_claim_id, positioning_version_id: version.positioning_version_id })),
            { edge_type: 'CLAIM_TO_VERSION', positioning_claim_id: claim.positioning_claim_id, positioning_version_id: version.positioning_version_id },
          ], version.input_generation);
        }
      })();
      return version;
    });
  }

  function readPositioningVersion(positioningVersionId) {
    const row = database.prepare('SELECT * FROM intelligence_positioning_versions WHERE positioning_version_id = ?').get(positioningVersionId);
    if (!row) return null;
    return {
      positioning_version_id: row.positioning_version_id,
      opportunity_id: row.opportunity_id,
      jd_revision_id: row.jd_revision_id,
      analysis_id: row.analysis_id,
      evidence_snapshot_id: row.evidence_snapshot_id,
      input_generation: row.input_generation,
      version_number: row.version_number,
      state: row.state,
      claims: intelligenceStoredJson(row.claims_json, 'claims_json'),
    };
  }

  function confirmPositioningVersion(positioningVersionId, confirmedAt) {
    return run(() => {
      const id = normalizeRequiredText(positioningVersionId, 'positioningVersionId', 'INTELLIGENCE_POSITIONING_NOT_FOUND');
      const row = database.prepare('SELECT * FROM intelligence_positioning_versions WHERE positioning_version_id = ?').get(id);
      if (!row) throw new FoundationPersistenceError('INTELLIGENCE_POSITIONING_NOT_FOUND', 'Positioning version does not exist.');
      if (row.state !== 'CANDIDATE') {
        throw new FoundationPersistenceError('INTELLIGENCE_CONFIRMATION_REQUIRED', 'Only a CANDIDATE positioning version can be explicitly confirmed.');
      }
      const opportunity = database.prepare('SELECT current_jd_revision_id FROM opportunities WHERE opportunity_id = ?').get(row.opportunity_id);
      const snapshot = readSnapshot(row.evidence_snapshot_id);
      const evidence = database.prepare('SELECT current_revision_id FROM evidence_records WHERE evidence_id = ?').get(snapshot.evidence_id);
      if (!opportunity || opportunity.current_jd_revision_id !== row.jd_revision_id
        || (evidence?.current_revision_id && !snapshot.evidence_revision_ids.includes(evidence.current_revision_id))) {
        database.transaction(() => {
          database.prepare("UPDATE intelligence_positioning_versions SET state = 'STALE' WHERE positioning_version_id = ? AND state = 'CANDIDATE'").run(id);
          database.prepare('DELETE FROM intelligence_positioning_current WHERE positioning_version_id = ?').run(id);
        })();
        throw new FoundationPersistenceError('INTELLIGENCE_STALE_POSITIONING', 'Positioning candidate no longer matches the current input generation.');
      }
      const timestamp = normalizeTimestamp(confirmedAt, 'confirmedAt', 'INTELLIGENCE_POSITIONING_INVALID');
      database.transaction(() => {
        database.prepare(`
          UPDATE intelligence_positioning_versions
             SET state = 'STALE'
           WHERE opportunity_id = ? AND state = 'CONFIRMED' AND positioning_version_id <> ?
        `).run(row.opportunity_id, id);
        database.prepare('DELETE FROM intelligence_positioning_current WHERE opportunity_id = ?').run(row.opportunity_id);
        database.prepare("UPDATE intelligence_positioning_versions SET state = 'CONFIRMED' WHERE positioning_version_id = ? AND state = 'CANDIDATE'").run(id);
        database.prepare(`
          INSERT INTO intelligence_positioning_current (opportunity_id, positioning_version_id, input_generation, updated_at)
          VALUES (?, ?, ?, ?)
        `).run(row.opportunity_id, id, row.input_generation, timestamp);
      })();
      return readPositioningVersion(id);
    });
  }

  function getCurrentPositioning(opportunityId) {
    return run(() => {
      const id = normalizeRequiredText(opportunityId, 'opportunityId', 'OPPORTUNITY_NOT_FOUND');
      const pointer = database.prepare('SELECT positioning_version_id FROM intelligence_positioning_current WHERE opportunity_id = ?').get(id);
      return pointer ? { ...readPositioningVersion(pointer.positioning_version_id), is_current: true } : null;
    });
  }

  function listPositioningVersions(opportunityId) {
    return run(() => {
      const id = normalizeRequiredText(opportunityId, 'opportunityId', 'OPPORTUNITY_NOT_FOUND');
      return database.prepare(
        'SELECT positioning_version_id FROM intelligence_positioning_versions WHERE opportunity_id = ? ORDER BY version_number ASC',
      ).all(id).map((row) => ({
        ...readPositioningVersion(row.positioning_version_id),
        is_current: Boolean(database.prepare(
          'SELECT 1 FROM intelligence_positioning_current WHERE positioning_version_id = ?',
        ).get(row.positioning_version_id)),
      }));
    });
  }

  function loadContext(input = {}) {
    return run(() => {
      const opportunityId = normalizeRequiredText(input.opportunityId ?? input.opportunity_id, 'opportunityId', 'OPPORTUNITY_NOT_FOUND');
      const opportunityRow = database.prepare('SELECT * FROM opportunities WHERE opportunity_id = ?').get(opportunityId);
      if (!opportunityRow) throw new FoundationPersistenceError('OPPORTUNITY_NOT_FOUND', 'Opportunity does not exist.');
      const jdRevisionId = normalizeRequiredText(
        input.jdRevisionId ?? input.jd_revision_id ?? opportunityRow.current_jd_revision_id,
        'jdRevisionId',
        'JD_REVISION_INVALID',
      );
      const jd = database.prepare('SELECT * FROM jd_revisions WHERE opportunity_id = ? AND jd_revision_id = ?').get(opportunityId, jdRevisionId);
      if (!jd || jd.availability_status !== 'AVAILABLE') throw new FoundationPersistenceError('INTELLIGENCE_UNAVAILABLE', 'Selected JD revision is unavailable.');
      const evidenceRevisionIds = input.evidenceRevisionIds ?? input.evidence_revision_ids;
      const snapshot = evidenceRevisionIds === undefined
        ? null
        : resolveEvidenceSnapshot({
          evidenceRevisionIds,
          inputGeneration: input.inputGeneration ?? input.input_generation ?? `context:${jdRevisionId}`,
          evidenceId: input.evidenceId ?? input.evidence_id,
        });
      const current = database.prepare(`
        SELECT e.*
          FROM intelligence_executions e
         WHERE e.opportunity_id = ? AND e.jd_revision_id = ? AND e.is_current = 1
         ORDER BY e.updated_at DESC LIMIT 1
      `).get(opportunityId, jdRevisionId);
      const currentPositioning = getCurrentPositioning(opportunityId);
      return Object.freeze({
        opportunity: {
          opportunityId: opportunityRow.opportunity_id,
          companyName: opportunityRow.company_name,
          roleTitle: opportunityRow.role_title,
          sourceRef: opportunityRow.source_ref,
          currentJdRevisionId: opportunityRow.current_jd_revision_id,
        },
        jdRevision: {
          jdRevisionId: jd.jd_revision_id,
          opportunityId: jd.opportunity_id,
          revisionNumber: jd.revision_number,
          sourceRef: jd.source_ref,
          availabilityStatus: jd.availability_status,
        },
        evidenceSnapshot: snapshot,
        currentExecution: current ? readExecutionRow(current.execution_id) : null,
        currentPositioning: currentPositioning?.jd_revision_id === jdRevisionId ? currentPositioning : null,
      });
    });
  }

  async function startExecution(input = {}) {
    const bundle = createInputGeneration(input);
    return executionService.execute({
      ...input,
      analysis_id: bundle.analysis_id,
      execution_id: bundle.execution_id,
      idempotency_key: bundle.idempotency_key,
      operation_type: bundle.operation_type,
      schema_version: bundle.schema_version,
      opportunity_id: bundle.opportunity_id,
      jd_revision_id: bundle.jd_revision_id,
      evidence_snapshot_id: bundle.evidence_snapshot_id,
      evidence_revision_ids: bundle.evidence_revision_ids,
      input_generation: bundle.input_generation,
      requested_at: bundle.requested_at,
      disclosure_classification: bundle.disclosure_classification,
    });
  }

  return Object.freeze({
    buildEvidenceSnapshot: buildSnapshot,
    createInputGeneration,
    getInputGeneration,
    saveRequirement,
    getRequirement: (requirementId) => run(() => readRequirement(requirementId)),
    classifyMatch: (input) => run(() => classifyMatch(input)),
    saveMatch,
    getMatch: (matchId) => run(() => readMatch(matchId)),
    validateTraceability: (input) => run(() => validateTraceability({
      ...input,
      snapshot: resolveEvidenceSnapshot({
        ...input,
        evidenceSnapshot: input?.snapshot ?? input?.evidence_snapshot ?? input?.evidenceSnapshot,
      }),
    })),
    validatePositioningClaimEdges: (input) => run(() => validatePositioningClaimEdges({
      ...input,
      evidenceSnapshot: resolveEvidenceSnapshot(input),
    })),
    savePositioningVersion,
    getPositioningVersion: (positioningVersionId) => run(() => readPositioningVersion(positioningVersionId)),
    confirmPositioningVersion,
    getCurrentPositioning,
    listPositioningVersions,
    loadContext,
    startExecution,
    buildExecutionRequest: executionService.buildRequest,
    execute: executionService.execute,
    cancelExecution: executionService.cancel,
    completeExecution: executionService.complete,
    getExecution: executionService.get,
    projectSurfaceState: executionService.projectSurfaceState,
    executionConstants: executionService.constants,
    constants: Object.freeze({
      claimKinds: CLAIM_KINDS,
      explicitness: EXPLICITNESS,
      extractionStatuses: EXTRACTION_STATUSES,
      matchClassifications: MATCH_CLASSIFICATIONS,
      operationTypes: OPERATION_TYPES,
      positioningStates: POSITIONING_STATES,
      priorities: PRIORITIES,
      requirementTypes: REQUIREMENT_TYPES,
    }),
  });
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
    migrateIntelligenceSchema(store.database, { ...options, privateRoot });
    assertMigrationOwnership(privateRoot, options.ownership, options);
    const intelligence = createIntelligenceOperations(
      store.database,
      privateRoot,
      options.ownership,
      options,
      () => closed,
    );
    const backup = createBackupOperations({
      database: store.database,
      privateRoot,
      ownership: options.ownership,
      repositoryRoot: options.repositoryRoot,
      isClosed: () => closed,
    });
    const result = {
      metadata: {
        ...store.metadata,
        opportunityEvidenceSchemaVersion: OPPORTUNITY_EVIDENCE_SCHEMA_VERSION,
        intelligenceSchemaVersion: INTELLIGENCE_SCHEMA_VERSION,
      },
      ...operations,
      close() {
        if (closed) return;
        closed = true;
        store.close();
      },
    };
    Object.defineProperty(result, 'intelligence', {
      value: intelligence,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(result, 'backup', {
      value: backup,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    return result;
  } catch (error) {
    if (
      options.allowDegradedOnMigrationFailure
      && typeof error?.code === 'string'
      && (error.code.startsWith('OPPORTUNITY_EVIDENCE_') || error.code.startsWith('INTELLIGENCE_'))
    ) {
      let substrateOperations;
      try {
        substrateOperations = createDomainOperations(
          store.database,
          privateRoot,
          options.ownership,
          options,
          () => closed,
        );
      } catch {
        substrateOperations = {};
      }
      return {
        metadata: {
          ...store.metadata,
          opportunityEvidenceSchemaVersion: error.code.startsWith('OPPORTUNITY_EVIDENCE_')
            ? null
            : OPPORTUNITY_EVIDENCE_SCHEMA_VERSION,
          intelligenceSchemaVersion: error.code.startsWith('INTELLIGENCE_') ? null : undefined,
        },
        ...(error.code.startsWith('INTELLIGENCE_') ? substrateOperations : {}),
        ...(error.code.startsWith('OPPORTUNITY_EVIDENCE_') ? {
          substrateStatus: {
            phase: 'unavailable',
            code: error.code,
            message: error.message,
          },
        } : {
          intelligenceStatus: {
            phase: 'unavailable',
            code: error.code,
            message: error.message,
          },
        }),
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
  INTELLIGENCE_SCHEMA_VERSION,
  initializeFoundationStore,
  initializeOpportunityEvidenceStore,
  OPPORTUNITY_EVIDENCE_SCHEMA_VERSION,
};
