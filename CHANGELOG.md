# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One Gladys device per pyLoad server (pyload-ng 0.5, up to two): downloads paused and automatic
  reconnection (switches), download speed, active downloads, files in the queue, files in total,
  failed files, free disk space, status and last download. Feature names in French by default, or
  English, German and Spanish.
- API key authentication (pyLoad 0.5.0b3.dev101 and later), or user name and password (before).
- Scene triggers "Download completed" (a package), "File failed" (with the reason) and "Queue
  empty", filtered by server. What happened during a restart of the integration is announced once
  it is back.
- Scene actions "Pause downloads" (for a number of minutes or until resumed), "Resume downloads",
  "Restart failed files" and "Add links to download" (off until allowed in the configuration).
- The "pyLoad downloads" dashboard widget: speed, queue, time left, one line per server, and
  Pause, Pause 30 min, Resume and Retry failed buttons.
- A "Test the connection" button, and the documentation in English, French, German and Spanish.
