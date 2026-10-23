// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `pyload`.
//
// The use case, as for the Usenet and torrent widgets of guim31: a glance at
// the wall tablet ("is the download still running, how long?"), and a pause
// when the line is needed (a video call, a game). So the widget shows the
// speed, the queue and the time left, one status row per server (its state,
// the files downloading, free space, failed files, last download), and four
// direct buttons: Pause (until resumed), Pause 30 min, Resume, Restart the
// failed files. No form button: it would need Gladys 5.2.0, and the scene
// action covers other durations.
//
// Every server by default, or the one chosen in the widget settings.
//
// Budget (8 components, 6 tiles, 1 status, 4 buttons): three tiles, one
// status list, four buttons. The figures are sent as values, not bound to
// device features, so the widget works before the devices are added to
// Gladys and sums two servers.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { ERROR_KINDS } from './clients/errors.js';
import { GB, MB, STATUSES } from './clients/model.js';
import { serverName } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { STATUS_TEXT, decimal, pick } from './texts.js';

// Action keys of the buttons: permanent once published (unique, the core
// drops a button whose key is taken).
export const ACTIONS = Object.freeze({
  PAUSE: 'pause',
  PAUSE_30: 'pause_30',
  RESUME: 'resume',
  RESTART_FAILED: 'restart_failed',
});
// Files downloading listed per server.
const MAX_FILE_ROWS = 2;
export const SHORT_PAUSE_MINUTES = 30;

const ACTIVE_ICON = 'check-circle';

export const TEXT = {
  pick: {
    en: 'Enter the address of pyLoad in the configuration of the integration.',
    fr: "Saisissez l'adresse de pyLoad dans la configuration de l'intégration.",
    de: 'Gib die Adresse von pyLoad in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de pyLoad en la configuración de la integración.',
  },
  unknown: {
    en: 'This server is no longer in the configuration: choose another one in the widget settings.',
    fr: "Ce serveur n'est plus dans la configuration : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieser Server ist nicht mehr in der Konfiguration: Wähle einen anderen in den Widget-Einstellungen.',
    es: 'Este servidor ya no está en la configuración: elija otro en la configuración del widget.',
  },
  noAnswer: {
    en: 'No pyLoad server answers: see the Configuration screen of the integration.',
    fr: "Aucun serveur pyLoad ne répond : voir l'écran Configuration de l'intégration.",
    de: 'Kein pyLoad-Server antwortet: Sieh dir die Konfiguration der Integration an.',
    es: 'Ningún servidor pyLoad responde: consulte la pantalla de configuración de la integración.',
  },
  speed: { en: 'Speed', fr: 'Vitesse', de: 'Geschwindigkeit', es: 'Velocidad' },
  queue: { en: 'Queue', fr: "File d'attente", de: 'Warteschlange', es: 'Cola' },
  timeLeft: { en: 'Time left', fr: 'Temps restant', de: 'Restzeit', es: 'Tiempo restante' },
  free: { en: 'Free space', fr: 'Espace libre', de: 'Freier Speicher', es: 'Espacio libre' },
  last: {
    en: 'Last download',
    fr: 'Dernier téléchargement',
    de: 'Letzter Download',
    es: 'Última descarga',
  },
  failed: {
    en: 'Failed files',
    fr: 'Fichiers en échec',
    de: 'Fehlgeschlagene Dateien',
    es: 'Archivos fallidos',
  },
  error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  waiting: { en: 'Waiting…', fr: 'En attente…', de: 'Warte…', es: 'Esperando…' },
  until: { en: 'until', fr: "jusqu'à", de: 'bis', es: 'hasta' },
  pause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  pause30: { en: 'Pause 30 min', fr: 'Pause 30 min', de: 'Pause 30 min', es: 'Pausa 30 min' },
  resume: { en: 'Resume', fr: 'Reprendre', de: 'Fortsetzen', es: 'Reanudar' },
  restart: {
    en: 'Retry failed',
    fr: 'Relancer les échecs',
    de: 'Fehler wiederholen',
    es: 'Reintentar fallidos',
  },
};

// Toasts after a tap (≤ 200 characters).
export const DONE_TEXT = {
  en: {
    paused: (count) => `pyLoad paused on ${count} server(s): the files in progress finish.`,
    pausedFor: (minutes, count) =>
      `pyLoad paused for ${minutes} min on ${count} server(s): the files in progress finish.`,
    resumed: (count) => `Downloads resumed on ${count} server(s).`,
    restarted: (count) => `Failed files restarted on ${count} server(s).`,
  },
  fr: {
    paused: (count) =>
      `pyLoad en pause sur ${count} serveur(s) : les fichiers en cours se terminent.`,
    pausedFor: (minutes, count) =>
      `pyLoad en pause pour ${minutes} min sur ${count} serveur(s) : les fichiers en cours se terminent.`,
    resumed: (count) => `Téléchargements repris sur ${count} serveur(s).`,
    restarted: (count) => `Fichiers en échec relancés sur ${count} serveur(s).`,
  },
  de: {
    paused: (count) => `pyLoad auf ${count} Server(n) pausiert: Laufende Dateien werden fertig.`,
    pausedFor: (minutes, count) =>
      `pyLoad für ${minutes} min auf ${count} Server(n) pausiert: Laufende Dateien werden fertig.`,
    resumed: (count) => `Downloads auf ${count} Server(n) fortgesetzt.`,
    restarted: (count) => `Fehlgeschlagene Dateien auf ${count} Server(n) neu gestartet.`,
  },
  es: {
    paused: (count) => `pyLoad en pausa en ${count} servidor(es): los archivos en curso terminan.`,
    pausedFor: (minutes, count) =>
      `pyLoad en pausa durante ${minutes} min en ${count} servidor(es): los archivos en curso terminan.`,
    resumed: (count) => `Descargas reanudadas en ${count} servidor(es).`,
    restarted: (count) => `Archivos fallidos reiniciados en ${count} servidor(es).`,
  },
};

// Day letter of a long time left: "2 d 4 h", "2 j 4 h"…
const DAY = { en: 'd', fr: 'j', de: 'T', es: 'd' };

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** Seconds as a short duration that fits a tile (≤ 12 characters). */
export function formatDuration(seconds, language) {
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
  }
  return fit(`${Math.floor(hours / 24)} ${DAY[language] ?? DAY.en} ${hours % 24} h`, 12);
}

/** "14:30" in the time zone of Gladys (TZ, injected by the supervisor). */
const clock = (at, language) =>
  new Date(at).toLocaleTimeString(language === 'en' ? 'en-GB' : language, {
    hour: '2-digit',
    minute: '2-digit',
  });

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** The rows of one server: state, then its details when it answers. */
function serverRows(record, language, { prefix }) {
  const name = serverName(record.server);
  const label = (text) => fit(prefix ? `${text} · ${name}` : text, 40);
  if (record.error) {
    const unreachable = record.error.kind === ERROR_KINDS.UNREACHABLE;
    return [
      {
        label: fit(name, 40),
        icon: 'alert-triangle',
        value: t(unreachable ? STATUS_TEXT.unreachable : TEXT.error, language),
        color: WIDGET_COLORS.DANGER,
      },
    ];
  }
  const { snapshot } = record;
  if (!snapshot) {
    return [
      {
        label: fit(name, 40),
        icon: 'clock',
        value: t(TEXT.waiting, language),
        color: WIDGET_COLORS.NEUTRAL,
      },
    ];
  }
  const state = { label: fit(name, 40), value: t(STATUS_TEXT[snapshot.status], language) };
  if (snapshot.status === STATUSES.DOWNLOADING) {
    Object.assign(state, { icon: 'download', color: WIDGET_COLORS.SUCCESS });
  } else if (snapshot.status === STATUSES.PAUSED) {
    Object.assign(state, { icon: 'pause-circle', color: WIDGET_COLORS.WARNING });
    if (snapshot.pauseEndsAt) {
      state.value = `${state.value} · ${t(TEXT.until, language)} ${clock(snapshot.pauseEndsAt, language)}`;
    }
  } else if (snapshot.status === STATUSES.QUEUED) {
    Object.assign(state, { icon: 'list', color: WIDGET_COLORS.INFO });
  } else {
    Object.assign(state, { icon: 'check', color: WIDGET_COLORS.NEUTRAL });
  }
  state.value = fit(state.value, 40);
  const rows = [state];
  for (const file of snapshot.downloads.slice(0, MAX_FILE_ROWS)) {
    rows.push({
      label: fit(file.name || file.packageName || '?', 40),
      icon: 'arrow-down-circle',
      value: file.etaSec
        ? `${file.percent} % · ${formatDuration(file.etaSec, language)}`
        : `${file.percent} %`,
      color: WIDGET_COLORS.INFO,
    });
  }
  if (snapshot.failed.length > 0) {
    rows.push({
      label: label(t(TEXT.failed, language)),
      icon: 'alert-circle',
      value: snapshot.failed.length,
      color: WIDGET_COLORS.WARNING,
    });
  }
  if (snapshot.freeBytes !== null) {
    rows.push({
      label: label(t(TEXT.free, language)),
      icon: 'hard-drive',
      value: `${decimal(snapshot.freeBytes / GB, language)} GB`,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  const last = record.lastCompleted;
  if (last) {
    rows.push({
      label: label(t(TEXT.last, language)),
      icon: 'check-circle',
      value: fit(last, 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  return rows;
}

export function buttons(records, language) {
  const answering = records.filter((record) => record.snapshot && !record.error);
  const allPaused =
    answering.length > 0 &&
    answering.every((record) => record.snapshot.paused && !record.snapshot.pauseEndsAt);
  const allRunning = answering.length > 0 && answering.every((record) => !record.snapshot.paused);
  // The current state shows as a check mark, never as the style (`primary`
  // is invisible in dark mode).
  return [
    {
      type: 'button',
      label: t(TEXT.pause, language),
      icon: allPaused ? ACTIVE_ICON : 'pause',
      style: 'secondary',
      action: { key: ACTIONS.PAUSE },
    },
    {
      type: 'button',
      label: t(TEXT.pause30, language),
      icon: 'clock',
      style: 'secondary',
      action: { key: ACTIONS.PAUSE_30, params: { minutes: SHORT_PAUSE_MINUTES } },
    },
    {
      type: 'button',
      label: t(TEXT.resume, language),
      icon: allRunning ? ACTIVE_ICON : 'play',
      style: 'secondary',
      action: { key: ACTIONS.RESUME },
    },
    {
      type: 'button',
      label: t(TEXT.restart, language),
      icon: 'refresh-cw',
      style: 'secondary',
      action: { key: ACTIONS.RESTART_FAILED },
    },
  ];
}

async function get(hub, { settings, language = 'en' }) {
  if (hub.records.size === 0) {
    return message(TEXT.pick, language);
  }
  const records = hub.view(settings?.device);
  if (records.length === 0) {
    return message(TEXT.unknown, language);
  }
  const answering = records.filter((record) => record.snapshot && !record.error);
  const components = [];
  if (answering.length) {
    const speed = answering.reduce((sum, record) => sum + record.snapshot.speedBps, 0);
    const queue = answering.reduce((sum, record) => sum + record.snapshot.queueCount, 0);
    const left = Math.max(...answering.map((record) => record.snapshot.timeLeftSec));
    components.push(
      {
        type: 'value',
        value: Math.round((speed / MB) * 10) / 10,
        unit: 'MB/s',
        label: t(TEXT.speed, language),
        icon: 'download',
        color: speed > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
      },
      { type: 'value', value: queue, label: t(TEXT.queue, language), icon: 'list' },
      {
        type: 'value',
        value: left > 0 ? formatDuration(left, language) : '—',
        label: t(TEXT.timeLeft, language),
        icon: 'clock',
      },
    );
  } else if (records.every((record) => record.error)) {
    components.push({ type: 'text', variant: 'body', text: t(TEXT.noAnswer, language) });
  }
  const items = records.flatMap((record) =>
    serverRows({ ...record, lastCompleted: hub.lastCompleted(record) }, language, {
      prefix: records.length > 1,
    }),
  );
  components.push({ type: 'status', items: items.slice(0, 10) });
  components.push(...buttons(records, language));
  const downloading = answering.some((record) => record.snapshot.speedBps > 0);
  // A download moves: refresh sooner.
  return { ttl_seconds: downloading ? 15 : 60, components };
}

async function action(hub, { actionKey, settings }) {
  const device = settings?.device || null;
  const done = (render) =>
    Object.fromEntries(Object.entries(DONE_TEXT).map(([lang, text]) => [lang, render(text)]));
  if (actionKey === ACTIONS.RESUME) {
    const count = await hub.resume(device);
    return { message: done((text) => text.resumed(count)) };
  }
  if (actionKey === ACTIONS.PAUSE) {
    const count = await hub.pause(device, 0);
    return { message: done((text) => text.paused(count)) };
  }
  if (actionKey === ACTIONS.PAUSE_30) {
    const count = await hub.pause(device, SHORT_PAUSE_MINUTES);
    return { message: done((text) => text.pausedFor(SHORT_PAUSE_MINUTES, count)) };
  }
  if (actionKey === ACTIONS.RESTART_FAILED) {
    const count = await hub.restartFailed(device);
    return { message: done((text) => text.restarted(count)) };
  }
  throw new Error(`Unknown action ${actionKey}`);
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
