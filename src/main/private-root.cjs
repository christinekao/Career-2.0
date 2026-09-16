const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const FOUNDATION_STATE_FILES = new Set([
  'foundation.lock',
  'foundation.lock.recovery',
  'foundation.sqlite',
  'foundation.sqlite-journal',
  'foundation.sqlite-shm',
  'foundation.sqlite-wal',
]);
const RECOVERY_CLAIM_NAME_PATTERN = /^foundation\.lock\.recovery\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class PrivateRootError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PrivateRootError';
    this.code = code;
  }
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === ''
    || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function sameFileIdentity(left, right) {
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino);
}

function isRecoveryClaimFileName(fileName) {
  return fileName === 'foundation.lock.recovery' || RECOVERY_CLAIM_NAME_PATTERN.test(fileName);
}

function isFoundationStateFileName(fileName) {
  return FOUNDATION_STATE_FILES.has(fileName) || isRecoveryClaimFileName(fileName);
}

function rootBindingFor(rootPath, stats) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      canonicalPath: rootPath,
      device: stats.dev,
      inode: stats.ino,
    }))
    .digest('hex');
}

function validatePrivateRoot(input, options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot || DEFAULT_REPOSITORY_ROOT);

  if (typeof input !== 'string' || input.trim() === '') {
    throw new PrivateRootError('PRIVATE_ROOT_NOT_CONFIGURED', 'A private root must be configured.');
  }
  if (!path.isAbsolute(input)) {
    throw new PrivateRootError('PRIVATE_ROOT_NOT_ABSOLUTE', 'The private root must be an absolute path.');
  }

  const normalizedPath = path.normalize(path.resolve(input));
  if (isInside(normalizedPath, repositoryRoot)) {
    throw new PrivateRootError('PRIVATE_ROOT_REPOSITORY_LOCAL', 'The private root cannot be the repository or its descendant.');
  }

  let canonicalPath;
  let stats;
  try {
    canonicalPath = fs.realpathSync.native(normalizedPath);
    stats = fs.statSync(canonicalPath);
  } catch (error) {
    throw new PrivateRootError('PRIVATE_ROOT_UNAVAILABLE', `The private root is unavailable: ${normalizedPath}`);
  }

  if (!stats.isDirectory()) {
    throw new PrivateRootError('PRIVATE_ROOT_NOT_DIRECTORY', 'The private root must be a directory.');
  }

  let repositoryCanonicalPath;
  try {
    repositoryCanonicalPath = fs.realpathSync.native(repositoryRoot);
  } catch {
    repositoryCanonicalPath = repositoryRoot;
  }
  if (isInside(canonicalPath, repositoryCanonicalPath)) {
    throw new PrivateRootError('PRIVATE_ROOT_REPOSITORY_LOCAL', 'The private root cannot resolve inside the repository.');
  }

  try {
    fs.accessSync(canonicalPath, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    throw new PrivateRootError('PRIVATE_ROOT_UNREADABLE', 'The private root must be readable and writable.');
  }

  return {
    inputPath: input,
    normalizedPath,
    canonicalPath,
    rootBinding: rootBindingFor(canonicalPath, stats),
    identity: {
      canonicalPath,
      device: stats.dev,
      inode: stats.ino,
    },
  };
}

function assertPrivateRootStable(privateRoot, options = {}) {
  const current = validatePrivateRoot(privateRoot.normalizedPath, options);
  if (current.rootBinding !== privateRoot.rootBinding) {
    throw new PrivateRootError('PRIVATE_ROOT_CHANGED', 'The private root identity changed during the operation.');
  }
  return current;
}

function ensureFoundationStateDirectory(privateRoot, options = {}) {
  const stableRoot = assertPrivateRootStable(privateRoot, options);
  const rootPath = stableRoot.canonicalPath;
  const stateDirectory = path.join(rootPath, '.career2');
  const rootStats = fs.statSync(rootPath);

  if (options.create !== false) {
    try {
      fs.mkdirSync(stateDirectory, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  let stateStats;
  let canonicalStatePath;
  try {
    stateStats = fs.lstatSync(stateDirectory);
    canonicalStatePath = fs.realpathSync.native(stateDirectory);
  } catch {
    throw new PrivateRootError('PRIVATE_STATE_PATH_UNSAFE', 'Foundation state directory cannot be resolved safely.');
  }

  const relativeStatePath = path.relative(rootPath, canonicalStatePath);
  if (
    !stateStats.isDirectory()
    || stateStats.isSymbolicLink()
    || stateStats.dev !== rootStats.dev
    || !isInside(canonicalStatePath, rootPath)
    || relativeStatePath !== '.career2'
  ) {
    throw new PrivateRootError('PRIVATE_STATE_PATH_UNSAFE', 'Foundation state directory must be a real directory inside the configured private root.');
  }

  const confirmedStateStats = fs.lstatSync(stateDirectory);
  const confirmedCanonicalPath = fs.realpathSync.native(stateDirectory);
  if (!sameFileIdentity(stateStats, confirmedStateStats) || path.relative(rootPath, confirmedCanonicalPath) !== '.career2') {
    throw new PrivateRootError('PRIVATE_STATE_PATH_UNSAFE', 'Foundation state directory changed while it was being validated.');
  }

  assertPrivateRootStable(privateRoot, options);
  return stateDirectory;
}

function assertFoundationFileSafe(privateRoot, fileName, options = {}) {
  if (!isFoundationStateFileName(fileName)) {
    throw new PrivateRootError('PRIVATE_STATE_PATH_INVALID', 'The requested foundation state file is not recognized.');
  }

  const stateDirectory = ensureFoundationStateDirectory(privateRoot, options);
  const filePath = path.join(stateDirectory, fileName);
  let initialStats;
  try {
    initialStats = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }

  if (!initialStats.isFile() || initialStats.isSymbolicLink() || initialStats.nlink !== 1) {
    throw new PrivateRootError('PRIVATE_STATE_PATH_UNSAFE', `Foundation state file is not an unlinked regular file: ${fileName}`);
  }

  let canonicalFilePath;
  let stateStats;
  let confirmedStats;
  try {
    canonicalFilePath = fs.realpathSync.native(filePath);
    stateStats = fs.lstatSync(stateDirectory);
    confirmedStats = fs.lstatSync(filePath);
  } catch {
    throw new PrivateRootError('PRIVATE_STATE_PATH_UNSAFE', `Foundation state file changed while being validated: ${fileName}`);
  }

  if (
    initialStats.dev !== stateStats.dev
    || !isInside(canonicalFilePath, stateDirectory)
    || path.relative(stateDirectory, canonicalFilePath) !== fileName
    || !sameFileIdentity(initialStats, confirmedStats)
  ) {
    throw new PrivateRootError('PRIVATE_STATE_PATH_UNSAFE', `Foundation state file must remain a regular file inside the configured private root: ${fileName}`);
  }

  assertPrivateRootStable(privateRoot, options);
  return confirmedStats;
}

function foundationStateDirectory(privateRoot) {
  return path.join(privateRoot.canonicalPath, '.career2');
}

function foundationDatabasePath(privateRoot) {
  return path.join(foundationStateDirectory(privateRoot), 'foundation.sqlite');
}

function foundationLockPath(privateRoot) {
  return path.join(foundationStateDirectory(privateRoot), 'foundation.lock');
}

function foundationLockRecoveryPath(privateRoot) {
  return foundationLockRecoveryClaimPath(privateRoot);
}

function foundationLockRecoveryClaimPath(privateRoot, claimId) {
  const fileName = claimId === undefined
    ? 'foundation.lock.recovery'
    : `foundation.lock.recovery.${claimId}`;
  if (!isRecoveryClaimFileName(fileName)) {
    throw new PrivateRootError('PRIVATE_STATE_PATH_INVALID', 'The requested recovery claim name is not recognized.');
  }
  return path.join(foundationStateDirectory(privateRoot), fileName);
}

module.exports = {
  DEFAULT_REPOSITORY_ROOT,
  PrivateRootError,
  assertFoundationFileSafe,
  assertPrivateRootStable,
  ensureFoundationStateDirectory,
  foundationDatabasePath,
  foundationLockPath,
  foundationLockRecoveryClaimPath,
  foundationLockRecoveryPath,
  foundationStateDirectory,
  isRecoveryClaimFileName,
  sameFileIdentity,
  validatePrivateRoot,
};
