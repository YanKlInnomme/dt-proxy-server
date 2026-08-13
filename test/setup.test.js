const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const { promises: fs } = require("fs");

const { completeWebSetup, rememberFoundryOrigin, resolvePaths } = require("../runtime-config");
const {
  escapeHtml,
  parseCookies,
  safeTokenEqual,
  setupAccessGranted,
  setupPage
} = require("../setup-ui");

test("uses product-specific files by default so colocated executables cannot collide", () => {
  const previous = process.env.DT_PROXY_CONFIG;
  delete process.env.DT_PROXY_CONFIG;
  try {
    const paths = resolvePaths();
    assert.equal(path.basename(paths.configPath), "deep-translate-proxy-config.json");
    assert.equal(path.basename(paths.defaultSecretsPath), "deep-translate-proxy-secrets.json");
  } finally {
    if (previous === undefined) delete process.env.DT_PROXY_CONFIG;
    else process.env.DT_PROXY_CONFIG = previous;
  }
});

test("keeps the proxy setup interface in English with a prominent product title", () => {
  const page = setupPage({ csrfToken: "token" });
  assert.match(page, /<title>Deep Translate Proxy Setup<\/title>/);
  assert.match(page, /<h1>Deep Translate Proxy<\/h1>/);
  assert.match(page, /Initial setup for the proxy\./);
  assert.doesNotMatch(page, /(?:Configuration|Clé API|Enregistrer|Proxy personnel)/i);
});

test("requires the unguessable setup token independently of the Host header", () => {
  assert.equal(setupAccessGranted("", "setup-secret", "setup-secret"), true);
  assert.equal(setupAccessGranted("dt_setup_access=setup-secret", "", "setup-secret"), true);
  assert.equal(setupAccessGranted("dt_setup_access=wrong", "wrong", "setup-secret"), false);
  assert.equal(setupAccessGranted("", "", "setup-secret"), false);
});

test("parses and compares the setup CSRF cookie safely", () => {
  assert.deepEqual(parseCookies("other=1; dt_setup_csrf=abc%20123"), {
    other: "1",
    dt_setup_csrf: "abc 123"
  });
  assert.equal(safeTokenEqual("secret", "secret"), true);
  assert.equal(safeTokenEqual("secre", "secret"), false);
  assert.equal(safeTokenEqual("", ""), false);
});

test("escapes setup-page values", () => {
  assert.equal(escapeHtml('<script>"x"</script>'), "&lt;script&gt;&quot;x&quot;&lt;/script&gt;");
  const page = setupPage({ csrfToken: '"><script>', error: "<bad>" });
  assert.doesNotMatch(page, /<script>/);
  assert.match(page, /&lt;bad&gt;/);
  const remotePage = setupPage({
    csrfToken: "token",
    values: { deploymentMode: "remote", publicUrl: '\"><script>' }
  });
  assert.match(remotePage, /value="remote" checked/);
  assert.doesNotMatch(remotePage, /<script>/);
});

test("persists web setup secrets and marks the runtime configured", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dt-proxy-setup-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtime = {
    config: { host: "127.0.0.1", port: 3001 },
    secrets: { deeplApiKey: "", accessToken: "", accountId: "" },
    configPath: path.join(directory, "config.json"),
    secretsPath: path.join(directory, "secrets.json"),
    setupRequired: true
  };

  await completeWebSetup(runtime, "test-key:fx");

  const config = JSON.parse(await fs.readFile(runtime.configPath, "utf8"));
  const secrets = JSON.parse(await fs.readFile(runtime.secretsPath, "utf8"));
  assert.equal(runtime.setupRequired, false);
  assert.equal(config.deeplApiKey, undefined);
  assert.equal(secrets.deeplApiKey, "test-key:fx");
  assert.match(secrets.accessToken, /^dt_[A-Za-z0-9_-]{43}$/);
  assert.match(secrets.accountId, /^account_[a-f0-9]{32}$/);
  await assert.rejects(() => completeWebSetup(runtime, "another-key"), /already configured/);
});

test("persists a secure remote web setup", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dt-proxy-remote-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtime = {
    config: {
      deploymentMode: "local",
      host: "0.0.0.0",
      port: 3001,
      publicUrl: "",
      allowedOrigins: [],
      tls: { enabled: false },
      behindTrustedProxy: false,
      trustProxyHops: 0
    },
    secrets: { deeplApiKey: "", accessToken: "", accountId: "" },
    configPath: path.join(directory, "config.json"),
    secretsPath: path.join(directory, "secrets.json"),
    setupRequired: true
  };

  await completeWebSetup(runtime, "test-key:fx", {
    deploymentMode: "remote",
    publicUrl: "https://translate.example.test/"
  });

  const config = JSON.parse(await fs.readFile(runtime.configPath, "utf8"));
  assert.equal(config.deploymentMode, "remote");
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.publicUrl, "https://translate.example.test");
  assert.deepEqual(config.allowedOrigins, []);
  assert.equal(config.behindTrustedProxy, true);
  assert.equal(config.trustProxyHops, 1);

  await rememberFoundryOrigin(runtime, "https://foundry.example.test");
  await rememberFoundryOrigin(runtime, "https://foundry.example.test");
  const learnedConfig = JSON.parse(await fs.readFile(runtime.configPath, "utf8"));
  assert.deepEqual(learnedConfig.allowedOrigins, ["https://foundry.example.test"]);
});
