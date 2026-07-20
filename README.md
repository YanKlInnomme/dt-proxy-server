[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-blue)
![Docker](https://img.shields.io/badge/docker-supported-blue)
![Foundry VTT](https://img.shields.io/badge/foundry-vtt-orange)

# Deep Translate Proxy

Local proxy server designed for the **Deep Translate** module for Foundry VTT.
It acts as a secure bridge between Foundry and the DeepL API, enabling efficient batch translation with session-based caching.

---

## Features

* **Batch translation** optimized for Foundry journals and rich content
* **Session-based cache** to avoid duplicate API costs
* **DeepL API key remains in the proxy and is never exposed to Foundry**
* **HTML-aware translation** (preserves formatting)
* Works locally, via Docker, or as a standalone executable
* Built specifically for **Foundry VTT workflows**

---

## Requirements

* A valid **DeepL API key**
* Foundry VTT with the **Deep Translate** module installed

---

## Why use a proxy?

DeepL’s API cannot be called directly from Foundry VTT (or any browser-based environment) due to **CORS restrictions**.
This results in errors such as:

```
Failed to fetch
```

### The usual workaround

Some solutions rely on a **remote proxy server** to bypass this limitation.
However, this introduces several drawbacks:

* Your **API key is sent to a third-party server**
* Your **translated content passes through an external service**
* You depend on infrastructure you do not control
* Potential performance bottlenecks

---

### Deep Translate approach

Deep Translate uses a **local proxy server running on your machine**.

This provides key advantages:

* **Full control over your API key**
* **No third-party relay between the proxy and DeepL**
* **Faster translations (no external relay)**
* **Built-in caching reduces API usage and cost**
* **Full control over your translation pipeline**

---

### How it works

```
Foundry VTT → Local Proxy → DeepL API → Local Proxy → Foundry VTT
```

The proxy acts as a **secure and efficient bridge**, solving CORS issues while improving performance and reducing costs.

---

## Download

👉 https://github.com/YanKlInnomme/dt-proxy-server/releases/latest

---

## Installation

### Windows (Recommended)

1. Download the `.exe` file
2. Double-click to launch
3. Choose a port (default: `3001`)

👉 The proxy is now running.

---

### Linux

```bash
chmod +x dt-proxy-server-linux
./dt-proxy-server-linux
```

On first launch, you will be prompted for the port and the DeepL API key. The
proxy writes general options to `config.json`, secrets to `secrets.json`, and
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
npm install
node server.js
```

You will be prompted to choose a port (default: `3001`).

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

Enter the DeepL API key in the setup page. The proxy validates it, stores it in
the private Docker data volume, generates the proxy token, and displays the
complete `address#token` connection string to copy into Foundry VTT. No `.env`
file or manual Docker Desktop setting is required.

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

Listening outside loopback is fail-closed. `ALLOWED_ORIGINS` must contain the
exact Foundry origins and the listener must use one of these modes:

* direct TLS with a certificate and private key;
* an HTTPS reverse proxy explicitly marked as trusted;
* an explicitly authorized unencrypted trusted LAN connection.

Direct TLS example:

```bash
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
HOST=0.0.0.0 \
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
  "cache_size": 42
}
```

---

## Development

```bash
npm install
node server.js
```

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

Output:

```
/dist
  deep-translate-proxy-v2.0.0-windows-x64.exe
  deep-translate-proxy-v2.0.0-windows-x64.zip
  deep-translate-proxy-v2.0.0-linux-x64
  deep-translate-proxy-v2.0.0-linux-x64.zip
  SHA256SUMS-2.0.0.txt
```

The ZIP packages also contain the README, project license, and third-party
license notices. Publish the checksum file alongside the downloads.

---

## Changelog

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
