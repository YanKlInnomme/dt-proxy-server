/*
* Deep Translate Proxy
* Copyright (c) 2026 YanK
*
* This project is licensed under the MIT License.
* See the LICENSE file for more information.
*
* Third-party licenses:
* See THIRD_PARTY_LICENSES.txt
*/

const express = require("express");
const cors = require("cors");
const deepl = require("deepl-node");
const readline = require("readline");

/* ----------------------------------------- */
/* UI / LOG                                  */
/* ----------------------------------------- */

function banner() {
  console.log("====================================");
  console.log("   Deep Translate Proxy");
  console.log("====================================");
}

/* ----------------------------------------- */
/* ERROR HANDLING                            */
/* ----------------------------------------- */

function keepConsoleOpen() {
  if (process.pkg && process.stdin.isTTY) {
    console.log("\nPress ENTER to exit...");
    process.stdin.resume();
  }
}

process.on("uncaughtException", (err) => {
  console.error("\n❌ Uncaught Exception:");
  console.error(err);
  keepConsoleOpen();
});

process.on("unhandledRejection", (err) => {
  console.error("\n❌ Unhandled Rejection:");
  console.error(err);
  keepConsoleOpen();
});

/* ----------------------------------------- */
/* PORT RESOLUTION                           */
/* ----------------------------------------- */

function askPortInteractive() {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question("Port du proxy (default 3001): ", answer => {
      rl.close();
      const port = parseInt(answer) || 3001;
      resolve(port);
    });
  });
}

async function resolvePort() {
  if (process.env.PORT) return parseInt(process.env.PORT);

  const argPort = process.argv.find(a => a.startsWith("--port="));
  if (argPort) return parseInt(argPort.split("=")[1]);

  if (process.stdin.isTTY) return await askPortInteractive();

  return 3001;
}

/* ----------------------------------------- */
/* HELPERS                                   */
/* ----------------------------------------- */

function normalize(text) {
  return text.trim().replace(/\s+/g, " ");
}

function getCacheKey(text, target) {
  return `${target}::${normalize(text)}`;
}

/* ----------------------------------------- */
/* MAIN                                      */
/* ----------------------------------------- */

async function startServer() {
  banner();

  const PORT = await resolvePort();

  console.log(`🚀 Starting proxy on port ${PORT}...\n`);

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  /* CACHE */

  const cache = new Map();
  const MAX_CACHE_SIZE = 5000;

  function setCache(key, value) {
    if (cache.size > MAX_CACHE_SIZE) {
      cache.clear();
      console.log("⚠️ Cache cleared");
    }
    cache.set(key, value);
  }

  /* LIMITS */

  const MAX_TEXTS = 300;
  const MAX_TOTAL_CHARS = 120000;

  /* ROUTES */

  app.post("/translate", async (req, res) => {
    try {
      const { texts, target_lang, apiKey, formality } = req.body;

      if (!apiKey) return res.status(400).json({ error: "Missing API key" });
      if (!Array.isArray(texts) || texts.length === 0)
        return res.status(400).json({ error: "Invalid texts" });
      if (typeof target_lang !== "string")
        return res.status(400).json({ error: "Invalid target_lang" });

      if (texts.length > MAX_TEXTS)
        return res.status(400).json({ error: "Too many texts" });

      const totalChars = texts.reduce((s, t) => s + (t?.length || 0), 0);

      if (totalChars > MAX_TOTAL_CHARS)
        return res.status(400).json({ error: "Payload too large" });

      const translator = new deepl.Translator(apiKey);

      const results = new Array(texts.length);
      const toTranslate = [];
      const indexMap = [];

      texts.forEach((text, i) => {
        const key = getCacheKey(text, target_lang);

        if (cache.has(key)) {
          results[i] = cache.get(key);
        } else {
          indexMap.push(i);
          toTranslate.push(text);
        }
      });

      if (toTranslate.length > 0) {
        const response = await translator.translateText(
          toTranslate,
          null,
          target_lang,
          {
            tagHandling: "html",
            formality: formality || "default"
          }
        );

        response.forEach((r, i) => {
          const translated = r.text;
          const idx = indexMap[i];

          results[idx] = translated;

          const key = getCacheKey(texts[idx], target_lang);
          setCache(key, translated);
        });
      }

      res.json({
        translations: results.map(t => ({ text: t }))
      });

    } catch (err) {
      console.error("❌ Translate error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/usage", async (req, res) => {
    try {
      const apiKey = req.query.apiKey;

      if (!apiKey)
        return res.status(400).json({ error: "Missing API key" });

      const translator = new deepl.Translator(apiKey);
      const usage = await translator.getUsage();

      res.json({
        character_count: usage.character?.count || 0,
        character_limit: usage.character?.limit || 0
      });

    } catch (err) {
      console.error("❌ Usage error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      cache_size: cache.size
    });
  });

  app.listen(PORT, () => {
    console.log(`✅ Proxy running at http://localhost:${PORT}`);
    console.log("🟢 Ready\n");
  });
}

startServer();