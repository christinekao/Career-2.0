const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const Database = require('better-sqlite3');
const {
  DEFAULT_REPOSITORY_ROOT,
  assertPrivateRootStable,
  foundationDatabasePath,
  foundationLockPath,
  foundationLockRecoveryPath,
  foundationStateDirectory,
  validatePrivateRoot,
} = require('../src/main/private-root.cjs');
const {
  configuredRoot,
  readRuntimeConfig,
  writeRuntimeConfig,
} = require('../src/main/runtime-config.cjs');
const { acquireRootOwnership } = require('../src/main/ownership.cjs');
const {
  FOUNDATION_STORE_VERSION,
  initializeFoundationStore,
  initializeOpportunityEvidenceStore,
  OPPORTUNITY_EVIDENCE_SCHEMA_VERSION,
} = require('../src/main/persistence.cjs');
const { bootstrapFoundation, runtimeConfigPath } = require('../src/main/foundation.cjs');

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'career-2-foundation-'));
}

function removeRoot(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function validPrivateRoot(root) {
  return validatePrivateRoot(root, { repositoryRoot: DEFAULT_REPOSITORY_ROOT });
}

function unusedPid() {
  for (let pid = process.pid + 10000; pid < 2147483647; pid += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return pid;
    }
  }
  throw new Error('Could not find an unused process id for the synthetic stale-owner fixture.');
}

function spawnRecoveryContender(root, repositoryRoot, paths, holdRecoveryClaim, forcedPlatform, claimBehavior) {
  const source = `
    const fs = require('node:fs');
    const path = require('node:path');
    const [rootPath, repoPath, privateRootModulePath, ownershipModulePath, persistenceModulePath, startPath, continuePath, releasePath, holdClaim, platformOverride, recoveryClaimBehavior] = process.argv.slice(1);
    const originalPlatform = process.platform;
    if (platformOverride) Object.defineProperty(process, 'platform', { value: platformOverride });
    const { validatePrivateRoot } = require(privateRootModulePath);
    const privateRoot = validatePrivateRoot(rootPath, { repositoryRoot: repoPath });
    const lockPath = path.join(privateRoot.canonicalPath, '.career2', 'foundation.lock');
    const recoveryPath = path.join(privateRoot.canonicalPath, '.career2', 'foundation.lock.recovery');
    const waitCell = new Int32Array(new SharedArrayBuffer(4));
    const waitForFile = (filePath) => { while (!fs.existsSync(filePath)) Atomics.wait(waitCell, 0, 0, 5); };

    if (holdClaim === 'yes') {
      if (process.platform === 'darwin') {
        const originalOpenSync = fs.openSync;
        let paused = false;
        fs.openSync = function (filePath, ...args) {
          const descriptor = originalOpenSync.call(fs, filePath, ...args);
          const flags = typeof args[0] === 'number' ? args[0] : 0;
          if (!paused && path.resolve(filePath) === lockPath && (flags & 0x0020) === 0x0020) {
            paused = true;
            fs.writeSync(1, JSON.stringify({ event: 'claim-held' }) + '\\n');
            waitForFile(continuePath);
          }
          return descriptor;
        };
      } else {
        const originalOpenSync = fs.openSync;
        const originalCloseSync = fs.closeSync;
        let claimDescriptor;
        let paused = false;
        fs.openSync = function (filePath, ...args) {
          const descriptor = originalOpenSync.call(fs, filePath, ...args);
          const flags = typeof args[0] === 'number' ? args[0] : 0;
          if (path.resolve(filePath) === recoveryPath && (flags & fs.constants.O_EXCL) === fs.constants.O_EXCL) {
            claimDescriptor = descriptor;
          }
          return descriptor;
        };
        fs.closeSync = function (descriptor) {
          const result = originalCloseSync.call(fs, descriptor);
          if (!paused && descriptor === claimDescriptor) {
            paused = true;
            fs.writeSync(1, JSON.stringify({ event: 'claim-held' }) + '\\n');
            waitForFile(continuePath);
          }
          return result;
        };
      }
    } else if (recoveryClaimBehavior === 'crash') {
      const originalOpenSync = fs.openSync;
      const originalCloseSync = fs.closeSync;
      let claimDescriptor;
      fs.openSync = function (filePath, ...args) {
        const descriptor = originalOpenSync.call(fs, filePath, ...args);
        const flags = typeof args[0] === 'number' ? args[0] : 0;
        if (path.resolve(filePath) === recoveryPath && (flags & fs.constants.O_EXCL) === fs.constants.O_EXCL) {
          claimDescriptor = descriptor;
        }
        return descriptor;
      };
      fs.closeSync = function (descriptor) {
        const result = originalCloseSync.call(fs, descriptor);
        if (descriptor === claimDescriptor) {
          fs.writeSync(1, JSON.stringify({ event: 'claim-created' }) + '\\n');
          process.exit(23);
        }
        return result;
      };
    }

    fs.writeSync(1, JSON.stringify({ event: 'ready' }) + '\\n');
    waitForFile(startPath);
    const { acquireRootOwnership } = require(ownershipModulePath);
    let ownership;
    let store;
    try {
      ownership = acquireRootOwnership(privateRoot, { repositoryRoot: repoPath });
      if (platformOverride) Object.defineProperty(process, 'platform', { value: originalPlatform });
      const { initializeFoundationStore } = require(persistenceModulePath);
      store = initializeFoundationStore(privateRoot, { repositoryRoot: repoPath, ownership });
      fs.writeSync(1, JSON.stringify({ event: 'result', status: 'success', pid: process.pid, storeIdentity: store.metadata.storeIdentity }) + '\\n');
      waitForFile(releasePath);
      store.close();
      ownership.release();
      fs.writeSync(1, JSON.stringify({ event: 'released' }) + '\\n');
    } catch (error) {
      try {
        store?.close();
      } finally {
        ownership?.release();
      }
      fs.writeSync(1, JSON.stringify({ event: 'result', status: 'error', code: error.code || 'ERROR', message: error.message }) + '\\n');
    }
  `;
  const child = spawn(process.execPath, [
    '-e',
    source,
    root,
    repositoryRoot,
    path.join(DEFAULT_REPOSITORY_ROOT, 'src', 'main', 'private-root.cjs'),
    path.join(DEFAULT_REPOSITORY_ROOT, 'src', 'main', 'ownership.cjs'),
    path.join(DEFAULT_REPOSITORY_ROOT, 'src', 'main', 'persistence.cjs'),
    paths.start,
    paths.continue,
    paths.release,
    holdRecoveryClaim ? 'yes' : 'no',
    forcedPlatform || '',
    claimBehavior || '',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const worker = { child, closePromise: once(child, 'close'), messages: [], stderr: '', pending: '', waiters: [] };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    worker.pending += chunk;
    let newline;
    while ((newline = worker.pending.indexOf('\n')) >= 0) {
      const line = worker.pending.slice(0, newline);
      worker.pending = worker.pending.slice(newline + 1);
      const message = JSON.parse(line);
      worker.messages.push(message);
      for (let index = worker.waiters.length - 1; index >= 0; index -= 1) {
        const waiter = worker.waiters[index];
        if (waiter.predicate(message)) {
          worker.waiters.splice(index, 1);
          clearTimeout(waiter.timeout);
          waiter.resolve(message);
        }
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    worker.stderr += chunk;
  });
  worker.waitFor = (predicate) => {
    const existing = worker.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.waiters = worker.waiters.filter((waiter) => waiter.predicate !== predicate);
        reject(new Error(`Recovery contender timed out: messages=${JSON.stringify(worker.messages)}, stderr=${worker.stderr}`));
      }, 10000);
      worker.waiters.push({ predicate, resolve, reject, timeout });
    });
  };
  return worker;
}

function waitForChildClose(worker) {
  return worker.child.closed ? Promise.resolve() : worker.closePromise;
}

function runDomainProcess(root, repositoryRoot, role, expected) {
  const source = String.raw`
    const assert = require('node:assert/strict');
    const [rootPath, repoPath, privateRootModulePath, ownershipModulePath, persistenceModulePath, roleName, expectedJson] = process.argv.slice(1);
    const { validatePrivateRoot } = require(privateRootModulePath);
    const { acquireRootOwnership } = require(ownershipModulePath);
    const { initializeOpportunityEvidenceStore } = require(persistenceModulePath);

    let ownership;
    let store;
    try {
      const privateRoot = validatePrivateRoot(rootPath, { repositoryRoot: repoPath });
      ownership = acquireRootOwnership(privateRoot, { repositoryRoot: repoPath });
      store = initializeOpportunityEvidenceStore(privateRoot, {
        repositoryRoot: repoPath,
        ownership,
      });

      let output;
      if (roleName === 'write') {
        const opportunity = store.opportunity.create({
          companyName: 'Cross Process Systems',
          roleTitle: 'Persistence Engineer',
          sourceRef: 'https://example.test/opportunity/cross-process',
          createdAt: '2026-09-17T03:00:00.000Z',
        });
        const firstJd = store.opportunity.addJdRevision(opportunity.opportunityId, {
          content: 'Own durable local storage and document recovery behavior.',
          sourceRef: 'paste://cross-process-jd-1',
          capturedAt: '2026-09-17T03:01:00.000Z',
        });
        const secondJd = store.opportunity.addJdRevision(opportunity.opportunityId, {
          content: 'Own durable local storage, document recovery behavior, and validate migrations.',
          sourceRef: 'paste://cross-process-jd-2',
          capturedAt: '2026-09-17T03:02:00.000Z',
        });
        const draft = store.evidence.create({
          factualContent: 'Built a synthetic durable storage workflow.',
          responsibilityBoundary: 'Owned the storage module and recovery tests.',
          outcome: 'Synthetic restart recovery became repeatable.',
          provenance: { kind: 'user_note', reference: 'cross-process-evidence-1' },
          createdAt: '2026-09-17T03:03:00.000Z',
        });
        const firstConfirmed = store.evidence.confirmRevision(
          draft.evidenceId,
          draft.revisions[0].evidenceRevisionId,
          '2026-09-17T03:04:00.000Z',
        );
        const nextDraft = store.evidence.createRevision(draft.evidenceId, {
          factualContent: 'Built a synthetic durable storage workflow and migration checks.',
          responsibilityBoundary: 'Owned storage, recovery tests, and migration checks.',
          outcome: 'Synthetic restart recovery became repeatable and migration-safe.',
          provenance: { kind: 'user_note', reference: 'cross-process-evidence-2' },
          createdAt: '2026-09-17T03:05:00.000Z',
        });
        const finalRecord = store.evidence.confirmRevision(
          draft.evidenceId,
          nextDraft.revisions.at(-1).evidenceRevisionId,
          '2026-09-17T03:06:00.000Z',
        );
        const persistedOpportunity = store.opportunity.get(opportunity.opportunityId);
        output = {
          role: roleName,
          pid: process.pid,
          storeIdentity: store.metadata.storeIdentity,
          storeVersion: store.metadata.storeVersion,
          opportunityEvidenceSchemaVersion: store.metadata.opportunityEvidenceSchemaVersion,
          opportunityId: opportunity.opportunityId,
          jdRevisionIds: persistedOpportunity.jdRevisions.map((revision) => revision.jdRevisionId),
          currentJdRevisionId: persistedOpportunity.currentJdRevisionId,
          jdContents: persistedOpportunity.jdRevisions.map((revision) => revision.content),
          jdSourceRefs: persistedOpportunity.jdRevisions.map((revision) => revision.sourceRef),
          evidenceId: draft.evidenceId,
          evidenceRevisionIds: finalRecord.revisions.map((revision) => revision.evidenceRevisionId),
          evidenceRevisionStates: finalRecord.revisions.map((revision) => revision.confirmationState),
          evidenceContents: finalRecord.revisions.map((revision) => revision.factualContent),
          currentEvidenceRevisionId: finalRecord.currentRevisionId,
          currentEvidenceProvenance: finalRecord.currentRevision.provenance,
          firstConfirmedRevisionId: firstConfirmed.currentRevisionId,
        };
      } else {
        const expectedValue = JSON.parse(expectedJson);
        assert.equal(store.metadata.storeIdentity, expectedValue.storeIdentity);
        assert.equal(store.metadata.storeVersion, 1);
        assert.equal(store.metadata.opportunityEvidenceSchemaVersion, 1);
        const persistedOpportunity = store.opportunity.get(expectedValue.opportunityId);
        assert.equal(persistedOpportunity.opportunityId, expectedValue.opportunityId);
        assert.deepEqual(
          persistedOpportunity.jdRevisions.map((revision) => revision.jdRevisionId),
          expectedValue.jdRevisionIds,
        );
        assert.equal(persistedOpportunity.currentJdRevisionId, expectedValue.currentJdRevisionId);
        assert.deepEqual(
          persistedOpportunity.jdRevisions.map((revision) => revision.content),
          expectedValue.jdContents,
        );
        assert.deepEqual(
          persistedOpportunity.jdRevisions.map((revision) => revision.sourceRef),
          expectedValue.jdSourceRefs,
        );

        const persistedEvidence = store.evidence.get(expectedValue.evidenceId);
        assert.equal(persistedEvidence.evidenceId, expectedValue.evidenceId);
        assert.deepEqual(
          persistedEvidence.revisions.map((revision) => revision.evidenceRevisionId),
          expectedValue.evidenceRevisionIds,
        );
        assert.deepEqual(
          persistedEvidence.revisions.map((revision) => revision.confirmationState),
          ['DRAFT', 'CONFIRMED', 'DRAFT', 'CONFIRMED'],
        );
        assert.deepEqual(
          persistedEvidence.revisions.map((revision) => revision.factualContent),
          expectedValue.evidenceContents,
        );
        assert.equal(persistedEvidence.currentRevisionId, expectedValue.currentEvidenceRevisionId);
        assert.equal(persistedEvidence.currentRevision.confirmationState, 'CONFIRMED');
        assert.deepEqual(persistedEvidence.currentRevision.provenance, expectedValue.currentEvidenceProvenance);
        assert.equal(persistedEvidence.revisions[1].evidenceRevisionId, expectedValue.firstConfirmedRevisionId);
        output = { role: roleName, pid: process.pid, verified: true };
      }

      store.close();
      store = null;
      ownership.release();
      ownership = null;
      process.stdout.write(JSON.stringify(output) + '\n');
    } catch (error) {
      try {
        store?.close();
      } finally {
        ownership?.release();
      }
      process.stderr.write((error.stack || error.message) + '\n');
      process.exitCode = 1;
    }
  `;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '-e',
      source,
      root,
      repositoryRoot,
      path.join(repositoryRoot, 'src', 'main', 'private-root.cjs'),
      path.join(repositoryRoot, 'src', 'main', 'ownership.cjs'),
      path.join(repositoryRoot, 'src', 'main', 'persistence.cjs'),
      role,
      JSON.stringify(expected || null),
    ], { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`Domain child process timed out: role=${role}, stdout=${stdout}, stderr=${stderr}`));
    }, 10000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ pid: child.pid, code, signal, stdout, stderr });
    });
  });
}

test('private-root validation rejects unsafe roots and preserves root identity', (t) => {
  const root = temporaryRoot();
  t.after(() => removeRoot(root));

  const privateRoot = validPrivateRoot(root);
  assert.equal(privateRoot.canonicalPath, fs.realpathSync.native(root));
  assert.match(privateRoot.rootBinding, /^[a-f0-9]{64}$/);
  assert.throws(() => validatePrivateRoot('', { repositoryRoot: DEFAULT_REPOSITORY_ROOT }), { code: 'PRIVATE_ROOT_NOT_CONFIGURED' });
  assert.throws(() => validatePrivateRoot('relative-root', { repositoryRoot: DEFAULT_REPOSITORY_ROOT }), { code: 'PRIVATE_ROOT_NOT_ABSOLUTE' });
  assert.throws(() => validatePrivateRoot(DEFAULT_REPOSITORY_ROOT, { repositoryRoot: DEFAULT_REPOSITORY_ROOT }), { code: 'PRIVATE_ROOT_REPOSITORY_LOCAL' });
  assert.throws(() => validatePrivateRoot(path.join(os.tmpdir(), 'career-2-missing-root'), { repositoryRoot: DEFAULT_REPOSITORY_ROOT }), { code: 'PRIVATE_ROOT_UNAVAILABLE' });

  const filePath = path.join(root, 'not-a-directory');
  fs.writeFileSync(filePath, 'synthetic');
  assert.throws(() => validatePrivateRoot(filePath, { repositoryRoot: DEFAULT_REPOSITORY_ROOT }), { code: 'PRIVATE_ROOT_NOT_DIRECTORY' });

  const unreadableRoot = path.join(root, 'unreadable');
  fs.mkdirSync(unreadableRoot);
  fs.chmodSync(unreadableRoot, 0o000);
  try {
    assert.throws(() => validatePrivateRoot(unreadableRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT }), { code: 'PRIVATE_ROOT_UNREADABLE' });
  } finally {
    fs.chmodSync(unreadableRoot, 0o700);
  }

  assert.doesNotThrow(() => assertPrivateRootStable(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT }));
});

test('foundation initialization rejects a state-directory symlink before writing outside the private root', (t) => {
  const fixture = temporaryRoot();
  t.after(() => removeRoot(fixture));

  const repositoryRoot = path.join(fixture, 'repository');
  const privateRootPath = path.join(fixture, 'private');
  const outsideTarget = path.join(fixture, 'outside');
  fs.mkdirSync(repositoryRoot);
  fs.mkdirSync(privateRootPath);
  fs.mkdirSync(outsideTarget);

  const privateRoot = validatePrivateRoot(privateRootPath, { repositoryRoot });
  fs.symlinkSync(repositoryRoot, foundationStateDirectory(privateRoot), 'dir');
  const unowned = { rootBinding: privateRoot.rootBinding, assertActive() {} };

  assert.throws(
    () => initializeFoundationStore(privateRoot, { repositoryRoot, ownership: unowned }),
    { code: 'PRIVATE_STATE_PATH_UNSAFE' },
  );
  assert.throws(
    () => acquireRootOwnership(privateRoot, { repositoryRoot }),
    { code: 'PRIVATE_STATE_PATH_UNSAFE' },
  );
  assert.deepEqual(fs.readdirSync(repositoryRoot), []);
  assert.deepEqual(fs.readdirSync(outsideTarget), []);
});

test('future hardening: ownership lock creation resists a same-user state-path swap during open', {
  skip: 'M1 excludes adversarial same-OS-user path replacement between validation and the filesystem open syscall.',
}, (t) => {
  const fixture = temporaryRoot();
  t.after(() => removeRoot(fixture));

  const privateRootPath = path.join(fixture, 'private');
  const outsideTarget = path.join(fixture, 'outside');
  fs.mkdirSync(privateRootPath);
  fs.mkdirSync(outsideTarget);
  const privateRoot = validPrivateRoot(privateRootPath);
  const stateDirectory = foundationStateDirectory(privateRoot);
  const movedStateDirectory = path.join(privateRoot.canonicalPath, '.career2-original');
  const lockPath = foundationLockPath(privateRoot);
  fs.mkdirSync(stateDirectory);

  const originalOpenSync = fs.openSync;
  let swapped = false;
  fs.openSync = function (filePath, ...args) {
    if (!swapped && path.resolve(String(filePath)) === lockPath) {
      swapped = true;
      fs.renameSync(stateDirectory, movedStateDirectory);
      fs.symlinkSync(outsideTarget, stateDirectory, 'dir');
    }
    return originalOpenSync.call(this, filePath, ...args);
  };

  try {
    assert.throws(
      () => acquireRootOwnership(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT }),
      { code: 'PRIVATE_STATE_PATH_UNSAFE' },
    );
  } finally {
    fs.openSync = originalOpenSync;
  }

  assert.equal(swapped, true);
  assert.deepEqual(fs.readdirSync(outsideTarget), []);
});

test('foundation lock, database, journal, and hard-linked state files cannot escape the private root', (t) => {
  const root = temporaryRoot();
  const outside = temporaryRoot();
  t.after(() => {
    removeRoot(root);
    removeRoot(outside);
  });

  const privateRoot = validPrivateRoot(root);
  const stateDirectory = foundationStateDirectory(privateRoot);
  fs.mkdirSync(stateDirectory);
  const databasePath = foundationDatabasePath(privateRoot);
  const unowned = { rootBinding: privateRoot.rootBinding, assertActive() {} };

  const outsideDatabase = path.join(outside, 'outside.sqlite');
  fs.symlinkSync(outsideDatabase, databasePath);
  assert.throws(
    () => initializeFoundationStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership: unowned }),
    { code: 'PRIVATE_STATE_PATH_UNSAFE' },
  );
  assert.equal(fs.existsSync(outsideDatabase), false);
  fs.unlinkSync(databasePath);

  const outsideJournal = path.join(outside, 'outside-journal');
  fs.writeFileSync(outsideJournal, 'synthetic-sentinel');
  fs.symlinkSync(outsideJournal, `${databasePath}-journal`);
  assert.throws(
    () => initializeFoundationStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership: unowned }),
    { code: 'PRIVATE_STATE_PATH_UNSAFE' },
  );
  assert.equal(fs.readFileSync(outsideJournal, 'utf8'), 'synthetic-sentinel');
  fs.unlinkSync(`${databasePath}-journal`);

  const outsideHardLink = path.join(outside, 'outside-hardlink.sqlite');
  fs.writeFileSync(outsideHardLink, 'synthetic-hardlink-sentinel');
  fs.linkSync(outsideHardLink, databasePath);
  assert.throws(
    () => initializeFoundationStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership: unowned }),
    { code: 'PRIVATE_STATE_PATH_UNSAFE' },
  );
  assert.equal(fs.readFileSync(outsideHardLink, 'utf8'), 'synthetic-hardlink-sentinel');
  fs.unlinkSync(databasePath);

  const outsideLock = path.join(outside, 'outside-lock');
  fs.writeFileSync(outsideLock, JSON.stringify({ pid: unusedPid(), token: 'synthetic-outside-lock-token' }));
  fs.symlinkSync(outsideLock, foundationLockPath(privateRoot));
  assert.throws(() => acquireRootOwnership(privateRoot), { code: 'PRIVATE_STATE_PATH_UNSAFE' });
  assert.match(fs.readFileSync(outsideLock, 'utf8'), /synthetic-outside-lock-token/);
});

test('Darwin ownership rejects unsafe pre-existing recovery claims before acquiring a lock', {
  skip: process.platform === 'darwin' ? false : 'Darwin-specific ownership path regression.',
}, (t) => {
  const fixture = temporaryRoot();
  const repositoryRoot = path.join(fixture, 'repository');
  const privateRootPath = path.join(fixture, 'private');
  const outsideTarget = path.join(fixture, 'outside');
  t.after(() => removeRoot(fixture));

  fs.mkdirSync(repositoryRoot);
  fs.mkdirSync(privateRootPath);
  fs.mkdirSync(outsideTarget);
  const privateRoot = validatePrivateRoot(privateRootPath, { repositoryRoot });
  const stateDirectory = foundationStateDirectory(privateRoot);
  fs.mkdirSync(stateDirectory);
  const recoveryPath = foundationLockRecoveryPath(privateRoot);

  const outsideSymlinkTarget = path.join(outsideTarget, 'recovery-symlink-target');
  fs.writeFileSync(outsideSymlinkTarget, 'outside-symlink-sentinel');
  fs.symlinkSync(outsideSymlinkTarget, recoveryPath);
  assert.throws(
    () => acquireRootOwnership(privateRoot, { repositoryRoot }),
    { code: 'PRIVATE_STATE_PATH_UNSAFE' },
  );
  assert.equal(fs.readFileSync(outsideSymlinkTarget, 'utf8'), 'outside-symlink-sentinel');
  assert.equal(fs.existsSync(foundationLockPath(privateRoot)), false);
  fs.unlinkSync(recoveryPath);

  const outsideHardLinkTarget = path.join(outsideTarget, 'recovery-hardlink-target');
  fs.writeFileSync(outsideHardLinkTarget, 'outside-hardlink-sentinel');
  fs.linkSync(outsideHardLinkTarget, recoveryPath);
  assert.throws(
    () => acquireRootOwnership(privateRoot, { repositoryRoot }),
    { code: 'PRIVATE_STATE_PATH_UNSAFE' },
  );
  assert.equal(fs.readFileSync(outsideHardLinkTarget, 'utf8'), 'outside-hardlink-sentinel');
  assert.equal(fs.existsSync(foundationLockPath(privateRoot)), false);
});

test('runtime configuration stores only the selected private root', (t) => {
  const root = temporaryRoot();
  const configRoot = temporaryRoot();
  t.after(() => {
    removeRoot(root);
    removeRoot(configRoot);
  });

  const configPath = path.join(configRoot, 'config.json');
  writeRuntimeConfig(configPath, root);
  assert.deepEqual(readRuntimeConfig(configPath), { privateRoot: root });
  assert.deepEqual(Object.keys(readRuntimeConfig(configPath)), ['privateRoot']);
  assert.equal(configuredRoot({ argv: [], env: {}, config: readRuntimeConfig(configPath) }), root);
});

test('application bootstrap reports missing root and starts ready with an explicit root', (t) => {
  const root = temporaryRoot();
  const userData = temporaryRoot();
  t.after(() => {
    removeRoot(root);
    removeRoot(userData);
  });
  const configPath = runtimeConfigPath(userData);

  const missing = bootstrapFoundation({ configPath, argv: [], env: {}, repositoryRoot: DEFAULT_REPOSITORY_ROOT });
  assert.equal(missing.status.phase, 'private-root-required');
  missing.close();

  const ready = bootstrapFoundation({
    configPath,
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });
  assert.equal(ready.status.phase, 'ready');
  assert.equal(ready.status.storeVersion, FOUNDATION_STORE_VERSION);
  assert.equal(ready.status.opportunityEvidenceSchemaVersion, OPPORTUNITY_EVIDENCE_SCHEMA_VERSION);
  assert.equal(typeof ready.opportunity.create, 'function');
  assert.equal(typeof ready.evidence.create, 'function');
  assert.deepEqual(readRuntimeConfig(configPath), { privateRoot: fs.realpathSync.native(root) });
  ready.close();
});

test('renderer-facing foundation error status redacts private root paths', (t) => {
  const fixture = temporaryRoot();
  const userData = temporaryRoot();
  t.after(() => {
    removeRoot(fixture);
    removeRoot(userData);
  });

  const missingPrivateRoot = path.join(fixture, 'private-root', '.career2', 'missing');
  const configPath = runtimeConfigPath(userData);
  const result = bootstrapFoundation({
    configPath,
    argv: [],
    env: { CAREER_PRIVATE_ROOT: missingPrivateRoot },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });
  const payload = JSON.stringify(result.status);

  assert.equal(result.status.phase, 'error');
  assert.equal(result.status.code, 'PRIVATE_ROOT_UNAVAILABLE');
  assert.equal(result.status.message, 'The private root is unavailable.');
  assert.equal(payload.includes(path.resolve(missingPrivateRoot)), false);
  assert.equal(payload.includes(configPath), false);
  assert.equal(payload.includes(os.homedir()), false);
  assert.equal(payload.includes('.career2'), false);
  result.close();
});

test('renderer-facing degraded status redacts SQLite and configuration diagnostics', (t) => {
  const root = temporaryRoot();
  const userData = temporaryRoot();
  t.after(() => {
    removeRoot(root);
    removeRoot(userData);
  });

  const configPath = runtimeConfigPath(userData);
  const privateRoot = validPrivateRoot(root);
  const databasePath = foundationDatabasePath(privateRoot);
  const result = bootstrapFoundation({
    configPath,
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    persistenceOptions: {
      onMigrationCheckpoint() {
        throw new Error(
          `SQLite diagnostic: database=${databasePath}; config=${configPath}; root=${privateRoot.canonicalPath}`,
        );
      },
    },
  });
  const payload = JSON.stringify(result.status);

  assert.equal(result.status.phase, 'ready');
  assert.equal(result.status.foundationPhase, 'ready');
  assert.equal(result.status.opportunityEvidencePhase, 'unavailable');
  assert.equal(result.status.opportunityEvidenceStatus.code, 'OPPORTUNITY_EVIDENCE_MIGRATION_FAILED');
  assert.equal(
    result.status.opportunityEvidenceStatus.message,
    'Opportunity/Evidence substrate migration failed.',
  );
  assert.equal(payload.includes(databasePath), false);
  assert.equal(payload.includes(configPath), false);
  assert.equal(payload.includes(privateRoot.canonicalPath), false);
  assert.equal(payload.includes(path.join(privateRoot.canonicalPath, '.career2')), false);
  assert.equal(payload.includes(os.homedir()), false);
  result.close();
});

test('public error status preserves non-sensitive error classification', (t) => {
  const userData = temporaryRoot();
  t.after(() => removeRoot(userData));

  const result = bootstrapFoundation({
    configPath: runtimeConfigPath(userData),
    argv: [],
    env: { CAREER_PRIVATE_ROOT: DEFAULT_REPOSITORY_ROOT },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });

  assert.equal(result.status.phase, 'error');
  assert.equal(result.status.code, 'PRIVATE_ROOT_REPOSITORY_LOCAL');
  assert.equal(result.status.message, 'The private root cannot be inside the repository.');
  result.close();
});

test('public error boundary leaves ready status contract unchanged', (t) => {
  const root = temporaryRoot();
  const userData = temporaryRoot();
  t.after(() => {
    removeRoot(root);
    removeRoot(userData);
  });

  const result = bootstrapFoundation({
    configPath: runtimeConfigPath(userData),
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });

  assert.equal(result.status.phase, 'ready');
  assert.equal(result.status.foundationPhase, 'ready');
  assert.equal(result.status.opportunityEvidencePhase, 'ready');
  assert.equal(result.status.storeVersion, FOUNDATION_STORE_VERSION);
  assert.equal(result.status.opportunityEvidenceSchemaVersion, OPPORTUNITY_EVIDENCE_SCHEMA_VERSION);
  assert.equal('code' in result.status, false);
  assert.equal('message' in result.status, false);
  assert.equal('opportunityEvidenceStatus' in result.status, false);
  assert.equal(typeof result.opportunity.create, 'function');
  assert.equal(typeof result.evidence.create, 'function');
  result.close();
});

test('built startup path is local-only and loads renderer assets from disk', () => {
  const builtHtmlPath = path.join(DEFAULT_REPOSITORY_ROOT, 'dist', 'index.html');
  const builtHtml = fs.readFileSync(builtHtmlPath, 'utf8');
  assert.doesNotMatch(builtHtml, /https?:\/\//);

  const assetReferences = [...builtHtml.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((reference) => reference.startsWith('./'));
  assert.ok(assetReferences.length > 0);
  for (const reference of assetReferences) {
    assert.equal(fs.existsSync(path.join(path.dirname(builtHtmlPath), reference)), true);
  }

  const mainSource = fs.readFileSync(path.join(DEFAULT_REPOSITORY_ROOT, 'src', 'main', 'index.cjs'), 'utf8');
  assert.match(mainSource, /\.loadFile\(/);
  assert.doesNotMatch(mainSource, /\.loadURL\(/);
});

test('persistence requires ownership and creates one idempotent foundation store', (t) => {
  const root = temporaryRoot();
  t.after(() => removeRoot(root));
  const privateRoot = validPrivateRoot(root);

  assert.throws(() => initializeFoundationStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT }), { code: 'OWNERSHIP_REQUIRED' });
  assert.equal(fs.existsSync(foundationDatabasePath(privateRoot)), false);

  const ownership = acquireRootOwnership(privateRoot);
  const first = initializeFoundationStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership });
  assert.deepEqual(Object.keys(first).sort(), ['close', 'metadata']);
  const firstIdentity = first.metadata.storeIdentity;
  assert.equal(first.metadata.storeVersion, FOUNDATION_STORE_VERSION);
  assert.equal(first.metadata.initializationState, 'READY');
  assert.equal(first.metadata.rootBinding, privateRoot.rootBinding);
  first.close();

  const repeated = initializeFoundationStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership });
  assert.equal(repeated.metadata.storeIdentity, firstIdentity);
  assert.equal(repeated.metadata.storeVersion, FOUNDATION_STORE_VERSION);
  repeated.close();
  ownership.release();

  const reopenedOwnership = acquireRootOwnership(privateRoot);
  const reopened = initializeFoundationStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership: reopenedOwnership });
  assert.equal(reopened.metadata.storeIdentity, firstIdentity);
  reopened.close();
  reopenedOwnership.release();

  const stateEntries = fs.readdirSync(foundationStateDirectory(privateRoot)).filter((entry) => entry.endsWith('.sqlite'));
  assert.deepEqual(stateEntries, ['foundation.sqlite']);
  const database = new Database(foundationDatabasePath(privateRoot), { readonly: true });
  assert.deepEqual(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all(), ['foundation_metadata']);
  database.close();
});

test('minimum Opportunity substrate keeps JD identity, source state, and history across restart', (t) => {
  const root = temporaryRoot();
  t.after(() => removeRoot(root));
  const privateRoot = validPrivateRoot(root);
  let ownership = acquireRootOwnership(privateRoot);
  let store = initializeOpportunityEvidenceStore(privateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership,
  });
  t.after(() => {
    store?.close();
    ownership?.release();
  });

  assert.deepEqual(Object.keys(store).sort(), ['close', 'evidence', 'metadata', 'opportunity']);
  assert.equal('database' in store, false);
  assert.equal('databasePath' in store, false);
  assert.equal(store.metadata.storeVersion, FOUNDATION_STORE_VERSION);
  assert.equal(store.metadata.opportunityEvidenceSchemaVersion, OPPORTUNITY_EVIDENCE_SCHEMA_VERSION);

  const opportunity = store.opportunity.create({
    companyName: 'Synthetic Systems',
    roleTitle: 'Platform Engineer',
    sourceRef: 'https://example.test/opportunity/synthetic',
    createdAt: '2026-09-17T01:00:00.000Z',
  });
  assert.match(opportunity.opportunityId, /^[0-9a-f-]{36}$/);
  assert.equal(opportunity.currentJdRevisionId, null);
  assert.deepEqual(opportunity.jdRevisions, []);

  const jdText = 'Build reliable local systems for synthetic users.';
  const firstRevision = store.opportunity.addJdRevision(opportunity.opportunityId, {
    content: jdText,
    sourceRef: 'paste://synthetic-jd-1',
    capturedAt: '2026-09-17T01:01:00.000Z',
  });
  assert.equal(firstRevision.revisionNumber, 1);
  assert.equal(firstRevision.availabilityStatus, 'AVAILABLE');
  assert.equal(firstRevision.content, jdText);
  assert.equal(
    firstRevision.contentIdentity,
    crypto.createHash('sha256').update(jdText, 'utf8').digest('hex'),
  );

  const unavailableRevision = store.opportunity.addJdRevision(opportunity.opportunityId, {
    sourceRef: 'https://example.test/opportunity/missing-jd',
    availabilityStatus: 'UNAVAILABLE',
    capturedAt: '2026-09-17T01:02:00.000Z',
  });
  assert.equal(unavailableRevision.revisionNumber, 2);
  assert.equal(unavailableRevision.content, null);
  assert.equal(unavailableRevision.contentIdentity, null);
  assert.equal(unavailableRevision.availabilityStatus, 'UNAVAILABLE');

  const latestText = 'Build reliable local systems and document ownership.';
  const latestRevision = store.opportunity.addJdRevision(opportunity.opportunityId, {
    content: latestText,
    sourceRef: 'paste://synthetic-jd-3',
    capturedAt: '2026-09-17T01:03:00.000Z',
  });
  assert.equal(latestRevision.revisionNumber, 3);
  assert.equal(store.opportunity.getJdRevision(opportunity.opportunityId, firstRevision.jdRevisionId).content, jdText);
  assert.equal(store.opportunity.get(opportunity.opportunityId).currentJdRevisionId, latestRevision.jdRevisionId);
  assert.deepEqual(store.opportunity.get(opportunity.opportunityId).jdRevisions.map((revision) => revision.revisionNumber), [1, 2, 3]);

  store.close();
  store = null;
  ownership.release();
  ownership = null;

  ownership = acquireRootOwnership(privateRoot);
  store = initializeOpportunityEvidenceStore(privateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership,
  });
  const reopened = store.opportunity.get(opportunity.opportunityId);
  assert.equal(reopened.opportunityId, opportunity.opportunityId);
  assert.equal(reopened.currentJdRevisionId, latestRevision.jdRevisionId);
  assert.deepEqual(reopened.jdRevisions.map((revision) => revision.jdRevisionId), [
    firstRevision.jdRevisionId,
    unavailableRevision.jdRevisionId,
    latestRevision.jdRevisionId,
  ]);
});

test('minimum Career Evidence substrate preserves provenance and immutable confirmation history across restart', (t) => {
  const root = temporaryRoot();
  t.after(() => removeRoot(root));
  const privateRoot = validPrivateRoot(root);
  let ownership = acquireRootOwnership(privateRoot);
  let store = initializeOpportunityEvidenceStore(privateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership,
  });
  t.after(() => {
    store?.close();
    ownership?.release();
  });

  const draft = store.evidence.create({
    factualContent: 'Reduced synthetic queue latency.',
    responsibilityBoundary: 'Owned the queue consumer and rollout.',
    outcome: 'Synthetic latency decreased.',
    metricDefinition: 'p95 processing latency in milliseconds.',
    provenance: { kind: 'user_note', reference: 'synthetic-evidence-1' },
    createdAt: '2026-09-17T02:00:00.000Z',
  });
  assert.match(draft.evidenceId, /^[0-9a-f-]{36}$/);
  assert.equal(draft.currentRevisionId, null);
  assert.equal(draft.revisions.length, 1);
  const draftRevision = draft.revisions[0];
  assert.match(draftRevision.evidenceRevisionId, /^[0-9a-f-]{36}$/);
  assert.equal(draftRevision.confirmationState, 'DRAFT');
  assert.deepEqual(draftRevision.provenance, { kind: 'user_note', reference: 'synthetic-evidence-1' });

  const confirmed = store.evidence.confirmRevision(
    draft.evidenceId,
    draftRevision.evidenceRevisionId,
    '2026-09-17T02:01:00.000Z',
  );
  assert.equal(confirmed.revisions.length, 2);
  assert.equal(confirmed.revisions[0].evidenceRevisionId, draftRevision.evidenceRevisionId);
  assert.equal(confirmed.revisions[0].confirmationState, 'DRAFT');
  assert.equal(confirmed.currentRevision.confirmationState, 'CONFIRMED');
  assert.notEqual(confirmed.currentRevisionId, draftRevision.evidenceRevisionId);
  const confirmedRevision = confirmed.currentRevision;
  assert.equal(confirmedRevision.factualContent, draftRevision.factualContent);
  assert.deepEqual(confirmedRevision.provenance, draftRevision.provenance);

  const nextDraft = store.evidence.createRevision(draft.evidenceId, {
    factualContent: 'Reduced synthetic queue latency during the staged rollout.',
    responsibilityBoundary: 'Owned the queue consumer, rollout, and rollback plan.',
    outcome: 'Synthetic latency decreased without an outage.',
    provenance: { kind: 'user_note', reference: 'synthetic-evidence-2' },
    createdAt: '2026-09-17T02:02:00.000Z',
  });
  assert.equal(nextDraft.currentRevisionId, confirmedRevision.evidenceRevisionId);
  assert.equal(nextDraft.revisions.at(-1).confirmationState, 'DRAFT');

  const reconfirmed = store.evidence.confirmRevision(
    draft.evidenceId,
    nextDraft.revisions.at(-1).evidenceRevisionId,
    '2026-09-17T02:03:00.000Z',
  );
  assert.equal(reconfirmed.revisions.length, 4);
  assert.equal(reconfirmed.currentRevision.confirmationState, 'CONFIRMED');
  assert.notEqual(reconfirmed.currentRevisionId, confirmedRevision.evidenceRevisionId);
  assert.equal(reconfirmed.revisions[1].confirmationState, 'CONFIRMED');
  assert.equal(reconfirmed.revisions[1].factualContent, draftRevision.factualContent);

  store.close();
  store = null;
  ownership.release();
  ownership = null;

  ownership = acquireRootOwnership(privateRoot);
  store = initializeOpportunityEvidenceStore(privateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership,
  });
  const reopened = store.evidence.get(draft.evidenceId);
  assert.equal(reopened.currentRevisionId, reconfirmed.currentRevisionId);
  assert.equal(reopened.revisions.length, 4);
  assert.equal(reopened.revisions[0].factualContent, draftRevision.factualContent);
  assert.equal(reopened.currentRevision.confirmationState, 'CONFIRMED');
  assert.deepEqual(reopened.currentRevision.provenance, { kind: 'user_note', reference: 'synthetic-evidence-2' });
});

test('Opportunity/Evidence migration is additive, preserves M1 metadata, and rolls back cleanly', (t) => {
  const migratedRoot = temporaryRoot();
  const failedRoot = temporaryRoot();
  t.after(() => {
    removeRoot(migratedRoot);
    removeRoot(failedRoot);
  });

  const migratedPrivateRoot = validPrivateRoot(migratedRoot);
  let migratedOwnership = acquireRootOwnership(migratedPrivateRoot);
  const foundation = initializeFoundationStore(migratedPrivateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership: migratedOwnership,
  });
  const foundationIdentity = foundation.metadata.storeIdentity;
  foundation.close();
  migratedOwnership.release();
  migratedOwnership = acquireRootOwnership(migratedPrivateRoot);
  const domainStore = initializeOpportunityEvidenceStore(migratedPrivateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership: migratedOwnership,
  });
  assert.equal(domainStore.metadata.storeIdentity, foundationIdentity);
  assert.equal(domainStore.metadata.storeVersion, FOUNDATION_STORE_VERSION);
  assert.equal(domainStore.metadata.opportunityEvidenceSchemaVersion, OPPORTUNITY_EVIDENCE_SCHEMA_VERSION);
  domainStore.close();
  migratedOwnership.release();

  const migratedDatabase = new Database(foundationDatabasePath(migratedPrivateRoot), { readonly: true });
  const migratedTables = migratedDatabase.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").pluck().all();
  assert.deepEqual(migratedTables, [
    'evidence_records',
    'evidence_revisions',
    'foundation_metadata',
    'jd_revisions',
    'opportunities',
  ]);
  assert.equal(
    migratedDatabase.prepare("SELECT value FROM foundation_metadata WHERE key = 'store_version'").pluck().get(),
    '1',
  );
  migratedDatabase.close();

  const failedPrivateRoot = validPrivateRoot(failedRoot);
  const failedOwnership = acquireRootOwnership(failedPrivateRoot);
  const failedFoundation = initializeFoundationStore(failedPrivateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership: failedOwnership,
  });
  const failedFoundationIdentity = failedFoundation.metadata.storeIdentity;
  failedFoundation.close();
  assert.throws(
    () => initializeOpportunityEvidenceStore(failedPrivateRoot, {
      repositoryRoot: DEFAULT_REPOSITORY_ROOT,
      ownership: failedOwnership,
      failurePoint: 'opportunity-evidence-before-marker',
    }),
    { code: 'OPPORTUNITY_EVIDENCE_MIGRATION_FAILED' },
  );
  const rolledBackDatabase = new Database(foundationDatabasePath(failedPrivateRoot), { readonly: true });
  assert.deepEqual(rolledBackDatabase.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").pluck().all(), ['foundation_metadata']);
  assert.equal(
    rolledBackDatabase.prepare("SELECT value FROM foundation_metadata WHERE key = 'opportunity_evidence_schema_version'").pluck().get(),
    undefined,
  );
  rolledBackDatabase.close();

  const foundationRetry = initializeFoundationStore(failedPrivateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership: failedOwnership,
  });
  assert.equal(foundationRetry.metadata.storeIdentity, failedFoundationIdentity);
  assert.equal(foundationRetry.metadata.storeVersion, FOUNDATION_STORE_VERSION);
  foundationRetry.close();
  failedOwnership.release();
});

test('Opportunity/Evidence migration rolls back when ownership is lost during the transaction', (t) => {
  const root = temporaryRoot();
  t.after(() => removeRoot(root));
  const privateRoot = validPrivateRoot(root);

  let initialOwnership = acquireRootOwnership(privateRoot);
  const foundation = initializeFoundationStore(privateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership: initialOwnership,
  });
  foundation.close();
  initialOwnership.release();
  initialOwnership = null;

  const actualOwnership = acquireRootOwnership(privateRoot);
  let revoked = false;
  const ownership = {
    rootBinding: actualOwnership.rootBinding,
    assertActive() {
      if (revoked) {
        const error = new Error('Synthetic ownership loss during domain migration.');
        error.code = 'OWNERSHIP_LOST';
        throw error;
      }
      actualOwnership.assertActive();
    },
  };

  assert.throws(
    () => initializeOpportunityEvidenceStore(privateRoot, {
      repositoryRoot: DEFAULT_REPOSITORY_ROOT,
      ownership,
      onMigrationCheckpoint(checkpoint) {
        if (checkpoint === 'after-schema') revoked = true;
      },
    }),
    { code: 'OWNERSHIP_LOST' },
  );
  assert.equal(revoked, true);
  actualOwnership.release();

  const rolledBackDatabase = new Database(foundationDatabasePath(privateRoot), { readonly: true });
  assert.deepEqual(
    rolledBackDatabase.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").pluck().all(),
    ['foundation_metadata'],
  );
  assert.equal(
    rolledBackDatabase.prepare("SELECT value FROM foundation_metadata WHERE key = 'opportunity_evidence_schema_version'").pluck().get(),
    undefined,
  );
  rolledBackDatabase.close();

  const retryOwnership = acquireRootOwnership(privateRoot);
  const retry = initializeOpportunityEvidenceStore(privateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership: retryOwnership,
  });
  assert.equal(retry.metadata.storeVersion, FOUNDATION_STORE_VERSION);
  assert.equal(retry.metadata.opportunityEvidenceSchemaVersion, OPPORTUNITY_EVIDENCE_SCHEMA_VERSION);
  retry.close();
  retryOwnership.release();
});

test('Opportunity/Evidence migration rolls back when ownership is lost after marker publication', (t) => {
  const root = temporaryRoot();
  t.after(() => removeRoot(root));
  const privateRoot = validPrivateRoot(root);

  const initialOwnership = acquireRootOwnership(privateRoot);
  const foundation = initializeFoundationStore(privateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership: initialOwnership,
  });
  foundation.close();
  initialOwnership.release();

  const actualOwnership = acquireRootOwnership(privateRoot);
  let revoked = false;
  const ownership = {
    rootBinding: actualOwnership.rootBinding,
    assertActive() {
      if (revoked) {
        const error = new Error('Synthetic ownership loss after schema marker publication.');
        error.code = 'OWNERSHIP_LOST';
        throw error;
      }
      actualOwnership.assertActive();
    },
  };

  assert.throws(
    () => initializeOpportunityEvidenceStore(privateRoot, {
      repositoryRoot: DEFAULT_REPOSITORY_ROOT,
      ownership,
      onMigrationCheckpoint(checkpoint) {
        if (checkpoint === 'after-marker') revoked = true;
      },
    }),
    { code: 'OWNERSHIP_LOST' },
  );
  assert.equal(revoked, true);
  actualOwnership.release();

  const rolledBackDatabase = new Database(foundationDatabasePath(privateRoot), { readonly: true });
  assert.deepEqual(
    rolledBackDatabase.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").pluck().all(),
    ['foundation_metadata'],
  );
  assert.equal(
    rolledBackDatabase.prepare("SELECT value FROM foundation_metadata WHERE key = 'opportunity_evidence_schema_version'").pluck().get(),
    undefined,
  );
  rolledBackDatabase.close();

  const retryOwnership = acquireRootOwnership(privateRoot);
  const retry = initializeOpportunityEvidenceStore(privateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership: retryOwnership,
  });
  assert.equal(retry.metadata.storeVersion, FOUNDATION_STORE_VERSION);
  assert.equal(retry.metadata.opportunityEvidenceSchemaVersion, OPPORTUNITY_EVIDENCE_SCHEMA_VERSION);
  retry.close();
  retryOwnership.release();
});

test('domain migration failure keeps M1 foundation ready while substrate is unavailable', (t) => {
  const root = temporaryRoot();
  const userData = temporaryRoot();
  t.after(() => {
    removeRoot(root);
    removeRoot(userData);
  });

  const configPath = runtimeConfigPath(userData);
  const degraded = bootstrapFoundation({
    configPath,
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    persistenceOptions: { failurePoint: 'opportunity-evidence-before-marker' },
  });
  assert.equal(degraded.status.phase, 'ready');
  assert.equal(degraded.status.foundationPhase, 'ready');
  assert.equal(degraded.status.opportunityEvidencePhase, 'unavailable');
  assert.equal(degraded.status.storeVersion, FOUNDATION_STORE_VERSION);
  assert.equal(degraded.status.opportunityEvidenceSchemaVersion, null);
  assert.equal(degraded.status.opportunityEvidenceStatus.phase, 'unavailable');
  assert.equal(degraded.status.opportunityEvidenceStatus.code, 'OPPORTUNITY_EVIDENCE_MIGRATION_FAILED');
  assert.equal('opportunity' in degraded, false);
  assert.equal('evidence' in degraded, false);
  degraded.close();

  const privateRoot = validPrivateRoot(root);
  const foundationOwnership = acquireRootOwnership(privateRoot);
  const foundation = initializeFoundationStore(privateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership: foundationOwnership,
  });
  assert.equal(foundation.metadata.storeVersion, FOUNDATION_STORE_VERSION);
  foundation.close();
  foundationOwnership.release();

  const retry = bootstrapFoundation({
    configPath,
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });
  assert.equal(retry.status.phase, 'ready');
  assert.equal(retry.status.foundationPhase, 'ready');
  assert.equal(retry.status.opportunityEvidencePhase, 'ready');
  assert.equal(retry.status.opportunityEvidenceSchemaVersion, OPPORTUNITY_EVIDENCE_SCHEMA_VERSION);
  assert.equal(typeof retry.opportunity.create, 'function');
  assert.equal(typeof retry.evidence.create, 'function');
  retry.close();
});

test('malformed domain schema with the published marker fails closed during bootstrap', (t) => {
  const root = temporaryRoot();
  const userData = temporaryRoot();
  t.after(() => {
    removeRoot(root);
    removeRoot(userData);
  });

  const privateRoot = validPrivateRoot(root);
  const ownership = acquireRootOwnership(privateRoot);
  const foundation = initializeFoundationStore(privateRoot, {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    ownership,
  });
  foundation.close();
  ownership.release();

  const database = new Database(foundationDatabasePath(privateRoot));
  database.exec(`
    CREATE TABLE opportunities (
      opportunity_id TEXT PRIMARY KEY NOT NULL,
      company_name TEXT NOT NULL,
      role_title TEXT NOT NULL,
      source_ref TEXT,
      current_jd_revision_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE jd_revisions (
      jd_revision_id TEXT PRIMARY KEY NOT NULL,
      opportunity_id TEXT NOT NULL,
      revision_number INTEGER NOT NULL,
      content TEXT,
      content_identity TEXT,
      source_ref TEXT,
      captured_at TEXT NOT NULL,
      availability_status TEXT NOT NULL
    );
    CREATE TABLE evidence_records (
      evidence_id TEXT PRIMARY KEY NOT NULL,
      current_revision_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE evidence_revisions (
      evidence_revision_id TEXT PRIMARY KEY NOT NULL,
      evidence_id TEXT NOT NULL,
      revision_number INTEGER NOT NULL,
      factual_content TEXT NOT NULL,
      provenance_json TEXT NOT NULL,
      responsibility_boundary TEXT NOT NULL,
      outcome TEXT NOT NULL,
      metric_definition TEXT,
      confirmation_state TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX jd_revisions_opportunity_idx
      ON jd_revisions(opportunity_id, revision_number);
    CREATE INDEX evidence_revisions_evidence_idx
      ON evidence_revisions(evidence_id, revision_number);
  `);
  database.prepare(`
    INSERT INTO foundation_metadata (key, value) VALUES (?, ?)
  `).run('opportunity_evidence_schema_version', String(OPPORTUNITY_EVIDENCE_SCHEMA_VERSION));
  database.close();

  const degraded = bootstrapFoundation({
    configPath: runtimeConfigPath(userData),
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });
  assert.equal(degraded.status.phase, 'ready');
  assert.equal(degraded.status.foundationPhase, 'ready');
  assert.equal(degraded.status.opportunityEvidencePhase, 'unavailable');
  assert.equal(degraded.status.opportunityEvidenceStatus.code, 'OPPORTUNITY_EVIDENCE_SCHEMA_INVALID');
  assert.equal(degraded.status.opportunityEvidenceSchemaVersion, null);
  assert.equal('opportunity' in degraded, false);
  assert.equal('evidence' in degraded, false);
  degraded.close();
});

test('malformed required domain index fails closed during bootstrap', (t) => {
  const root = temporaryRoot();
  const userData = temporaryRoot();
  t.after(() => {
    removeRoot(root);
    removeRoot(userData);
  });

  const configPath = runtimeConfigPath(userData);
  const initial = bootstrapFoundation({
    configPath,
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });
  assert.equal(initial.status.opportunityEvidencePhase, 'ready');
  initial.close();

  const privateRoot = validPrivateRoot(root);
  const database = new Database(foundationDatabasePath(privateRoot));
  database.exec('DROP INDEX jd_revisions_opportunity_idx');
  database.exec('CREATE INDEX jd_revisions_opportunity_idx ON jd_revisions(revision_number)');
  database.close();

  const degraded = bootstrapFoundation({
    configPath,
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });
  assert.equal(degraded.status.phase, 'ready');
  assert.equal(degraded.status.foundationPhase, 'ready');
  assert.equal(degraded.status.opportunityEvidencePhase, 'unavailable');
  assert.equal(degraded.status.opportunityEvidenceStatus.code, 'OPPORTUNITY_EVIDENCE_SCHEMA_INVALID');
  assert.equal('opportunity' in degraded, false);
  assert.equal('evidence' in degraded, false);
  degraded.close();
});

test('schema readiness rejects unrelated domain write failures', (t) => {
  const root = temporaryRoot();
  const userData = temporaryRoot();
  t.after(() => {
    removeRoot(root);
    removeRoot(userData);
  });

  const configPath = runtimeConfigPath(userData);
  const initial = bootstrapFoundation({
    configPath,
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });
  const opportunity = initial.opportunity.create({ companyName: 'Synthetic', roleTitle: 'Validator' });
  initial.close();

  const privateRoot = validPrivateRoot(root);
  const ownership = acquireRootOwnership(privateRoot);
  const database = new Database(foundationDatabasePath(privateRoot));
  database.exec("CREATE TRIGGER schema_probe_block_jd BEFORE INSERT ON jd_revisions BEGIN SELECT RAISE(ABORT, 'synthetic schema failure'); END;");
  database.close();
  ownership.release();

  const degraded = bootstrapFoundation({
    configPath,
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });
  assert.equal(degraded.status.phase, 'ready');
  assert.equal(degraded.status.foundationPhase, 'ready');
  assert.equal(degraded.status.opportunityEvidencePhase, 'unavailable');
  assert.equal(degraded.status.opportunityEvidenceStatus.code, 'OPPORTUNITY_EVIDENCE_SCHEMA_INVALID');
  assert.equal('opportunity' in degraded, false);
  assert.equal('evidence' in degraded, false);
  assert.equal(opportunity.companyName, 'Synthetic');
  degraded.close();
});

test('malformed mandatory domain schema extension remains degraded', (t) => {
  const root = temporaryRoot();
  const userData = temporaryRoot();
  t.after(() => {
    removeRoot(root);
    removeRoot(userData);
  });

  const configPath = runtimeConfigPath(userData);
  const initial = bootstrapFoundation({
    configPath,
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });
  initial.close();

  const privateRoot = validPrivateRoot(root);
  const ownership = acquireRootOwnership(privateRoot);
  const database = new Database(foundationDatabasePath(privateRoot));
  database.exec('ALTER TABLE opportunities ADD COLUMN malformed_required TEXT NOT NULL');
  database.close();
  ownership.release();

  const degraded = bootstrapFoundation({
    configPath,
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });
  assert.equal(degraded.status.phase, 'ready');
  assert.equal(degraded.status.foundationPhase, 'ready');
  assert.equal(degraded.status.opportunityEvidencePhase, 'unavailable');
  assert.equal(degraded.status.opportunityEvidenceStatus.code, 'OPPORTUNITY_EVIDENCE_SCHEMA_INVALID');
  assert.equal('opportunity' in degraded, false);
  assert.equal('evidence' in degraded, false);
  degraded.close();
});

test('malformed Opportunity/Evidence schema marker fails closed without migration', (t) => {
  for (const malformedMarker of ['', '   ']) {
    const root = temporaryRoot();
    const userData = temporaryRoot();
    t.after(() => {
      removeRoot(root);
      removeRoot(userData);
    });

    const configPath = runtimeConfigPath(userData);
    const initial = bootstrapFoundation({
      configPath,
      argv: [],
      env: { CAREER_PRIVATE_ROOT: root },
      repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    });
    initial.close();

    const privateRoot = validPrivateRoot(root);
    const ownership = acquireRootOwnership(privateRoot);
    const database = new Database(foundationDatabasePath(privateRoot));
    database.prepare('UPDATE foundation_metadata SET value = ? WHERE key = ?').run(
      malformedMarker,
      'opportunity_evidence_schema_version',
    );
    database.close();
    ownership.release();

    const degraded = bootstrapFoundation({
      configPath,
      argv: [],
      env: { CAREER_PRIVATE_ROOT: root },
      repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    });
    assert.equal(degraded.status.phase, 'ready');
    assert.equal(degraded.status.foundationPhase, 'ready');
    assert.equal(degraded.status.opportunityEvidencePhase, 'unavailable');
    assert.equal(degraded.status.opportunityEvidenceStatus.code, 'OPPORTUNITY_EVIDENCE_SCHEMA_INVALID');
    assert.equal(degraded.status.opportunityEvidenceSchemaVersion, null);
    assert.equal('opportunity' in degraded, false);
    assert.equal('evidence' in degraded, false);
    degraded.close();
  }
});

test('broken current revision pointers fail closed and never publish domain readiness', (t) => {
  const root = temporaryRoot();
  const userData = temporaryRoot();
  t.after(() => {
    removeRoot(root);
    removeRoot(userData);
  });

  const configPath = runtimeConfigPath(userData);
  const initial = bootstrapFoundation({
    configPath,
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });
  const firstOpportunity = initial.opportunity.create({
    companyName: 'Pointer Systems',
    roleTitle: 'Owner',
    sourceRef: 'synthetic://pointer-opportunity-a',
  });
  const firstJd = initial.opportunity.addJdRevision(firstOpportunity.opportunityId, {
    content: 'First synthetic JD.',
    sourceRef: 'synthetic://pointer-jd-a',
  });
  const secondOpportunity = initial.opportunity.create({
    companyName: 'Other Systems',
    roleTitle: 'Owner',
    sourceRef: 'synthetic://pointer-opportunity-b',
  });
  const secondJd = initial.opportunity.addJdRevision(secondOpportunity.opportunityId, {
    content: 'Second synthetic JD.',
    sourceRef: 'synthetic://pointer-jd-b',
  });
  const evidence = initial.evidence.create({
    factualContent: 'Synthetic pointer evidence.',
    responsibilityBoundary: 'Synthetic test only.',
    outcome: 'Pointer integrity was checked.',
    provenance: { kind: 'synthetic', reference: 'pointer-regression' },
  });
  const confirmedEvidence = initial.evidence.confirmRevision(
    evidence.evidenceId,
    evidence.revisions[0].evidenceRevisionId,
  );
  initial.close();

  const privateRoot = validPrivateRoot(root);
  const database = new Database(foundationDatabasePath(privateRoot));
  database.prepare(
    'UPDATE opportunities SET current_jd_revision_id = ? WHERE opportunity_id = ?',
  ).run(secondJd.jdRevisionId, firstOpportunity.opportunityId);
  database.prepare(
    'UPDATE evidence_records SET current_revision_id = ? WHERE evidence_id = ?',
  ).run('missing-evidence-revision', evidence.evidenceId);
  database.close();

  const degraded = bootstrapFoundation({
    configPath,
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });
  assert.equal(degraded.status.phase, 'ready');
  assert.equal(degraded.status.foundationPhase, 'ready');
  assert.equal(degraded.status.opportunityEvidencePhase, 'unavailable');
  assert.equal(degraded.status.opportunityEvidenceStatus.code, 'OPPORTUNITY_EVIDENCE_SCHEMA_INVALID');
  assert.equal('opportunity' in degraded, false);
  assert.equal('evidence' in degraded, false);
  degraded.close();

  assert.equal(firstJd.opportunityId, firstOpportunity.opportunityId);
  assert.equal(confirmedEvidence.evidenceId, evidence.evidenceId);
});

test('current Evidence pointer must resolve to a confirmed revision', (t) => {
  const root = temporaryRoot();
  const userData = temporaryRoot();
  t.after(() => {
    removeRoot(root);
    removeRoot(userData);
  });

  const configPath = runtimeConfigPath(userData);
  const initial = bootstrapFoundation({
    configPath,
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });
  const draft = initial.evidence.create({
    factualContent: 'Synthetic draft pointer.',
    responsibilityBoundary: 'Synthetic test only.',
    outcome: 'Draft pointer must not be canonical.',
    provenance: { kind: 'synthetic', reference: 'draft-pointer' },
  });
  initial.close();

  const privateRoot = validPrivateRoot(root);
  const ownership = acquireRootOwnership(privateRoot);
  const database = new Database(foundationDatabasePath(privateRoot));
  database.prepare(
    'UPDATE evidence_records SET current_revision_id = ? WHERE evidence_id = ?',
  ).run(draft.revisions[0].evidenceRevisionId, draft.evidenceId);
  database.close();
  ownership.release();

  const degraded = bootstrapFoundation({
    configPath,
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });
  assert.equal(degraded.status.phase, 'ready');
  assert.equal(degraded.status.foundationPhase, 'ready');
  assert.equal(degraded.status.opportunityEvidencePhase, 'unavailable');
  assert.equal(degraded.status.opportunityEvidenceStatus.code, 'OPPORTUNITY_EVIDENCE_SCHEMA_INVALID');
  assert.equal('opportunity' in degraded, false);
  assert.equal('evidence' in degraded, false);
  degraded.close();
});

test('valid existing domain schema remains ready through full bootstrap reopen', (t) => {
  const root = temporaryRoot();
  const userData = temporaryRoot();
  t.after(() => {
    removeRoot(root);
    removeRoot(userData);
  });

  const configPath = runtimeConfigPath(userData);
  const first = bootstrapFoundation({
    configPath,
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });
  assert.equal(first.status.phase, 'ready');
  assert.equal(first.status.foundationPhase, 'ready');
  assert.equal(first.status.opportunityEvidencePhase, 'ready');
  const storeIdentity = first.status.storeIdentity;
  first.close();

  const second = bootstrapFoundation({
    configPath,
    argv: [],
    env: { CAREER_PRIVATE_ROOT: root },
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
  });
  assert.equal(second.status.phase, 'ready');
  assert.equal(second.status.foundationPhase, 'ready');
  assert.equal(second.status.opportunityEvidencePhase, 'ready');
  assert.equal(second.status.storeIdentity, storeIdentity);
  assert.equal(second.status.storeVersion, FOUNDATION_STORE_VERSION);
  assert.equal(second.status.opportunityEvidenceSchemaVersion, OPPORTUNITY_EVIDENCE_SCHEMA_VERSION);
  assert.equal(typeof second.opportunity.create, 'function');
  assert.equal(typeof second.evidence.create, 'function');
  second.close();
});

test('Opportunity/Evidence substrate survives a true cross-process restart and read-back', async (t) => {
  const root = temporaryRoot();
  t.after(() => removeRoot(root));

  const writer = await runDomainProcess(root, DEFAULT_REPOSITORY_ROOT, 'write');
  assert.equal(writer.code, 0, `Process A failed: stdout=${writer.stdout}, stderr=${writer.stderr}`);
  assert.equal(writer.signal, null, `Process A terminated by signal: ${writer.signal}`);
  assert.equal(writer.stderr, '');
  const written = JSON.parse(writer.stdout.trim().split('\n').at(-1));
  assert.equal(written.role, 'write');
  assert.equal(written.storeVersion, FOUNDATION_STORE_VERSION);
  assert.equal(written.opportunityEvidenceSchemaVersion, OPPORTUNITY_EVIDENCE_SCHEMA_VERSION);

  const reader = await runDomainProcess(root, DEFAULT_REPOSITORY_ROOT, 'read', written);
  assert.equal(reader.code, 0, `Process B failed: stdout=${reader.stdout}, stderr=${reader.stderr}`);
  assert.equal(reader.signal, null, `Process B terminated by signal: ${reader.signal}`);
  assert.equal(reader.stderr, '');
  const readBack = JSON.parse(reader.stdout.trim().split('\n').at(-1));
  assert.equal(readBack.role, 'read');
  assert.equal(readBack.verified, true);
  assert.notEqual(writer.pid, reader.pid);
});

test('different roots are independent while same-root acquisition conflicts', (t) => {
  const rootA = temporaryRoot();
  const rootB = temporaryRoot();
  t.after(() => {
    removeRoot(rootA);
    removeRoot(rootB);
  });
  const privateRootA = validPrivateRoot(rootA);
  const privateRootB = validPrivateRoot(rootB);
  const ownershipA = acquireRootOwnership(privateRootA);
  const ownershipB = acquireRootOwnership(privateRootB);
  assert.notEqual(ownershipA.rootBinding, ownershipB.rootBinding);
  assert.throws(() => acquireRootOwnership(privateRootA), { code: 'OWNERSHIP_CONFLICT' });
  assert.equal(fs.existsSync(foundationDatabasePath(privateRootA)), false);
  ownershipA.release();
  ownershipB.release();
});

test('ownership releases cleanly and recovers stale state but fails on uncertainty', (t) => {
  const root = temporaryRoot();
  t.after(() => removeRoot(root));
  const privateRoot = validPrivateRoot(root);

  const first = acquireRootOwnership(privateRoot);
  first.release();
  const second = acquireRootOwnership(privateRoot);
  second.release();

  const lockPath = foundationLockPath(privateRoot);
  fs.writeFileSync(lockPath, JSON.stringify({ pid: unusedPid(), token: 'stale-owner-token' }));
  const recovered = acquireRootOwnership(privateRoot);
  recovered.release();

  fs.writeFileSync(lockPath, 'not-json');
  assert.throws(() => acquireRootOwnership(privateRoot), { code: 'OWNERSHIP_UNCERTAIN' });
  fs.unlinkSync(lockPath);
});

test('simultaneous stale recovery contenders yield one initialized owner and one valid owner lock', async (t) => {
  const fixture = temporaryRoot();
  const repositoryRoot = path.join(fixture, 'repository');
  const rootPath = path.join(fixture, 'private');
  fs.mkdirSync(repositoryRoot);
  fs.mkdirSync(rootPath);

  const privateRoot = validatePrivateRoot(rootPath, { repositoryRoot });
  const stateDirectory = foundationStateDirectory(privateRoot);
  fs.mkdirSync(stateDirectory);
  fs.writeFileSync(foundationLockPath(privateRoot), JSON.stringify({
    pid: unusedPid(),
    token: 'simultaneous-stale-owner-token',
  }));

  const paths = {
    start: path.join(fixture, 'start'),
    continue: path.join(fixture, 'continue-recovery'),
    release: path.join(fixture, 'release-owner'),
  };
  const workers = [];
  t.after(async () => {
    for (const gate of Object.values(paths)) fs.writeFileSync(gate, 'continue');
    await Promise.all(workers.map(async (worker) => {
      const { child } = worker;
      if (child.closed) return;
      const closed = waitForChildClose(worker);
      const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
      await closed;
      clearTimeout(timeout);
    }));
    removeRoot(fixture);
  });

  const recoveryWinner = spawnRecoveryContender(rootPath, repositoryRoot, paths, true);
  workers.push(recoveryWinner);
  await recoveryWinner.waitFor((message) => message.event === 'ready');
  fs.writeFileSync(paths.start, 'go');
  await recoveryWinner.waitFor((message) => message.event === 'claim-held');

  const concurrentContender = spawnRecoveryContender(rootPath, repositoryRoot, paths, false);
  workers.push(concurrentContender);
  await concurrentContender.waitFor((message) => message.event === 'ready');
  const losingResult = await concurrentContender.waitFor((message) => message.event === 'result');

  assert.deepEqual(losingResult.status, 'error');
  assert.equal(
    losingResult.code,
    process.platform === 'darwin' ? 'OWNERSHIP_CONFLICT' : 'OWNERSHIP_RECOVERY_IN_PROGRESS',
  );
  assert.equal(fs.existsSync(foundationDatabasePath(privateRoot)), false);
  assert.equal(fs.existsSync(foundationLockPath(privateRoot)), true);

  fs.writeFileSync(paths.continue, 'finish recovery');
  const winningResult = await recoveryWinner.waitFor((message) => message.event === 'result');
  assert.equal(winningResult.status, 'success');
  assert.equal(winningResult.pid, recoveryWinner.child.pid);
  assert.equal(winningResult.storeIdentity.length > 0, true);

  const successfulOwners = workers.flatMap((worker) => worker.messages)
    .filter((message) => message.event === 'result' && message.status === 'success');
  assert.equal(successfulOwners.length, 1);

  const finalOwner = JSON.parse(fs.readFileSync(foundationLockPath(privateRoot), 'utf8'));
  assert.equal(finalOwner.pid, recoveryWinner.child.pid);
  assert.equal(typeof finalOwner.token, 'string');
  assert.equal(finalOwner.token.length >= 16, true);
  assert.equal(fs.existsSync(foundationLockRecoveryPath(privateRoot)), false);
  assert.doesNotThrow(() => process.kill(finalOwner.pid, 0));

  const database = new Database(foundationDatabasePath(privateRoot), { readonly: true });
  const storedMetadata = new Map(database.prepare('SELECT key, value FROM foundation_metadata').all().map((row) => [row.key, row.value]));
  assert.equal(storedMetadata.get('initialization_state'), 'READY');
  assert.equal(storedMetadata.get('store_identity'), winningResult.storeIdentity);
  database.close();

  fs.writeFileSync(paths.release, 'release owner');
  await waitForChildClose(recoveryWinner);
  await waitForChildClose(concurrentContender);
  assert.equal(recoveryWinner.child.exitCode, 0);
  if (process.platform !== 'darwin') assert.equal(fs.existsSync(foundationLockPath(privateRoot)), false);
  const reacquired = acquireRootOwnership(privateRoot);
  reacquired.assertActive();
  reacquired.release();
});

test('non-Darwin recovery claims can be taken over after the claimant terminates', async (t) => {
  const fixture = temporaryRoot();
  const repositoryRoot = path.join(fixture, 'repository');
  const rootPath = path.join(fixture, 'private');
  fs.mkdirSync(repositoryRoot);
  fs.mkdirSync(rootPath);

  const privateRoot = validatePrivateRoot(rootPath, { repositoryRoot });
  const stateDirectory = foundationStateDirectory(privateRoot);
  fs.mkdirSync(stateDirectory);
  fs.writeFileSync(foundationLockPath(privateRoot), JSON.stringify({
    pid: unusedPid(),
    token: 'crash-recovery-stale-owner-token',
  }));

  const crashPaths = {
    start: path.join(fixture, 'start-crash-recovery'),
    continue: path.join(fixture, 'continue-crash-recovery'),
    release: path.join(fixture, 'release-crash-recovery'),
  };
  const takeoverPaths = {
    start: path.join(fixture, 'start-takeover-recovery'),
    continue: path.join(fixture, 'continue-takeover-recovery'),
    release: path.join(fixture, 'release-takeover-recovery'),
  };
  const workers = [];
  t.after(async () => {
    for (const gate of [...Object.values(crashPaths), ...Object.values(takeoverPaths)]) {
      fs.writeFileSync(gate, 'continue');
    }
    await Promise.all(workers.map(async (worker) => {
      if (worker.child.closed) return;
      const closed = waitForChildClose(worker);
      const timeout = setTimeout(() => worker.child.kill('SIGKILL'), 5000);
      await closed;
      clearTimeout(timeout);
    }));
    removeRoot(fixture);
  });

  const crashedContender = spawnRecoveryContender(rootPath, repositoryRoot, crashPaths, false, 'linux', 'crash');
  workers.push(crashedContender);
  await crashedContender.waitFor((message) => message.event === 'ready');
  fs.writeFileSync(crashPaths.start, 'start');
  await crashedContender.waitFor((message) => message.event === 'claim-created');
  await waitForChildClose(crashedContender);
  assert.equal(crashedContender.child.exitCode, 23);
  assert.equal(fs.existsSync(foundationLockRecoveryPath(privateRoot)), true);

  const staleRecoveryOwner = JSON.parse(fs.readFileSync(foundationLockRecoveryPath(privateRoot), 'utf8'));
  assert.equal(staleRecoveryOwner.ownershipMode, 'recovery-claim-v2');
  assert.throws(() => process.kill(staleRecoveryOwner.pid, 0), { code: 'ESRCH' });

  const takeoverContender = spawnRecoveryContender(rootPath, repositoryRoot, takeoverPaths, false, 'linux');
  workers.push(takeoverContender);
  await takeoverContender.waitFor((message) => message.event === 'ready');
  fs.writeFileSync(takeoverPaths.start, 'start');
  const takeoverResult = await takeoverContender.waitFor((message) => message.event === 'result');
  assert.equal(takeoverResult.status, 'success', JSON.stringify(takeoverResult));
  assert.equal(takeoverResult.pid, takeoverContender.child.pid);
  assert.equal(takeoverResult.storeIdentity.length > 0, true);

  const successfulOwners = takeoverContender.messages
    .filter((message) => message.event === 'result' && message.status === 'success');
  assert.equal(successfulOwners.length, 1);
  const recoveryClaimsWhileOwned = fs.readdirSync(stateDirectory)
    .filter((entry) => entry === 'foundation.lock.recovery' || entry.startsWith('foundation.lock.recovery.'));
  assert.deepEqual(recoveryClaimsWhileOwned, []);

  const finalOwner = JSON.parse(fs.readFileSync(foundationLockPath(privateRoot), 'utf8'));
  assert.equal(finalOwner.pid, takeoverContender.child.pid);
  assert.equal(typeof finalOwner.token, 'string');
  assert.equal(finalOwner.token.length >= 16, true);
  assert.doesNotThrow(() => process.kill(finalOwner.pid, 0));

  const database = new Database(foundationDatabasePath(privateRoot), { readonly: true });
  const storedMetadata = new Map(database.prepare('SELECT key, value FROM foundation_metadata').all().map((row) => [row.key, row.value]));
  assert.equal(storedMetadata.get('initialization_state'), 'READY');
  assert.equal(storedMetadata.get('store_identity'), takeoverResult.storeIdentity);
  database.close();

  fs.writeFileSync(takeoverPaths.release, 'release owner');
  await waitForChildClose(takeoverContender);
  assert.equal(takeoverContender.child.exitCode, 0);
  assert.equal(fs.existsSync(foundationLockPath(privateRoot)), false);
  const reacquired = acquireRootOwnership(privateRoot, { repositoryRoot });
  reacquired.assertActive();
  reacquired.release();
});

test('separate processes conflict on one root and recover after termination', async (t) => {
  const root = temporaryRoot();
  const privateRoot = validPrivateRoot(root);
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const childClosed = once(child, 'close');
      child.kill('SIGKILL');
      await childClosed;
    }
    removeRoot(root);
  });

  const childSource = `
    const { validatePrivateRoot } = require(process.argv[2]);
    const { acquireRootOwnership } = require(process.argv[3]);
    const privateRoot = validatePrivateRoot(process.argv[1]);
    acquireRootOwnership(privateRoot);
    process.stdout.write('ready\\n');
    setInterval(() => {}, 1000);
  `;
  child = spawn(process.execPath, [
    '-e',
    childSource,
    root,
    path.join(DEFAULT_REPOSITORY_ROOT, 'src', 'main', 'private-root.cjs'),
    path.join(DEFAULT_REPOSITORY_ROOT, 'src', 'main', 'ownership.cjs'),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  await new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Ownership child did not become ready: stdout=${output}, stderr=${errors}`));
    }, 5000);
    const onData = (chunk) => {
      output += chunk;
      if (output.includes('ready')) {
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        resolve();
      }
    };
    child.stderr.on('data', (chunk) => {
      errors += chunk;
    });
    child.stdout.on('data', onData);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`Ownership child exited before readiness: code=${code}, signal=${signal}`));
    });
  });

  assert.throws(() => acquireRootOwnership(privateRoot), { code: 'OWNERSHIP_CONFLICT' });
  const childClosed = once(child, 'close');
  child.kill('SIGKILL');
  await childClosed;

  const recovered = acquireRootOwnership(privateRoot);
  recovered.release();
});

test('partial initialization rolls back and retries deterministically', (t) => {
  const root = temporaryRoot();
  t.after(() => removeRoot(root));
  const privateRoot = validPrivateRoot(root);
  const ownership = acquireRootOwnership(privateRoot);
  const databasePath = foundationDatabasePath(privateRoot);

  assert.throws(
    () => initializeFoundationStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership, failurePoint: 'before-ready' }),
    { code: 'FOUNDATION_INIT_FAILED' },
  );
  const failedDatabase = new Database(databasePath, { readonly: true });
  assert.deepEqual(failedDatabase.prepare(`SELECT key FROM foundation_metadata`).pluck().all(), []);
  failedDatabase.close();

  const retry = initializeFoundationStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership });
  assert.equal(retry.metadata.initializationState, 'READY');
  retry.close();
  ownership.release();
});

test('persistence does not return a ready store after ownership is lost during initialization', (t) => {
  const root = temporaryRoot();
  t.after(() => removeRoot(root));
  const privateRoot = validPrivateRoot(root);
  const owner = acquireRootOwnership(privateRoot);
  let ownershipChecks = 0;
  const ownershipLostAtPublication = {
    rootBinding: owner.rootBinding,
    assertActive() {
      ownershipChecks += 1;
      if (ownershipChecks === 3) {
        throw Object.assign(new Error('Synthetic ownership loss before publication.'), { code: 'OWNERSHIP_LOST' });
      }
      owner.assertActive();
    },
  };

  assert.throws(
    () => initializeFoundationStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership: ownershipLostAtPublication }),
    { code: 'OWNERSHIP_LOST' },
  );
  assert.equal(ownershipChecks, 3);

  const retry = initializeFoundationStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership: owner });
  assert.equal(retry.metadata.initializationState, 'READY');
  retry.close();
  owner.release();
});

test('unsupported foundation version fails closed without resetting the store', (t) => {
  const root = temporaryRoot();
  t.after(() => removeRoot(root));
  const privateRoot = validPrivateRoot(root);
  const ownership = acquireRootOwnership(privateRoot);
  const store = initializeFoundationStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership });
  const databasePath = foundationDatabasePath(privateRoot);
  store.close();
  ownership.release();

  const tamperedDatabase = new Database(databasePath);
  tamperedDatabase.prepare("UPDATE foundation_metadata SET value = '99' WHERE key = 'store_version'").run();
  tamperedDatabase.close();

  const reopenOwnership = acquireRootOwnership(privateRoot);
  assert.throws(
    () => initializeFoundationStore(privateRoot, { repositoryRoot: DEFAULT_REPOSITORY_ROOT, ownership: reopenOwnership }),
    { code: 'FOUNDATION_VERSION_UNSUPPORTED' },
  );
  reopenOwnership.release();

  const unchangedDatabase = new Database(databasePath, { readonly: true });
  assert.equal(unchangedDatabase.prepare("SELECT value FROM foundation_metadata WHERE key = 'store_version'").pluck().get(), '99');
  unchangedDatabase.close();
});

test('renderer cannot import persistence capabilities', () => {
  const rendererRoot = path.join(DEFAULT_REPOSITORY_ROOT, 'src', 'renderer');
  const rendererFiles = fs.readdirSync(rendererRoot)
    .filter((entry) => entry.endsWith('.jsx') || entry.endsWith('.html') || entry.endsWith('.css'))
    .map((entry) => fs.readFileSync(path.join(rendererRoot, entry), 'utf8'))
    .join('\n');
  assert.doesNotMatch(rendererFiles, /better-sqlite3|node:fs|node:path|node:sqlite/);
  const preloadSource = fs.readFileSync(path.join(DEFAULT_REPOSITORY_ROOT, 'src', 'preload', 'index.cjs'), 'utf8');
  const mainSource = fs.readFileSync(path.join(DEFAULT_REPOSITORY_ROOT, 'src', 'main', 'index.cjs'), 'utf8');
  assert.match(preloadSource, /contextBridge/);
  assert.doesNotMatch(preloadSource, /better-sqlite3|node:fs|node:path|node:sqlite/);
  for (const channel of [
    'opportunity:create',
    'opportunity:get',
    'opportunity:add-jd-revision',
    'opportunity:get-jd-revision',
    'evidence:create',
    'evidence:get',
    'evidence:create-revision',
    'evidence:confirm-revision',
  ]) {
    assert.match(mainSource, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(preloadSource, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(mainSource, /foundation\.cjs/);
});
