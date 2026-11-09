import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DEFAULT_PROGRAM, loadConfig, programUrl } from '../src/config.ts';

test('defaults to OpenAI Technical Practitioner on its own CDP port', () => {
  const config = loadConfig({});
  assert.equal(config.programId, DEFAULT_PROGRAM.id);
  assert.equal(DEFAULT_PROGRAM.name, 'OpenAI Technical Practitioner');
  assert.equal(config.cdpPort, 9223);
  assert.equal(programUrl(config), `https://openai-partneru.sana.ai/program/${DEFAULT_PROGRAM.id}`);
});

test('keeps data per program, with one shared Chrome profile', () => {
  const id = '0F1E2D3C-4B5A-6978-8A9B-0C1D2E3F4A5B';
  const config = loadConfig({ PROGRAM_ID: id });
  assert.equal(config.programId, id.toLowerCase());
  assert.equal(config.programDir, path.join(config.dataDir, 'programs', id.toLowerCase()));
  assert.equal(config.auditPath, path.join(config.programDir, 'audit.jsonl'));
  assert.equal(config.probeDir, path.join(config.programDir, 'probe'));
  assert.equal(config.profileDir, path.join(config.dataDir, 'chrome-profile'));
});

test('rejects a PROGRAM_ID that is not a UUID (it becomes a folder name)', () => {
  assert.throws(() => loadConfig({ PROGRAM_ID: '../../etc' }), /PROGRAM_ID không hợp lệ/);
  assert.throws(() => loadConfig({ PROGRAM_ID: 'technical-practitioner' }), /PROGRAM_ID không hợp lệ/);
});

test('CDP_PORT and CHROME_PATH can be overridden', () => {
  const config = loadConfig({ CDP_PORT: '9333', CHROME_PATH: 'C:\\chrome.exe' });
  assert.equal(config.cdpPort, 9333);
  assert.equal(config.chromePath, 'C:\\chrome.exe');
});
