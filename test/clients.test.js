// -----------------------------------------------------------------------------
// The pyLoad client against the real answers of pyLoad 0.5.0b3.dev101
// (test/fixtures/pyload): the snapshot, the authentication headers, the
// commands, and each kind of error.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS } from '../src/clients/errors.js';
import { STATUSES, toSnapshot } from '../src/clients/model.js';
import { PyloadClient } from '../src/clients/pyload.js';
import { API_KEY, FakePyload, PASSWORD, USERNAME, fixtureJson } from './helpers/fakePyload.js';

const URL = 'http://192.0.2.10:8000';
const dev101 = (name) => fixtureJson(`0.5.0b3.dev101/${name}.json`);

/** A client on a canned answer; records the requests. */
function canned(answer) {
  const requests = [];
  const client = new PyloadClient({
    url: URL,
    apiKey: API_KEY,
    request: async (url, options) => {
      requests.push({ url, ...options });
      return typeof answer === 'function' ? answer(url, options) : answer;
    },
  });
  return { client, requests };
}

test('the snapshot of the real answers: paused while a file finishes downloading', () => {
  const snapshot = toSnapshot({
    status: dev101('status-paused-downloading'),
    queue: dev101('queue-data'),
    downloads: dev101('status-downloads'),
    free: dev101('free-space'),
    version: dev101('server-version'),
  });
  assert.equal(snapshot.version, '0.5.0');
  assert.equal(snapshot.status, STATUSES.PAUSED);
  assert.equal(snapshot.paused, true);
  assert.equal(snapshot.reconnect, true);
  assert.equal(snapshot.speedBps, 1_070_028);
  assert.equal(snapshot.active, 1);
  assert.equal(snapshot.queueCount, 4);
  assert.equal(snapshot.total, 5);
  assert.equal(snapshot.pendingCount, 1);
  assert.equal(snapshot.freeBytes, 51_441_360_896);
  assert.equal(snapshot.timeLeftSec, 224);
  assert.deepEqual(snapshot.downloads, [
    { id: 5, name: 'big.bin', packageName: 'Big file', percent: 23, etaSec: 224 },
  ]);
  assert.deepEqual(
    snapshot.packages.map((item) => [item.id, item.name, item.finished, item.bytes]),
    [
      [1, 'Small file', false, 0],
      [2, 'Missing file', false, 0],
      [3, 'Small file', true, 2_097_152],
      [4, 'Missing file', false, 0],
      [5, 'Big file', false, 0],
    ],
  );
  assert.deepEqual(
    snapshot.failed.map((file) => [file.key, file.packageName, file.reason]),
    [
      [
        '1:small.bin',
        'Small file',
        "Refusing to download from Server-Side host ('files.lan' resolves to 198.51.100.3)",
      ],
      [
        '2:missing.bin',
        'Missing file',
        "Refusing to download from Server-Side host ('files.lan' resolves to 198.51.100.3)",
      ],
      ['4:missing.bin', 'Missing file', 'offline'],
    ],
  );
});

test('the snapshot when everything is done: idle, two packages completed', () => {
  const snapshot = toSnapshot({
    status: dev101('status-idle'),
    queue: dev101('queue-data-finished'),
  });
  assert.equal(snapshot.status, STATUSES.IDLE);
  assert.equal(snapshot.pendingCount, 0);
  assert.equal(snapshot.freeBytes, null, 'not read');
  assert.deepEqual(
    snapshot.packages.filter((item) => item.finished).map((item) => [item.name, item.bytes]),
    [
      ['Small file', 2_097_152],
      ['Big file', 314_572_800],
    ],
  );
});

test('a reading costs 3 calls, 4 while downloading, and the version once', async () => {
  const pyload = new FakePyload();
  const client = new PyloadClient({
    url: URL,
    apiKey: API_KEY,
    request: (url, options) => pyload.handle(url, options),
  });
  await client.read();
  assert.deepEqual(pyload.requests.map((r) => r.name).sort(), [
    'free_space',
    'get_queue_data',
    'get_server_version',
    'status_server',
  ]);
  pyload.requests = [];
  pyload.download(pyload.addPackage('A', ['https://downloads.example.com/a']));
  const snapshot = await client.read();
  assert.equal(snapshot.status, STATUSES.DOWNLOADING);
  assert.deepEqual(pyload.requests.map((r) => `${r.method} ${r.name}`).sort(), [
    'GET free_space',
    'GET get_queue_data',
    'GET status_downloads',
    'GET status_server',
  ]);
});

test('API key in X-API-Key, user name and password in basic auth, both when both are set', async () => {
  const headersOf = async (options) => {
    let seen;
    const client = new PyloadClient({
      url: URL,
      ...options,
      request: async (url, request) => {
        seen = request.headers;
        return { status: 200, headers: {}, body: 'null' };
      },
    });
    await client.pause();
    return seen;
  };
  assert.deepEqual(await headersOf({ apiKey: API_KEY }), { 'x-api-key': API_KEY });
  assert.deepEqual(await headersOf({ username: USERNAME, password: PASSWORD }), {
    authorization: `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')}`,
  });
  assert.equal(Object.keys(await headersOf({ apiKey: API_KEY, username: USERNAME })).length, 2);
});

test('the commands: POST, JSON body for add_package', async () => {
  const { client, requests } = canned((url) => ({
    status: 200,
    headers: {},
    body: url.endsWith('add_package') ? '7' : url.endsWith('toggle_reconnect') ? 'true' : 'null',
  }));
  await client.pause();
  await client.resume();
  await client.restartFailed();
  assert.equal(await client.setReconnect(true), true);
  assert.equal(await client.addPackage('Name', ['https://a.example/x']), 7);
  assert.deepEqual(
    requests.map((r) => `${r.method} ${r.url.replace(URL, '')}`),
    [
      'POST /api/pause_server',
      'POST /api/unpause_server',
      'POST /api/restart_failed',
      'POST /api/toggle_reconnect',
      'POST /api/add_package',
    ],
  );
  assert.deepEqual(requests.at(-1).json, { name: 'Name', links: ['https://a.example/x'] });
});

const kindOf = async (answer) => {
  const { client } = canned(answer);
  try {
    await client.read();
  } catch (err) {
    return err.kind;
  }
  return 'none';
};
const reply = (status, body, headers = {}) => ({
  status,
  headers,
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('each answer of pyLoad becomes an error kind', async () => {
  assert.equal(await kindOf(reply(401, { error: 'Invalid API key' })), ERROR_KINDS.AUTH);
  assert.equal(await kindOf(reply(401, { error: 'Invalid API credentials' })), ERROR_KINDS.AUTH);
  assert.equal(await kindOf(reply(401, { error: 'Access denied' })), ERROR_KINDS.PERMISSION);
  assert.equal(
    await kindOf(reply(401, { error: 'Unauthorized - Insufficient permissions' })),
    ERROR_KINDS.PERMISSION,
  );
  assert.equal(await kindOf(reply(404, { error: 'Not Found' })), ERROR_KINDS.NOT_PYLOAD);
  assert.equal(await kindOf(reply(403, { error: 'Forbidden' })), ERROR_KINDS.NOT_PYLOAD);
  assert.equal(await kindOf(reply(200, '<html>Gladys</html>')), ERROR_KINDS.NOT_PYLOAD);
  assert.equal(await kindOf(reply(200, { hello: 1 })), ERROR_KINDS.NOT_PYLOAD);
  assert.equal(await kindOf(reply(302, '', { location: '/login?next=x' })), ERROR_KINDS.REDIRECT);
  assert.equal(await kindOf(reply(429, { error: 'Too Many Requests' })), ERROR_KINDS.RATE_LIMIT);
  assert.equal(await kindOf(reply(500, { error: 'Internal server error' })), ERROR_KINDS.HTTP);
  const offline = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  assert.equal(
    await kindOf(() => {
      throw offline;
    }),
    ERROR_KINDS.UNREACHABLE,
  );
  const tls = Object.assign(new Error('self-signed'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
  assert.equal(
    await kindOf(() => {
      throw tls;
    }),
    ERROR_KINDS.TLS,
  );
});

test('the free space is optional (the "status" permission), the rest is not', async () => {
  const pyload = new FakePyload();
  pyload.denied.add('free_space');
  const client = new PyloadClient({
    url: URL,
    apiKey: API_KEY,
    request: (url, options) => pyload.handle(url, options),
  });
  assert.equal((await client.read()).freeBytes, null);
  pyload.denied.add('get_queue_data');
  await assert.rejects(client.read(), { kind: ERROR_KINDS.PERMISSION });
});

test('the snapshot of a real dev96 queue: completed packages, an offline link', () => {
  const dev96 = (name) => fixtureJson(`0.5.0b3.dev96/${name}.json`);
  const snapshot = toSnapshot({ status: dev96('status-idle'), queue: dev96('queue-data') });
  assert.equal(snapshot.status, STATUSES.IDLE);
  assert.deepEqual(
    snapshot.packages.map((item) => [item.name, item.finished]),
    [
      ['Real test 2', false],
      ['Good one', true],
      ['Real test 2', false],
      ['Good one', true],
    ],
  );
  assert.deepEqual(
    snapshot.failed.map((file) => [file.name, file.reason]),
    [
      ['gone.bin', 'offline'],
      ['gone (1).bin', 'offline'],
    ],
  );
});
