// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake pyLoad servers on a fake
// network, a temporary /data and a manual clock, with the integration wired
// on top through registerHandlers. No timer runs unless `timers: true` (with
// node:test mock timers): the tests read the servers with `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { API_KEY, FakePyload, PASSWORD, USERNAME, createNetwork } from './fakePyload.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const PYLOAD_URL = 'http://192.0.2.10:8000';
export const OLD_PYLOAD_URL = 'http://192.0.2.20:8000';

export const ONE_CONFIG = {
  server_1_url: PYLOAD_URL,
  server_1_api_key: API_KEY,
  server_1_name: 'NAS',
  language: 'en',
};

// A recent pyLoad (API key) and an older one (user name and password).
export const BOTH_CONFIG = {
  ...ONE_CONFIG,
  server_2_url: OLD_PYLOAD_URL,
  server_2_username: USERNAME,
  server_2_password: PASSWORD,
  server_2_name: 'Old',
};

/** A manual clock, used by the hub. */
export function createClock(start = Date.UTC(2026, 9, 14, 10, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {Record<string, object>} [options.servers] fake pyLoad servers by origin
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  clock = createClock(),
  servers,
  config = ONE_CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-pyload-')),
  timings = {},
  timers = false,
} = {}) {
  const network = createNetwork(
    servers ?? {
      [PYLOAD_URL]: new FakePyload(),
      [OLD_PYLOAD_URL]: new FakePyload({ auth: 'basic', version: '0.5.0' }),
    },
  );
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return {
    gladys,
    fake: gladys.fake,
    network,
    pyload: network.servers.get(PYLOAD_URL),
    old: network.servers.get(OLD_PYLOAD_URL),
    app,
    hub: app.hub,
    clock,
    dataDir,
  };
}

/** External id of the device of a configuration slot. */
export const deviceId = (gladys, slot = 1) => gladys.externalIds('server', String(slot)).device;
export const featureId = (gladys, key, slot = 1) =>
  gladys.externalIds('server', String(slot)).feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { FakePyload };
