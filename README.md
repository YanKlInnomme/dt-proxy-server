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
* **API key remains on the client side**
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
* **All data remains local**
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

You will be prompted to choose a port (default: `3001`).

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

#### Build the image

```bash
docker build -t dt-proxy-server .
```

#### Run the container

```bash
docker run -p 3001:3001 dt-proxy-server
```

Available at:

```
http://localhost:3001
```

---

## Configuration (Foundry VTT)

In your **Deep Translate module settings**:

* Proxy URL:

```
http://localhost:3001
```

* DeepL API Key:
  Enter your personal API key (**never stored by the proxy**)

---

## Usage

1. Launch the proxy
2. Start Foundry VTT
3. Use **Deep Translate** normally

All translations automatically go through the proxy.

---

## API Endpoints

### `POST /translate`

Translate multiple texts.

#### Request

```json
{
  "texts": ["Hello world", "<p>Some HTML</p>"],
  "target_lang": "FR",
  "apiKey": "your-deepl-api-key",
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

```
/usage?apiKey=your-key
```

```json
{
  "character_count": 12345,
  "character_limit": 500000
}
```

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

```bash
npm run build
```

Output:

```
/dist
  dt-proxy-server-win.exe
  dt-proxy-server-linux
```

---

## Author

**YanK**
https://yanklinnomme.fr
[contact@yanklinnomme.fr](mailto:contact@yanklinnomme.fr)
Discord: yanklinnomme

---

## License

MIT — see LICENSE file for details  
Includes third-party libraries under MIT licenses
