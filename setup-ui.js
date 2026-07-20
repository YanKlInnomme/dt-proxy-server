const crypto = require("crypto");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = "";
    }
  }
  return cookies;
}

function safeTokenEqual(first, second) {
  const left = Buffer.from(String(first ?? ""));
  const right = Buffer.from(String(second ?? ""));
  return Boolean(left.length && left.length === right.length && crypto.timingSafeEqual(left, right));
}

function setupAccessGranted(cookieHeader, queryToken, expectedToken) {
  const accessCookie = parseCookies(cookieHeader).dt_setup_access;
  return safeTokenEqual(accessCookie, expectedToken) || safeTokenEqual(queryToken, expectedToken);
}

function setupPage({ csrfToken, error = "", connection = "" }) {
  const finished = Boolean(connection);
  const message = finished
    ? `<div class="success"><strong>Setup complete.</strong><p>Copy this address into the Deep Translate settings:</p><code>${escapeHtml(connection)}</code></div>`
    : `<form method="post" action="/setup" autocomplete="off">
        <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}">
        <label for="deeplApiKey">DeepL API key</label>
        <input id="deeplApiKey" name="deeplApiKey" type="password" required maxlength="500" autofocus>
        <p class="hint">The key remains in the Docker volume and is never sent to Foundry.</p>
        ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
        <button type="submit">Configure proxy</button>
      </form>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Deep Translate Proxy Setup</title>
  <style>
    :root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111827;color:#e5e7eb}.card{box-sizing:border-box;width:min(92vw,560px);padding:2rem;border:1px solid #374151;border-radius:16px;background:#1f2937;box-shadow:0 20px 50px #0006}h1{margin-top:0;font-size:1.55rem}label{display:block;margin:1.5rem 0 .5rem;font-weight:700}input{box-sizing:border-box;width:100%;padding:.8rem;border:1px solid #6b7280;border-radius:8px;background:#111827;color:#fff;font:inherit}button{margin-top:1rem;padding:.8rem 1rem;border:0;border-radius:8px;background:#2563eb;color:#fff;font:inherit;font-weight:700;cursor:pointer}.hint{color:#9ca3af;font-size:.9rem}.error{color:#fca5a5}.success{padding:1rem;border-radius:10px;background:#064e3b}.success code{display:block;margin-top:1rem;padding:.8rem;overflow-wrap:anywhere;border-radius:6px;background:#022c22;color:#d1fae5}</style>
</head>
<body><main class="card"><h1>Deep Translate Proxy</h1><p>${finished ? "The proxy is ready to use." : "Initial setup for the Docker proxy."}</p>${message}</main></body>
</html>`;
}

function setSetupHeaders(res) {
  res.set({
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  });
}

module.exports = {
  escapeHtml,
  parseCookies,
  safeTokenEqual,
  setSetupHeaders,
  setupAccessGranted,
  setupPage
};
