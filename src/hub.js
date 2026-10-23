// -----------------------------------------------------------------------------
// The pyLoad hub: one record per configured server, read on a timer of the
// container (the interval chosen in the configuration), its states published
// to Gladys when they change, its scene events fired when a package completes,
// a file fails or the queue empties, and the commands of the devices, the
// widget and the scene actions (pause, timed pause, resume, reconnection,
// restart the failed files, add links).
//
// Gladys never polls these devices (should_poll: false): the core does not
// poll the external devices reliably (GladysAssistant/Gladys#3198), the
// configurable interval goes up to 5 minutes, beyond the fixed list of the
// core scheduler, and the scene events must fire even for a server whose
// device was not added.
//
// States: only for the devices the user added, only what changed
// (publishChangedStates of the SDK), every value again after 6 hours unchanged
// so the dashboard never shows "no recent value".
//
// Logs stay quiet: a normal reading writes at the debug level only; a failure
// that repeats on every reading writes one line when it starts and one when
// it ends. Refused credentials are never retried on the timer: each refusal
// writes an error in the pyLoad log. Saving the configuration, "Test the
// connection" or a command try again.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { ClientError, ERROR_KINDS } from './clients/errors.js';
import { MB } from './clients/model.js';
import { PyloadClient } from './clients/pyload.js';
import {
  FEATURE_KEYS,
  buildDevice,
  deviceIds,
  deviceStates,
  serverName,
  slotOf,
  unreachableState,
} from './devices.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  STATUS_TEXT,
  decimal,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'pyload-hub' });

export const WIDGET_KEY = 'pyload';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  COMPLETED: 'download_completed',
  FAILED: 'file_failed',
  QUEUE_EMPTY: 'queue_empty',
});

export const HUB_TIMINGS = {
  // A server that fails once is read again this soon, to tell a blip from an outage.
  retryMs: 15_000,
  // Failures in a row before a server counts as unreachable.
  downAfterFailures: 2,
  // An unchanged value is sent again after this long (the front shows "no
  // recent value" past 48 hours; the maintainer rule is 12 hours at most).
  heartbeatMs: 6 * 3600_000,
};

// Longest pause accepted from a scene or the widget: one week.
export const MAX_PAUSE_MINUTES = 10_080;
// Packages and failed files remembered per server: the queue of pyLoad itself
// bounds them (a package deleted from pyLoad is forgotten).
// The SDK refuses a scene event text over 1000 characters.
const MAX_EVENT_TEXT = 500;
const eventText = (text) => String(text ?? '').slice(0, MAX_EVENT_TEXT);
const MAX_TRANSPORTS_PER_REQUEST = 100;
// Links added by one scene action.
export const MAX_LINKS = 50;
const MAX_PACKAGE_NAME = 100;
// Errors that say the server cannot be read (the others concern one command).
const CONNECTION_KINDS = new Set([
  ERROR_KINDS.UNREACHABLE,
  ERROR_KINDS.TLS,
  ERROR_KINDS.AUTH,
  ERROR_KINDS.NOT_PYLOAD,
  ERROR_KINDS.REDIRECT,
  ERROR_KINDS.HTTP,
]);
// A blip (one failed reading of a network error) is not shown as an outage:
// the server is failing once down (two readings), or at once for an error
// the user must fix (credentials, address, permission).
const TRANSIENT_KINDS = new Set([
  ERROR_KINDS.UNREACHABLE,
  ERROR_KINDS.RATE_LIMIT,
  ERROR_KINDS.HTTP,
]);
const failing = (record) =>
  record.error !== null && (record.down || !TRANSIENT_KINDS.has(record.error.kind));
const LINK_SCHEMES = new Set(['http:', 'https:', 'ftp:', 'ftps:']);

/**
 * The links typed in a scene: http(s) or ftp addresses, separated by spaces,
 * commas or new lines. Throws a BAD_LINK error on anything else.
 */
export function parseLinks(raw) {
  const words = String(raw ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (words.length === 0) {
    throw new ClientError(ERROR_KINDS.BAD_LINK, 'No link');
  }
  if (words.length > MAX_LINKS) {
    throw new ClientError(ERROR_KINDS.BAD_LINK, `More than ${MAX_LINKS} links`);
  }
  for (const word of words) {
    let url;
    try {
      url = new URL(word);
    } catch {
      throw new ClientError(ERROR_KINDS.BAD_LINK, 'Not a link');
    }
    if (!LINK_SCHEMES.has(url.protocol) || !url.hostname) {
      throw new ClientError(ERROR_KINDS.BAD_LINK, `Scheme ${url.protocol} not accepted`);
    }
  }
  return [...new Set(words)];
}

/** The package name of added links: the one typed, else the first file name. */
export function packageName(raw, links) {
  const typed = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (typed) {
    return typed.slice(0, MAX_PACKAGE_NAME);
  }
  const path = new URL(links[0]).pathname.split('/').filter(Boolean).pop();
  let name;
  try {
    name = decodeURIComponent(path ?? '');
  } catch {
    name = path ?? '';
  }
  return (name || new URL(links[0]).hostname).slice(0, MAX_PACKAGE_NAME);
}

/** Minutes of a pause typed in a scene: a number, or a string ("30", "2,5"). */
export function parseMinutes(raw) {
  const number =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw.trim().replace(',', '.'))
        : 0;
  if (!Number.isFinite(number) || number <= 0) {
    return 0;
  }
  return Math.min(MAX_PAUSE_MINUTES, Math.max(1, Math.round(number)));
}

const identity = (server) => server.url;
const signature = (server, config) =>
  JSON.stringify([
    server.url,
    server.apiKey,
    server.username,
    server.password,
    config.allowSelfSigned,
  ]);

export class PyloadHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/servers/http.js)
   * @param {boolean} [options.timers] periodic timers (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** @type {Map<number, object>} server records, by slot */
    this.records = new Map();
    this.transports = new Map();
    this.connection = null;
    // seen: by slot, what the triggers already announced; pauses: by slot,
    // the end of a timed pause (pyLoad has none of its own).
    this.saved = { seen: {}, pauses: {} };
    this.pollTimer = null;
    this.stopped = false;
    /** Problems already logged, by key: their repeats go to debug. */
    this.warned = new Set();
  }

  // --- Logs ------------------------------------------------------------------

  /** Log a problem once (`level` warn or error), its repeats at debug. */
  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  /** The problem `key` is gone: the next occurrence is logged again. */
  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    const object = (value) => (value && typeof value === 'object' ? value : {});
    this.saved = { seen: object(saved.seen), pauses: object(saved.pauses) };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates();
    this.transports.clear();
    this.connection = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    this.config = config;
    const wanted = new Map(config.servers.map((server) => [server.slot, server]));
    for (const [slot, record] of this.records) {
      const server = wanted.get(slot);
      if (!server || record.signature !== signature(server, config)) {
        record.dropped = true;
        clearTimeout(record.retryTimer);
        clearTimeout(record.pauseTimer);
        this.records.delete(slot);
      }
    }
    for (const server of config.servers) {
      const record = this.records.get(server.slot);
      if (record) {
        record.server = server; // a new name: same connection
      } else {
        this.records.set(server.slot, this.newRecord(server, config));
      }
    }
    await this.publishDevices();
    await this.pollAll({ manual: true });
    this.schedulePoll();
  }

  newRecord(server, config) {
    return {
      server,
      signature: signature(server, config),
      api: new PyloadClient({
        url: server.url,
        apiKey: server.apiKey,
        username: server.username,
        password: server.password,
        insecure: config.allowSelfSigned,
        request: this.request,
      }),
      snapshot: null,
      error: null,
      failures: 0,
      down: false,
      polling: null,
      retryTimer: null,
      pauseTimer: null,
      epoch: 0,
      dropped: false,
    };
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    for (const record of this.records.values()) {
      clearTimeout(record.retryTimer);
      clearTimeout(record.pauseTimer);
    }
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || this.records.size === 0) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.resolved('poll');
      } catch (err) {
        this.problem('poll', 'Reading failed', err, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Devices ---------------------------------------------------------------

  async publishDevices() {
    const devices = [...this.records.values()].map((record) =>
      buildDevice(this.gladys, record.server, this.config.language),
    );
    // Even an empty list: the Discovery tab then shows no stale server.
    await this.gladys.publishDiscoveredDevices(devices);
  }

  /** "Search" in the Discovery tab: publish the devices again, read the servers. */
  async rediscover() {
    await this.publishDevices();
    await this.pollAll({ manual: true });
  }

  /** The device external ids the user added in Gladys. */
  createdIds() {
    return new Set((this.gladys.devices ?? []).map((device) => device.external_id));
  }

  /** The user added a device: its states sent before it existed were dropped. */
  async onDeviceCreated(device) {
    const slot = slotOf(this.gladys, device.external_id);
    const record = slot === null ? null : this.records.get(slot);
    if (!record) {
      return;
    }
    this.transports.delete(device.external_id);
    await this.publishStates(record, { force: true, created: device.external_id });
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Reading the servers ---------------------------------------------------

  /**
   * Read every server. `manual`: also the servers whose key was refused (a
   * new configuration, "Test the connection", "Search").
   */
  async pollAll({ manual = false } = {}) {
    const records = [...this.records.values()];
    const changes = await Promise.all(records.map((record) => this.poll(record, { manual })));
    await this.afterChanges(changes.some(Boolean));
  }

  /** Gladys asks for a refresh (onPoll): read that server now. */
  async pollDevice(device) {
    const slot = slotOf(this.gladys, device.external_id);
    const record = slot === null ? null : this.records.get(slot);
    if (record) {
      await this.afterChanges(await this.poll(record, {}));
    }
  }

  /**
   * Read one server and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll(record, { manual = false } = {}) {
    if (!manual && record.error?.kind === ERROR_KINDS.AUTH) {
      return Promise.resolve(false); // waits for the user (see the header)
    }
    record.polling ??= this.read(record).finally(() => {
      record.polling = null;
    });
    return record.polling;
  }

  async read(record) {
    // A command sent while this reading was in flight makes its answer stale
    // (a pause just sent would read as "not paused" and cancel its own end):
    // drop it, the command reads the server again once done.
    const epoch = record.epoch;
    let snapshot;
    try {
      snapshot = await record.api.read();
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return this.applyFailure(record, err);
    }
    if (record.epoch !== epoch) {
      return false;
    }
    return this.applySuccess(record, snapshot);
  }

  label(record) {
    return `pyLoad ${record.server.slot} (${serverName(record.server)})`;
  }

  async applySuccess(record, snapshot) {
    if (record.dropped) {
      return false;
    }
    const previous = record.snapshot;
    if (record.down) {
      logger.info(`${this.label(record)} answers again`);
    } else if (record.error) {
      logger.info(`${this.label(record)}: connection restored`);
    } else if (previous === null) {
      logger.info(
        `${this.label(record)}: connected${snapshot.version ? ` (version ${snapshot.version})` : ''}`,
      );
    }
    record.failures = 0;
    record.down = false;
    record.error = null;
    clearTimeout(record.retryTimer);
    if (await this.checkPause(record, snapshot)) {
      return true; // resumed at the end of a timed pause: read again
    }
    snapshot.pauseEndsAt = snapshot.paused ? this.pauseEnd(record) : null;
    const widgetChanged =
      previous === null ||
      previous.status !== snapshot.status ||
      previous.queueCount !== snapshot.queueCount ||
      previous.failed.length !== snapshot.failed.length ||
      previous.paused !== snapshot.paused ||
      previous.pauseEndsAt !== snapshot.pauseEndsAt;
    record.snapshot = snapshot;
    await this.announce(record, snapshot);
    await this.publishStates(record);
    return widgetChanged;
  }

  async applyFailure(record, err) {
    if (record.dropped) {
      return false;
    }
    const wasError = record.error?.kind;
    record.error = { kind: err.kind, message: err.message };
    // One warning when the problem starts (or changes), not one per reading.
    if (wasError !== err.kind) {
      logger.warn(`${this.label(record)}: ${err.message}`);
    } else {
      logger.debug(`${this.label(record)}: ${err.message} (again)`);
    }
    if (err.kind === ERROR_KINDS.AUTH) {
      record.failures = 0;
      if (!record.down) {
        record.down = true; // the states would otherwise freeze on the last reading
        await this.publishStates(record);
      }
      return wasError !== err.kind;
    }
    record.failures += 1;
    if (record.failures === 1) {
      this.scheduleRetry(record);
    }
    if (!record.down && record.failures >= this.timings.downAfterFailures) {
      record.down = true;
      await this.publishStates(record);
      return true;
    }
    return wasError !== err.kind;
  }

  scheduleRetry(record) {
    clearTimeout(record.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    record.retryTimer = setTimeout(() => {
      this.poll(record)
        .then((changed) => this.afterChanges(changed))
        .then(() => this.resolved('retry'))
        .catch((err) => this.problem('retry', 'Retry failed', err, 'error'));
    }, this.timings.retryMs);
    record.retryTimer.unref?.();
  }

  // --- Timed pause -----------------------------------------------------------

  /** The end of the timed pause of a server, null when none. */
  pauseEnd(record) {
    // Keyed on the slot (the device identity): a new address keeps the pause.
    const until = this.saved.pauses[String(record.server.slot)]?.until;
    return Number.isFinite(until) ? until : null;
  }

  setPauseEnd(record, until) {
    const slot = String(record.server.slot);
    clearTimeout(record.pauseTimer);
    record.pauseTimer = null;
    if (until === null) {
      if (!(slot in this.saved.pauses)) {
        return;
      }
      delete this.saved.pauses[slot];
    } else {
      this.saved.pauses[slot] = { until };
      this.armPause(record, until);
    }
    this.store.save(this.saved);
  }

  armPause(record, until) {
    clearTimeout(record.pauseTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    // setTimeout holds 24.8 days at most; a week fits.
    record.pauseTimer = setTimeout(
      () => {
        this.poll(record, { manual: true })
          .then((changed) => this.afterChanges(changed))
          .catch((err) => this.problem('pause-end', 'End of the pause failed', err, 'error'));
      },
      Math.max(0, until - this.now()) + 500,
    );
    record.pauseTimer.unref?.();
  }

  /**
   * Apply the timed pause to a fresh reading: resume once it is over, forget
   * it when pyLoad was resumed meanwhile (by its interface, for instance).
   * @returns {Promise<boolean>} whether pyLoad was resumed (the snapshot is stale)
   */
  async checkPause(record, snapshot) {
    const until = this.pauseEnd(record);
    if (until === null) {
      return false;
    }
    if (!snapshot.paused) {
      this.setPauseEnd(record, null);
      return false;
    }
    if (this.now() < until) {
      if (!record.pauseTimer) {
        this.armPause(record, until); // after a restart of the integration
      }
      return false;
    }
    try {
      await record.api.resume();
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      // The end is kept: the next reading tries again.
      logger.warn(`${this.label(record)}: could not resume after the pause: ${err.message}`);
      return false;
    }
    this.setPauseEnd(record, null);
    logger.info(`${this.label(record)}: end of the timed pause, downloads resumed`);
    await this.read(record);
    return true;
  }

  // --- Scene events ----------------------------------------------------------

  /**
   * Fire "download completed" once per package whose files are all done,
   * "file failed" once per failed file, "queue empty" when nothing is left to
   * download. The first reading of a server only remembers its state; after
   * a restart of the integration, what changed meanwhile is announced.
   */
  async announce(record, snapshot) {
    const slot = String(record.server.slot);
    const key = identity(record.server);
    const finished = snapshot.packages.filter((item) => item.finished);
    const state = {
      key,
      finished: finished.map((item) => item.key),
      failed: snapshot.failed.map((file) => file.key),
      pending: snapshot.pendingCount > 0,
    };
    const entry = this.saved.seen[slot];
    if (
      !entry ||
      entry.key !== key ||
      !Array.isArray(entry.finished) ||
      !Array.isArray(entry.failed)
    ) {
      // The last completed package is not known yet: the newest finished one.
      const newest = finished.reduce(
        (best, item) => (!best || item.id > best.id ? item : best),
        null,
      );
      this.saved.seen[slot] = { ...state, last: newest?.name ?? null };
      this.store.save(this.saved);
      return;
    }
    const knownFinished = new Set(entry.finished);
    const knownFailed = new Set(entry.failed);
    const completed = finished.filter((item) => !knownFinished.has(item.key));
    const failed = snapshot.failed.filter((file) => !knownFailed.has(file.key));
    const emptied = entry.pending === true && !state.pending;
    const changed =
      completed.length > 0 ||
      failed.length > 0 ||
      entry.pending !== state.pending ||
      entry.finished.length !== state.finished.length ||
      entry.failed.length !== state.failed.length;
    if (!changed) {
      return;
    }
    const last = completed.length ? completed[completed.length - 1].name : entry.last;
    this.saved.seen[slot] = { ...state, last: last ?? null };
    this.store.save(this.saved);
    for (const item of completed) {
      logger.debug(`${this.label(record)}: completed "${item.name}"`);
      await this.fire(TRIGGERS.COMPLETED, record, {
        name: eventText(item.name),
        files: item.files,
        size_mb: Math.round(item.bytes / MB),
      });
    }
    for (const file of failed) {
      logger.debug(`${this.label(record)}: failed "${file.name}"`);
      await this.fire(TRIGGERS.FAILED, record, {
        name: eventText(file.name),
        package: eventText(file.packageName),
        reason: eventText(file.reason),
      });
    }
    if (emptied) {
      logger.debug(`${this.label(record)}: queue empty`);
      await this.fire(TRIGGERS.QUEUE_EMPTY, record, {});
    }
  }

  async fire(key, record, data) {
    try {
      await this.gladys.publishSceneEvent(key, {
        device: deviceIds(this.gladys, record.server.slot).device,
        server: serverName(record.server),
        ...data,
      });
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys --------------------------------------------------

  context(record) {
    return {
      language: this.config.language,
      lastCompleted: this.lastCompleted(record),
    };
  }

  /** The name of the last package completed on a server, null when none. */
  lastCompleted(record) {
    const entry = this.saved.seen[String(record.server.slot)];
    return entry && entry.key === identity(record.server) ? (entry.last ?? null) : null;
  }

  /** The states of a server's device, if the user added it. */
  async publishStates(record, { force = false, created = null } = {}) {
    const deviceId = deviceIds(this.gladys, record.server.slot).device;
    if (created !== deviceId && !this.createdIds().has(deviceId)) {
      return;
    }
    let states;
    if (record.snapshot && !record.down) {
      states = deviceStates(this.gladys, record.server.slot, record.snapshot, this.context(record));
    } else if (record.down) {
      states = [unreachableState(this.gladys, record.server.slot, this.config.language)];
    } else {
      return;
    }
    try {
      if (force) {
        this.gladys.forgetPublishedStates(deviceId);
      }
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States of ${this.label(record)} refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged) {
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: "local", or "unreachable". */
  async publishTransports() {
    const created = this.createdIds();
    const entries = [];
    for (const record of this.records.values()) {
      const externalId = deviceIds(this.gladys, record.server.slot).device;
      if (!created.has(externalId) || (record.snapshot === null && record.error === null)) {
        continue;
      }
      if (record.error !== null && !failing(record)) {
        continue;
      }
      const transport = failing(record) ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.resolved('transports');
      } catch (err) {
        this.problem('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name: connected while a server answers. */
  connectionStatus() {
    const { servers, invalidSlots } = this.config;
    if (servers.length === 0) {
      return {
        connected: false,
        message: invalidSlots.length ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noServer,
      };
    }
    const failingRecords = [...this.records.values()].filter(failing);
    if (failingRecords.length === 0 && invalidSlots.length === 0) {
      return { connected: true };
    }
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noServer)) {
      const parts = failingRecords.map((record) =>
        labelled(
          serverName(record.server),
          pick(ERROR_TEXT[record.error.kind], language),
          language,
        ),
      );
      if (invalidSlots.length) {
        parts.push(pick(CONNECTION_TEXT.invalidUrl, language));
      }
      message[language] = parts.join(' · ').slice(0, 200);
    }
    return { connected: failingRecords.length < this.records.size, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands --------------------------------------------------------------

  /**
   * The servers a command targets: one device, or every configured server.
   * @param {string|null|undefined} deviceExternalId
   */
  targets(deviceExternalId) {
    const language = this.config?.language;
    if (this.records.size === 0) {
      throw new Error(pick(ACTION_TEXT.noServer, language));
    }
    if (!deviceExternalId) {
      // Slot order: "the first server" is slot 1, even after a reconfiguration.
      return [...this.records.values()].sort((a, b) => a.server.slot - b.server.slot);
    }
    const slot = slotOf(this.gladys, deviceExternalId);
    const record = slot === null ? null : this.records.get(slot);
    if (!record) {
      throw new Error(pick(ACTION_TEXT.unknownServer, language));
    }
    return [record];
  }

  /**
   * Run a command on the targeted servers, read them again, and resolve with
   * the number of servers that accepted it.
   * @param {string|null} deviceExternalId
   * @param {(record: object) => Promise<void>} command
   * @param {string} description for the logs ("paused for 30 min")
   */
  async command(deviceExternalId, command, description) {
    const records = this.targets(deviceExternalId);
    const errors = [];
    const results = await Promise.all(
      records.map(async (record) => {
        try {
          // Before and after: a reading started during the command is stale too.
          record.epoch += 1;
          try {
            await command(record);
          } finally {
            record.epoch += 1;
          }
          logger.info(`${this.label(record)}: ${description}`);
          // A reading started before the command would publish the old state.
          await record.polling;
          await this.poll(record, { manual: true });
          return true;
        } catch (err) {
          if (!err.kind) {
            throw err;
          }
          logger.warn(`${this.label(record)}: command failed: ${err.message}`);
          errors.push({ record, kind: err.kind });
          // A missing permission concerns the command, not the connection.
          if (CONNECTION_KINDS.has(err.kind)) {
            await this.applyFailure(record, err);
          }
          return false;
        }
      }),
    );
    await this.afterChanges(true);
    const done = results.filter(Boolean).length;
    if (done === 0) {
      const language = this.config.language;
      // One reason for every server (a missing permission, a server down):
      // say it, with the names; mixed reasons: the logs tell.
      const kinds = new Set(errors.map((error) => error.kind));
      throw new Error(
        errors.length === records.length && kinds.size === 1
          ? labelled(
              errors.map((error) => serverName(error.record.server)).join(', '),
              pick(ERROR_TEXT[errors[0].kind], language),
              language,
            )
          : pick(ACTION_TEXT.failed, language),
      );
    }
    return done;
  }

  /**
   * Pause the downloads for `minutes` (0: until resumed). pyLoad has no timed
   * pause: the hub resumes it at the end (src/hub.js, "Timed pause").
   */
  pause(deviceExternalId, minutes = 0) {
    return this.command(
      deviceExternalId,
      async (record) => {
        await record.api.pause();
        this.setPauseEnd(record, minutes ? this.now() + minutes * 60_000 : null);
      },
      minutes ? `downloads paused for ${minutes} min` : 'downloads paused',
    );
  }

  resume(deviceExternalId) {
    return this.command(
      deviceExternalId,
      async (record) => {
        await record.api.resume();
        this.setPauseEnd(record, null);
      },
      'downloads resumed',
    );
  }

  setReconnect(deviceExternalId, on) {
    return this.command(
      deviceExternalId,
      (record) => record.api.setReconnect(on),
      on ? 'automatic reconnection on' : 'automatic reconnection off',
    );
  }

  restartFailed(deviceExternalId) {
    return this.command(
      deviceExternalId,
      (record) => record.api.restartFailed(),
      'failed files restarted',
    );
  }

  /**
   * Add links to the queue of one server (the first one by default), as one
   * package. Only when the configuration allows it.
   * @returns {Promise<number|null>} the package id
   */
  async addLinks(deviceExternalId, rawLinks, rawName) {
    const language = this.config?.language;
    const [record] = this.targets(deviceExternalId).slice(0, 1);
    const refuse = (kind) => {
      throw new Error(
        labelled(serverName(record.server), pick(ERROR_TEXT[kind], language), language),
      );
    };
    if (!this.config.allowAddLinks) {
      refuse(ERROR_KINDS.LINKS_OFF);
    }
    let links;
    try {
      links = parseLinks(rawLinks);
    } catch (err) {
      refuse(err.kind);
    }
    const name = packageName(rawName, links);
    let id = null;
    await this.command(
      deviceExternalId || deviceIds(this.gladys, record.server.slot).device,
      async (target) => {
        id = await target.api.addPackage(name, links);
      },
      `package "${name}" added (${links.length} link(s))`,
    );
    return id;
  }

  /** The two controls of a device: "paused" and "automatic reconnection". */
  async setValue(device, feature, value) {
    const slot = slotOf(this.gladys, device.external_id);
    const ids = slot === null ? null : deviceIds(this.gladys, slot);
    const on = Number(value) === 1;
    if (ids && feature.external_id === ids.feature(FEATURE_KEYS.PAUSED)) {
      await (on ? this.pause(device.external_id, 0) : this.resume(device.external_id));
      return;
    }
    if (ids && feature.external_id === ids.feature(FEATURE_KEYS.RECONNECT)) {
      await this.setReconnect(device.external_id, on);
      return;
    }
    throw new Error(`Feature ${feature.external_id} cannot be controlled`);
  }

  // --- Reports ---------------------------------------------------------------

  /** "Test the connection": read every server now, one line each. */
  async testConnection() {
    await this.pollAll({ manual: true });
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (this.records.size === 0) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      const lines = [...this.records.values()].map((record) => {
        const name = serverName(record.server);
        if (record.error) {
          return labelled(name, pick(ERROR_TEXT[record.error.kind], language), language);
        }
        const { snapshot } = record;
        const parts = [text.ok, `pyLoad${snapshot.version ? ` ${snapshot.version}` : ''}`];
        let state = pick(STATUS_TEXT[snapshot.status], language);
        if (snapshot.speedBps > 0) {
          state += ` ${decimal(snapshot.speedBps / MB, language)} MB/s`;
        }
        parts.push(state, text.queue(snapshot.queueCount));
        if (snapshot.failed.length) {
          parts.push(text.failed(snapshot.failed.length));
        }
        if (snapshot.freeBytes === null) {
          parts.push(text.noSpace);
        }
        return labelled(name, parts.join(', '), language);
      });
      // Addresses that could not be read are not records: say it too.
      if (this.config.invalidSlots.length) {
        lines.push(pick(CONNECTION_TEXT.invalidUrl, language));
      }
      message[language] = lines.join('\n');
    }
    return message;
  }

  /** What the widget shows, for one server or all of them. */
  view(deviceExternalId) {
    if (!deviceExternalId) {
      return [...this.records.values()];
    }
    const slot = slotOf(this.gladys, deviceExternalId);
    const record = slot === null ? null : this.records.get(slot);
    return record ? [record] : [];
  }
}
