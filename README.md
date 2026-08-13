[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue)
![Docker](https://img.shields.io/badge/docker-supported-blue)
![Foundry VTT](https://img.shields.io/badge/foundry-vtt-orange)

# Deep Translate Proxy

Self-hosted proxy server designed for the **Deep Translate** module for Foundry VTT.
It acts as an authenticated bridge between Foundry and the DeepL API, with a
bounded in-memory cache for duplicate translations.

This repository contains only the free **self-hosted proxy**. Its setup assistant
uses the terms `local` and `remote` to describe how this same self-hosted proxy
is reached over the network:

* `local`: the proxy is reached on the computer running it;
* `remote`: the proxy is reached through a public HTTPS address that you operate.

These deployment modes are not the Yanklinnomme **hosted service** offered in
the Deep Translate module.

---

## Features

* **Batch translation** optimized for Foundry journals and rich content
* **Bounded in-memory cache** to reduce duplicate DeepL requests
* **DeepL API key remains in the proxy and is never exposed to Foundry**
* **HTML-aware translation** (preserves formatting)
* Works locally, via Docker, or as a standalone executable
* Supports secured remote deployment behind HTTPS or a trusted reverse proxy
* Learns the first authenticated Foundry origin in guided remote mode
* Isolates cached translations by tenant and DeepL API key
* Built specifically for **Foundry VTT workflows**

---

## Requirements

* A valid **DeepL API key**
* Foundry VTT with the **Deep Translate** module installed
* **Node.js 18 or later** only when running the proxy from source (Node.js is
  already included in the standalone executables and Docker image)

---

## Why use a proxy?

DeepL’s API cannot be called directly from Foundry VTT (or any browser-based environment) due to **CORS restrictions**.
This results in errors such as:

```
Failed to fetch
```

### Why self-host this proxy?

This repository lets you run a **self-hosted proxy** locally or on infrastructure
you control. It avoids an additional managed relay between this proxy and DeepL.

Self-hosting provides operational control but also makes you responsible for
installation, updates, availability, backups of the private configuration, and
secure network exposure. The proxy is designed to:

* keep the DeepL key in the proxy rather than the Foundry browser;
* authenticate Foundry requests with a dedicated proxy token;
* reduce duplicate DeepL requests through an in-memory cache; and
* support local use or a secured remote deployment.

---

### How it works

```
Foundry VTT → Self-hosted Proxy → DeepL API → Self-hosted Proxy → Foundry VTT
```

The proxy provides the bridge required by the browser. Caching may reduce
duplicate requests, but no particular performance, cost, availability, or
translation result is guaranteed.

---

## Download

Ready-to-run Windows and Linux executables are published as assets on the
[latest GitHub release](https://github.com/YanKlInnomme/dt-proxy-server/releases/latest).

The Git repository contains the source code only. Generated dependencies
(`node_modules/`) and build artifacts (`dist/`) are intentionally excluded and
must not be downloaded from the repository tree.

### Prefer a managed service?

Deep Translate 2.5.0 also offers a separate Yanklinnomme-hosted proxy through
eligible Buy Me a Coffee memberships. It is configured directly in the Foundry
module and is not installed from this repository. Current membership options,
prices, and terms are maintained on Buy Me a Coffee. Hosted access does not
include a DeepL plan, credits, or API usage.

---

## Installation

### Windows (Recommended)

1. Download the Windows `.exe` from the latest GitHub release
2. Double-click to launch
3. Choose `local` (recommended) or `remote` deployment
4. Choose a port (default: `3001`)
5. Enter the DeepL API key
6. In remote mode, enter the public HTTPS URL served by your TLS endpoint or
   trusted reverse proxy

The proxy then displays the complete `address#token` connection string to copy
into Deep Translate. Keep the generated configuration and secrets files private.

---

### Linux

Download the Linux executable from the latest GitHub release, then run:

```bash
chmod +x dt-proxy-server-linux
./dt-proxy-server-linux
```

On first launch, choose `local` (recommended) or `remote`, then enter the port
and the DeepL API key. Remote mode also asks for the public HTTPS proxy URL. The
proxy writes general options to
`deep-translate-proxy-config.json`, secrets to
`deep-translate-proxy-secrets.json`, and
prints an `address#token` connection string to copy into Foundry VTT.

The secrets file is created with owner-only permissions on platforms that
support POSIX permissions. Never publish or copy this file with a release.

Administrative commands:

```bash
node server.js --show-token
node server.js --regenerate-token
```

---

### Node.js

```bash
git clone https://github.com/YanKlInnomme/dt-proxy-server
cd dt-proxy-server
npm ci
npm start
```

`npm ci` recreates the ignored `node_modules/` directory from
`package-lock.json`. On first start, the same assistant used by the executables
asks for the deployment mode, port, and DeepL API key. Remote mode additionally
requires the public HTTPS proxy URL. Copy the generated `address#token` string
into the Deep Translate module settings.

---

### Docker

#### Quick start with Docker Compose

Start the proxy from this directory:

```bash
docker compose up -d
```

The container name, local-only port `3001`, persistent data volume, and restart
policy are configured automatically. On first launch, read the container logs:

```bash
docker compose logs
```

Open the one-time `/setup?token=...` URL printed there. The random setup token
is exchanged for a protected, short-lived cookie and immediately removed from
the browser URL. A plain `/setup` URL is deliberately rejected.

Choose local or remote deployment and enter the DeepL API key in the setup
page. Remote mode additionally requires the public HTTPS proxy URL. The proxy
validates the configuration and key, stores them in
the private Docker data volume, generates the proxy token, and displays the
complete `address#token` connection string to copy into Foundry VTT. No `.env`
file or manual Docker Desktop setting is required for local mode.

The connection string is also written to the container logs after setup:

```bash
docker compose logs
```

To stop the proxy:

```bash
docker compose down
```

#### Build the image manually

```bash
docker build -t deep-translate-proxy .
```

#### Run the container

```bash
docker run -p 127.0.0.1:3001:3001 -v dt-proxy-data:/data \
  -e ALLOWED_ORIGINS="http://localhost:30000,http://127.0.0.1:30000" \
  -e DT_PROXY_ALLOW_INSECURE_NETWORK="true" \
  deep-translate-proxy
```

Read the container logs and open the one-time setup URL printed there. For
unattended deployments, `DEEPL_API_KEY` and `DT_PROXY_TOKEN` can still be
provided as environment variables.

Available at:

```
http://localhost:3001
```

---

## Configuration (Foundry VTT)

In your **Deep Translate module settings**:

* Proxy connection:

```
http://localhost:3001#dt_proxy-token-displayed-at-startup
```

Foundry never receives or stores the DeepL API key.

Select **Self-hosted proxy** in Deep Translate. The module's **Hosted service**
choice refers to the separate managed Yanklinnomme service, not to this proxy's
`remote` network-deployment mode.

---

## Usage

1. Launch the proxy
2. Start Foundry VTT
3. Use **Deep Translate** normally

All translations automatically go through the proxy.

---

## Security Configuration

By default, the proxy listens only on `127.0.0.1`. Protected routes reject
requests without an `Origin` header and always require the proxy Bearer token.
Loopback browser origins are accepted for local use.

The first-time assistant offers two network deployment modes for this
self-hosted proxy:

* `local` keeps the current loopback connection and is recommended for normal
  use, including a remotely hosted Foundry server opened from the same computer;
* `remote` requires a non-loopback public HTTPS URL and either direct TLS or a
  trusted HTTPS reverse proxy. HTTP and loopback public URLs are rejected. The
  first request carrying a valid proxy token automatically records its exact
  Foundry origin; later requests remain restricted to recorded origins.

The guided remote mode assumes one trusted HTTPS reverse-proxy hop unless direct
TLS is already configured. The public HTTPS endpoint may be Internet-facing;
the proxy's plain internal port must not be. When the reverse proxy runs on the
same host, keep the Node listener on `127.0.0.1`. With Docker, publish port 3001
only on `127.0.0.1` when the reverse proxy is on the host, or expose it solely on
a private Docker network to a reverse-proxy container. Use `0.0.0.0` only when
the listener itself uses direct TLS or is protected on a trusted private network.

Listening outside loopback is fail-closed. `ALLOWED_ORIGINS` must contain the
exact Foundry origins and the listener must use one of these modes:

* direct TLS with a certificate and private key;
* an HTTPS reverse proxy explicitly marked as trusted;
* an explicitly authorized unencrypted trusted LAN connection.

Direct TLS example:

```bash
DT_PROXY_MODE=remote \
HOST=0.0.0.0 \
ALLOWED_ORIGINS=https://foundry.example.test \
DT_PROXY_TLS_ENABLED=true \
DT_PROXY_TLS_CERT=certificates/fullchain.pem \
DT_PROXY_TLS_KEY=certificates/private-key.pem \
DT_PROXY_PUBLIC_URL=https://translate.example.test \
node server.js
```

Trusted HTTPS reverse proxy example:

```bash
DT_PROXY_MODE=remote \
HOST=127.0.0.1 \
ALLOWED_ORIGINS=https://foundry.example.test \
DT_PROXY_BEHIND_TRUSTED_PROXY=true \
DT_PROXY_TRUST_PROXY_HOPS=1 \
DT_PROXY_PUBLIC_URL=https://translate.example.test \
node server.js
```

`DT_PROXY_TRUST_PROXY_HOPS` is deliberately explicit: use the exact number of
trusted reverse-proxy hops between the client and this process. Forwarded IP
headers are ignored when it is `0` (the default).

For a trusted LAN only, unencrypted access requires the explicit
`DT_PROXY_ALLOW_INSECURE_NETWORK=true` acknowledgement. Do not use that option
on an Internet-facing host. Requests without `Origin` remain disabled unless
`DT_PROXY_ALLOW_NO_ORIGIN=true` is deliberately configured for a trusted
non-browser client.

Docker and unattended deployments support `DEEPL_API_KEY`, `DT_PROXY_TOKEN`,
`DT_PROXY_MODE`,
`PORT`, `HOST`, `ALLOWED_ORIGINS`, `DT_PROXY_PUBLIC_URL`, `DT_PROXY_CONFIG`,
`DT_PROXY_SECRETS`, `DT_PROXY_TLS_ENABLED`, `DT_PROXY_TLS_CERT`,
`DT_PROXY_TLS_KEY`, `DT_PROXY_BEHIND_TRUSTED_PROXY`,
`DT_PROXY_TRUST_PROXY_HOPS`,
`DT_PROXY_ALLOW_INSECURE_NETWORK`, and `DT_PROXY_ALLOW_NO_ORIGIN`. The proxy
starts its local first-time setup assistant when no DeepL key is available and
still refuses to start when its network exposure is unsafe.

Docker listens on `0.0.0.0` only inside the container. Publish it on
`127.0.0.1` as shown above unless a properly secured LAN, TLS, or reverse-proxy
deployment is intended. Never publish the port directly on the Internet.

---

## API Endpoints

### `POST /translate`

Translate multiple texts.

#### Request

```http
Authorization: Bearer dt_proxy-token
Origin: http://localhost:30000
Content-Type: application/json
```

```json
{
  "texts": ["Hello world", "<p>Some HTML</p>"],
  "target_lang": "FR",
  "formality": "default"
}
```

#### Response

```json
{
  "translations": [
    { "text": "Bonjour le monde" },
    { "text": "<p>Du HTML</p>" }
  ]
}
```

---

### `GET /usage`

Send the proxy token in the `Authorization` header:

```bash
curl -H "Authorization: Bearer dt_proxy-token" \
  -H "Origin: http://localhost:30000" \
  http://localhost:3001/usage
```

Response:

```
{
  "character_count": 12345,
  "character_limit": 500000
}
```

### Multilingual glossaries (DeepL v3)

All protected routes expect the proxy token as `Authorization: Bearer <token>`.

Authentication errors use a consistent contract:

* `401 PROXY_TOKEN_INVALID`: the proxy token is missing or invalid;
* `401 DEEPL_AUTH_FAILED`: the token is valid, but the DeepL key stored by the proxy was rejected;
* `429 DEEPL_QUOTA_EXCEEDED`: the DeepL billing-period quota is exhausted;
* `429 DEEPL_RATE_LIMITED`: DeepL is temporarily rate limiting requests;
* `429 PROXY_RATE_LIMITED`: the local proxy request limit was reached.

Local rate limits use independent in-memory windows for translation, usage,
language discovery, glossary operations, and other protected routes. `/health`
is exempt. Defaults per 60 seconds are respectively 180, 240, 120, 120, and 60.
Configure them with `DT_PROXY_RATE_TRANSLATE`, `DT_PROXY_RATE_USAGE`,
`DT_PROXY_RATE_LANGUAGES`, `DT_PROXY_RATE_GLOSSARIES`,
`DT_PROXY_RATE_DEFAULT`, and `DT_PROXY_RATE_WINDOW_MS`. A value of `0` disables
the corresponding local limit. Expired client windows are cleaned periodically.

Every protected endpoint, including translation, usage, languages, and
glossaries, uses the same Bearer proxy token. The DeepL API key is never accepted
from a request body or from Foundry.

Glossary requests are limited to 20 dictionaries, 10,000 entries per dictionary,
1,024 characters per term, 1,000,000 term characters per dictionary, and 200
characters for the glossary name.

* `GET /glossaries` lists the glossaries belonging to that DeepL account.
* `POST /glossaries` creates a glossary.
* `PUT /glossaries/:id` renames a glossary and/or replaces its dictionaries.
* `DELETE /glossaries/:id` deletes a glossary.
* `GET /glossary-language-pairs` lists the supported language pairs.
* `GET /languages?type=source` and `GET /languages?type=target` list every translation language currently returned by DeepL for the authenticated account.

Creation and synchronization accept one or more dictionaries:

```json
{
  "name": "D&D 5e — EN to FR",
  "dictionaries": [
    {
      "source_lang": "EN",
      "target_lang": "FR",
      "entries": [
        { "source": "Saving Throw", "target": "Jet de sauvegarde" },
        { "source": "Armor Class", "target": "Classe d’armure" }
      ]
    }
  ]
}
```

The shorthand `source_lang`, `target_lang`, and `entries` fields may be placed
directly at the top level for a glossary containing a single dictionary.

To use a synchronized glossary, add `source_lang` and `glossary_id` to
`POST /translate`. `source_lang` is mandatory whenever `glossary_id` is set.

---

### `GET /health`

```json
{
  "status": "ok",
  "cache_size": 42,
  "tls": false,
  "deployment_mode": "local",
  "public_url": null,
  "loopback_only": true
}
```

`status` is `setup_required` until first-time configuration is complete.
`cache_size` reports entries in the current process's bounded in-memory cache;
the cache is cleared on restart and reset when it reaches 5,000 entries.

---

## Development

```bash
npm ci
npm start
```

The generated `node_modules/` directory is local to your checkout and is not
committed to Git.

Optional:

```bash
node server.js --port=4000
```

---

## Build (Executable)

Building the standalone executables requires Node.js 22 or later.

```bash
npm run build
```

The build recreates the local `dist/` directory. This directory is intentionally
ignored by Git: publish its files as GitHub release assets instead of committing
them to the repository.

Expected output for version 2.5.0:

```
/dist
  deep-translate-proxy-v2.5.0-windows-x64.exe
  deep-translate-proxy-v2.5.0-windows-x64.zip
  deep-translate-proxy-v2.5.0-linux-x64
  deep-translate-proxy-v2.5.0-linux-x64.zip
  SHA256SUMS-2.5.0.txt
```

The ZIP packages also contain the README, project license, and third-party
license notices. Publish the checksum file alongside the downloads.

---

## Changelog

### Version 2.5.0

* Added guided local and secured remote deployment modes
* Required a public HTTPS URL for guided remote deployments
* Added trusted reverse-proxy configuration and explicit hop handling
* Added automatic registration of the first authenticated Foundry origin
* Added tenant and DeepL-key isolation to the translation cache
* Added request, header, keep-alive, and per-socket limits
* Documented the separate Yanklinnomme hosted-proxy subscription

### Version 2.0.1

* Isolated standalone configuration and secrets with product-specific filenames
* Prevented collisions when multiple YanK standalone services share one folder

### Version 2.0.0

* Added a secure browser-based first-time setup assistant for Docker
* Moved the DeepL API key into a private proxy-only secrets file
* Added a dedicated authenticated proxy token for Foundry
* Added multilingual DeepL glossary routes and language discovery
* Changed the interactive proxy port prompt from French to English
* Translated the Dockerfile comments into English
* Rebuilt the Windows and Linux executables with the updated English prompt
* Restricted default network binding and browser origins
* Added request rate and translation concurrency limits
* Hardened input validation, error responses, and cache isolation
* Moved the `/usage` API key from the URL to the `Authorization` header

#### Migration from the proxy used with Deep Translate 1.0.1

The 2.0.0 proxy uses a new connection contract. Foundry must receive the full
`address#token` string rather than a DeepL key or a bare proxy URL. Existing
proxy configuration files should not be distributed or copied into a release.

For a clean migration, start the new proxy, configure the DeepL key in its
interactive or browser-based setup, then copy the generated connection string
into Deep Translate 2.0.0. The connection string is shown when setup completes
and can later be displayed explicitly with `--show-token`. Interactive Windows
and Linux executables also display it automatically, since a user launching the
program directly cannot conveniently add command-line arguments. Non-interactive
restarts no longer write the token to application or container logs.

---

## Author

**YanK**
https://yanklinnomme.fr
[contact@yanklinnomme.fr](mailto:contact@yanklinnomme.fr)
Discord: yanklinnomme

---

## License

MIT — see LICENSE file for details  
Includes third-party software under MIT, ISC, BSD, and other compatible
licenses; see `THIRD_PARTY_LICENSES.txt` for the complete notices.
