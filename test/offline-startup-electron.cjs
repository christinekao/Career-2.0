const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const electron = require('electron');
const { app } = electron;
const intelligence = require('../src/main/intelligence.cjs');

const {
  foundationDatabasePath,
  validatePrivateRoot,
} = require('../src/main/private-root.cjs');
const { acquireRootOwnership } = require('../src/main/ownership.cjs');
const Database = require('better-sqlite3');

const repositoryRoot = path.resolve(__dirname, '..');
const expectedPreloadPath = path.join(repositoryRoot, 'src', 'preload', 'index.cjs');
const mainSource = fs.readFileSync(path.join(repositoryRoot, 'src', 'main', 'index.cjs'), 'utf8');
const preloadSource = fs.readFileSync(expectedPreloadPath, 'utf8');
const expectedPreloadSourceHash = crypto.createHash('sha256').update(preloadSource, 'utf8').digest('hex');
const mainPath = path.join(repositoryRoot, 'src', 'main', 'index.cjs');
const foundationPath = path.join(repositoryRoot, 'src', 'main', 'foundation.cjs');
const visibleObservationWindowMs = 8000;
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'career-2-electron-startup-'));
const privateRootPath = path.join(temporaryRoot, 'private-root');
const userDataPath = path.join(temporaryRoot, 'user-data');
fs.mkdirSync(privateRootPath);
fs.mkdirSync(userDataPath);
app.setPath('userData', userDataPath);
process.env.CAREER_PRIVATE_ROOT = privateRootPath;

const privateRoot = validatePrivateRoot(privateRootPath, { repositoryRoot });
const configPath = path.join(userDataPath, 'config.json');
const repositoryStatePath = path.join(repositoryRoot, '.career2');
const repositoryStateExisted = fs.existsSync(repositoryStatePath);
const remoteRequests = [];
let failed = false;
let cleaned = false;

function syntheticResponse(request) {
  const evidence = request.payload.evidence.map((item) => ({
    evidence_revision_id: item.evidence_revision_id,
    evidence_id: item.evidence_id,
    factual_content: item.factual_content,
    responsibility_boundary: item.responsibility_boundary,
    outcome: item.outcome,
    confirmation_state: 'CONFIRMED',
    provenance: item.provenance,
  }));
  const snapshot = intelligence.buildEvidenceSnapshot({
    evidenceRevisionIds: evidence.map((item) => item.evidence_revision_id),
    evidenceRevisions: evidence,
    expectedEvidenceId: evidence[0].evidence_id,
    inputGeneration: request.input_generation,
  });
  const requirement = intelligence.validateRequirement({
    jdRevisionId: request.jd_revision_id,
    sourceRef: 'jd:line:1',
    normalizedContent: 'Build reliable local systems.',
    requirementType: 'RESPONSIBILITY',
    priority: 'HIGH',
    explicitness: 'EXPLICIT',
    extractionStatus: 'EXTRACTED',
    uncertainty: { signal_type: 'EXTRACTION_UNCERTAINTY', value: 0, basis: 'RULE' },
  });
  const match = intelligence.classifyMatch({
    requirement,
    evidenceSnapshot: snapshot,
    evaluation: {
      completeSupport: true,
      evidenceComplete: true,
      supportedEvidenceRevisionIds: [evidence[0].evidence_revision_id],
      missingDimensions: [],
      explanation: 'Synthetic Evidence covers the requested work. Scope: The evaluated material dimensions are covered.',
      explanation_details: {
        support_summary: 'Synthetic Evidence covers the requested work.',
        scope_summary: 'The evaluated material dimensions are covered.',
      },
    },
  });
  const positioning = intelligence.validatePositioningVersion({
    positioningVersionId: intelligence.buildPositioningVersionId({ opportunityId: request.opportunity_id, versionNumber: 1 }),
    opportunityId: request.opportunity_id,
    jdRevisionId: request.jd_revision_id,
    analysisId: `analysis:${request.opportunity_id}:${request.jd_revision_id}:${request.input_generation}`,
    evidenceSnapshotId: request.evidence_snapshot_id,
    inputGeneration: request.input_generation,
    evidenceSnapshot: snapshot,
    versionNumber: 1,
    state: 'CANDIDATE',
    requirements: [requirement],
    matches: [match],
    claims: [{
      requirementId: requirement.requirement_id,
      matchId: match.match_id,
      evidenceRevisionIds: match.evidence_revision_ids,
      claimKind: 'SUPPORTED',
      claimText: 'Show reliable local system ownership.',
    }],
  });
  return {
    execution_id: request.execution_id,
    idempotency_key: request.idempotency_key,
    operation_type: request.operation_type,
    schema_version: request.schema_version,
    opportunity_id: request.opportunity_id,
    jd_revision_id: request.jd_revision_id,
    evidence_snapshot_id: request.evidence_snapshot_id,
    input_generation: request.input_generation,
    result_status: 'SUCCEEDED',
    validation_status: 'VALID',
    payload: { requirements: [requirement], matches: [match], positioning },
  };
}

const originalFoundation = require(foundationPath);
const injectedFoundation = {
  ...originalFoundation,
  bootstrapFoundation(args) {
    return originalFoundation.bootstrapFoundation({
      ...args,
      persistenceOptions: { executor: { execute: async (request) => syntheticResponse(request) } },
    });
  },
};
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (parent?.filename === mainPath && request === './foundation.cjs') return injectedFoundation;
  return originalLoad.call(this, request, parent, isMain);
};

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

function windowState(window) {
  if (window.isDestroyed()) {
    return { isDestroyed: true, isVisible: false, isMinimized: false, bounds: null };
  }

  return {
    isDestroyed: false,
    isVisible: window.isVisible(),
    isMinimized: window.isMinimized(),
    bounds: window.getBounds(),
  };
}

function fail(error) {
  if (failed) return;
  failed = true;
  clearTimeout(startupTimeout);
  console.error(error.stack || error);
  process.exitCode = 1;
  app.quit();
}

const startupTimeout = setTimeout(() => {
  fail(new Error('Career 2.0 Electron startup did not reach renderer load within 15 seconds.'));
}, 15000);

app.on('browser-window-created', (_event, window) => {
  let readyToShowSnapshot;
  const readyToShowPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Career 2.0 BrowserWindow did not emit ready-to-show.'));
    }, 5000);

    window.once('ready-to-show', () => {
      clearTimeout(timeout);
      readyToShowSnapshot = windowState(window);
      console.log(`Career 2.0 BrowserWindow ready-to-show: ${JSON.stringify(readyToShowSnapshot)}`);
      resolve();
    });
  });

  window.webContents.session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      remoteRequests.push(details.url);
      callback({ cancel: true });
    },
  );

  window.webContents.once('did-finish-load', async () => {
    try {
      const renderer = await window.webContents.executeJavaScript(`(async () => {
        const capability = window.careerFoundation;
        const opportunity = capability
          ? await capability.opportunity.create({
            companyName: 'Synthetic Systems',
            roleTitle: 'Platform Engineer',
            sourceRef: 'https://example.test/opportunity/synthetic',
            createdAt: '2026-09-17T03:00:00.000Z',
          })
          : null;
        const jdRevision = opportunity
          ? await capability.opportunity.addJdRevision(opportunity.opportunityId, {
            content: 'Build reliable local systems for synthetic users.',
            sourceRef: 'paste://synthetic-jd',
            capturedAt: '2026-09-17T03:01:00.000Z',
          })
          : null;
        const evidence = capability
          ? await capability.evidence.create({
            factualContent: 'Reduced synthetic queue latency.',
            responsibilityBoundary: 'Owned the synthetic queue consumer and rollout.',
            outcome: 'Synthetic latency decreased.',
            provenance: { kind: 'user_note', reference: 'synthetic-evidence' },
            createdAt: '2026-09-17T03:02:00.000Z',
          })
          : null;
        const confirmedEvidence = evidence
          ? await capability.evidence.confirmRevision(
            evidence.evidenceId,
            evidence.revisions[0].evidenceRevisionId,
            '2026-09-17T03:03:00.000Z',
          )
          : null;
        const readBack = opportunity && evidence
          ? {
            opportunity: await capability.opportunity.get(opportunity.opportunityId),
            evidence: await capability.evidence.get(evidence.evidenceId),
          }
          : null;
        const intelligenceContext = confirmedEvidence
          ? await capability.intelligence.loadContext({
            opportunityId: opportunity.opportunityId,
            jdRevisionId: jdRevision.jdRevisionId,
            evidenceRevisionIds: [confirmedEvidence.currentRevisionId],
            inputGeneration: 'electron-context-generation',
          })
          : null;
        const execution = confirmedEvidence
          ? await capability.intelligence.startExecution({
            opportunityId: opportunity.opportunityId,
            jdRevisionId: jdRevision.jdRevisionId,
            evidenceRevisionIds: [confirmedEvidence.currentRevisionId],
            inputGeneration: 'electron-execution-generation',
            operationType: 'ANALYZE_REQUIREMENTS',
            executionId: 'electron-execution',
            idempotencyKey: 'electron-idempotency',
            disclosureClassification: 'LOCAL_SYNTHETIC',
          })
          : null;
        const candidate = execution?.result_payload?.positioning
          ? await capability.intelligence.getPositioning(execution.result_payload.positioning.positioning_version_id)
          : null;
        const confirmedPositioning = candidate
          ? await capability.intelligence.confirmPositioning(candidate.positioning_version_id, '2026-09-17T03:04:00.000Z')
          : null;
        const currentPositioning = confirmedPositioning
          ? await capability.intelligence.getCurrentPositioning(opportunity.opportunityId)
          : null;
        return {
          url: location.href,
          status: capability ? await capability.getStatus() : null,
          capabilityKeys: capability ? Object.keys(capability).sort() : [],
          requireType: typeof window.require,
          processType: typeof window.process,
          fsType: typeof window.fs,
          databaseType: typeof window.database,
          opportunity,
          jdRevision,
          evidence,
          confirmedEvidence,
          readBack,
          intelligenceContext,
          execution,
          candidate,
          confirmedPositioning,
          currentPositioning,
          rootText: document.querySelector('#root')?.textContent || '',
          assetUrls: Array.from(document.querySelectorAll('script[src],link[href]'))
            .map((element) => element.src || element.href),
        };
      })()`);

      assert.equal(renderer.url.startsWith('file://'), true);
      assert.equal(renderer.status?.phase, 'ready');
      assert.equal(renderer.status?.storeVersion, 1);
      assert.equal(renderer.status?.opportunityEvidenceSchemaVersion, 1);
      assert.deepEqual(renderer.capabilityKeys, ['evidence', 'getStatus', 'intelligence', 'opportunity']);
      assert.equal(renderer.requireType, 'undefined');
      assert.equal(renderer.processType, 'undefined');
      assert.equal(renderer.fsType, 'undefined');
      assert.equal(renderer.databaseType, 'undefined');
      assert.equal(renderer.opportunity.companyName, 'Synthetic Systems');
      assert.equal(renderer.jdRevision.availabilityStatus, 'AVAILABLE');
      assert.equal(renderer.jdRevision.revisionNumber, 1);
      assert.equal(renderer.readBack.opportunity.currentJdRevisionId, renderer.jdRevision.jdRevisionId);
      assert.equal(renderer.evidence.currentRevisionId, null);
      assert.equal(renderer.evidence.revisions[0].confirmationState, 'DRAFT');
      assert.equal(renderer.confirmedEvidence.currentRevision.confirmationState, 'CONFIRMED');
      assert.notEqual(renderer.confirmedEvidence.currentRevisionId, renderer.evidence.revisions[0].evidenceRevisionId);
      assert.equal(renderer.readBack.opportunity.currentJdRevisionId, renderer.jdRevision.jdRevisionId);
      assert.equal(renderer.readBack.evidence.currentRevisionId, renderer.confirmedEvidence.currentRevisionId);
      assert.deepEqual(renderer.readBack.evidence.currentRevision.provenance, {
        kind: 'user_note',
        reference: 'synthetic-evidence',
      });
      assert.equal(renderer.intelligenceContext.opportunity.opportunityId, renderer.opportunity.opportunityId);
      assert.equal(renderer.intelligenceContext.jdRevision.jdRevisionId, renderer.jdRevision.jdRevisionId);
      assert.deepEqual(renderer.intelligenceContext.evidenceSnapshot.evidence_revision_ids, [renderer.confirmedEvidence.currentRevisionId]);
      assert.equal(renderer.execution.execution_state, 'COMPLETED');
      assert.equal(renderer.candidate.state, 'CANDIDATE');
      assert.equal(renderer.confirmedPositioning.state, 'CONFIRMED');
      assert.equal(renderer.currentPositioning.positioning_version_id, renderer.confirmedPositioning.positioning_version_id);
      assert.match(renderer.rootText, /Opportunity intelligence/);
      assert.ok(renderer.assetUrls.length > 0);
      assert.ok(renderer.assetUrls.every((assetUrl) => new URL(assetUrl).protocol === 'file:'));
      assert.deepEqual(remoteRequests, []);

      assert.equal(fs.realpathSync.native(expectedPreloadPath), expectedPreloadPath);
      assert.match(
        mainSource,
        /preload:\s*path\.join\(__dirname,\s*'\.\.',\s*'preload',\s*'index\.cjs'\)/,
      );
      assert.match(mainSource, /contextIsolation:\s*true/);
      assert.match(mainSource, /nodeIntegration:\s*false/);
      assert.match(preloadSource, /contextBridge\.exposeInMainWorld\('careerFoundation'/);
      assert.match(preloadSource, /ipcRenderer\.invoke\('evidence:confirm-revision'/);
      console.log(`Career 2.0 preload identity passed: ${JSON.stringify({ path: expectedPreloadPath, sourceSha256: expectedPreloadSourceHash, ipcHandshake: true })}`);
      assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), { privateRoot: privateRoot.canonicalPath });

      const databasePath = foundationDatabasePath(privateRoot);
      assert.equal(fs.realpathSync.native(databasePath), databasePath);
      const database = new Database(databasePath, { readonly: true });
      const metadata = new Map(database.prepare('SELECT key, value FROM foundation_metadata').all().map((row) => [row.key, row.value]));
      assert.equal(metadata.get('root_binding'), privateRoot.rootBinding);
      assert.equal(metadata.get('store_version'), '1');
      assert.equal(metadata.get('initialization_state'), 'READY');
      assert.equal(metadata.get('store_identity'), renderer.status.storeIdentity);
      assert.equal(metadata.get('opportunity_evidence_schema_version'), '1');
      assert.deepEqual(
        database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").pluck().all(),
        [
          'evidence_records', 'evidence_revisions', 'foundation_metadata',
          'intelligence_evidence_snapshots', 'intelligence_executions', 'intelligence_input_generations',
          'intelligence_matches', 'intelligence_positioning_claims', 'intelligence_positioning_current',
          'intelligence_positioning_versions', 'intelligence_provenance_edges', 'intelligence_requirements',
          'jd_revisions', 'opportunities',
        ],
      );
      database.close();
      assert.equal(fs.existsSync(repositoryStatePath), repositoryStateExisted);

      await readyToShowPromise;
      assert.deepEqual(readyToShowSnapshot.isDestroyed, false);
      assert.equal(readyToShowSnapshot.isVisible, true);
      assert.equal(readyToShowSnapshot.isMinimized, false);
      assert.ok(readyToShowSnapshot.bounds.width > 0);
      assert.ok(readyToShowSnapshot.bounds.height > 0);

      const visibleState = windowState(window);
      assert.deepEqual(visibleState, readyToShowSnapshot);
      console.log(`Career 2.0 visible GUI observation window open: ${JSON.stringify({ pid: process.pid, visibleState, durationMs: visibleObservationWindowMs })}`);
      await new Promise((resolve) => setTimeout(resolve, visibleObservationWindowMs));
      assert.deepEqual(windowState(window), readyToShowSnapshot);

      console.log('Career 2.0 Electron startup acceptance passed: main, visible BrowserWindow, local renderer, preload, synthetic private root, READY store v1.');
      clearTimeout(startupTimeout);
      app.quit();
    } catch (error) {
      fail(error);
    }
  });
});

app.on('will-quit', () => {
  clearTimeout(startupTimeout);
  let releaseProbe;
  try {
    releaseProbe = acquireRootOwnership(privateRoot, { repositoryRoot });
    releaseProbe.assertActive();
    assert.equal(fs.existsSync(repositoryStatePath), repositoryStateExisted, 'Career 2.0 created or removed repository-local state.');
    if (!failed) console.log('Career 2.0 Electron clean exit passed: synthetic writer ownership was reacquired after shutdown.');
  } catch (error) {
    failed = true;
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    releaseProbe?.release();
    cleanup();
  }
});

process.on('exit', cleanup);

require(path.join(repositoryRoot, 'src', 'main', 'index.cjs'));
