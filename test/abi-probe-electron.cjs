const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const Database = require('better-sqlite3');

assert.equal(process.versions.electron, '44.3.0');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-2-abi-'));
const databasePath = path.join(root, 'probe.sqlite');
const database = new Database(databasePath);

try {
  database.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  const insert = database.prepare('INSERT INTO probe (value) VALUES (?)');
  const writeTransaction = database.transaction((value) => insert.run(value));
  writeTransaction('electron-abi-ok');
  assert.equal(database.prepare('SELECT value FROM probe WHERE id = 1').pluck().get(), 'electron-abi-ok');
  database.close();

  const reopened = new Database(databasePath);
  assert.equal(reopened.prepare('SELECT COUNT(*) FROM probe').pluck().get(), 1);
  reopened.close();
  console.log(`Electron ${process.versions.electron} / Node ${process.versions.node} better-sqlite3 ABI probe passed`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
