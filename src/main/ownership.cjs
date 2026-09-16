const crypto = require('node:crypto');
const fs = require('node:fs');

// Darwin exposes O_EXLOCK in <sys/fcntl.h>, but Node omits it from fs.constants.
const DARWIN_O_EXLOCK = 0x0020;
const DARWIN_OWNERSHIP_MODE = 'darwin-exlock-v1';

const {
  assertFoundationFileSafe,
  ensureFoundationStateDirectory,
  foundationLockPath,
  foundationLockRecoveryClaimPath,
  foundationLockRecoveryPath,
  isRecoveryClaimFileName,
  sameFileIdentity,
} = require('./private-root.cjs');

class OwnershipError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OwnershipError';
    this.code = code;
  }
}

function noFollowFlag() {
  return typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
}

function createExclusiveFile(filePath, value) {
  const flags = fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | fs.constants.O_EXCL
    | noFollowFlag();
  let descriptor;
  let identity;

  try {
    descriptor = fs.openSync(filePath, flags, 0o600);
    const stats = fs.fstatSync(descriptor);
    identity = { dev: stats.dev, ino: stats.ino };
    fs.writeFileSync(descriptor, `${JSON.stringify(value)}\n`);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    return identity;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the original failure.
      }
    }
    if (identity) unlinkIfSame(filePath, identity);
    throw error;
  }
}

function unlinkIfSame(filePath, expectedIdentity) {
  let stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (stats.isFile() && !stats.isSymbolicLink() && sameFileIdentity(stats, expectedIdentity)) {
    fs.unlinkSync(filePath);
  }
}

function inspectOwner(lockPath) {
  let descriptor;
  let raw;
  let identity;
  try {
    const before = fs.lstatSync(lockPath);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
      throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The ownership state is not a safe regular file.');
    }

    descriptor = fs.openSync(
      lockPath,
      fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0) | noFollowFlag(),
    );
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || !sameFileIdentity(before, opened)) {
      throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The ownership state changed while being opened.');
    }
    raw = fs.readFileSync(descriptor, 'utf8');
    const after = fs.lstatSync(lockPath);
    if (after.isSymbolicLink() || !sameFileIdentity(opened, after)) {
      throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The ownership state changed while being read.');
    }
    identity = { dev: opened.dev, ino: opened.ino };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof OwnershipError) throw error;
    throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The ownership state cannot be read safely.');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }

  let owner;
  try {
    owner = JSON.parse(raw);
  } catch {
    throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The ownership state is invalid and cannot be trusted.');
  }

  if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== 'string' || owner.token.length < 16) {
    throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The ownership state is incomplete and cannot be trusted.');
  }

  try {
    process.kill(owner.pid, 0);
    return { owner, active: true, fileIdentity: identity };
  } catch (error) {
    if (error.code === 'ESRCH') return { owner, active: false, fileIdentity: identity };
    throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The active owner cannot be determined safely.');
  }
}

function parseOwnerRecord(raw) {
  if (raw.trim() === '') return null;
  let owner;
  try {
    owner = JSON.parse(raw);
  } catch {
    throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The ownership state is invalid and cannot be trusted.');
  }

  if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== 'string' || owner.token.length < 16) {
    throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The ownership state is incomplete and cannot be trusted.');
  }
  return owner;
}

function assertOwnershipStatePathsSafe(privateRoot, options = {}) {
  assertFoundationFileSafe(privateRoot, 'foundation.lock', options);
  assertFoundationFileSafe(privateRoot, 'foundation.lock.recovery', options);
  const stateDirectory = ensureFoundationStateDirectory(privateRoot, { ...options, create: false });
  const fixedName = 'foundation.lock.recovery';
  for (const name of fs.readdirSync(stateDirectory).filter((entry) => entry.startsWith(`${fixedName}.`))) {
    assertFoundationFileSafe(privateRoot, name, { ...options, create: false });
  }
}

function createOwnerRecord(privateRoot) {
  return {
    pid: process.pid,
    token: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    rootBinding: privateRoot.rootBinding,
  };
}

function createRecoveryOwner(privateRoot, owner, staleState) {
  return {
    pid: process.pid,
    token: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    rootBinding: privateRoot.rootBinding,
    ownershipMode: 'recovery-claim-v2',
    ownerToken: owner.token,
    stalePid: staleState.owner.pid,
    staleToken: staleState.owner.token,
    staleFileIdentity: staleState.fileIdentity,
  };
}

function listRecoveryClaims(privateRoot, options) {
  const stateDirectory = ensureFoundationStateDirectory(privateRoot, { ...options, create: false });
  const fixedName = 'foundation.lock.recovery';
  const names = fs.readdirSync(stateDirectory)
    .filter((name) => name === fixedName || name.startsWith(`${fixedName}.`))
    .sort();

  return names.map((name) => {
    if (!isRecoveryClaimFileName(name)) {
      throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The recovery claim name is not recognized safely.');
    }
    const claimPath = name === fixedName
      ? foundationLockRecoveryPath(privateRoot)
      : foundationLockRecoveryClaimPath(privateRoot, name.slice(`${fixedName}.`.length));
    const claimIdentity = assertFoundationFileSafe(privateRoot, name, { ...options, create: false });
    if (!claimIdentity) return null;
    const state = inspectOwner(claimPath);
    if (!state) return null;
    if (state.owner.rootBinding && state.owner.rootBinding !== privateRoot.rootBinding) {
      throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The recovery claim belongs to a different private-root identity.');
    }
    return { name, path: claimPath, state, fileIdentity: claimIdentity };
  }).filter(Boolean);
}

function writeRecoveryClaimRecord(privateRoot, options, claim, owner, expectedIdentity) {
  let descriptor;
  try {
    const pathIdentity = assertFoundationFileSafe(privateRoot, claim.name, { ...options, create: false });
    if (!pathIdentity || !sameFileIdentity(pathIdentity, expectedIdentity)) {
      throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The recovery claim changed before it could be published.');
    }

    descriptor = fs.openSync(
      claim.path,
      fs.constants.O_RDWR | (fs.constants.O_NONBLOCK || 0) | noFollowFlag(),
    );
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || !sameFileIdentity(opened, expectedIdentity)) {
      throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The recovery claim changed while it was opened.');
    }

    const contents = Buffer.from(`${JSON.stringify(owner)}\n`);
    fs.ftruncateSync(descriptor, 0);
    fs.writeSync(descriptor, contents, 0, contents.length, 0);
    fs.ftruncateSync(descriptor, contents.length);
    fs.fsyncSync(descriptor);

    const confirmedDescriptor = fs.fstatSync(descriptor);
    const confirmedPath = assertFoundationFileSafe(privateRoot, claim.name, { ...options, create: false });
    if (!sameFileIdentity(confirmedDescriptor, expectedIdentity) || !sameFileIdentity(confirmedPath, expectedIdentity)) {
      throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The recovery claim changed while it was published.');
    }
  } catch (error) {
    if (error instanceof OwnershipError || error.name === 'PrivateRootError') throw error;
    throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The recovery claim could not be published safely.');
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the original failure, if any.
      }
    }
  }
}

function createRecoveryClaim(privateRoot, options, owner) {
  const claim = {
    name: 'foundation.lock.recovery',
    path: foundationLockRecoveryPath(privateRoot),
  };
  let fileIdentity;
  try {
    fileIdentity = createExclusiveFile(claim.path, owner);
    const confirmedPath = assertFoundationFileSafe(privateRoot, claim.name, { ...options, create: false });
    if (!confirmedPath || !sameFileIdentity(confirmedPath, fileIdentity)) {
      throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The recovery claim could not be confirmed safely.');
    }
    const confirmed = inspectOwner(claim.path);
    if (
      !confirmed
      || confirmed.owner.pid !== owner.pid
      || confirmed.owner.token !== owner.token
      || !sameFileIdentity(confirmed.fileIdentity, fileIdentity)
    ) {
      throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The newly created recovery claim could not be confirmed.');
    }
    return { ...claim, owner, fileIdentity };
  } catch (error) {
    if (fileIdentity) unlinkIfSame(claim.path, fileIdentity);
    throw error;
  }
}

function takeOverRecoveryClaim(privateRoot, options, existingClaim, owner) {
  const claimId = crypto.randomUUID();
  const nextClaim = {
    name: `foundation.lock.recovery.${claimId}`,
    path: foundationLockRecoveryClaimPath(privateRoot, claimId),
  };
  let fileIdentity;
  try {
    fs.renameSync(existingClaim.path, nextClaim.path);

    const movedIdentity = assertFoundationFileSafe(privateRoot, nextClaim.name, { ...options, create: false });
    if (!movedIdentity || !sameFileIdentity(movedIdentity, existingClaim.fileIdentity)) {
      throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The stale recovery claim changed during takeover.');
    }
    fileIdentity = { dev: movedIdentity.dev, ino: movedIdentity.ino };

    const priorOwner = existingClaim.state.owner;
    const priorStaleFileIdentity = priorOwner.staleFileIdentity;
    if (
      !Number.isInteger(priorOwner.stalePid)
      || priorOwner.stalePid <= 0
      || typeof priorOwner.staleToken !== 'string'
      || priorOwner.staleToken.length < 16
      || typeof priorStaleFileIdentity !== 'object'
      || !Number.isInteger(priorStaleFileIdentity.dev)
      || !Number.isInteger(priorStaleFileIdentity.ino)
    ) {
      throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The stale recovery generation cannot be trusted safely.');
    }

    const recoveryOwner = {
      pid: process.pid,
      token: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      rootBinding: privateRoot.rootBinding,
      ownershipMode: 'recovery-claim-v2',
      ownerToken: owner.token,
      stalePid: priorOwner.stalePid,
      staleToken: priorOwner.staleToken,
      staleFileIdentity: priorStaleFileIdentity,
    };
    writeRecoveryClaimRecord(privateRoot, options, nextClaim, recoveryOwner, fileIdentity);

    const confirmed = inspectOwner(nextClaim.path);
    if (
      !confirmed
      || confirmed.owner.pid !== recoveryOwner.pid
      || confirmed.owner.token !== recoveryOwner.token
      || !sameFileIdentity(confirmed.fileIdentity, fileIdentity)
    ) {
      throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The recovered recovery claim could not be confirmed.');
    }
    return { ...nextClaim, owner: recoveryOwner, fileIdentity };
  } catch (error) {
    if (fileIdentity) unlinkIfSame(nextClaim.path, fileIdentity);
    throw error;
  }
}

function recoveryClaimTargetsCurrent(recoveryClaim, current) {
  if (!current) return true;
  const recoveryOwner = recoveryClaim.owner;
  const targetsStaleGeneration = current.owner.pid === recoveryOwner.stalePid
    && current.owner.token === recoveryOwner.staleToken
    && sameFileIdentity(current.fileIdentity, recoveryOwner.staleFileIdentity);
  const targetsInterruptedRecoveryOwner = current.owner.pid === recoveryOwner.pid
    && current.owner.token === recoveryOwner.ownerToken;
  return targetsStaleGeneration || targetsInterruptedRecoveryOwner;
}

function acquireDarwinOwnership(privateRoot, options) {
  ensureFoundationStateDirectory(privateRoot, options);
  assertOwnershipStatePathsSafe(privateRoot, options);
  const lockPath = foundationLockPath(privateRoot);
  assertFoundationFileSafe(privateRoot, 'foundation.lock', options);

  const owner = {
    pid: process.pid,
    token: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    rootBinding: privateRoot.rootBinding,
    ownershipMode: DARWIN_OWNERSHIP_MODE,
  };
  const flags = fs.constants.O_CREAT
    | fs.constants.O_RDWR
    | fs.constants.O_NONBLOCK
    | noFollowFlag()
    | DARWIN_O_EXLOCK;

  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, flags, 0o600);
  } catch (error) {
    if (error.code === 'EAGAIN' || error.code === 'EWOULDBLOCK') {
      throw new OwnershipError('OWNERSHIP_CONFLICT', 'Another active process owns this private root.');
    }
    if (error.code === 'ELOOP') {
      throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The ownership path became unsafe while it was opened.');
    }
    throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The kernel ownership lock could not be acquired safely.');
  }

  try {
    const opened = fs.fstatSync(descriptor);
    const currentPath = assertFoundationFileSafe(privateRoot, 'foundation.lock', options);
    if (!opened.isFile() || opened.nlink !== 1 || !sameFileIdentity(opened, currentPath)) {
      throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The ownership path changed while its kernel lock was acquired.');
    }

    const previousOwner = parseOwnerRecord(fs.readFileSync(descriptor, 'utf8'));
    if (previousOwner) {
      if (previousOwner.rootBinding && previousOwner.rootBinding !== privateRoot.rootBinding) {
        throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The ownership record belongs to a different private-root identity.');
      }
      // A prior version may still be using the PID-record lock without the
      // kernel lock. The PID is only a compatibility guard for those records;
      // successful O_EXLOCK acquisition is authoritative for this mode.
      if (previousOwner.ownershipMode !== DARWIN_OWNERSHIP_MODE && previousOwner.pid !== process.pid) {
        try {
          process.kill(previousOwner.pid, 0);
          throw new OwnershipError('OWNERSHIP_CONFLICT', 'A previous owner process is still active.');
        } catch (error) {
          if (error instanceof OwnershipError) throw error;
          if (error.code !== 'ESRCH') {
            throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The previous owner process cannot be determined safely.');
          }
        }
      }
    }

    const contents = Buffer.from(`${JSON.stringify(owner)}\n`);
    fs.ftruncateSync(descriptor, 0);
    fs.writeSync(descriptor, contents, 0, contents.length, 0);
    fs.ftruncateSync(descriptor, contents.length);
    fs.fsyncSync(descriptor);

    const confirmedDescriptor = fs.fstatSync(descriptor);
    const confirmedPath = assertFoundationFileSafe(privateRoot, 'foundation.lock', options);
    if (!sameFileIdentity(confirmedDescriptor, opened) || !sameFileIdentity(confirmedPath, opened)) {
      throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The ownership path changed while publishing the new owner.');
    }
    ensureFoundationStateDirectory(privateRoot, options);
    const confirmedOwner = inspectOwner(lockPath);
    if (
      !confirmedOwner
      || confirmedOwner.owner.pid !== owner.pid
      || confirmedOwner.owner.token !== owner.token
      || !sameFileIdentity(confirmedOwner.fileIdentity, opened)
    ) {
      throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The newly acquired ownership record could not be confirmed.');
    }

    let released = false;
    return {
      lockPath,
      rootBinding: privateRoot.rootBinding,
      assertActive() {
        if (released) throw new OwnershipError('OWNERSHIP_RELEASED', 'Ownership has been released.');
        try {
          ensureFoundationStateDirectory(privateRoot, { ...options, create: false });
          assertFoundationFileSafe(privateRoot, 'foundation.lock', { ...options, create: false });
          const descriptorIdentity = fs.fstatSync(descriptor);
          const state = inspectOwner(lockPath);
          if (
            !state
            || !state.active
            || state.owner.pid !== owner.pid
            || state.owner.token !== owner.token
            || !sameFileIdentity(descriptorIdentity, opened)
            || !sameFileIdentity(state.fileIdentity, opened)
          ) {
            throw new OwnershipError('OWNERSHIP_LOST', 'Write ownership is no longer active.');
          }
        } catch (error) {
          if (error instanceof OwnershipError) throw error;
          throw new OwnershipError('OWNERSHIP_LOST', 'Write ownership is no longer active.');
        }
      },
      release() {
        if (released) return;
        released = true;
        try {
          fs.closeSync(descriptor);
        } catch {
          // Closing the descriptor is the kernel ownership-release operation.
        }
      },
    };
  } catch (error) {
    try {
      fs.closeSync(descriptor);
    } catch {
      // Preserve the original failure.
    }
    if (error instanceof OwnershipError || error.name === 'PrivateRootError') throw error;
    throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'The acquired kernel ownership state could not be validated.');
  }
}

function createOwnership(privateRoot, options, lockPath, owner, fileIdentity) {
  let released = false;
  return {
    lockPath,
    rootBinding: privateRoot.rootBinding,
    assertActive() {
      if (released) throw new OwnershipError('OWNERSHIP_RELEASED', 'Ownership has been released.');
      try {
        ensureFoundationStateDirectory(privateRoot, { ...options, create: false });
        assertFoundationFileSafe(privateRoot, 'foundation.lock', { ...options, create: false });
      } catch {
        throw new OwnershipError('OWNERSHIP_LOST', 'Write ownership is no longer active.');
      }

      const state = inspectOwner(lockPath);
      if (
        !state
        || state.owner.token !== owner.token
        || state.owner.pid !== process.pid
        || !state.active
        || !sameFileIdentity(state.fileIdentity, fileIdentity)
      ) {
        throw new OwnershipError('OWNERSHIP_LOST', 'Write ownership is no longer active.');
      }
    },
    release() {
      if (released) return;
      released = true;
      try {
        ensureFoundationStateDirectory(privateRoot, { ...options, create: false });
        const state = inspectOwner(lockPath);
        if (
          state
          && state.owner.token === owner.token
          && state.owner.pid === process.pid
          && sameFileIdentity(state.fileIdentity, fileIdentity)
        ) {
          assertFoundationFileSafe(privateRoot, 'foundation.lock', { ...options, create: false });
          unlinkIfSame(lockPath, fileIdentity);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') return;
      }
    },
  };
}

function releaseRecoveryClaim(privateRoot, options, recoveryClaim) {
  try {
    ensureFoundationStateDirectory(privateRoot, { ...options, create: false });
    const claimStats = assertFoundationFileSafe(
      privateRoot,
      recoveryClaim.name,
      { ...options, create: false },
    );
    if (claimStats && sameFileIdentity(claimStats, recoveryClaim.fileIdentity)) {
      unlinkIfSame(recoveryClaim.path, recoveryClaim.fileIdentity);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function acquireRootOwnership(privateRoot, options = {}) {
  ensureFoundationStateDirectory(privateRoot, options);
  if (process.platform === 'darwin') return acquireDarwinOwnership(privateRoot, options);

  const lockPath = foundationLockPath(privateRoot);

  for (let attempt = 0; attempt < 6; attempt += 1) {
    ensureFoundationStateDirectory(privateRoot, options);
    assertOwnershipStatePathsSafe(privateRoot, options);
    const owner = createOwnerRecord(privateRoot);
    const recoveryClaims = listRecoveryClaims(privateRoot, options);
    const activeRecoveryClaim = recoveryClaims.find((claim) => claim.state.active);
    if (activeRecoveryClaim) {
      throw new OwnershipError('OWNERSHIP_RECOVERY_IN_PROGRESS', 'Another process is recovering stale ownership.');
    }

    let recoveryClaim;
    if (recoveryClaims.length > 0) {
      recoveryClaim = takeOverRecoveryClaim(privateRoot, options, recoveryClaims[0], owner);
      if (!recoveryClaim) continue;
    } else {
      try {
        const fileIdentity = createExclusiveFile(lockPath, owner);
        return createOwnership(privateRoot, options, lockPath, owner, fileIdentity);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }

      const staleState = inspectOwner(lockPath);
      if (!staleState) continue;
      if (staleState.active) {
        throw new OwnershipError('OWNERSHIP_CONFLICT', 'Another active process owns this private root.');
      }

      const recoveryOwner = createRecoveryOwner(privateRoot, owner, staleState);
      try {
        recoveryClaim = createRecoveryClaim(privateRoot, options, recoveryOwner);
      } catch (error) {
        if (error.code === 'EEXIST') continue;
        throw error;
      }
    }

    try {
      ensureFoundationStateDirectory(privateRoot, options);
      const current = inspectOwner(lockPath);
      if (current?.active) {
        throw new OwnershipError('OWNERSHIP_CONFLICT', 'Another active process owns this private root.');
      }
      if (!recoveryClaimTargetsCurrent(recoveryClaim, current)) continue;

      if (current) {
        unlinkIfSame(lockPath, current.fileIdentity);
        const afterRemoval = inspectOwner(lockPath);
        if (afterRemoval) {
          if (afterRemoval.active) {
            throw new OwnershipError('OWNERSHIP_CONFLICT', 'Another active process acquired this private root.');
          }
          if (!recoveryClaimTargetsCurrent(recoveryClaim, afterRemoval)) continue;
          continue;
        }
      }

      try {
        const fileIdentity = createExclusiveFile(lockPath, owner);
        return createOwnership(privateRoot, options, lockPath, owner, fileIdentity);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const winner = inspectOwner(lockPath);
        if (winner?.active) {
          throw new OwnershipError('OWNERSHIP_CONFLICT', 'Another active process acquired this private root.');
        }
      }
    } finally {
      releaseRecoveryClaim(privateRoot, options, recoveryClaim);
    }
  }

  throw new OwnershipError('OWNERSHIP_UNCERTAIN', 'Ownership could not be established safely.');
}

module.exports = {
  OwnershipError,
  acquireRootOwnership,
};
