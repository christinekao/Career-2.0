const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const repositoryRoot = path.resolve(__dirname, '..');
const mainPath = path.join(repositoryRoot, 'src', 'main', 'index.cjs');
const foundationPath = path.join(repositoryRoot, 'src', 'main', 'foundation.cjs');
const preloadPath = path.join(repositoryRoot, 'src', 'preload', 'index.cjs');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'career-2-public-ipc-error-'));
const userDataPath = path.join(temporaryRoot, 'user-data');
const privateRootPath = path.join(temporaryRoot, 'private-root');
fs.mkdirSync(userDataPath);
fs.mkdirSync(privateRootPath);
app.setPath('userData', userDataPath);

const privatePath = path.join(privateRootPath, '.career2', 'foundation.sqlite');
const configPath = path.join(userDataPath, 'config.json');
const secrets = [privateRootPath, privatePath, configPath, path.join(privateRootPath, '.career2'), os.homedir()];
let failed = false;
let cleaned = false;

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

function internalError(code, message, stack) {
  const error = new Error(message);
  error.code = code;
  if (stack) error.stack = stack;
  return error;
}

function testFoundationSession() {
  const status = {
    phase: 'ready',
    foundationPhase: 'ready',
    opportunityEvidencePhase: 'ready',
    storeIdentity: 'synthetic-public-ipc-error-probe',
    storeVersion: 1,
    opportunityEvidenceSchemaVersion: 1,
  };

  return {
    status,
    opportunity: {
      create(input = {}) {
        switch (input.scenario) {
          case 'private-path':
            throw internalError(
              'OPPORTUNITY_INVALID',
              `invalid input: root=${privatePath}; home=${os.homedir()}`,
              `Error: internal stack root=${privatePath}\n    at synthetic-domain-fixture (${privatePath})`,
            );
          case 'sqlite-config':
            throw internalError(
              'OPPORTUNITY_EVIDENCE_MIGRATION_FAILED',
              `SQLite failure database=${privatePath} config=${configPath}`,
              `Error: sqlite stack database=${privatePath}\n    at synthetic-domain-fixture (${configPath})`,
            );
          case 'unknown':
            throw internalError(
              'UNEXPECTED_INTERNAL_TEST_CODE',
              `unexpected internal failure at ${privatePath}; config=${configPath}`,
              `Error: unknown stack ${privatePath}`,
            );
          case 'known':
            throw internalError('OPPORTUNITY_NOT_FOUND', 'Opportunity does not exist.');
          default:
            return { opportunityId: 'synthetic-opportunity', scenario: 'success' };
        }
      },
    },
    evidence: {},
    close() {},
  };
}

function assertSafePublicError(record, expectedCode, expectedMessage) {
  assert.deepEqual(record.enumerableKeys, ['code', 'message']);
  assert.deepEqual(record.ownKeys, ['code', 'message']);
  assert.equal(record.code, expectedCode);
  assert.equal(record.message, expectedMessage);
  assert.equal(record.stack, undefined);
  for (const secret of secrets) {
    assert.equal(record.serialized.includes(secret), false, `public payload leaked ${secret}`);
  }
  assert.equal(record.serialized.includes('.career2'), false);
  assert.equal(record.serialized.includes('SQLite'), false);
  assert.equal(record.serialized.includes('database'), false);
  assert.equal(record.serialized.includes('config'), false);
}

function fail(error) {
  if (failed) return;
  failed = true;
  console.error(error.stack || error);
  process.exitCode = 1;
  app.quit();
}

const timeout = setTimeout(() => {
  fail(new Error('Public IPC error probe timed out.'));
}, 15000);

const originalFoundation = require(foundationPath);
const testSession = testFoundationSession();
const injectedFoundation = {
  ...originalFoundation,
  bootstrapFoundation: () => testSession,
};
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (parent?.filename === mainPath && request === './foundation.cjs') return injectedFoundation;
  return originalLoad.call(this, request, parent, isMain);
};

app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        const capability = window.careerFoundation;
        const capture = async (name, operation) => {
          try {
            const value = await operation();
            return { name, kind: 'success', value };
          } catch (error) {
            return {
              name,
              kind: 'error',
              enumerableKeys: Object.keys(error).sort(),
              ownKeys: Object.getOwnPropertyNames(error).sort(),
              code: error?.code,
              message: error?.message,
              stack: error?.stack,
              serialized: JSON.stringify(error),
            };
          }
        };
        return {
          capabilityKeys: Object.keys(capability).sort(),
          privatePath: await capture('private-path', () => capability.opportunity.create({ scenario: 'private-path' })),
          sqliteConfig: await capture('sqlite-config', () => capability.opportunity.create({ scenario: 'sqlite-config' })),
          unknown: await capture('unknown', () => capability.opportunity.create({ scenario: 'unknown' })),
          known: await capture('known', () => capability.opportunity.create({ scenario: 'known' })),
          success: await capture('success', () => capability.opportunity.create({ scenario: 'success' })),
        };
      })()`);

      assert.deepEqual(result.capabilityKeys, ['evidence', 'getStatus', 'intelligence', 'opportunity']);
      assert.equal(result.privatePath.kind, 'error');
      assertSafePublicError(
        result.privatePath,
        'OPPORTUNITY_INVALID',
        'The Opportunity input is invalid.',
      );
      assert.equal(result.sqliteConfig.kind, 'error');
      assertSafePublicError(
        result.sqliteConfig,
        'OPPORTUNITY_EVIDENCE_MIGRATION_FAILED',
        'Opportunity/Evidence substrate migration failed.',
      );
      assert.equal(result.unknown.kind, 'error');
      assertSafePublicError(
        result.unknown,
        'DOMAIN_OPERATION_FAILED',
        'The domain operation failed.',
      );
      assert.equal(result.known.kind, 'error');
      assertSafePublicError(
        result.known,
        'OPPORTUNITY_NOT_FOUND',
        'The Opportunity was not found.',
      );
      assert.deepEqual(result.success, {
        name: 'success',
        kind: 'success',
        value: { opportunityId: 'synthetic-opportunity', scenario: 'success' },
      });
      console.log(JSON.stringify({
        publicBoundary: 'ipcRenderer.invoke -> preload -> renderer',
        capabilityKeys: result.capabilityKeys,
        cases: ['private-path', 'sqlite-config', 'unknown', 'known', 'success'],
        preloadPath,
      }));
      clearTimeout(timeout);
      app.quit();
    } catch (error) {
      fail(error);
    }
  });
});

app.on('will-quit', () => {
  clearTimeout(timeout);
  cleanup();
});

process.on('exit', cleanup);

require(mainPath);
