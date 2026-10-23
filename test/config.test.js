import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseServerUrl } from '../src/config.js';

test('server addresses: bare host gets port 8000, URL copied from the browser', () => {
  assert.equal(parseServerUrl('192.0.2.10'), 'http://192.0.2.10:8000');
  assert.equal(parseServerUrl(' nas.local:8001 '), 'http://nas.local:8001');
  assert.equal(parseServerUrl('http://192.0.2.10:8000/dashboard'), 'http://192.0.2.10:8000');
  assert.equal(parseServerUrl('https://dl.example.com/pyload/'), 'https://dl.example.com/pyload');
  assert.equal(
    parseServerUrl('https://dl.example.com/pyload/api'),
    'https://dl.example.com/pyload',
  );
  assert.equal(parseServerUrl('http://192.0.2.10'), 'http://192.0.2.10', 'a scheme keeps port 80');
});

test('unusable addresses are refused, credentials in the address too', () => {
  for (const raw of ['', '   ', 'ftp://192.0.2.10', 'http://', 'http://u:p@192.0.2.10:8000', 42]) {
    assert.equal(parseServerUrl(raw), null, String(raw));
  }
});

test('defaults: no server, 30 seconds, adding links off, French', () => {
  const config = normalizeConfig(DEFAULT_CONFIG);
  assert.deepEqual(config, {
    servers: [],
    invalidSlots: [],
    allowSelfSigned: false,
    allowAddLinks: false,
    pollIntervalMs: 30_000,
    language: 'fr',
  });
  assert.deepEqual(normalizeConfig(undefined).servers, []);
});

test('servers by slot, secrets kept as typed, bad values fall back to the defaults', () => {
  const config = normalizeConfig({
    server_1_url: 'bad url with spaces',
    server_2_url: '192.0.2.20',
    server_2_api_key: ' pl_key ',
    server_2_username: ' admin ',
    server_2_password: ' with spaces ',
    server_2_name: 'x'.repeat(60),
    poll_interval: '7',
    language: 'it',
    allow_add_links: 'true',
  });
  assert.deepEqual(config.invalidSlots, [1]);
  assert.deepEqual(config.servers, [
    {
      slot: 2,
      url: 'http://192.0.2.20:8000',
      apiKey: 'pl_key',
      username: 'admin',
      password: ' with spaces ',
      name: 'x'.repeat(40),
    },
  ]);
  assert.equal(config.pollIntervalMs, 30_000);
  assert.equal(config.language, 'fr');
  assert.equal(config.allowAddLinks, true);
});
