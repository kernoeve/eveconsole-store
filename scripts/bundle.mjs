// Builds the Worker exactly as `wrangler deploy` would, without deploying, and writes the
// manifest EVE Console's Deploy and Update buttons read:
//
//   dist/index.js        the bundled module Cloudflare runs
//   dist/manifest.json   its version, protocol, schema version, SHA-256, and what the Worker
//                        needs bound — so the app deploys it with the same settings wrangler would
//
// A release attaches both. Nothing here touches Cloudflare.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const read = (p) => readFileSync(resolve(root, p), "utf8");

const pkg = JSON.parse(read("package.json"));
const toml = read("wrangler.toml");
const siteVersion = /SITE_VERSION\s*=\s*"([^"]+)"/.exec(toml)?.[1];
if (siteVersion !== pkg.version) {
  console.error(`wrangler.toml says SITE_VERSION ${siteVersion} but package.json says ${pkg.version}; make them agree.`);
  process.exit(1);
}
const compatibilityDate = /compatibility_date\s*=\s*"([^"]+)"/.exec(toml)?.[1] ?? "";
const compatibilityFlags = (/compatibility_flags\s*=\s*\[([^\]]*)\]/.exec(toml)?.[1] ?? "")
  .split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
const protocol = Number(/export const PROTOCOL = (\d+)/.exec(read("src/protocol.ts"))?.[1]);
const schemaVersion = Number(/export const SCHEMA_VERSION = (\d+)/.exec(read("src/db.ts"))?.[1]);

mkdirSync(dist, { recursive: true });
execSync("npx wrangler deploy --dry-run --outdir dist", { cwd: root, stdio: "inherit" });
const script = resolve(dist, "index.js");
if (!existsSync(script)) {
  console.error("wrangler did not write dist/index.js");
  process.exit(1);
}

const sha256 = createHash("sha256").update(readFileSync(script)).digest("hex");
const manifest = {
  name: pkg.name,
  version: pkg.version,
  protocol,
  schemaVersion,
  script: "index.js",
  sha256,
  compatibilityDate,
  compatibilityFlags,
  bindings: {
    d1: "DB",
    vars: { SITE_VERSION: pkg.version },
    secrets: ["STORE_SYNC_SECRET", "EVE_CLIENT_ID", "EVE_CLIENT_SECRET"],
  },
  builtAt: new Date().toISOString(),
};
writeFileSync(resolve(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`dist/index.js  version ${pkg.version}  protocol ${protocol}  schema ${schemaVersion}  compat ${compatibilityDate}  sha256 ${sha256.slice(0, 12)}…`);
