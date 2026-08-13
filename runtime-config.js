const { promises: fs } = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline/promises");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const originWriteQueues = new WeakMap();

const DEFAULT_CONFIG = {
  deploymentMode: "local",
  host: "127.0.0.1",
  port: 3001,
  publicUrl: "",
  allowedOrigins: [],
  allowNoOrigin: false,
  allowInsecureNetwork: false,
  behindTrustedProxy: false,
  trustProxyHops: 0,
  rateLimits: {
    windowMs: 60000,
    default: 60,
    translate: 180,
    usage: 240,
    languages: 120,
    glossaries: 120
  },
  tls: { enabled: false, certificateFile: "", privateKeyFile: "" },
  secretsFile: "deep-translate-proxy-secrets.json"
};

function environmentBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function isLoopbackHost(host) {
  return ["127.0.0.1", "localhost", "::1"].includes(String(host).trim().toLowerCase());
}

function normalizeDeploymentMode(value) {
  const mode = String(value ?? "local").trim().toLowerCase();
  if (mode !== "local" && mode !== "remote") {
    throw new Error('Deployment mode must be either "local" or "remote"');
  }
  return mode;
}

function validatePublicProxyUrl(value, deploymentMode = "remote") {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw new Error("The proxy public URL is invalid");
  }
  if (!url.hostname || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("The proxy public URL is invalid");
  }
  if (deploymentMode === "remote" && url.protocol !== "https:") {
    throw new Error("Remote mode requires a public HTTPS URL");
  }
  if (deploymentMode === "remote" && isLoopbackHost(url.hostname)) {
    throw new Error("Remote mode does not allow localhost or loopback public URLs");
  }
  return url.toString().replace(/\/+$/, "");
}

function validateFoundryOrigin(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    throw new Error("The Foundry origin is invalid");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("The Foundry origin must contain only its scheme, host, and optional port");
  }
  return url.origin;
}

function validateDeploymentSecurity(config) {
  config.deploymentMode = normalizeDeploymentMode(config.deploymentMode);
  if (config.deploymentMode === "local") return;
  config.publicUrl = validatePublicProxyUrl(config.publicUrl, "remote");
  config.allowedOrigins = config.allowedOrigins.map(validateFoundryOrigin);
  if (!config.tls.enabled && !config.behindTrustedProxy) {
    throw new Error("Remote mode requires direct TLS or a trusted HTTPS reverse proxy");
  }
}

function validateNetworkSecurity(config) {
  if (isLoopbackHost(config.host)) return;
  if (!config.allowedOrigins.length && config.deploymentMode !== "remote") {
    throw new Error("ALLOWED_ORIGINS must contain the exact Foundry origin when listening outside loopback");
  }
  if (config.tls.enabled) return;
  if (config.behindTrustedProxy && /^https:\/\//i.test(config.publicUrl)) return;
  if (!config.allowInsecureNetwork) {
    throw new Error(
      "Refusing an unencrypted non-loopback listener. Configure TLS, a trusted HTTPS reverse proxy, or explicitly set DT_PROXY_ALLOW_INSECURE_NETWORK=true for a trusted LAN"
    );
  }
}

function validatePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be an integer between 1 and 65535");
  }
  return port;
}

function validateNonNegativeInteger(value, field, { minimum = 0 } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    throw new Error(`${field} must be an integer greater than or equal to ${minimum}`);
  }
  return number;
}

function generateAccessToken() {
  return `dt_${crypto.randomBytes(32).toString("base64url")}`;
}

function generateAccountId() {
  return `account_${crypto.randomBytes(16).toString("hex")}`;
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw new Error(`Unable to read ${filePath}: ${error.message}`);
  }
}

async function writePrivateJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
  await secureFilePermissions(filePath);
}

async function secureFilePermissions(filePath) {
  if (process.platform === "win32") {
    const result = await execFileAsync("whoami.exe", [], { windowsHide: true });
    const output = typeof result === "string" ? result : (result?.stdout ?? result?.[0] ?? "");
    const username = String(output).trim() || (
      process.env.USERDOMAIN && process.env.USERNAME
        ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
        : process.env.USERNAME
    );
    if (!username) throw new Error("Unable to determine the Windows user for secret-file permissions");
    await execFileAsync("icacls.exe", [filePath, "/inheritance:r", "/grant:r", `${username}:(F)`], {
      windowsHide: true
    });
    return;
  }
  await fs.chmod(filePath, 0o600);
}

function normalizeOrigins(value) {
  const origins = Array.isArray(value) ? value : String(value ?? "").split(",");
  return origins.map(origin => String(origin).trim()).filter(Boolean);
}

function resolvePaths() {
  const applicationDirectory = process.pkg ? path.dirname(process.execPath) : __dirname;
  const configPath = path.resolve(
    process.env.DT_PROXY_CONFIG || path.join(applicationDirectory, "deep-translate-proxy-config.json")
  );
  const defaultSecretsPath = path.resolve(path.dirname(configPath), DEFAULT_CONFIG.secretsFile);
  return { applicationDirectory, configPath, defaultSecretsPath };
}

async function promptForSetup(config, secrets, { needsConfig, needsApiKey }) {
  if (!process.stdin.isTTY) return { config, secrets, changed: false };
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  let changed = false;
  try {
    if (needsConfig) {
      while (true) {
        const answer = (await terminal.question(
          `Deployment mode (type "local" or "remote") [${config.deploymentMode}]: `
        )).trim();
        try {
          config.deploymentMode = normalizeDeploymentMode(answer || config.deploymentMode);
          changed = true;
          break;
        } catch (error) {
          console.error(error.message);
        }
      }
      while (true) {
        const answer = (await terminal.question(`Proxy port [${config.port}]: `)).trim();
        try {
          config.port = validatePort(answer || config.port);
          changed = true;
          break;
        } catch (error) {
          console.error(error.message);
        }
      }
      if (config.deploymentMode === "remote") {
        while (true) {
          const answer = (await terminal.question("Public HTTPS proxy URL: ")).trim();
          try {
            config.publicUrl = validatePublicProxyUrl(answer, "remote");
            break;
          } catch (error) {
            console.error(error.message);
          }
        }
        config.behindTrustedProxy = !config.tls.enabled;
        config.trustProxyHops = config.behindTrustedProxy ? 1 : 0;
      }
    }
    if (needsApiKey) {
      while (!secrets.deeplApiKey) {
        secrets.deeplApiKey = (await terminal.question("DeepL API key: ")).trim();
        if (!secrets.deeplApiKey) console.error("The DeepL API key is required.");
      }
      changed = true;
    }
  } finally {
    terminal.close();
  }
  return { config, secrets, changed };
}

async function loadRuntimeConfiguration() {
  const { configPath } = resolvePaths();
  const storedConfig = await readJson(configPath);
  const config = {
    ...DEFAULT_CONFIG,
    ...(storedConfig ?? {}),
    tls: { ...DEFAULT_CONFIG.tls, ...(storedConfig?.tls ?? {}) },
    rateLimits: { ...DEFAULT_CONFIG.rateLimits, ...(storedConfig?.rateLimits ?? {}) }
  };
  const inferredStoredMode = storedConfig?.deploymentMode ?? (
    storedConfig?.publicUrl && !isLoopbackHost((() => {
      try { return new URL(storedConfig.publicUrl).hostname; } catch { return ""; }
    })()) ? "remote" : DEFAULT_CONFIG.deploymentMode
  );
  config.deploymentMode = normalizeDeploymentMode(
    process.env.DT_PROXY_MODE ?? inferredStoredMode
  );
  const portArgument = process.argv.find(argument => argument.startsWith("--port="))?.slice(7);
  config.port = validatePort(process.env.PORT ?? portArgument ?? config.port);
  config.host = String(process.env.HOST ?? config.host).trim() || DEFAULT_CONFIG.host;
  config.publicUrl = String(process.env.DT_PROXY_PUBLIC_URL ?? config.publicUrl ?? "").replace(/\/+$/, "");
  config.allowedOrigins = normalizeOrigins(process.env.ALLOWED_ORIGINS ?? config.allowedOrigins);
  config.allowNoOrigin = environmentBoolean(process.env.DT_PROXY_ALLOW_NO_ORIGIN, config.allowNoOrigin);
  config.allowInsecureNetwork = environmentBoolean(
    process.env.DT_PROXY_ALLOW_INSECURE_NETWORK,
    config.allowInsecureNetwork
  );
  config.behindTrustedProxy = environmentBoolean(
    process.env.DT_PROXY_BEHIND_TRUSTED_PROXY,
    config.behindTrustedProxy
  );
  config.trustProxyHops = validateNonNegativeInteger(
    process.env.DT_PROXY_TRUST_PROXY_HOPS ?? config.trustProxyHops,
    "DT_PROXY_TRUST_PROXY_HOPS"
  );
  if (!config.behindTrustedProxy && config.trustProxyHops > 0) {
    throw new Error("DT_PROXY_TRUST_PROXY_HOPS requires DT_PROXY_BEHIND_TRUSTED_PROXY=true");
  }
  if (config.behindTrustedProxy && config.trustProxyHops < 1) {
    throw new Error("DT_PROXY_TRUST_PROXY_HOPS must be at least 1 behind a trusted reverse proxy");
  }
  config.rateLimits.windowMs = validateNonNegativeInteger(
    process.env.DT_PROXY_RATE_WINDOW_MS ?? config.rateLimits.windowMs,
    "DT_PROXY_RATE_WINDOW_MS",
    { minimum: 1000 }
  );
  for (const name of ["default", "translate", "usage", "languages", "glossaries"]) {
    const environmentName = `DT_PROXY_RATE_${name.toUpperCase()}`;
    config.rateLimits[name] = validateNonNegativeInteger(
      process.env[environmentName] ?? config.rateLimits[name],
      environmentName
    );
  }
  config.tls.enabled = environmentBoolean(process.env.DT_PROXY_TLS_ENABLED, config.tls.enabled);
  config.tls.certificateFile = String(process.env.DT_PROXY_TLS_CERT ?? config.tls.certificateFile ?? "").trim();
  config.tls.privateKeyFile = String(process.env.DT_PROXY_TLS_KEY ?? config.tls.privateKeyFile ?? "").trim();
  if (config.tls.enabled && (!config.tls.certificateFile || !config.tls.privateKeyFile)) {
    throw new Error("TLS is enabled but DT_PROXY_TLS_CERT or DT_PROXY_TLS_KEY is missing");
  }
  validateDeploymentSecurity(config);
  validateNetworkSecurity(config);

  const secretsPath = path.resolve(path.dirname(configPath), process.env.DT_PROXY_SECRETS || config.secretsFile);
  const storedSecrets = await readJson(secretsPath, {});
  const secrets = {
    deeplApiKey: String(process.env.DEEPL_API_KEY ?? storedSecrets.deeplApiKey ?? "").trim(),
    accessToken: String(process.env.DT_PROXY_TOKEN ?? storedSecrets.accessToken ?? "").trim(),
    accountId: String(storedSecrets.accountId ?? "").trim()
  };

  const prompted = await promptForSetup(config, secrets, {
    needsConfig: !storedConfig && !process.env.PORT && !portArgument,
    needsApiKey: !secrets.deeplApiKey
  });
  validateDeploymentSecurity(prompted.config);
  validateNetworkSecurity(prompted.config);
  const runtime = {
    config: prompted.config,
    secrets: prompted.secrets,
    configPath,
    secretsPath,
    setupRequired: !prompted.secrets.deeplApiKey
  };

  if (!runtime.setupRequired) {
    await persistRuntimeSecrets(runtime, storedSecrets);
  }
  if ((!storedConfig || prompted.changed) && !runtime.setupRequired) {
    await writePrivateJson(configPath, prompted.config);
  }

  return runtime;
}

async function persistRuntimeSecrets(runtime, previousSecrets = {}) {
  if (!runtime.secrets.deeplApiKey) throw new Error("A DeepL API key is required");
  if (!runtime.secrets.accessToken) runtime.secrets.accessToken = generateAccessToken();
  const deepLKeyFingerprint = crypto.createHash("sha256")
    .update(runtime.secrets.deeplApiKey)
    .digest("hex");
  if (!runtime.secrets.accountId || previousSecrets.deepLKeyFingerprint !== deepLKeyFingerprint) {
    runtime.secrets.accountId = generateAccountId();
  }
  runtime.secrets.deepLKeyFingerprint = deepLKeyFingerprint;

  await writePrivateJson(runtime.secretsPath, {
    ...(!process.env.DEEPL_API_KEY ? { deeplApiKey: runtime.secrets.deeplApiKey } : {}),
    ...(!process.env.DT_PROXY_TOKEN ? { accessToken: runtime.secrets.accessToken } : {}),
    accountId: runtime.secrets.accountId,
    deepLKeyFingerprint
  });
}

async function completeWebSetup(runtime, deeplApiKey, deployment = {}) {
  if (!runtime.setupRequired) throw new Error("The proxy is already configured");
  const normalizedKey = String(deeplApiKey ?? "").trim();
  if (!normalizedKey || normalizedKey.length > 500) throw new Error("A valid DeepL API key is required");

  const mode = normalizeDeploymentMode(deployment.deploymentMode ?? runtime.config.deploymentMode);
  runtime.config.deploymentMode = mode;
  if (mode === "remote") {
    runtime.config.publicUrl = validatePublicProxyUrl(deployment.publicUrl, "remote");
    runtime.config.behindTrustedProxy = !runtime.config.tls.enabled;
    runtime.config.trustProxyHops = runtime.config.behindTrustedProxy ? 1 : 0;
  } else {
    runtime.config.publicUrl = "";
  }
  validateDeploymentSecurity(runtime.config);
  validateNetworkSecurity(runtime.config);

  runtime.secrets.deeplApiKey = normalizedKey;
  await persistRuntimeSecrets(runtime);
  await writePrivateJson(runtime.configPath, runtime.config);
  runtime.setupRequired = false;
  return runtime;
}

async function rememberFoundryOrigin(runtime, value) {
  const origin = validateFoundryOrigin(value);
  const previous = originWriteQueues.get(runtime) ?? Promise.resolve();
  const current = previous.then(async () => {
    if (runtime.config.allowedOrigins.includes(origin)) return origin;
    runtime.config.allowedOrigins.push(origin);
    await writePrivateJson(runtime.configPath, runtime.config);
    return origin;
  });
  originWriteQueues.set(runtime, current.catch(() => {}));
  return current;
}

function connectionString(runtime) {
  const host = runtime.config.host === "0.0.0.0" || runtime.config.host === "::"
    ? "127.0.0.1"
    : runtime.config.host;
  const protocol = runtime.config.tls.enabled ? "https" : "http";
  const base = runtime.config.publicUrl || `${protocol}://${host}:${runtime.config.port}`;
  return `${base}#${encodeURIComponent(runtime.secrets.accessToken)}`;
}

async function regenerateAccessToken(runtime) {
  if (process.env.DT_PROXY_TOKEN) throw new Error("Cannot regenerate a token supplied by DT_PROXY_TOKEN.");
  runtime.secrets.accessToken = generateAccessToken();
  await writePrivateJson(runtime.secretsPath, {
    ...(!process.env.DEEPL_API_KEY ? { deeplApiKey: runtime.secrets.deeplApiKey } : {}),
    accessToken: runtime.secrets.accessToken,
    accountId: runtime.secrets.accountId,
    deepLKeyFingerprint: runtime.secrets.deepLKeyFingerprint
  });
  return runtime.secrets.accessToken;
}

module.exports = {
  completeWebSetup,
  connectionString,
  generateAccessToken,
  isLoopbackHost,
  loadRuntimeConfiguration,
  regenerateAccessToken,
  rememberFoundryOrigin,
  resolvePaths,
  normalizeDeploymentMode,
  validateDeploymentSecurity,
  validateFoundryOrigin,
  validateNetworkSecurity,
  validatePort,
  validatePublicProxyUrl,
  writePrivateJson
};
