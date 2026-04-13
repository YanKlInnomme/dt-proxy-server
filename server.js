import express from "express";
import cors from "cors";
import readline from "readline";
import * as deepl from "deepl-node";

/* ----------------------------------------- */
/* INPUT PORT                                */
/* ----------------------------------------- */

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askPort() {
  return new Promise(resolve => {
    rl.question("Port du proxy (default 3001): ", answer => {
      const port = parseInt(answer) || 3001;
      resolve(port);
    });
  });
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
/* START SERVER                              */
/* ----------------------------------------- */

async function startServer() {
  const PORT = await askPort();
  rl.close();

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));

  /* ----------------------------------------- */
  /* CACHE (SESSION MEMORY)                    */
  /* ----------------------------------------- */

  const cache = new Map();
  const MAX_CACHE_SIZE = 5000;

  function setCache(key, value) {
    if (cache.size > MAX_CACHE_SIZE) {
      cache.clear();
      console.log("⚠️ Cache cleared (limit reached)");
    }
    cache.set(key, value);
  }

  /* ----------------------------------------- */
  /* LIMITS (DEEPL SAFE + FOUNDRY FRIENDLY)    */
  /* ----------------------------------------- */

  const MAX_TEXTS = 300;
  const MAX_TOTAL_CHARS = 120000;

  /* ----------------------------------------- */
  /* TRANSLATE                                 */
  /* ----------------------------------------- */

  app.post("/translate", async (req, res) => {
    try {
      const { texts, target_lang, apiKey, formality } = req.body;

      /* ---------- VALIDATION ---------- */

      if (!apiKey) {
        return res.status(400).json({ error: "Missing API key" });
      }

      if (!Array.isArray(texts) || texts.length === 0) {
        return res.status(400).json({ error: "Invalid texts array" });
      }

      if (typeof target_lang !== "string") {
        return res.status(400).json({ error: "Invalid target_lang" });
      }

      if (texts.length > MAX_TEXTS) {
        return res.status(400).json({
          error: `Too many texts (max ${MAX_TEXTS})`
        });
      }

      const totalChars = texts.reduce((sum, t) => sum + (t?.length || 0), 0);

      if (totalChars > MAX_TOTAL_CHARS) {
        return res.status(400).json({
          error: `Text too large (${totalChars} chars, max ${MAX_TOTAL_CHARS})`
        });
      }

      /* ---------- TRANSLATOR ---------- */

      const translator = new deepl.Translator(apiKey);

      const results = new Array(texts.length);
      const toTranslate = [];
      const indexMap = [];

      /* ---------- CACHE CHECK ---------- */

      texts.forEach((text, i) => {
        const key = getCacheKey(text, target_lang);

        if (cache.has(key)) {
          results[i] = cache.get(key);
        } else {
          indexMap.push(i);
          toTranslate.push(text);
        }
      });

      /* ---------- BATCH DEEPL ---------- */

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
          const originalIndex = indexMap[i];

          results[originalIndex] = translated;

          const key = getCacheKey(texts[originalIndex], target_lang);
          setCache(key, translated);
        });
      }

      /* ---------- RESPONSE ---------- */

      res.json({
        translations: results.map(t => ({ text: t }))
      });

    } catch (err) {
      console.error("❌ Translate error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /* ----------------------------------------- */
  /* USAGE                                     */
  /* ----------------------------------------- */

  app.get("/usage", async (req, res) => {
    try {
      const apiKey = req.query.apiKey;

      if (!apiKey) {
        return res.status(400).json({ error: "Missing API key" });
      }

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

  /* ----------------------------------------- */
  /* HEALTH                                    */
  /* ----------------------------------------- */

  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      cache_size: cache.size
    });
  });

  /* ----------------------------------------- */
  /* START                                     */
  /* ----------------------------------------- */

  app.listen(PORT, () => {
    console.log(`✅ Proxy running on http://localhost:${PORT}`);
  });
}

startServer();