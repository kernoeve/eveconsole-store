// The site's database: D1, one store, self-migrating.
//
// ⚠️ Additive only. A deploy never touches the data the site already holds: every step here is
// CREATE IF NOT EXISTS or ADD COLUMN, never a drop or a rename, and the version row says which
// have run. A manual deploy and EVE Console's Update button therefore land in the same place,
// and there is no separate migration command to forget.

import { randomToken } from "./crypto";
import type { Catalogue, StoreInfo } from "./protocol";

export const SCHEMA_VERSION = 2;


const steps: { version: number; sql: string[] }[] = [
  {
    version: 1,
    sql: [
      `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
      // What EVE Console last pushed about the store, and the catalogue as a document.
      `CREATE TABLE IF NOT EXISTS store (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         json TEXT NOT NULL,
         catalogue_json TEXT NOT NULL DEFAULT '',
         catalogue_hash TEXT NOT NULL DEFAULT '',
         pushed_at TEXT,
         app_version TEXT NOT NULL DEFAULT '')`,
      `CREATE TABLE IF NOT EXISTS allowed (
         id INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
         PRIMARY KEY (id, kind))`,
      // The order book as the app last pushed it, upserted by the app's own id.
      `CREATE TABLE IF NOT EXISTS orders (
         id INTEGER PRIMARY KEY,
         buyer_id INTEGER NOT NULL, buyer_type TEXT NOT NULL DEFAULT '',
         web_order_id TEXT NOT NULL DEFAULT '',
         status TEXT NOT NULL DEFAULT '',
         json TEXT NOT NULL,
         updated_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS ix_orders_buyer ON orders (buyer_id)`,
      // Orders placed here, from submission until the app books or declines them.
      `CREATE TABLE IF NOT EXISTS web_orders (
         id TEXT PRIMARY KEY,
         buyer_id INTEGER NOT NULL, buyer_name TEXT NOT NULL DEFAULT '',
         corp_id INTEGER NOT NULL DEFAULT 0, alliance_id INTEGER,
         lines_json TEXT NOT NULL, contract_to_json TEXT, note TEXT NOT NULL DEFAULT '',
         catalogue_hash TEXT NOT NULL DEFAULT '', total REAL NOT NULL DEFAULT 0,
         state TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', app_ref TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS ix_web_orders_buyer ON web_orders (buyer_id)`,
      // What buyers did, for the app to pull; pruned once the app's cursor passes them.
      `CREATE TABLE IF NOT EXISTS events (
         seq INTEGER PRIMARY KEY AUTOINCREMENT,
         kind TEXT NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS sessions (
         id TEXT PRIMARY KEY,
         character_id INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '',
         corp_id INTEGER NOT NULL DEFAULT 0, alliance_id INTEGER,
         csrf TEXT NOT NULL,
         created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS oauth_states (
         state TEXT PRIMARY KEY, verifier TEXT NOT NULL, next TEXT NOT NULL DEFAULT '/', created_at TEXT NOT NULL)`,
    ],
  },
  {
    version: 2,
    // Whether the buyer wants EVE mail as the order moves, asked when the order is placed.
    sql: [`ALTER TABLE web_orders ADD COLUMN mail_updates INTEGER NOT NULL DEFAULT 1`],
  },
];


let ensured: Promise<void> | null = null;

/** Brings the schema up to date, once per isolate. Cheap after the first request. */
export function ensureSchema(db: D1Database): Promise<void> {
  ensured ??= (async () => {
    // The meta table may not exist yet, so the first read is guarded.
    let current = 0;
    try {
      const row = await db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).first<{ value: string }>();
      current = row ? Number(row.value) : 0;
    } catch { current = 0; }

    for (const step of steps) {
      if (step.version <= current) continue;
      for (const sql of step.sql) {
        try { await db.prepare(sql).run(); }
        catch (e) {
          // ⚠️ Another isolate may have run this step a moment ago: the first requests after a
          // deploy race here, and a column that is already there is the step done, not a failure.
          if (!/duplicate column name/i.test(String((e as Error)?.message ?? e))) throw e;
        }
      }

      await db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?1)
                        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(String(step.version)).run();
    }

    // The generation: minted once, when this database first exists. EVE Console compares it
    // with the one it last saw, and a different one means "resend everything".
    const gen = await db.prepare(`SELECT value FROM meta WHERE key = 'generation'`).first<{ value: string }>();
    if (!gen) await db.prepare(`INSERT INTO meta (key, value) VALUES ('generation', ?1)`).bind(randomToken(12)).run();
  })().catch((e) => { ensured = null; throw e; });
  return ensured;
}

export async function meta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM meta WHERE key = ?1`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export interface StoreState {
  info: StoreInfo;
  catalogue: Catalogue | null;
  catalogueHash: string;
  pushedAt: string | null;
  appVersion: string;
}

/** What the app last pushed, or null before the first sync. */
export async function loadStore(db: D1Database): Promise<StoreState | null> {
  const row = await db.prepare(`SELECT json, catalogue_json, catalogue_hash, pushed_at, app_version FROM store WHERE id = 1`)
    .first<{ json: string; catalogue_json: string; catalogue_hash: string; pushed_at: string | null; app_version: string }>();
  if (!row) return null;
  return {
    info: JSON.parse(row.json) as StoreInfo,
    catalogue: row.catalogue_json ? (JSON.parse(row.catalogue_json) as Catalogue) : null,
    catalogueHash: row.catalogue_hash,
    pushedAt: row.pushed_at,
    appVersion: row.app_version,
  };
}

export const now = () => new Date().toISOString();
