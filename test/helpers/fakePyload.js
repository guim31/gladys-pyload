// -----------------------------------------------------------------------------
// An in-memory pyLoad behind the `request` seam of the client
// (src/clients/http.js). Its answers start from the real responses recorded
// in test/fixtures/pyload (pyLoad 0.5.0b3.dev101), with the behaviours that
// matter: API key (dev101) or basic auth (dev96), GET / POST per method,
// pause, reconnection toggle, restart of the failed files, packages added,
// rate limit, a server that does not answer.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const fixture = (path) =>
  readFileSync(new URL(`../fixtures/pyload/${path}`, import.meta.url), 'utf8');
export const fixtureJson = (path) => JSON.parse(fixture(path));

// Made-up credentials, in the format of pyLoad (pl_ + id length + id + 43).
export const API_KEY = `pl_11${'k'.repeat(43)}`;
export const USERNAME = 'pyload';
export const PASSWORD = 'pyload-test-password';

const json = (status, body) => ({
  status,
  headers: { 'content-type': 'application/json', server: 'pyLoad/0.5.0' },
  body: JSON.stringify(body),
});

function offline() {
  const error = new Error('connect ECONNREFUSED');
  error.code = 'ECONNREFUSED';
  return error;
}

const METHODS = {
  status_server: 'GET',
  free_space: 'GET',
  get_server_version: 'GET',
  get_queue_data: 'GET',
  status_downloads: 'GET',
  pause_server: 'POST',
  unpause_server: 'POST',
  toggle_reconnect: 'POST',
  restart_failed: 'POST',
  add_package: 'POST',
};

export class FakePyload {
  /**
   * @param {object} [options]
   * @param {'apikey'|'basic'} [options.auth] dev101 takes an API key, dev96 basic auth
   * @param {string} [options.version]
   * @param {Array} [options.queue] packages, as `get_queue_data` returns them
   */
  constructor({
    auth = 'apikey',
    version = '0.5.0',
    queue = fixtureJson('0.5.0b3.dev101/queue-data-finished.json'),
  } = {}) {
    this.auth = auth;
    this.version = version;
    this.online = true;
    this.requests = [];
    this.paused = false;
    this.reconnect = false;
    this.free = fixtureJson('0.5.0b3.dev101/free-space.json');
    this.queue = structuredClone(queue);
    this.downloads = [];
    this.rateLimited = false;
    this.denied = new Set(); // API methods the user may not call
    this.nextId = Math.max(0, ...this.queue.map((pack) => pack.pid)) + 1;
    this.nextFid = Math.max(0, ...this.queue.flatMap((pack) => pack.links.map((l) => l.fid))) + 1;
  }

  // --- Scenario helpers ----------------------------------------------------------

  /** Add a package whose files have `status` (3 queued by default). */
  addPackage(name, links, status = 3) {
    const pid = this.nextId++;
    this.queue.push({
      pid,
      name,
      folder: name.replace(/\W+/g, '_'),
      site: '',
      password: '',
      dest: 1,
      order: this.queue.length,
      linksdone: 0,
      sizedone: 0,
      sizetotal: 0,
      linkstotal: null,
      links: links.map((url, order) => ({
        fid: this.nextFid++,
        url,
        name: url.split('/').pop(),
        plugin: 'DefaultPlugin',
        size: 0,
        format_size: '0.00 Bit',
        status,
        statusmsg: status === 3 ? 'queued' : 'downloading',
        package_id: pid,
        error: '',
        order,
      })),
      fids: null,
    });
    return pid;
  }

  pack(pid) {
    return this.queue.find((pack) => pack.pid === pid);
  }

  /** The files of a package downloading, as `status_downloads` shows them. */
  download(pid, { speed = 1_070_975, percent = 3, eta = 284 } = {}) {
    const pack = this.pack(pid);
    this.downloads = pack.links.map((link) => {
      link.status = 12;
      link.statusmsg = 'downloading';
      return {
        ...fixtureJson('0.5.0b3.dev101/status-downloads.json')[0],
        fid: link.fid,
        name: link.name,
        package_id: pid,
        package_name: pack.name,
        speed: speed / pack.links.length,
        percent,
        eta,
      };
    });
  }

  /** Every file of a package finished, `size` bytes each. */
  finish(pid, size = 2_097_152) {
    for (const link of this.pack(pid).links) {
      Object.assign(link, { status: 0, statusmsg: 'finished', error: '', size });
    }
    this.downloads = this.downloads.filter((download) => download.package_id !== pid);
  }

  /** A file failed: 8 failed, 1 offline (a dead link). */
  fail(pid, index = 0, { status = 8, error = 'Connection timed out' } = {}) {
    const link = this.pack(pid).links[index];
    Object.assign(link, {
      status,
      statusmsg: status === 1 ? 'offline' : 'failed',
      error: status === 1 ? 'offline' : error,
    });
    this.downloads = this.downloads.filter((download) => download.fid !== link.fid);
  }

  links() {
    return this.queue.flatMap((pack) => pack.links);
  }

  // --- HTTP ------------------------------------------------------------------------

  authorized(headers = {}) {
    if (this.auth === 'apikey') {
      const key = headers['x-api-key'];
      if (key !== undefined) {
        return key === API_KEY ? true : 'Invalid API key';
      }
      return 'Invalid API credentials';
    }
    const basic = headers.authorization;
    if (basic) {
      const expected = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')}`;
      return basic === expected ? true : 'Invalid API credentials';
    }
    return 'Invalid API credentials';
  }

  async handle(url, { method = 'GET', headers = {}, json: body } = {}) {
    if (!this.online) {
      throw offline();
    }
    const { pathname } = new URL(url);
    const name = pathname.replace(/^\/api\//, '');
    this.requests.push({ method, name, body });
    if (!pathname.startsWith('/api/')) {
      return { status: 302, headers: { location: '/login?next=index' }, body: '' };
    }
    const auth = this.authorized(headers);
    if (auth !== true) {
      return json(401, { error: auth });
    }
    if (this.rateLimited) {
      return json(429, { error: 'Too Many Requests' });
    }
    if (!METHODS[name]) {
      return this.auth === 'apikey'
        ? json(404, { error: 'Not Found' })
        : json(403, { error: 'Forbidden' });
    }
    if (METHODS[name] !== method) {
      return json(405, {
        error: `Method not allowed in API ${name}(): Expected ${METHODS[name]}, got ${method}`,
      });
    }
    if (this.denied.has(name)) {
      return json(401, { error: 'Access denied' });
    }
    return json(200, this[`api_${name}`](body ?? {}));
  }

  api_status_server() {
    const links = this.links();
    return {
      pause: this.paused,
      active: this.downloads.length,
      queue: links.filter((link) => link.status !== 0).length,
      total: links.length,
      speed: this.downloads.reduce((sum, download) => sum + download.speed, 0),
      download: !this.paused,
      reconnect: this.reconnect,
      captcha: false,
      proxy: false,
    };
  }

  api_free_space() {
    return this.free;
  }

  api_get_server_version() {
    return this.version;
  }

  api_get_queue_data() {
    return this.queue;
  }

  api_status_downloads() {
    return this.downloads;
  }

  api_pause_server() {
    this.paused = true;
    return null;
  }

  api_unpause_server() {
    this.paused = false;
    return null;
  }

  api_toggle_reconnect() {
    this.reconnect = !this.reconnect;
    return this.reconnect;
  }

  api_restart_failed() {
    for (const link of this.links()) {
      if (link.status === 8 || link.status === 9) {
        Object.assign(link, { status: 3, statusmsg: 'queued', error: '' });
      }
    }
    return null;
  }

  api_add_package({ name, links }) {
    return this.addPackage(name, links);
  }
}

/** A fake network: the pyLoad servers by origin, anything else unreachable. */
export function createNetwork(servers = {}) {
  const byOrigin = new Map(Object.entries(servers));
  return {
    servers: byOrigin,
    async request(url, options) {
      const server = byOrigin.get(new URL(url).origin);
      if (!server) {
        const error = new Error('connect EHOSTUNREACH');
        error.code = 'EHOSTUNREACH';
        throw error;
      }
      return server.handle(url, options);
    },
  };
}
