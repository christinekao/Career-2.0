const fs = require('node:fs');
const path = require('node:path');

class RuntimeConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RuntimeConfigError';
    this.code = code;
  }
}

function readRuntimeConfig(configPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new RuntimeConfigError('RUNTIME_CONFIG_INVALID', `Runtime configuration is invalid: ${configPath}`);
  }
}

function writeRuntimeConfig(configPath, privateRoot) {
  if (typeof privateRoot !== 'string' || privateRoot.trim() === '') {
    throw new RuntimeConfigError('RUNTIME_CONFIG_INVALID', 'Runtime configuration requires a private root.');
  }

  const directory = path.dirname(configPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify({ privateRoot }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, configPath);
}

function configuredRoot({ argv = process.argv, env = process.env, config = {} } = {}) {
  const argument = argv.find((value) => value.startsWith('--private-root='));
  return argument ? argument.slice('--private-root='.length) : env.CAREER_PRIVATE_ROOT || config.privateRoot || null;
}

module.exports = {
  RuntimeConfigError,
  configuredRoot,
  readRuntimeConfig,
  writeRuntimeConfig,
};
