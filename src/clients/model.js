// -----------------------------------------------------------------------------
// The snapshot the pyLoad client produces (src/clients/pyload.js), so the rest
// of the integration never deals with the API format:
//
//   version       pyLoad version, e.g. "0.5.0" (null when unknown)
//   status        'downloading' | 'paused' | 'queued' | 'idle'
//   paused        pyLoad is paused: it starts no new download (the files
//                 already downloading finish)
//   reconnect     automatic reconnection on
//   speedBps      download speed, bytes per second
//   active        files downloading now
//   queueCount    files of the queue not finished (pyLoad's own "queue" figure,
//                 failed files included)
//   total         files of pyLoad, queue and collector
//   pendingCount  files still to download: waiting, queued or downloading
//   freeBytes     free space of the download folder, null if unknown
//   timeLeftSec   time left of the longest download in progress, 0 when none
//   downloads     files downloading: { id, name, packageName, percent, etaSec }
//   packages      packages of the queue: { id, key, name, files, bytes, finished }
//   failed        files that failed: { id, key, name, packageName, reason }
//
// Sizes are binary (1 MB = 1024 × 1024 bytes), like pyLoad shows them.
// -----------------------------------------------------------------------------

export const KB = 1024;
export const MB = 1024 * 1024;
export const GB = 1024 * 1024 * 1024;

export const STATUSES = Object.freeze({
  DOWNLOADING: 'downloading',
  PAUSED: 'paused',
  QUEUED: 'queued',
  IDLE: 'idle',
});

// The file statuses of pyLoad (pyload/core/datatypes/enums.py, DownloadStatus).
export const FILE_STATUS = Object.freeze({
  FINISHED: 0,
  OFFLINE: 1,
  ONLINE: 2,
  QUEUED: 3,
  SKIPPED: 4,
  WAITING: 5,
  TEMP_OFFLINE: 6,
  STARTING: 7,
  FAILED: 8,
  ABORTED: 9,
  DECRYPTING: 10,
  CUSTOM: 11,
  DOWNLOADING: 12,
  PROCESSING: 13,
  UNKNOWN: 14,
});

// Done: finished, or skipped (the file was already there).
export const DONE = new Set([FILE_STATUS.FINISHED, FILE_STATUS.SKIPPED]);
// Failed: the link is dead (offline, a 404 for instance) or the download
// failed. Not "aborted" (the user stopped it) nor "temporarily offline"
// (pyLoad tries again by itself).
export const FAILED = new Set([FILE_STATUS.OFFLINE, FILE_STATUS.FAILED]);
// Still to download, sooner or later.
export const PENDING = new Set([
  FILE_STATUS.ONLINE,
  FILE_STATUS.QUEUED,
  FILE_STATUS.WAITING,
  FILE_STATUS.TEMP_OFFLINE,
  FILE_STATUS.STARTING,
  FILE_STATUS.DECRYPTING,
  FILE_STATUS.CUSTOM,
  FILE_STATUS.DOWNLOADING,
  FILE_STATUS.PROCESSING,
  FILE_STATUS.UNKNOWN,
]);

/** A number from a JSON field that may be a string ("12.50"); null when not one. */
export function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value.trim());
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

const count = (value) => Math.max(0, Math.round(toNumber(value) ?? 0));
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const firstLine = (value) => text(value).split('\n')[0].trim();

/**
 * The snapshot of a reading.
 * @param {object} parts the answers of pyLoad
 * @param {object} parts.status `status_server`
 * @param {unknown[]} parts.queue `get_queue_data`
 * @param {unknown[]} [parts.downloads] `status_downloads`
 * @param {unknown} [parts.free] `free_space`
 * @param {string|null} [parts.version] `get_server_version`
 */
export function toSnapshot({ status, queue, downloads = [], free = null, version = null }) {
  const paused = status.pause === true;
  const active = count(status.active);
  const packages = [];
  const failed = [];
  let pendingCount = 0;
  for (const entry of Array.isArray(queue) ? queue : []) {
    const id = toNumber(entry?.pid);
    if (id === null) {
      continue;
    }
    const name = text(entry.name) || `#${id}`;
    const links = Array.isArray(entry.links) ? entry.links : [];
    let bytes = 0;
    let done = 0;
    for (const link of links) {
      const state = toNumber(link?.status);
      if (DONE.has(state)) {
        done += 1;
        bytes += count(link.size);
      } else if (FAILED.has(state)) {
        const fid = toNumber(link.fid);
        const fileName = text(link.name) || text(link.url) || `#${fid}`;
        failed.push({
          id: fid,
          // The id and the name: pyLoad may give a deleted id to a new file.
          key: `${fid}:${fileName}`,
          name: fileName,
          packageName: name,
          reason: firstLine(link.error) || text(link.statusmsg),
        });
      } else if (PENDING.has(state)) {
        pendingCount += 1;
      }
    }
    packages.push({
      id,
      key: `${id}:${name}`,
      name,
      files: links.length,
      bytes,
      finished: links.length > 0 && done === links.length,
    });
  }
  const files = (Array.isArray(downloads) ? downloads : [])
    .filter((download) => download && typeof download === 'object')
    .map((download) => ({
      id: toNumber(download.fid),
      name: text(download.name),
      packageName: text(download.package_name),
      percent: Math.min(100, count(download.percent)),
      etaSec: count(download.eta),
    }));
  const freeBytes = toNumber(free);
  let state;
  if (paused) {
    state = STATUSES.PAUSED;
  } else if (active > 0) {
    state = STATUSES.DOWNLOADING;
  } else if (pendingCount > 0) {
    state = STATUSES.QUEUED;
  } else {
    state = STATUSES.IDLE;
  }
  return {
    version: typeof version === 'string' && version ? version : null,
    status: state,
    paused,
    reconnect: status.reconnect === true,
    speedBps: Math.max(0, toNumber(status.speed) ?? 0),
    active,
    queueCount: count(status.queue),
    total: count(status.total),
    pendingCount: Math.max(pendingCount, active),
    freeBytes: freeBytes !== null && freeBytes >= 0 ? freeBytes : null,
    timeLeftSec: files.reduce((max, file) => Math.max(max, file.etaSec), 0),
    downloads: files,
    packages,
    failed,
  };
}
