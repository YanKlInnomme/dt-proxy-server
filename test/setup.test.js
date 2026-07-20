const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const { promises: fs } = require("fs");

const { completeWebSetup } = require("../runtime-config");
const {
  escapeHtml,
  parseCookies,
  safeTokenEqual,
  setupAccessGranted,
  setupPage
} = require("../setup-ui");

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
});

test("persists web setup secrets and marks the runtime configured", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dt-proxy-setup-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const runtime = {
    config: { host: "0.0.0.0", port: 3001 },
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
