const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const {
  bootstrapFoundation,
  runtimeConfigPath,
  toPublicError,
  toPublicFoundationStatus,
} = require('./foundation.cjs');

let foundationSession;

function publicIpcFailure(error, fallbackCode) {
  return { __career2PublicError: toPublicError(error, fallbackCode) };
}

async function invokeDomain(namespace, operation, args) {
  const handler = foundationSession?.[namespace]?.[operation];
  if (typeof handler !== 'function') {
    const error = new Error('Career 2.0 domain substrate is not ready.');
    error.code = 'DOMAIN_NOT_READY';
    return publicIpcFailure(error, 'DOMAIN_OPERATION_FAILED');
  }
  try {
    return await handler(...args);
  } catch (error) {
    return publicIpcFailure(error, 'DOMAIN_OPERATION_FAILED');
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 900,
    height: 680,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
    },
  });

  return window.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
}

ipcMain.handle('foundation:get-status', () => toPublicFoundationStatus(
  foundationSession?.status || { phase: 'starting' },
));

ipcMain.handle('opportunity:create', (_event, input) => invokeDomain('opportunity', 'create', [input]));
ipcMain.handle('opportunity:get', (_event, opportunityId) => invokeDomain('opportunity', 'get', [opportunityId]));
ipcMain.handle('opportunity:list', () => invokeDomain('opportunity', 'list', []));
ipcMain.handle('opportunity:add-jd-revision', (_event, opportunityId, input) => (
  invokeDomain('opportunity', 'addJdRevision', [opportunityId, input])
));
ipcMain.handle('opportunity:get-jd-revision', (_event, opportunityId, jdRevisionId) => (
  invokeDomain('opportunity', 'getJdRevision', [opportunityId, jdRevisionId])
));
ipcMain.handle('evidence:create', (_event, input) => invokeDomain('evidence', 'create', [input]));
ipcMain.handle('evidence:get', (_event, evidenceId) => invokeDomain('evidence', 'get', [evidenceId]));
ipcMain.handle('evidence:list', () => invokeDomain('evidence', 'list', []));
ipcMain.handle('evidence:create-revision', (_event, evidenceId, input) => (
  invokeDomain('evidence', 'createRevision', [evidenceId, input])
));
ipcMain.handle('evidence:confirm-revision', (_event, evidenceId, evidenceRevisionId, confirmedAt) => (
  invokeDomain('evidence', 'confirmRevision', [evidenceId, evidenceRevisionId, confirmedAt])
));

ipcMain.handle('intelligence:load-context', (_event, input) => invokeDomain('intelligence', 'loadContext', [input]));
ipcMain.handle('intelligence:start-execution', (_event, input) => invokeDomain('intelligence', 'startExecution', [input]));
ipcMain.handle('intelligence:cancel-execution', (_event, executionId) => invokeDomain('intelligence', 'cancelExecution', [executionId]));
ipcMain.handle('intelligence:get-execution', (_event, executionId) => invokeDomain('intelligence', 'getExecution', [executionId]));
ipcMain.handle('intelligence:get-positioning', (_event, positioningVersionId) => invokeDomain('intelligence', 'getPositioningVersion', [positioningVersionId]));
ipcMain.handle('intelligence:get-current-positioning', (_event, opportunityId) => invokeDomain('intelligence', 'getCurrentPositioning', [opportunityId]));
ipcMain.handle('intelligence:list-positioning', (_event, opportunityId) => invokeDomain('intelligence', 'listPositioningVersions', [opportunityId]));
ipcMain.handle('intelligence:confirm-positioning', (_event, positioningVersionId, confirmedAt) => (
  invokeDomain('intelligence', 'confirmPositioningVersion', [positioningVersionId, confirmedAt])
));

app.whenReady().then(async () => {
  foundationSession = bootstrapFoundation({
    configPath: runtimeConfigPath(app.getPath('userData')),
    argv: process.argv,
    env: process.env,
    repositoryRoot: path.resolve(__dirname, '..', '..'),
  });
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  try {
    foundationSession?.close();
  } finally {
    foundationSession = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
