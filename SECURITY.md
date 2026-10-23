# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the pyLoad API key and password are `secret` fields of the Gladys configuration.
  The integration reads them from Gladys, keeps them in memory, sends them only to the pyLoad
  server they belong to (the `X-API-Key` header, or HTTP basic authentication), and never writes
  them to `/data` nor to the logs. An address containing credentials (`http://user:pass@…`) is
  refused.
- **Stored in `/data`**: `pyload-state.json`, per server (with its address): the ids and names of
  the completed packages and failed files already announced to the scenes, the name of the last
  completed package, and the end of a timed pause. Nothing else.
- **Network**: requests go only to the pyLoad addresses typed in the configuration, on the local
  network, in HTTP or HTTPS. HTTPS certificates are verified unless the user ticks "Accept
  self-signed certificates"; the integration opens no port and calls no cloud service. It never
  deletes a file or a package and never restarts pyLoad. Adding links from a scene is off by
  default (an option of the configuration): pyLoad would download them.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)), pyLoad itself, the
file hosts it downloads from, and the other devices and services of your network.
