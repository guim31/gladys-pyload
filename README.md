# pyLoad for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for
[pyLoad](https://github.com/pyload/pyload), the free download manager (`pyload-ng` 0.5). It reads
the local API of pyLoad, shows the downloads on the dashboard, pauses and resumes them, restarts
the failed files or adds links from a scene, and starts scenes when a download is finished, a file
failed or the queue is empty.

Tested against real pyLoad 0.5.0b3.dev96 and 0.5.0b3.dev101 installs, not yet in a real Gladys:
feedback welcome in the [issues](https://github.com/guim31/gladys-pyload/issues).

## Features

- **One device per server** (up to two): downloads paused (switch), automatic reconnection
  (switch), download speed, active downloads, files in the queue, files in total, failed files,
  free disk space, status, last download. Feature names in French by default, or English, German,
  Spanish.
- **Scene triggers**: _Download completed_ (a package), _File failed_ (with the reason given by
  pyLoad) and _Queue empty_, filtered by server. Once each, including what happened while the
  integration was restarting.
- **Scene actions**: _Pause downloads_ (for a number of minutes, or until resumed), _Resume
  downloads_, _Restart failed files_, on one server or all of them, and _Add links to download_
  (off until allowed in the configuration). Never a deletion, never a restart of pyLoad.
- **Widget** _pyLoad downloads_: speed, queue, time left, one line per server (state, files in
  progress, failed files, free space, last download), and Pause, Pause 30 min, Resume and Retry
  failed buttons.
- **Test the connection** button in the configuration.

The features, triggers, widget and actions follow the two sibling integrations,
[gladys-usenet](https://github.com/guim31/gladys-usenet) (SABnzbd / NZBGet) and
[gladys-torrent](https://github.com/guim31/gladys-torrent) (qBittorrent / Transmission / Deluge),
so the three download managers behave the same way in Gladys.

## Requirements

- Gladys 5.1.0 or later.
- pyLoad 0.5 on the local network of Gladys: an **API key** for 0.5.0b3.dev101 and later (pyLoad:
  Settings → Users → Manage API Keys), the user name and password of the web interface before.
  The old pyLoad 0.4 API is not supported.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the address of this
   repository: `https://github.com/guim31/gladys-pyload` (or install **pyLoad** from the catalog
   once it is listed).
2. In **Configuration**, enter the address with its port (`192.168.1.10:8000`), the API key (or
   the user name and password), and optionally a name. Save, then click **Test the connection**.
3. Open the **Discover** tab and add the device.

The user guide is in [`docs/en.md`](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

- The integration reads each server on its own timer (30 s by default, 10 s to 5 min), not through
  the polling of Gladys (the devices are published with `should_poll: false`,
  GladysAssistant/Gladys#3198). Only the changed values are sent to Gladys, and each value again
  after 6 hours.
- A reading is `GET /api/status_server`, `/api/free_space` and `/api/get_queue_data`, plus
  `/api/status_downloads` while something downloads: 3 or 4 calls, well within the 100 calls a
  minute pyLoad accepts per address. Commands: `POST /api/pause_server`, `unpause_server`,
  `toggle_reconnect`, `restart_failed`, `add_package`.
- Authentication: the `X-API-Key` header (pyLoad 0.5.0b3.dev101 and later), HTTP basic auth
  (before). Refused credentials are not retried on the timer (each refusal is an error in the
  pyLoad log): saving the configuration or **Test the connection** tries again.
- pyLoad has no timed pause: the integration pauses it and resumes it at the end, the end being
  kept in `/data/pyload-state.json` with what the triggers already announced (completed packages,
  failed files, whether something was left to download), so a restart neither repeats nor misses
  an event.

## Checked on real software, and what was not

The session that wrote this integration ran pyLoad in Docker (`lscr.io/linuxserver/pyload-ng`,
0.5.0b3.dev101 and 0.5.0b3.dev96) with a small local HTTP server, so pyLoad really downloaded,
finished, paused and failed files (a 404 link is "offline"; pyLoad refuses private addresses with
"Refusing to download from Server-Side host"). Its answers are recorded, anonymised, in
`test/fixtures/pyload` and replayed by the tests; the integration itself ran in the sandbox of
Gladys (read-only root, no capability, 256 MB) against both versions.

Not checked: a real Gladys (dashboard rendering, scene editor, Discovery tab), real file hosts and
their accounts, captchas, HTTPS with a self-signed certificate, a reverse proxy.

## Limitations

- Pausing pyLoad lets the files already downloading finish (pyLoad's own pause).
- The automatic reconnection reads off outside its time window set in pyLoad.
- No queue management beyond adding links and restarting the failed files: the integration deletes
  nothing.

## Credits

- [pyLoad](https://github.com/pyload/pyload) (AGPL-3.0), by the pyLoad team: the API this
  integration talks to. The cover shows the pyLoad logo from its repository
  (`media/logo.png`), a trademark of the pyLoad team.
- The Home Assistant [pyLoad integration](https://www.home-assistant.io/integrations/pyload/)
  (Apache-2.0) and its library [pyloadapi](https://github.com/tr4nt0r/pyloadapi) (MIT), by
  Manfred Dennerlein Rodelo (tr4nt0r): the choice of figures and controls.
- Architecture and tests adapted from [gladys-usenet](https://github.com/guim31/gladys-usenet).

Not affiliated with the pyLoad team.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

Released under the Apache 2.0 license (see `LICENSE`).
