// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Up to two pyLoad servers, each in its own slot: its address, its
// credentials (an API key for pyLoad 0.5.0b3.dev101 and later, a user name
// and a password before), and a name. The slot number is the device identity:
// changing the address of a slot (an IP for a name, HTTP for HTTPS) keeps the
// device and its history.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const SLOTS = [1, 2];

// Port pyLoad listens on out of the box, added to a bare host.
export const DEFAULT_PORT = 8000;

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['10', '30', '60', '120', '300'];

const slotDefaults = (slot) => ({
  [`server_${slot}_url`]: '',
  [`server_${slot}_api_key`]: '',
  [`server_${slot}_username`]: '',
  [`server_${slot}_password`]: '',
  [`server_${slot}_name`]: '',
});

export const DEFAULT_CONFIG = {
  ...slotDefaults(1),
  ...slotDefaults(2),
  allow_self_signed: false,
  poll_interval: '30',
  allow_add_links: false,
  language: 'fr',
};

const MAX_NAME_LENGTH = 40;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10`, `nas.local:8000`), or the URL copied from the browser
 * (`http://192.0.2.10:8000/dashboard`). HTTP by default; a bare host without
 * port gets port 8000. A path is kept (a reverse proxy may serve pyLoad under
 * `/pyload`), without a trailing page of the interface, `/api` or slash.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the device params.
  if (url.username || url.password) {
    return null;
  }
  if (!hasScheme && !url.port) {
    url.port = String(DEFAULT_PORT);
  }
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/(api|dashboard|home|queue|collector|files|logs|settings|login|index)$/i, '')
    .replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  // Secrets are kept as typed: spaces may be part of them.
  const secret = (key) => (typeof source[key] === 'string' ? source[key] : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const servers = [];
  const invalid = [];
  for (const slot of SLOTS) {
    const typed = text(`server_${slot}_url`);
    if (!typed) {
      continue;
    }
    const url = parseServerUrl(typed);
    if (!url) {
      invalid.push(slot);
      continue;
    }
    servers.push({
      slot,
      url,
      apiKey: secret(`server_${slot}_api_key`).trim(),
      username: text(`server_${slot}_username`),
      password: secret(`server_${slot}_password`),
      name: text(`server_${slot}_name`).slice(0, MAX_NAME_LENGTH) || null,
    });
  }

  const flag = (key) => source[key] === true || source[key] === 'true';
  return {
    servers,
    invalidSlots: invalid,
    allowSelfSigned: flag('allow_self_signed'),
    allowAddLinks: flag('allow_add_links'),
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
