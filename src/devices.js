// -----------------------------------------------------------------------------
// One Gladys device per configured pyLoad server.
//
// Identity: the configuration slot (1 or 2), not the address: switching a
// slot from an IP to a host name, or from HTTP to HTTPS, keeps the device and
// its history. pyLoad exposes no stable instance id to use instead.
//
// Features (category/type couples of the core table, see
// test/gladys-rules.test.js), in display order:
//   - paused: switch/binary, writable — 1 pyLoad paused (no new download
//     starts, the files in progress finish), 0 downloading;
//   - automatic reconnection: switch/binary, writable;
//   - download speed: datarate/rate in MB/s (binary, like pyLoad shows);
//   - active downloads, queue (pyLoad's "queue" figure: files not finished,
//     failed ones included), total (pyLoad's "total": every file) and failed
//     files: counter-sensor/integer;
//   - free space: data/size in GB, the download folder;
//   - status: text/text (Downloading, Paused, Waiting, Idle, Unreachable), in
//     the language of the configuration;
//   - last download: text/text, the name of the last package completed.
//
// Published with should_poll: false: the integration reads the servers on its
// own timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { SLOTS, hostOf } from './config.js';
import { GB, MB } from './clients/model.js';
import { STATUS_TEXT, pick } from './texts.js';

export const DEVICE_TYPE = 'server';
export const URL_PARAM = 'URL';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  PAUSED: 'paused',
  RECONNECT: 'reconnect',
  SPEED: 'download_speed',
  ACTIVE: 'active_downloads',
  QUEUE: 'queue_count',
  TOTAL: 'total_count',
  FAILED: 'failed_count',
  FREE: 'free_space',
  STATUS: 'status',
  LAST: 'last_completed',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.PAUSED]: 'Downloads paused',
    [FEATURE_KEYS.RECONNECT]: 'Automatic reconnection',
    [FEATURE_KEYS.SPEED]: 'Download speed',
    [FEATURE_KEYS.ACTIVE]: 'Active downloads',
    [FEATURE_KEYS.QUEUE]: 'Files in the queue',
    [FEATURE_KEYS.TOTAL]: 'Files in total',
    [FEATURE_KEYS.FAILED]: 'Failed files',
    [FEATURE_KEYS.FREE]: 'Free disk space',
    [FEATURE_KEYS.STATUS]: 'Status',
    [FEATURE_KEYS.LAST]: 'Last download',
  },
  fr: {
    [FEATURE_KEYS.PAUSED]: 'Téléchargements en pause',
    [FEATURE_KEYS.RECONNECT]: 'Reconnexion automatique',
    [FEATURE_KEYS.SPEED]: 'Vitesse de téléchargement',
    [FEATURE_KEYS.ACTIVE]: 'Téléchargements actifs',
    [FEATURE_KEYS.QUEUE]: "Fichiers en file d'attente",
    [FEATURE_KEYS.TOTAL]: 'Fichiers au total',
    [FEATURE_KEYS.FAILED]: 'Fichiers en échec',
    [FEATURE_KEYS.FREE]: 'Espace disque libre',
    [FEATURE_KEYS.STATUS]: 'État',
    [FEATURE_KEYS.LAST]: 'Dernier téléchargement',
  },
  de: {
    [FEATURE_KEYS.PAUSED]: 'Downloads pausiert',
    [FEATURE_KEYS.RECONNECT]: 'Automatische Neuverbindung',
    [FEATURE_KEYS.SPEED]: 'Download-Geschwindigkeit',
    [FEATURE_KEYS.ACTIVE]: 'Aktive Downloads',
    [FEATURE_KEYS.QUEUE]: 'Dateien in der Warteschlange',
    [FEATURE_KEYS.TOTAL]: 'Dateien insgesamt',
    [FEATURE_KEYS.FAILED]: 'Fehlgeschlagene Dateien',
    [FEATURE_KEYS.FREE]: 'Freier Speicherplatz',
    [FEATURE_KEYS.STATUS]: 'Status',
    [FEATURE_KEYS.LAST]: 'Letzter Download',
  },
  es: {
    [FEATURE_KEYS.PAUSED]: 'Descargas en pausa',
    [FEATURE_KEYS.RECONNECT]: 'Reconexión automática',
    [FEATURE_KEYS.SPEED]: 'Velocidad de descarga',
    [FEATURE_KEYS.ACTIVE]: 'Descargas activas',
    [FEATURE_KEYS.QUEUE]: 'Archivos en la cola',
    [FEATURE_KEYS.TOTAL]: 'Archivos en total',
    [FEATURE_KEYS.FAILED]: 'Archivos fallidos',
    [FEATURE_KEYS.FREE]: 'Espacio libre en disco',
    [FEATURE_KEYS.STATUS]: 'Estado',
    [FEATURE_KEYS.LAST]: 'Última descarga',
  },
};

// Display bounds (the core never applies them on write).
const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
const sensor = (category, type, extra) => ({
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  ...extra,
});

const counter = (max) =>
  sensor(DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR, DEVICE_FEATURE_TYPES.SENSOR.INTEGER, { max });
const switchFeature = {
  category: DEVICE_FEATURE_CATEGORIES.SWITCH,
  type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
  read_only: false,
  has_feedback: true,
  keep_history: true,
  min: 0,
  max: 1,
};
const textFeature = {
  category: DEVICE_FEATURE_CATEGORIES.TEXT,
  type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 0,
};
const MAX_FILES = 1_000_000;

// Order = display order in Gladys. `value(snapshot, context)` returns a number,
// `{ text }` or null (nothing to publish).
const FEATURES = [
  {
    key: FEATURE_KEYS.PAUSED,
    definition: switchFeature,
    value: (snapshot) => (snapshot.paused ? 1 : 0),
  },
  {
    key: FEATURE_KEYS.RECONNECT,
    definition: switchFeature,
    value: (snapshot) => (snapshot.reconnect ? 1 : 0),
  },
  {
    key: FEATURE_KEYS.SPEED,
    definition: sensor(DEVICE_FEATURE_CATEGORIES.DATARATE, DEVICE_FEATURE_TYPES.DATARATE.RATE, {
      unit: DEVICE_FEATURE_UNITS.MEGABYTES_PER_SECOND,
      max: 10_000,
    }),
    value: (snapshot) => round(snapshot.speedBps / MB, 2),
  },
  {
    key: FEATURE_KEYS.ACTIVE,
    definition: counter(1000),
    value: (snapshot) => Math.min(1000, snapshot.active),
  },
  {
    key: FEATURE_KEYS.QUEUE,
    definition: counter(MAX_FILES),
    value: (snapshot) => Math.min(MAX_FILES, snapshot.queueCount),
  },
  {
    key: FEATURE_KEYS.TOTAL,
    definition: counter(MAX_FILES),
    value: (snapshot) => Math.min(MAX_FILES, snapshot.total),
  },
  {
    key: FEATURE_KEYS.FAILED,
    definition: counter(MAX_FILES),
    value: (snapshot) => Math.min(MAX_FILES, snapshot.failed.length),
  },
  {
    key: FEATURE_KEYS.FREE,
    definition: sensor(DEVICE_FEATURE_CATEGORIES.DATA, DEVICE_FEATURE_TYPES.DATA.SIZE, {
      unit: DEVICE_FEATURE_UNITS.GIGABYTE,
      max: 1_000_000,
    }),
    value: (snapshot) => (snapshot.freeBytes === null ? null : round(snapshot.freeBytes / GB, 1)),
  },
  {
    key: FEATURE_KEYS.STATUS,
    definition: textFeature,
    value: (snapshot, { language }) => ({ text: pick(STATUS_TEXT[snapshot.status], language) }),
  },
  {
    key: FEATURE_KEYS.LAST,
    definition: textFeature,
    value: (snapshot, { lastCompleted }) => (lastCompleted ? { text: lastCompleted } : null),
  },
];

/** External ids of a server's device and features. */
export const deviceIds = (gladys, slot) => gladys.externalIds(DEVICE_TYPE, String(slot));

/** The slot of a device external id, null when it is not one of ours. */
export function slotOf(gladys, externalId) {
  for (const slot of SLOTS) {
    if (deviceIds(gladys, slot).device === externalId) {
      return slot;
    }
  }
  return null;
}

/** The name shown for a server: the one typed in the configuration, else "pyLoad" and the address. */
export const serverName = (server) => server.name ?? `pyLoad ${hostOf(server.url)}`;

/**
 * The discovery payload of a server.
 * @param {object} gladys SDK client
 * @param {{ slot: number, url: string, name: string|null }} server
 * @param {string} language feature names language
 */
export function buildDevice(gladys, server, language = 'en') {
  const ids = deviceIds(gladys, server.slot);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: serverName(server),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: URL_PARAM, value: server.url }],
    features: FEATURES.map(({ key, definition }) => ({
      ...definition,
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The states of a server, in the `publishStates` format (null values left out).
 * @param {object} context { language, lastCompleted }
 */
export function deviceStates(gladys, slot, snapshot, context) {
  const ids = deviceIds(gladys, slot);
  const states = [];
  for (const { key, value } of FEATURES) {
    const result = value(snapshot, context);
    if (result === null || result === undefined) {
      continue;
    }
    const state = { device_feature_external_id: ids.feature(key) };
    if (typeof result === 'object') {
      state.text = result.text;
    } else {
      state.state = result;
    }
    states.push(state);
  }
  return states;
}

/** The single "Unreachable" status of a server that stopped answering. */
export function unreachableState(gladys, slot, language) {
  return {
    device_feature_external_id: deviceIds(gladys, slot).feature(FEATURE_KEYS.STATUS),
    text: pick(STATUS_TEXT.unreachable, language),
  };
}
