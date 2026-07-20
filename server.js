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
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const https = require("https");
const {
  completeWebSetup,
  connectionString,
  loadRuntimeConfiguration,
  regenerateAccessToken
} = require("./runtime-config");
const {
  parseCookies,
  safeTokenEqual,
  setSetupHeaders,
  setupAccessGranted,
  setupPage
} = require("./setup-ui");

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

let activeServer = null;
let fatalShutdownStarted = false;

function fatalShutdown(kind, error) {
  if (fatalShutdownStarted) return;
  fatalShutdownStarted = true;
  console.error(`\n❌ ${kind}:`);
  console.error(error);
  process.exitCode = 1;

  const forceExit = setTimeout(() => process.exit(1), 5000);
  forceExit.unref?.();
  if (!activeServer?.listening) return process.exit(1);
  activeServer.close(() => {
    clearTimeout(forceExit);
    process.exit(1);
  });
}

process.on("uncaughtException", error => fatalShutdown("Uncaught Exception", error));
process.on("unhandledRejection", error => fatalShutdown("Unhandled Rejection", error));

/* ----------------------------------------- */
/* HELPERS                                   */
/* ----------------------------------------- */

function getCacheKey(text, target) {
  const exactTextHash = crypto.createHash("sha256").update(text, "utf8").digest("hex");
  return `${target}::${exactTextHash}`;
}

function getAccessToken(req) {
  const authorization = req.get("authorization");
  const match = String(authorization ?? "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function tokensEqual(supplied, expected) {
  const suppliedBuffer = Buffer.from(String(supplied ?? ""));
  const expectedBuffer = Buffer.from(String(expected ?? ""));
  return Boolean(
    expectedBuffer.length &&
    suppliedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

function getDeepLClient(req) {
  return new deepl.DeepLClient(req.deepLApiKey);
}

function serializeGlossary(glossary) {
  return {
    glossary_id: glossary.glossaryId,
    name: glossary.name,
    creation_time: glossary.creationTime,
    dictionaries: glossary.dictionaries.map(dictionary => ({
      source_lang: dictionary.sourceLangCode,
      target_lang: dictionary.targetLangCode,
      entry_count: dictionary.entryCount
    }))
  };
}

function serializeLanguage(language) {
  return {
    language: language.code,
    name: language.name,
    ...(language.supportsFormality !== undefined
      ? { supports_formality: language.supportsFormality }
      : {})
  };
}

function validateLanguageCode(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(value)) {
    throw new TypeError(`Invalid ${field}`);
  }
  return value.toUpperCase();
}

function normalizeFormality(value) {
  if (value === undefined || value === null || value === "") return "default";
  const allowed = new Set(["default", "more", "less", "prefer_more", "prefer_less"]);
  if (typeof value !== "string" || !allowed.has(value)) throw new TypeError("Invalid formality");
  return value;
}

const GLOSSARY_LIMITS = Object.freeze({
  maxDictionaries: 20,
  maxEntries: 10000,
  maxTermLength: 1024,
  maxTotalTermCharacters: 1000000,
  maxNameLength: 200
});

function parseEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError("Glossary entries must be a non-empty array");
  }
  if (entries.length > GLOSSARY_LIMITS.maxEntries) {
    throw new TypeError(`A glossary dictionary cannot contain more than ${GLOSSARY_LIMITS.maxEntries} entries`);
  }

  const parsed = {};
  const sources = new Set();
  let totalCharacters = 0;
  for (const entry of entries) {
    if (!entry || typeof entry.source !== "string" || typeof entry.target !== "string") {
      throw new TypeError("Every glossary entry must contain source and target strings");
    }

    const source = entry.source.trim();
    const target = entry.target.trim();
    if (!source || !target) throw new TypeError("Glossary terms must not be empty");
    if (source.length > GLOSSARY_LIMITS.maxTermLength || target.length > GLOSSARY_LIMITS.maxTermLength) {
      throw new TypeError(`Glossary terms must not exceed ${GLOSSARY_LIMITS.maxTermLength} characters`);
    }
    totalCharacters += source.length + target.length;
    if (totalCharacters > GLOSSARY_LIMITS.maxTotalTermCharacters) {
      throw new TypeError(`Glossary terms must not exceed ${GLOSSARY_LIMITS.maxTotalTermCharacters} characters in total`);
    }
    const duplicateKey = source.toLocaleLowerCase();
    if (sources.has(duplicateKey)) {
      throw new TypeError(`Duplicate glossary source term: ${source}`);
    }
    sources.add(duplicateKey);
    parsed[source] = target;
  }

  const glossaryEntries = new deepl.GlossaryEntries({ entries: parsed });
  glossaryEntries.toTsv();
  return glossaryEntries;
}

function parseDictionary(dictionary) {
  if (!dictionary || typeof dictionary !== "object") {
    throw new TypeError("Invalid glossary dictionary");
  }

  return {
    sourceLangCode: validateLanguageCode(dictionary.source_lang, "source_lang"),
    targetLangCode: validateLanguageCode(dictionary.target_lang, "target_lang"),
    entries: parseEntries(dictionary.entries)
  };
}

function parseDictionaries(body) {
  const dictionaries = body.dictionaries || (
    body.source_lang || body.target_lang || body.entries
      ? [{ source_lang: body.source_lang, target_lang: body.target_lang, entries: body.entries }]
      : null
  );

  if (!Array.isArray(dictionaries) || dictionaries.length === 0) {
    throw new TypeError("At least one glossary dictionary is required");
  }
  if (dictionaries.length > GLOSSARY_LIMITS.maxDictionaries) {
    throw new TypeError(`A glossary cannot contain more than ${GLOSSARY_LIMITS.maxDictionaries} dictionaries`);
  }
  return dictionaries.map(parseDictionary);
}

function deepLServiceError(res, err, service = "DeepL") {
  console.error(`❌ ${service} error:`, err.message);
  if (err instanceof TypeError || err instanceof deepl.ArgumentError) {
    return res.status(400).json({ error: err.message, code: "INVALID_REQUEST" });
  }
  if (err instanceof deepl.GlossaryNotFoundError) {
    return res.status(404).json({ error: "Glossary not found", code: "GLOSSARY_NOT_FOUND" });
  }
  if (err instanceof deepl.AuthorizationError) {
    return res.status(401).json({
      error: "The DeepL API key configured in the proxy was rejected",
      code: "DEEPL_AUTH_FAILED"
    });
  }
  if (err instanceof deepl.QuotaExceededError) {
    return res.status(429).json({ error: "DeepL quota exceeded", code: "DEEPL_QUOTA_EXCEEDED" });
  }
  if (err instanceof deepl.TooManyRequestsError) {
    return res.status(429).json({ error: "DeepL is receiving too many requests", code: "DEEPL_RATE_LIMITED" });
  }
  return res.status(502).json({ error: `${service} service request failed`, code: "DEEPL_SERVICE_ERROR" });
}

function getAllowedOrigins(configured) {
  return configured?.length ? new Set(configured) : null;
}

function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return true;
  if (allowedOrigins) return allowedOrigins.has(origin);

  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function rateLimitBucket(req) {
  if (req.path === "/health") return null;
  if (req.path === "/translate") return "translate";
  if (req.path === "/usage") return "usage";
  if (req.path === "/languages" || req.path === "/glossary-language-pairs") return "languages";
  if (req.path === "/glossaries" || req.path.startsWith("/glossaries/")) return "glossaries";
  return "default";
}

function shouldShowConnectionAtStartup({ packaged = Boolean(process.pkg), interactive = Boolean(process.stdout.isTTY) } = {}) {
  return packaged && interactive;
}

function createRateLimiter(rateLimits, requestWindows = new Map()) {
  const cleanup = now => {
    for (const [key, window] of requestWindows) {
      if (now - window.startedAt >= rateLimits.windowMs) requestWindows.delete(key);
    }
  };
  const cleanupTimer = setInterval(() => cleanup(Date.now()), rateLimits.windowMs);
  cleanupTimer.unref?.();

  return (req, res, next) => {
    const bucket = rateLimitBucket(req);
    if (!bucket) return next();
    const maximum = rateLimits[bucket] ?? rateLimits.default;
    if (maximum === 0) return next();

    const now = Date.now();
    const key = `${bucket}:${req.ip}`;
    let window = requestWindows.get(key);
    if (!window || now - window.startedAt >= rateLimits.windowMs) {
      window = { startedAt: now, count: 0 };
      requestWindows.set(key, window);
    }
    window.count += 1;
    if (window.count > maximum) {
      const retryAfterSeconds = Math.max(1, Math.ceil((rateLimits.windowMs - (now - window.startedAt)) / 1000));
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        error: `Too many proxy requests for ${bucket}`,
        code: "PROXY_RATE_LIMITED",
        route: bucket,
        retry_after: retryAfterSeconds
      });
    }
    return next();
  };
}

/* ----------------------------------------- */
/* MAIN                                      */
/* ----------------------------------------- */

async function startServer() {
  banner();
  const runtime = await loadRuntimeConfiguration();
  if (process.argv.includes("--regenerate-token")) {
    await regenerateAccessToken(runtime);
  }
  if (process.argv.includes("--show-token") || process.argv.includes("--regenerate-token")) {
    if (runtime.setupRequired) {
      throw new Error("The proxy is not configured yet. Start it and open /setup first.");
    }
    console.log("Connection string to copy into Foundry VTT:");
    console.log(connectionString(runtime));
    if (process.argv.includes("--show-token") && !process.argv.includes("--start")) return;
    if (process.argv.includes("--regenerate-token") && !process.argv.includes("--start")) return;
  }

  const PORT = runtime.config.port;
  const HOST = runtime.config.host;

  console.log(`🚀 Starting proxy at http://${HOST}:${PORT}...\n`);

  const app = express();
  app.disable("x-powered-by");
  if (runtime.config.trustProxyHops > 0) app.set("trust proxy", runtime.config.trustProxyHops);

  const setupCsrfToken = crypto.randomBytes(32).toString("base64url");
  const setupAccessToken = crypto.randomBytes(32).toString("base64url");
  let setupInProgress = false;
  const setupRateLimiter = createRateLimiter({ ...runtime.config.rateLimits, default: 10 });
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));

  app.get("/", (req, res, next) => {
    if (!runtime.setupRequired) return next();
    return res.redirect(302, "/setup");
  });

  app.get("/setup", (req, res) => {
    setSetupHeaders(res);
    if (!runtime.setupRequired) return res.status(404).send("Setup is no longer available.");
    const setupUsesHttps = runtime.config.tls.enabled || (
      runtime.config.behindTrustedProxy && /^https:\/\//i.test(runtime.config.publicUrl)
    );
    const secureCookie = setupUsesHttps ? "; Secure" : "";
    const hasAccessCookie = safeTokenEqual(parseCookies(req.get("cookie")).dt_setup_access, setupAccessToken);
    if (!setupAccessGranted(req.get("cookie"), req.query.token, setupAccessToken)) {
      return res.status(403).send("A valid one-time setup URL is required. Check the proxy console.");
    }
    if (!hasAccessCookie) {
      res.set("Set-Cookie", `dt_setup_access=${setupAccessToken}; Path=/setup; HttpOnly; SameSite=Strict; Max-Age=900${secureCookie}`);
      return res.redirect(303, "/setup");
    }
    res.set("Set-Cookie", `dt_setup_csrf=${setupCsrfToken}; Path=/setup; HttpOnly; SameSite=Strict; Max-Age=900${secureCookie}`);
    return res.type("html").send(setupPage({ csrfToken: setupCsrfToken }));
  });

  app.post("/setup", setupRateLimiter, async (req, res) => {
    setSetupHeaders(res);
    if (!runtime.setupRequired) return res.status(404).send("Setup is no longer available.");
    const cookies = parseCookies(req.get("cookie"));
    if (!safeTokenEqual(cookies.dt_setup_access, setupAccessToken)) {
      return res.status(403).send("The setup access token is invalid. Use the URL shown in the proxy console.");
    }
    const cookieToken = cookies.dt_setup_csrf;
    if (!safeTokenEqual(cookieToken, setupCsrfToken) || !safeTokenEqual(req.body.csrfToken, setupCsrfToken)) {
      return res.status(403).send("The setup session is invalid. Reload the page and try again.");
    }
    if (setupInProgress) {
      return res.status(409).type("html").send(setupPage({
        csrfToken: setupCsrfToken,
        error: "Setup is already in progress. Please try again in a few seconds."
      }));
    }

    setupInProgress = true;
    try {
      const apiKey = String(req.body.deeplApiKey ?? "").trim();
      if (!apiKey || apiKey.length > 500) {
        return res.status(400).type("html").send(setupPage({
          csrfToken: setupCsrfToken,
          error: "Enter a valid DeepL API key."
        }));
      }
      try {
        await new deepl.Translator(apiKey).getUsage();
      } catch (error) {
        const message = error instanceof deepl.AuthorizationError
          ? "This DeepL API key was rejected."
          : "The key could not be verified with DeepL. Check your connection and try again.";
        return res.status(error instanceof deepl.AuthorizationError ? 401 : 502)
          .type("html")
          .send(setupPage({ csrfToken: setupCsrfToken, error: message }));
      }

      await completeWebSetup(runtime, apiKey);
      const connection = connectionString(runtime);
      console.log("✅ Docker setup completed");
      console.log("Connection string to copy into Foundry VTT:");
      console.log(connection);
      res.set("Set-Cookie", [
        "dt_setup_access=; Path=/setup; HttpOnly; SameSite=Strict; Max-Age=0",
        "dt_setup_csrf=; Path=/setup; HttpOnly; SameSite=Strict; Max-Age=0"
      ]);
      return res.type("html").send(setupPage({ csrfToken: "", connection }));
    } finally {
      setupInProgress = false;
    }
  });

  app.use((req, res, next) => {
    if (!runtime.setupRequired || req.path === "/health") return next();
    return res.status(503).json({
      error: "Use the one-time setup URL shown in the proxy console",
      code: "SETUP_REQUIRED"
    });
  });

  const allowedOrigins = getAllowedOrigins(runtime.config.allowedOrigins);
  app.use((req, res, next) => {
    if (req.path === "/health" || req.get("origin") || runtime.config.allowNoOrigin) return next();
    return res.status(403).json({
      error: "An Origin header is required for protected routes",
      code: "ORIGIN_REQUIRED"
    });
  });
  app.use(cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin, allowedOrigins)) {
        return callback(null, true);
      }
      return callback(new Error("Origin not allowed"));
    }
  }));

  app.use((req, res, next) => {
    if (req.path === "/health") return next();
    if (!tokensEqual(getAccessToken(req), runtime.secrets.accessToken)) {
      res.set("WWW-Authenticate", 'Bearer realm="Deep Translate Proxy"');
      return res.status(401).json({ error: "Invalid or missing proxy token", code: "PROXY_TOKEN_INVALID" });
    }
    req.deepLApiKey = runtime.secrets.deeplApiKey;
    return next();
  });

  app.use(createRateLimiter(runtime.config.rateLimits));

  app.use(express.json({ limit: "10mb" }));

  /* CACHE */

  const cache = new Map();
  const MAX_CACHE_SIZE = 5000;

  function setCache(key, value) {
    if (cache.size >= MAX_CACHE_SIZE) {
      cache.clear();
      console.log("⚠️ Cache cleared");
    }
    cache.set(key, value);
  }

  /* LIMITS */

  const MAX_TEXTS = 300;
  const MAX_TOTAL_CHARS = 120000;
  const MAX_CONCURRENT_TRANSLATIONS = 5;
  let activeTranslations = 0;

  /* ROUTES */

  app.post("/translate", async (req, res) => {
    try {
      const { texts, source_lang, target_lang, glossary_id, formality } = req.body;
      if (!Array.isArray(texts) || texts.length === 0)
        return res.status(400).json({ error: "Invalid texts" });
      if (!texts.every(text => typeof text === "string"))
        return res.status(400).json({ error: "Every text must be a string" });
      if (typeof target_lang !== "string")
        return res.status(400).json({ error: "Invalid target_lang" });
      if (source_lang !== undefined && typeof source_lang !== "string")
        return res.status(400).json({ error: "Invalid source_lang" });
      if (glossary_id !== undefined && (typeof glossary_id !== "string" || !glossary_id.trim()))
        return res.status(400).json({ error: "Invalid glossary_id" });
      if (glossary_id && !source_lang)
        return res.status(400).json({ error: "source_lang is required with glossary_id" });
      const requestedFormality = normalizeFormality(formality);

      if (texts.length > MAX_TEXTS)
        return res.status(400).json({ error: "Too many texts" });

      const totalChars = texts.reduce((s, t) => s + (t?.length || 0), 0);

      if (totalChars > MAX_TOTAL_CHARS)
        return res.status(400).json({ error: "Payload too large" });

      const translator = new deepl.Translator(req.deepLApiKey);
      const clientId = runtime.secrets.accountId;
      const results = new Array(texts.length);
      const toTranslate = [];
      const indexMap = [];

      texts.forEach((text, i) => {
        const key = `${clientId}::${source_lang || "auto"}::${glossary_id || "none"}::${requestedFormality}::${getCacheKey(text, target_lang)}`;

        if (cache.has(key)) {
          results[i] = cache.get(key);
        } else {
          indexMap.push(i);
          toTranslate.push(text);
        }
      });

      if (toTranslate.length > 0) {
        if (activeTranslations >= MAX_CONCURRENT_TRANSLATIONS)
          return res.status(503).json({ error: "Translation service is busy" });

        activeTranslations += 1;
        let response;
        try {
          response = await translator.translateText(
            toTranslate,
            source_lang || null,
            target_lang,
            {
              tagHandling: "html",
              formality: requestedFormality,
              ...(glossary_id ? { glossary: glossary_id } : {})
            }
          );
        } finally {
          activeTranslations -= 1;
        }

        response.forEach((r, i) => {
          const translated = r.text;
          const idx = indexMap[i];

          results[idx] = translated;

          const key = `${clientId}::${source_lang || "auto"}::${glossary_id || "none"}::${requestedFormality}::${getCacheKey(texts[idx], target_lang)}`;
          setCache(key, translated);
        });
      }

      res.json({
        translations: results.map(t => ({ text: t }))
      });

    } catch (err) {
      return deepLServiceError(res, err, "Translation");
    }
  });

  app.get("/usage", async (req, res) => {
    try {
      const translator = new deepl.Translator(req.deepLApiKey);
      const usage = await translator.getUsage();

      res.json({
        character_count: usage.character?.count || 0,
        character_limit: usage.character?.limit || 0,
        account_type: runtime.secrets.deeplApiKey.endsWith(":fx") ? "free" : "pro"
      });

    } catch (err) {
      return deepLServiceError(res, err, "Usage");
    }
  });

  app.get("/health", (req, res) => {
    res.json({
      status: runtime.setupRequired ? "setup_required" : "ok",
      cache_size: cache.size,
      tls: runtime.config.tls.enabled,
      loopback_only: ["127.0.0.1", "localhost", "::1"].includes(HOST.toLowerCase())
    });
  });

  app.get("/identity", (req, res) => {
    res.json({
      account_id: runtime.secrets.accountId,
      account_type: runtime.secrets.deeplApiKey.endsWith(":fx") ? "free" : "pro"
    });
  });

  app.get("/glossaries", async (req, res) => {
    try {
      const client = getDeepLClient(req);

      const glossaries = await client.listMultilingualGlossaries();
      return res.json({ glossaries: glossaries.map(serializeGlossary) });
    } catch (err) {
      return deepLServiceError(res, err, "Glossary");
    }
  });

  app.post("/glossaries", async (req, res) => {
    try {
      const client = getDeepLClient(req);
      if (typeof req.body.name !== "string" || !req.body.name.trim()) {
        return res.status(400).json({ error: "Glossary name is required" });
      }
      if (req.body.name.trim().length > GLOSSARY_LIMITS.maxNameLength) {
        return res.status(400).json({ error: `Glossary name must not exceed ${GLOSSARY_LIMITS.maxNameLength} characters` });
      }

      const glossary = await client.createMultilingualGlossary(
        req.body.name.trim(),
        parseDictionaries(req.body)
      );
      return res.status(201).json(serializeGlossary(glossary));
    } catch (err) {
      return deepLServiceError(res, err, "Glossary");
    }
  });

  app.put("/glossaries/:id", async (req, res) => {
    try {
      const client = getDeepLClient(req);
      if (!req.params.id) return res.status(400).json({ error: "Missing glossary ID" });

      let changed = false;
      if (req.body.name !== undefined) {
        if (typeof req.body.name !== "string" || !req.body.name.trim()) {
          return res.status(400).json({ error: "Invalid glossary name" });
        }
        if (req.body.name.trim().length > GLOSSARY_LIMITS.maxNameLength) {
          return res.status(400).json({ error: `Glossary name must not exceed ${GLOSSARY_LIMITS.maxNameLength} characters` });
        }
        await client.updateMultilingualGlossaryName(req.params.id, req.body.name.trim());
        changed = true;
      }

      if (req.body.dictionaries || req.body.source_lang || req.body.target_lang || req.body.entries) {
        const dictionaries = parseDictionaries(req.body);
        for (const dictionary of dictionaries) {
          await client.replaceMultilingualGlossaryDictionary(req.params.id, dictionary);
        }
        changed = true;
      }

      if (!changed) return res.status(400).json({ error: "No glossary changes supplied" });
      const glossary = await client.getMultilingualGlossary(req.params.id);
      return res.json(serializeGlossary(glossary));
    } catch (err) {
      return deepLServiceError(res, err, "Glossary");
    }
  });

  app.delete("/glossaries/:id", async (req, res) => {
    try {
      const client = getDeepLClient(req);
      await client.deleteMultilingualGlossary(req.params.id);
      return res.status(204).send();
    } catch (err) {
      return deepLServiceError(res, err, "Glossary");
    }
  });

  app.get("/glossary-language-pairs", async (req, res) => {
    try {
      const pairs = await new deepl.Translator(req.deepLApiKey).getGlossaryLanguagePairs();
      return res.json({
        language_pairs: pairs.map(pair => ({
          source_lang: pair.sourceLang,
          target_lang: pair.targetLang
        }))
      });
    } catch (err) {
      return deepLServiceError(res, err, "Glossary languages");
    }
  });

  app.get("/languages", async (req, res) => {
    try {
      const client = getDeepLClient(req);
      if (req.query.type !== "source" && req.query.type !== "target") {
        return res.status(400).json({ error: "type must be source or target" });
      }

      const languages = req.query.type === "source"
        ? await client.getSourceLanguages()
        : await client.getTargetLanguages();
      return res.json({ languages: languages.map(serializeLanguage) });
    } catch (err) {
      return deepLServiceError(res, err, "Languages");
    }
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.message === "Origin not allowed") {
      return res.status(403).json({ error: "Origin not allowed" });
    }
    console.error("❌ Request error:", err.message);
    return res.status(400).json({ error: "Invalid request" });
  });

  let server = app;
  if (runtime.config.tls.enabled) {
    const configDirectory = path.dirname(runtime.configPath);
    const certificatePath = path.resolve(configDirectory, runtime.config.tls.certificateFile);
    const privateKeyPath = path.resolve(configDirectory, runtime.config.tls.privateKeyFile);
    server = https.createServer({
      cert: fs.readFileSync(certificatePath),
      key: fs.readFileSync(privateKeyPath)
    }, app);
  }
  const protocol = runtime.config.tls.enabled ? "https" : "http";
  activeServer = server.listen(PORT, HOST, () => {
    console.log(`✅ Proxy running at ${protocol}://${HOST}:${PORT}`);
    if (runtime.config.allowInsecureNetwork && !runtime.config.tls.enabled) {
      console.warn("⚠️ Unencrypted non-loopback access was explicitly enabled. Use only on a trusted LAN.");
    }
    if (runtime.setupRequired) {
      console.log("🔧 First-time setup required");
      console.log("Open this one-time setup URL in your browser:");
      console.log(`${protocol}://localhost:${PORT}/setup?token=${encodeURIComponent(setupAccessToken)}\n`);
    } else {
      console.log("🟢 Ready\n");
      if (shouldShowConnectionAtStartup()) {
        console.log("Connection string to copy into Foundry VTT:");
        console.log(`${connectionString(runtime)}\n`);
      } else {
        console.log("Use --show-token to display the Foundry connection string.\n");
      }
    }
  });
}

if (require.main === module) {
  startServer().catch(error => {
    console.error(`\n❌ ${error.message}`);
    keepConsoleOpen();
    process.exitCode = 1;
  });
}

module.exports = {
  parseDictionary,
  parseDictionaries,
  normalizeFormality,
  serializeGlossary,
  serializeLanguage,
  validateLanguageCode,
  getCacheKey,
  GLOSSARY_LIMITS,
  deepLServiceError,
  createRateLimiter,
  getAccessToken,
  rateLimitBucket,
  shouldShowConnectionAtStartup,
  tokensEqual
};
