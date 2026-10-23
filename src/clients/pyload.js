// -----------------------------------------------------------------------------
// pyLoad client: the JSON API of pyload-ng 0.5 (`/api/<method>`, snake_case
// names, GET to read and POST to act, JSON bodies). Behaviours checked on real
// pyLoad 0.5.0b3.dev96 and dev101 (test/fixtures/pyload):
//
//   - dev101 (2025) only accepts an API key, in the `X-API-Key` header
//     (pl_…, created in pyLoad: Settings → Users → API keys); dev96 and the
//     versions before only accept HTTP basic auth, user name and password.
//     Both are sent when both are configured: each version reads its own;
//   - every refused login writes an ERROR line in the pyLoad log: the hub
//     never retries refused credentials on its timer;
//   - the API answers 100 calls a minute per address at most (429 beyond);
//     a reading costs 3 calls (`status_server`, `free_space`,
//     `get_queue_data`), 4 while something downloads (`status_downloads`);
//   - the wrong HTTP method answers 405, an unknown method 404 (dev101) or
//     403 (dev96), the pages of the interface a 302 to the login page;
//   - `pause_server` starts no new download but lets the files already
//     downloading finish (pyLoad's own pause); there is no timed pause, the
//     hub keeps the timer (src/hub.js);
//   - `status_server.reconnect` is "reconnection on AND within its time
//     window"; `toggle_reconnect` flips the option and returns it.
//
// pyLoad 0.4 (the old Thrift / `/api/login` API) is not supported.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';
import { ClientError, ERROR_KINDS, networkError, parseJson, safeLocation } from './errors.js';
import { toSnapshot } from './model.js';

export class PyloadClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host:port[/path]`
   * @param {string} [options.apiKey] API key (pyLoad dev101 and later)
   * @param {string} [options.username] user name (basic auth, before dev101)
   * @param {string} [options.password]
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({
    url,
    apiKey = '',
    username = '',
    password = '',
    insecure = false,
    request = httpRequest,
    timeoutMs = 10_000,
  }) {
    this.base = url;
    this.insecure = insecure;
    this.request = request;
    this.timeoutMs = timeoutMs;
    this.headers = {};
    if (apiKey) {
      this.headers['x-api-key'] = apiKey;
    }
    if (username) {
      this.headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }
    this.version = null;
  }

  // --- Transport -----------------------------------------------------------------

  /**
   * One API call; resolves with the parsed JSON (null for the commands).
   * @param {'GET'|'POST'} method
   * @param {string} name API method, snake_case
   * @param {object} [body] JSON arguments
   */
  async call(method, name, body) {
    let response;
    try {
      response = await this.request(`${this.base}/api/${name}`, {
        method,
        headers: this.headers,
        json: body,
        insecure: this.insecure,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      throw networkError(err);
    }
    const { status, body: text } = response;
    const data = parseJson(text);
    const error = typeof data?.error === 'string' ? data.error : '';
    if (status >= 300 && status < 400) {
      throw new ClientError(
        ERROR_KINDS.REDIRECT,
        `Redirected to ${safeLocation(response.headers?.location)}`,
        { status },
      );
    }
    if (status === 401 && /denied|insufficient/i.test(error)) {
      throw new ClientError(ERROR_KINDS.PERMISSION, `${name}: ${error}`, { status });
    }
    if (status === 401) {
      throw new ClientError(ERROR_KINDS.AUTH, error || 'Login refused', { status });
    }
    if (status === 429) {
      throw new ClientError(ERROR_KINDS.RATE_LIMIT, 'Too many requests', { status });
    }
    if (status === 404 || (status === 403 && error === 'Forbidden')) {
      throw new ClientError(ERROR_KINDS.NOT_PYLOAD, `No pyLoad 0.5 API at this address (${name})`, {
        status,
      });
    }
    if (status !== 200) {
      throw new ClientError(ERROR_KINDS.HTTP, `HTTP ${status}${error ? ` (${error})` : ''}`, {
        status,
      });
    }
    if (data === undefined) {
      throw new ClientError(ERROR_KINDS.NOT_PYLOAD, 'The answer is not pyLoad JSON');
    }
    return data;
  }

  // --- Reading -------------------------------------------------------------------

  /** Everything the integration shows, as a snapshot (src/clients/model.js). */
  async read() {
    const status = await this.call('GET', 'status_server');
    if (!status || typeof status !== 'object' || typeof status.pause !== 'boolean') {
      throw new ClientError(ERROR_KINDS.NOT_PYLOAD, 'No pyLoad status in the answer');
    }
    const [queue, downloads, free] = await Promise.all([
      this.call('GET', 'get_queue_data'),
      status.active > 0 ? this.call('GET', 'status_downloads') : [],
      // Needs the "status" permission only: a missing permission costs the figure.
      this.call('GET', 'free_space').catch((err) => {
        if (err.kind === ERROR_KINDS.PERMISSION) {
          return null;
        }
        throw err;
      }),
      this.version === null ? this.readVersion() : null,
    ]);
    return toSnapshot({ status, queue, downloads, free, version: this.version });
  }

  async readVersion() {
    const version = await this.call('GET', 'get_server_version').catch(() => null);
    this.version = typeof version === 'string' ? version : '';
  }

  // --- Commands ------------------------------------------------------------------

  pause() {
    return this.call('POST', 'pause_server');
  }

  resume() {
    return this.call('POST', 'unpause_server');
  }

  /** Turn the automatic reconnection on or off; resolves with the new state. */
  async setReconnect(on) {
    let state = await this.call('POST', 'toggle_reconnect');
    if (state !== on) {
      // It was already in the wanted state (the status hides it outside its
      // time window): flip it back.
      state = await this.call('POST', 'toggle_reconnect');
    }
    return state === true;
  }

  restartFailed() {
    return this.call('POST', 'restart_failed');
  }

  /**
   * Add a package to the queue.
   * @param {string} name package name
   * @param {string[]} links
   * @returns {Promise<number|null>} the package id
   */
  async addPackage(name, links) {
    const id = await this.call('POST', 'add_package', { name, links });
    return typeof id === 'number' ? id : null;
  }
}
