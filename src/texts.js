// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the state of a server, the "Test the connection"
// report, scene action errors. Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks every
// table. The brand name (pyLoad) is never translated.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './clients/errors.js';
import { STATUSES } from './clients/model.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noServer: {
    en: 'Enter the address of pyLoad in the configuration.',
    fr: "Saisissez l'adresse de pyLoad dans la configuration.",
    de: 'Gib die Adresse von pyLoad in der Konfiguration ein.',
    es: 'Introduzca la dirección de pyLoad en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.10:8000',
    fr: 'Adresse incomprise, ex. http://192.168.1.10:8000',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.10:8000',
    es: 'Dirección no válida, p. ej. http://192.168.1.10:8000',
  },
};

// One short explanation per error kind (src/clients/errors.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'login refused: recent pyLoad needs an API key; correct, then save',
    fr: "connexion refusée : un pyLoad récent exige une clé d'API ; corrigez, puis enregistrez",
    de: 'Anmeldung abgelehnt: Neues pyLoad braucht einen API-Schlüssel; korrigiere und speichere',
    es: 'acceso rechazado: un pyLoad reciente exige una clave de API; corrija y guarde',
  },
  [ERROR_KINDS.PERMISSION]: {
    en: 'the pyLoad user lacks a permission (pyLoad: Settings → Users)',
    fr: "il manque un droit à l'utilisateur pyLoad (pyLoad : Paramètres → Utilisateurs)",
    de: 'dem pyLoad-Benutzer fehlt ein Recht (pyLoad: Einstellungen → Benutzer)',
    es: 'al usuario de pyLoad le falta un permiso (pyLoad: Ajustes → Usuarios)',
  },
  [ERROR_KINDS.NOT_PYLOAD]: {
    en: 'no pyLoad 0.5 at this address: check the port (8000)',
    fr: 'pas de pyLoad 0.5 à cette adresse : vérifiez le port (8000)',
    de: 'kein pyLoad 0.5 unter dieser Adresse: Prüfe den Port (8000)',
    es: 'no hay pyLoad 0.5 en esta dirección: compruebe el puerto (8000)',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'too many requests to pyLoad, try again in a minute',
    fr: 'trop de requêtes vers pyLoad, réessayez dans une minute',
    de: 'zu viele Anfragen an pyLoad, versuche es in einer Minute erneut',
    es: 'demasiadas solicitudes a pyLoad, inténtelo de nuevo en un minuto',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
  [ERROR_KINDS.BAD_LINK]: {
    en: 'enter http://, https:// or ftp:// links, 50 at most',
    fr: 'saisissez des liens http://, https:// ou ftp://, 50 au plus',
    de: 'gib Links mit http://, https:// oder ftp:// ein, höchstens 50',
    es: 'introduzca enlaces http://, https:// o ftp://, 50 como máximo',
  },
  [ERROR_KINDS.LINKS_OFF]: {
    en: 'adding links is off: allow it in the configuration of the integration',
    fr: "l'ajout de liens est désactivé : autorisez-le dans la configuration de l'intégration",
    de: 'Links hinzufügen ist aus: Erlaube es in der Konfiguration der Integration',
    es: 'añadir enlaces está desactivado: permítalo en la configuración de la integración',
  },
};

// The "Status" feature of a server, and its row in the widget.
export const STATUS_TEXT = {
  [STATUSES.DOWNLOADING]: {
    en: 'Downloading',
    fr: 'Téléchargement',
    de: 'Lädt herunter',
    es: 'Descargando',
  },
  [STATUSES.PAUSED]: { en: 'Paused', fr: 'En pause', de: 'Pausiert', es: 'En pausa' },
  [STATUSES.QUEUED]: { en: 'Waiting', fr: 'En attente', de: 'Wartet', es: 'En espera' },
  [STATUSES.IDLE]: { en: 'Idle', fr: 'Inactif', de: 'Leerlauf', es: 'Inactivo' },
  unreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
};

// The "Test the connection" report, one line per server.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    queue: (count) => `${count} file(s) in the queue`,
    failed: (count) => `${count} failed`,
    noSpace: 'free space unknown (the user lacks the "status" permission)',
  },
  fr: {
    ok: 'OK',
    queue: (count) => `${count} fichier(s) en file d'attente`,
    failed: (count) => `${count} en échec`,
    noSpace: "espace libre inconnu (il manque le droit « status » à l'utilisateur)",
  },
  de: {
    ok: 'OK',
    queue: (count) => `${count} Datei(en) in der Warteschlange`,
    failed: (count) => `${count} fehlgeschlagen`,
    noSpace: 'freier Speicher unbekannt (dem Benutzer fehlt das Recht „status“)',
  },
  es: {
    ok: 'OK',
    queue: (count) => `${count} archivo(s) en la cola`,
    failed: (count) => `${count} fallido(s)`,
    noSpace: 'espacio libre desconocido (al usuario le falta el permiso «status»)',
  },
};

// Errors of the scene actions, the device controls and the widget buttons.
export const ACTION_TEXT = {
  noServer: {
    en: 'No pyLoad server is configured.',
    fr: "Aucun serveur pyLoad n'est configuré.",
    de: 'Kein pyLoad-Server ist konfiguriert.',
    es: 'No hay ningún servidor pyLoad configurado.',
  },
  unknownServer: {
    en: 'This pyLoad server is no longer in the configuration.',
    fr: "Ce serveur pyLoad n'est plus dans la configuration.",
    de: 'Dieser pyLoad-Server ist nicht mehr in der Konfiguration.',
    es: 'Este servidor pyLoad ya no está en la configuración.',
  },
  failed: {
    en: 'No pyLoad server accepted the command.',
    fr: "Aucun serveur pyLoad n'a accepté la commande.",
    de: 'Kein pyLoad-Server hat den Befehl angenommen.',
    es: 'Ningún servidor pyLoad ha aceptado la orden.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A decimal number written the way the language writes it ("2,5" in French). */
export const decimal = (value, language, digits = 1) =>
  value.toLocaleString(language === 'en' ? 'en-US' : language, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
