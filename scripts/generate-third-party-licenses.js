const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const outputPath = path.join(root, "THIRD_PARTY_LICENSES.txt");
const nodeLicensePath = path.join(root, "licenses", "NODEJS-22-LICENSE.txt");

const FALLBACK_NOTICES = {
  "agent-base@6.0.2": `Copyright (c) Nathan Rajlich <nathan@tootallnate.net>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  "https-proxy-agent@5.0.1": `Copyright (c) Nathan Rajlich <nathan@tootallnate.net>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`
};

function normalize(text) {
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
}

function packageName(packagePath, metadata) {
  return metadata.name || packagePath.split("node_modules/").at(-1);
}

function findNotice(packagePath, id) {
  const directory = path.join(root, packagePath);
  const candidate = fs.readdirSync(directory)
    .filter(name => /^(licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(name))
    .sort((a, b) => a.localeCompare(b))[0];
  if (candidate) return normalize(fs.readFileSync(path.join(directory, candidate), "utf8"));
  if (FALLBACK_NOTICES[id]) return FALLBACK_NOTICES[id];
  throw new Error(`No license notice found for ${id}`);
}

const packages = new Map();
for (const [packagePath, metadata] of Object.entries(lock.packages)) {
  if (!packagePath.startsWith("node_modules/") || metadata.dev) continue;
  const id = `${packageName(packagePath, metadata)}@${metadata.version}`;
  if (!packages.has(id)) packages.set(id, { packagePath, license: metadata.license || "UNKNOWN" });
}

const pkgMetadata = lock.packages["node_modules/@yao-pkg/pkg"];
if (pkgMetadata) {
  packages.set(`@yao-pkg/pkg@${pkgMetadata.version}`, {
    packagePath: "node_modules/@yao-pkg/pkg",
    license: pkgMetadata.license || "MIT"
  });
}

const groups = new Map();
for (const [id, details] of [...packages].sort(([left], [right]) => left.localeCompare(right))) {
  const notice = findNotice(details.packagePath, id);
  const key = `${details.license}\0${notice}`;
  if (!groups.has(key)) groups.set(key, { license: details.license, notice, packages: [] });
  groups.get(key).packages.push(id);
}

const sections = [...groups.values()].map(group => [
  "================================================================================",
  `Packages: ${group.packages.join(", ")}`,
  `SPDX license expression: ${group.license}`,
  "--------------------------------------------------------------------------------",
  group.notice
].join("\n"));

const nodeLicense = normalize(fs.readFileSync(nodeLicensePath, "utf8"));
const output = `${[
  "Deep Translate Proxy — Third-Party Notices",
  "",
  "This distribution includes third-party software. The notices below are",
  "generated from package-lock.json and the license files shipped by each package.",
  "The @yao-pkg/pkg notice is included because its bootstrap is used to produce the",
  "standalone executables. Duplicate notice texts are consolidated.",
  "",
  ...sections,
  "================================================================================",
  "Component: Node.js 22 runtime and its bundled third-party components",
  "Source: https://github.com/nodejs/node/tree/v22.x",
  "--------------------------------------------------------------------------------",
  nodeLicense,
  "================================================================================",
  "DeepL service notice",
  "--------------------------------------------------------------------------------",
  "Deep Translate Proxy uses the DeepL API but does not redistribute the service.",
  "Use of DeepL is governed separately by its terms:",
  "https://www.deepl.com/pro-license",
  ""
].join("\n")}\n`;

if (process.argv.includes("--check")) {
  const current = fs.existsSync(outputPath) ? normalize(fs.readFileSync(outputPath, "utf8")) : "";
  if (current !== normalize(output)) {
    console.error("THIRD_PARTY_LICENSES.txt is out of date. Run npm run licenses.");
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(outputPath, output, "utf8");
}
