const test = require("node:test");
const assert = require("node:assert/strict");

const deepl = require("deepl-node");
const {
  createRateLimiter,
  deepLServiceError,
  getAccessToken,
  rateLimitBucket,
  shouldShowConnectionAtStartup,
  tokensEqual
} = require("../server");
const {
  generateAccessToken,
  validateDeploymentSecurity,
  validateFoundryOrigin,
  validateNetworkSecurity,
  validatePort,
  validatePublicProxyUrl
} = require("../runtime-config");

test("generates a high-entropy proxy token", () => {
  const first = generateAccessToken();
  const second = generateAccessToken();
  assert.match(first, /^dt_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("compares proxy tokens without accepting prefixes or empty values", () => {
  assert.equal(tokensEqual("dt_secret", "dt_secret"), true);
  assert.equal(tokensEqual("dt_secre", "dt_secret"), false);
  assert.equal(tokensEqual("", ""), false);
});

test("accepts the Bearer authentication scheme case-insensitively", () => {
  assert.equal(getAccessToken({ get: () => "bearer   dt_secret" }), "dt_secret");
  assert.equal(getAccessToken({ get: () => "Basic abc" }), null);
});

test("shows the connection automatically only in an interactive packaged executable", () => {
  assert.equal(shouldShowConnectionAtStartup({ packaged: true, interactive: true }), true);
  assert.equal(shouldShowConnectionAtStartup({ packaged: true, interactive: false }), false);
  assert.equal(shouldShowConnectionAtStartup({ packaged: false, interactive: true }), false);
});

test("keeps proxy authentication distinct from DeepL authentication", () => {
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    deepLServiceError(response, new deepl.AuthorizationError("rejected"), "Translation");
  } finally {
    console.error = originalError;
  }
  assert.equal(response.statusCode, 401);
  assert.equal(response.body.code, "DEEPL_AUTH_FAILED");
});

test("uses independent configurable limits for each route and exempts health", () => {
  assert.equal(rateLimitBucket({ path: "/translate" }), "translate");
  assert.equal(rateLimitBucket({ path: "/languages" }), "languages");
  assert.equal(rateLimitBucket({ path: "/health" }), null);

  const limiter = createRateLimiter({
    windowMs: 60000,
    default: 1,
    translate: 2,
    usage: 1,
    languages: 1,
    glossaries: 1
  });
  const response = {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  let accepted = 0;
  const next = () => { accepted += 1; };
  limiter({ path: "/translate", ip: "127.0.0.1" }, response, next);
  limiter({ path: "/translate", ip: "127.0.0.1" }, response, next);
  limiter({ path: "/translate", ip: "127.0.0.1" }, response, next);
  limiter({ path: "/health", ip: "127.0.0.1" }, response, next);

  assert.equal(accepted, 3);
  assert.equal(response.statusCode, 429);
  assert.equal(response.body.route, "translate");
  assert.ok(Number(response.headers["Retry-After"]) >= 1);
});

test("validates configured ports", () => {
  assert.equal(validatePort("3001"), 3001);
  assert.throws(() => validatePort(0));
  assert.throws(() => validatePort(65536));
  assert.throws(() => validatePort("not-a-port"));
});

test("remote mode requires a non-loopback HTTPS public URL", () => {
  assert.equal(
    validatePublicProxyUrl("https://translate.example.test/", "remote"),
    "https://translate.example.test"
  );
  assert.throws(() => validatePublicProxyUrl("http://translate.example.test", "remote"), /HTTPS/);
  assert.throws(() => validatePublicProxyUrl("https://127.0.0.1:3001", "remote"), /loopback/);
  assert.equal(validatePublicProxyUrl("http://127.0.0.1:3001", "local"), "http://127.0.0.1:3001");
});

test("accepts only exact HTTP or HTTPS Foundry origins", () => {
  assert.equal(validateFoundryOrigin("https://foundry.example.test:30000"), "https://foundry.example.test:30000");
  assert.throws(() => validateFoundryOrigin("https://foundry.example.test/game"), /scheme, host/);
  assert.throws(() => validateFoundryOrigin("ftp://foundry.example.test"), /scheme, host/);
});

test("remote deployment can learn origins but still requires a secured frontend", () => {
  const base = {
    deploymentMode: "remote",
    publicUrl: "https://translate.example.test",
    allowedOrigins: ["https://foundry.example.test"],
    tls: { enabled: false },
    behindTrustedProxy: true
  };
  assert.doesNotThrow(() => validateDeploymentSecurity({ ...base }));
  assert.doesNotThrow(() => validateDeploymentSecurity({ ...base, allowedOrigins: [] }));
  assert.throws(() => validateDeploymentSecurity({ ...base, behindTrustedProxy: false }), /TLS/);
});

test("refuses unsafe non-loopback listeners by default", () => {
  const base = {
    host: "0.0.0.0",
    allowedOrigins: ["https://foundry.example.test"],
    publicUrl: "",
    tls: { enabled: false },
    behindTrustedProxy: false,
    allowInsecureNetwork: false
  };
  assert.throws(() => validateNetworkSecurity({ ...base, allowedOrigins: [] }), /ALLOWED_ORIGINS/);
  assert.throws(() => validateNetworkSecurity(base), /Refusing an unencrypted/);
  assert.doesNotThrow(() => validateNetworkSecurity({ ...base, allowInsecureNetwork: true }));
  assert.doesNotThrow(() => validateNetworkSecurity({ ...base, tls: { enabled: true } }));
  assert.doesNotThrow(() => validateNetworkSecurity({
    ...base,
    behindTrustedProxy: true,
    publicUrl: "https://proxy.example.test"
  }));
  assert.doesNotThrow(() => validateNetworkSecurity({ ...base, host: "127.0.0.1", allowedOrigins: [] }));
  assert.doesNotThrow(() => validateNetworkSecurity({
    ...base,
    deploymentMode: "remote",
    allowedOrigins: [],
    behindTrustedProxy: true,
    publicUrl: "https://proxy.example.test"
  }));
});
