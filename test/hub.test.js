// -----------------------------------------------------------------------------
// The hub: devices, states of the added devices, scene events once per
// completed package, failed file and emptied queue (also after a restart),
// the timed pause, the commands of the devices and of the scene actions, a
// server that stops answering, refused credentials.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import { FEATURE_KEYS } from '../src/devices.js';
import { TRIGGERS } from '../src/hub.js';
import {
  BOTH_CONFIG,
  FakePyload,
  ONE_CONFIG,
  OLD_PYLOAD_URL,
  PYLOAD_URL,
  createAll,
  createWorld,
  deviceId,
  featureId,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const events = (w, key) => w.fake.sceneEvents.filter((event) => event.key === key);
const LINK = 'https://downloads.example.com/file.zip';

test('one device per server, published with should_poll false', async (t) => {
  const w = await world(t, { config: BOTH_CONFIG });
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => [device.name, device.should_poll, device.params]),
    [
      ['NAS', false, [{ name: 'URL', value: PYLOAD_URL }]],
      ['Old', false, [{ name: 'URL', value: OLD_PYLOAD_URL }]],
    ],
  );
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  // dev101 gets the API key only, dev96 basic auth only.
  assert.ok(w.pyload.requests.length > 0 && w.old.requests.length > 0);
});

test('states only for the added devices, all of them once added', async (t) => {
  const w = await world(t);
  const pid = w.pyload.addPackage('Linux ISO', [LINK]);
  w.pyload.download(pid);
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, 0, 'nothing before the device exists');
  await createAll(w);
  const value = (key) => w.fake.lastState(featureId(w.gladys, key));
  assert.equal(value(FEATURE_KEYS.PAUSED), 0);
  assert.equal(value(FEATURE_KEYS.RECONNECT), 0);
  assert.equal(value(FEATURE_KEYS.SPEED), 1.02);
  assert.equal(value(FEATURE_KEYS.ACTIVE), 1);
  // The real fixture: 2 failed (SSRF refusal), 1 offline, 2 finished; + 1 now.
  assert.equal(value(FEATURE_KEYS.QUEUE), 4);
  assert.equal(value(FEATURE_KEYS.TOTAL), 6);
  assert.equal(value(FEATURE_KEYS.FAILED), 3);
  assert.equal(value(FEATURE_KEYS.FREE), 47.9);
  assert.equal(value(FEATURE_KEYS.STATUS), 'Downloading');
  assert.equal(value(FEATURE_KEYS.LAST), 'Big file', 'the newest finished package at start');
  assert.equal(w.fake.transports.at(-1).transport, 'local');
  assert.ok(w.fake.widgetRefreshes.length > 0, 'the widget is refreshed');
});

test('only the changes are sent', async (t) => {
  const w = await world(t);
  await createAll(w);
  const before = w.fake.states.length;
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, before, 'nothing changed, nothing sent');
  w.pyload.paused = true;
  await w.hub.pollAll();
  const sent = w.fake.states.slice(before).map((state) => state.device_feature_external_id);
  assert.deepEqual(sent.map((id) => id.split(':').at(-1)).sort(), ['paused', 'status']);
});

test('a completed package fires once, with its details, and becomes the last download', async (t) => {
  const w = await world(t, { config: BOTH_CONFIG });
  assert.equal(w.fake.sceneEvents.length, 0, 'the queue read at start is not announced');
  const pid = w.pyload.addPackage('Holiday photos', [LINK, `${LINK}.2`]);
  await w.hub.pollAll();
  w.pyload.finish(pid, 3 * 1024 * 1024);
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(events(w, TRIGGERS.COMPLETED), [
    {
      key: TRIGGERS.COMPLETED,
      data: {
        device: deviceId(w.gladys, 1),
        server: 'NAS',
        name: 'Holiday photos',
        files: 2,
        size_mb: 6,
      },
    },
  ]);
  assert.equal(events(w, TRIGGERS.QUEUE_EMPTY).length, 1, 'nothing left: queue empty');
  await createAll(w);
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.LAST)), 'Holiday photos');
});

test('a failed file fires once, with its reason; restarted then failed again fires again', async (t) => {
  const w = await world(t);
  const pid = w.pyload.addPackage('Broken', [LINK, `${LINK}.2`]);
  await w.hub.pollAll();
  w.pyload.fail(pid, 0, { status: 1 });
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.deepEqual(
    events(w, TRIGGERS.FAILED).map((event) => event.data),
    [
      {
        device: deviceId(w.gladys),
        server: 'NAS',
        name: 'file.zip',
        package: 'Broken',
        reason: 'offline',
      },
    ],
  );
  assert.equal(events(w, TRIGGERS.QUEUE_EMPTY).length, 0, 'the second file is still queued');
  w.pyload.fail(pid, 1);
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.FAILED).at(-1).data.reason, 'Connection timed out');
  assert.equal(events(w, TRIGGERS.QUEUE_EMPTY).length, 1);
  assert.equal(events(w, TRIGGERS.COMPLETED).length, 0, 'a failed package is not completed');

  // "Restart failed files": the failed one (not the offline one) is retried.
  assert.deepEqual((await w.fake.sceneAction('restart_failed', {})).data.outputs, { servers: 1 });
  assert.ok(w.pyload.requests.some((r) => r.method === 'POST' && r.name === 'restart_failed'));
  w.pyload.fail(pid, 1);
  await w.hub.pollAll();
  assert.equal(events(w, TRIGGERS.FAILED).length, 3, 'failed again: announced again');
});

test('the failures of the real fixture, at start, are not announced', async (t) => {
  const w = await world(t);
  await w.hub.pollAll();
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('after a restart, what changed meanwhile is announced, not the old state', async (t) => {
  const pyload = new FakePyload();
  const servers = { [PYLOAD_URL]: pyload };
  const first = await createWorld({ servers });
  const pid = pyload.addPackage('Overnight', [LINK]);
  await first.hub.pollAll();
  await first.app.stop();
  pyload.finish(pid);
  const second = await world(t, { servers, dataDir: first.dataDir });
  assert.deepEqual(
    second.fake.sceneEvents.map((event) => [event.key, event.data.name]),
    [
      [TRIGGERS.COMPLETED, 'Overnight'],
      [TRIGGERS.QUEUE_EMPTY, undefined],
    ],
  );
});

test('a server that stops answering: unreachable after two readings, then back', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.pyload.online = false;
  await w.hub.pollAll();
  assert.notEqual(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.STATUS)), 'Unreachable');
  await w.hub.pollAll();
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.STATUS)), 'Unreachable');
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(w.fake.connectionStatus.connected, false);
  w.pyload.online = true;
  await w.hub.pollAll();
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.STATUS)), 'Idle');
  assert.equal(w.fake.transports.at(-1).transport, 'local');
});

test('refused credentials are not retried by the timer (each try is an error in pyLoad)', async (t) => {
  const w = await world(t, { config: { ...ONE_CONFIG, server_1_api_key: 'pl_wrong' } });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /NAS: login refused/);
  const before = w.pyload.requests.length;
  await w.hub.pollAll();
  assert.equal(w.pyload.requests.length, before, 'no new try on the timer');
  const ack = await w.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /login refused/);
  assert.equal(w.pyload.requests.length, before + 1, '"Test the connection" tries again');
});

test('dev101 without API key: the user name alone is refused, the message says why', async (t) => {
  const w = await world(t, {
    config: { server_1_url: PYLOAD_URL, server_1_username: 'pyload', server_1_password: 'x' },
  });
  assert.match(w.fake.connectionStatus.message.fr, /clé d'API/);
});

test('the device controls: paused and automatic reconnection switches', async (t) => {
  const w = await world(t);
  await createAll(w);
  const device = { external_id: deviceId(w.gladys) };
  const set = (key, value) =>
    w.fake.setValue(device, { external_id: featureId(w.gladys, key) }, value);
  await set(FEATURE_KEYS.PAUSED, 1);
  assert.equal(w.pyload.paused, true);
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.PAUSED)), 1);
  await set(FEATURE_KEYS.PAUSED, 0);
  assert.equal(w.pyload.paused, false);
  await set(FEATURE_KEYS.RECONNECT, 1);
  assert.equal(w.pyload.reconnect, true);
  // Already on: toggled twice, still on.
  await set(FEATURE_KEYS.RECONNECT, 1);
  assert.equal(w.pyload.reconnect, true);
  await set(FEATURE_KEYS.RECONNECT, 0);
  assert.equal(w.pyload.reconnect, false);
  assert.equal(w.fake.lastState(featureId(w.gladys, FEATURE_KEYS.RECONNECT)), 0);
});

test('scene actions: pause every server for a while, then resume', async (t) => {
  const w = await world(t, { config: BOTH_CONFIG });
  const paused = await w.fake.sceneAction('pause_downloads', { minutes: '45' });
  assert.deepEqual(paused.data.outputs, { servers: 2, minutes: 45 });
  assert.ok(w.pyload.paused && w.old.paused);
  assert.equal(w.hub.records.get(1).snapshot.pauseEndsAt, w.clock.now() + 45 * 60_000);
  const resumed = await w.fake.sceneAction('resume_downloads', { device: deviceId(w.gladys, 2) });
  assert.deepEqual(resumed.data.outputs, { servers: 1 });
  assert.ok(w.pyload.paused && !w.old.paused);
});

test('a timed pause ends by itself, and is forgotten when pyLoad is resumed elsewhere', async (t) => {
  const w = await world(t);
  await w.fake.sceneAction('pause_downloads', { minutes: 30 });
  w.clock.advance(29 * 60_000);
  await w.hub.pollAll();
  assert.equal(w.pyload.paused, true, 'not yet');
  w.clock.advance(60_000);
  await w.hub.pollAll();
  assert.equal(w.pyload.paused, false, 'resumed at the end of the pause');
  assert.equal(w.hub.records.get(1).snapshot.paused, false);

  await w.fake.sceneAction('pause_downloads', { minutes: 30 });
  w.pyload.paused = false; // resumed in the pyLoad interface
  await w.hub.pollAll();
  w.pyload.paused = true; // paused again there, until resumed
  w.clock.advance(31 * 60_000);
  await w.hub.pollAll();
  assert.equal(w.pyload.paused, true, 'the old timer does not resume it');
});

test('the timed pause survives a restart of the integration', async (t) => {
  const pyload = new FakePyload();
  const servers = { [PYLOAD_URL]: pyload };
  const first = await createWorld({ servers });
  await first.fake.sceneAction('pause_downloads', { minutes: 10 });
  await first.app.stop();
  const second = await world(t, { servers, dataDir: first.dataDir, clock: first.clock });
  assert.equal(pyload.paused, true);
  second.clock.advance(10 * 60_000);
  await second.hub.pollAll();
  assert.equal(pyload.paused, false);
});

test('the timer resumes pyLoad at the end of the pause, between two readings', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 23, 10) });
  const clock = { now: () => Date.now() };
  const w = await world(t, {
    clock,
    timers: true,
    config: { ...ONE_CONFIG, poll_interval: '300' },
  });
  await w.fake.sceneAction('pause_downloads', { minutes: 1 });
  assert.equal(w.pyload.paused, true);
  t.mock.timers.tick(61_000);
  for (let i = 0; i < 30; i += 1) {
    await flush();
  }
  assert.equal(w.pyload.paused, false);
});

test('the hub reads pyLoad on its own timer, without onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 9, 23, 10) });
  const clock = { now: () => Date.now() };
  const w = await world(t, { clock, timers: true, config: { ...ONE_CONFIG, poll_interval: '60' } });
  const polled = t.mock.method(w.hub, 'pollDevice');
  await createAll(w);
  const reads = () => w.pyload.requests.filter((r) => r.name === 'status_server').length;
  for (let i = 0; i < 3; i += 1) {
    const before = reads();
    t.mock.timers.tick(60_000);
    for (let j = 0; j < 30; j += 1) {
      await flush();
    }
    assert.equal(reads() - before, 1, 'one reading per interval');
  }
  assert.equal(polled.mock.callCount(), 0);
});

test('add links: off by default, then one package, with the typed or derived name', async (t) => {
  const off = await world(t);
  const refused = await off.fake.sceneAction('add_links', { links: LINK });
  assert.equal(refused.success, false);
  assert.match(refused.error, /NAS: adding links is off/);
  assert.equal(off.pyload.requests.filter((r) => r.name === 'add_package').length, 0);

  const w = await world(t, { config: { ...BOTH_CONFIG, allow_add_links: true } });
  const added = await w.fake.sceneAction('add_links', {
    links: `${LINK}\nhttps://downloads.example.com/My%20File.iso, ${LINK}`,
  });
  assert.equal(added.success, true, added.error);
  const call = w.pyload.requests.find((r) => r.name === 'add_package');
  assert.deepEqual(call.body, {
    name: 'file.zip',
    links: [LINK, 'https://downloads.example.com/My%20File.iso'],
  });
  assert.equal(added.data.outputs.package_id, call && w.pyload.queue.at(-1).pid);
  assert.equal(w.old.requests.filter((r) => r.name === 'add_package').length, 0, 'first server');

  await w.fake.sceneAction('add_links', {
    device: deviceId(w.gladys, 2),
    links: 'ftp://ftp.example.org/pub/a.tar.gz',
    package: '  Weekly   backup ',
  });
  assert.equal(w.old.queue.at(-1).name, 'Weekly backup');

  for (const links of ['', 'javascript:alert(1)', 'magnet:?xt=urn:btih:abc', 'not a link']) {
    const bad = await w.fake.sceneAction('add_links', { links });
    assert.equal(bad.success, false, links);
    assert.match(bad.error, /http:\/\/, https:\/\/ or ftp:\/\//);
  }
});

test('a missing permission fails the command without marking the server down', async (t) => {
  const w = await world(t, { config: { ...ONE_CONFIG, allow_add_links: true } });
  w.pyload.denied.add('add_package');
  const ack = await w.fake.sceneAction('add_links', { links: LINK });
  assert.equal(ack.success, false);
  assert.match(ack.error, /lacks a permission/);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a command to a server that does not answer fails with its name', async (t) => {
  const w = await world(t);
  w.pyload.online = false;
  const ack = await w.fake.sceneAction('resume_downloads', {});
  assert.equal(ack.success, false);
  assert.equal(ack.error, 'NAS: does not answer');
});

test('no server configured: the connection status says what to do', async (t) => {
  const w = await world(t, { config: { language: 'en' } });
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /Enter the address of pyLoad/);
  const ack = await w.fake.sceneAction('pause_downloads', {});
  assert.equal(ack.error, 'No pyLoad server is configured.');
});

test('the rate limit of pyLoad is reported as such', async (t) => {
  const w = await world(t);
  w.pyload.rateLimited = true;
  const ack = await w.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /too many requests/);
});

test('a reading in flight during a timed pause command does not cancel its end', async (t) => {
  const w = await world(t);
  // The reading answers "not paused" only after the pause was sent.
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const handle = w.pyload.handle.bind(w.pyload);
  let first = true;
  t.mock.method(w.pyload, 'handle', async (url, options) => {
    if (first && url.endsWith('/api/status_server')) {
      first = false;
      const answer = await handle(url, options);
      await gate;
      return answer;
    }
    return handle(url, options);
  });
  const reading = w.hub.pollAll();
  const pausing = w.fake.sceneAction('pause_downloads', { minutes: 30 });
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([reading, pausing]);
  assert.equal(w.pyload.paused, true);
  assert.equal(w.hub.pauseEnd(w.hub.records.get(1)), w.clock.now() + 30 * 60_000);
  assert.equal(w.hub.records.get(1).snapshot.pauseEndsAt, w.clock.now() + 30 * 60_000);
});

test('a resume refused at the end of a timed pause is tried again at the next reading', async (t) => {
  const w = await world(t);
  await w.fake.sceneAction('pause_downloads', { minutes: 5 });
  w.clock.advance(5 * 60_000);
  w.pyload.denied.add('unpause_server');
  await w.hub.pollAll();
  assert.equal(w.pyload.paused, true);
  w.pyload.denied.delete('unpause_server');
  await w.hub.pollAll();
  assert.equal(w.pyload.paused, false);
});

test('the first server is slot 1, even after slot 1 was reconfigured', async (t) => {
  const w = await world(t, { config: { ...BOTH_CONFIG, allow_add_links: true } });
  // Force a new connection on slot 1 (new credentials), re-inserting it last.
  w.hub.records.get(1).signature = 'changed';
  await w.hub.reconfigure(w.hub.config);
  assert.deepEqual([...w.hub.records.keys()], [2, 1]);
  await w.fake.sceneAction('add_links', { links: LINK });
  assert.equal(w.pyload.queue.at(-1).links[0].url, LINK, 'added on slot 1');
});

test('a malformed state file does not block the start', async (t) => {
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dataDir = mkdtempSync(join(tmpdir(), 'gladys-pyload-'));
  writeFileSync(
    join(dataDir, 'pyload-state.json'),
    JSON.stringify({ seen: { 1: { key: PYLOAD_URL } }, pauses: { 1: 'x' } }),
  );
  const w = await world(t, { dataDir });
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
  assert.deepEqual(w.fake.sceneEvents, []);
});

test('one failed reading (a blip) does not flip the badge nor the connection status', async (t) => {
  const w = await world(t);
  await createAll(w);
  w.pyload.online = false;
  await w.hub.pollAll();
  assert.equal(w.fake.transports.at(-1).transport, 'local');
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});
