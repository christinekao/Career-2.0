const assert = require('node:assert/strict');
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
  assert.deepEqual(readRuntimeConfig(configPath), { privateRoot: fs.realpathSync.native(root) });
  ready.close();
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
  assert.match(fs.readFileSync(path.join(DEFAULT_REPOSITORY_ROOT, 'src', 'preload', 'index.cjs'), 'utf8'), /contextBridge/);
  assert.match(fs.readFileSync(path.join(DEFAULT_REPOSITORY_ROOT, 'src', 'main', 'index.cjs'), 'utf8'), /foundation\.cjs/);
});
