const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { bootstrapFoundation, runtimeConfigPath } = require('./foundation.cjs');

let foundationSession;

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

ipcMain.handle('foundation:get-status', () => foundationSession?.status || { phase: 'starting' });

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
