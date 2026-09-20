// POST /api/sync — the one call EVE Console makes. See docs/protocol.md.
//
// ⚠️ The app is the source of truth. Everything here that describes the store, the catalogue
// or the order book is written from the request and never edited by the site; what the site
// adds of its own is what buyers did, handed back as events until the app's cursor passes them.

import type { Context } from "hono";
import type { AppEnv } from "./env";
import { base64Decode, sha256Hex, verifySync } from "./crypto";
import { bannerHash, ensureSchema, meta, now, SCHEMA_VERSION } from "./db";
import {
  BANNER_MAX_BYTES, BANNER_TYPES, PROTOCOL, SIGNATURE_HEADER, TIMESTAMP_HEADER,
  type BannerUpload, type SiteEvent, type SyncRequest, type SyncResponse,
} from "./protocol";

const EVENTS_PER_REPLY = 200;
const ACTIVE_MINUTES = 5;

export async function handleSync(c: Context<AppEnv>): Promise<Response> {
  const body = new Uint8Array(await c.req.arrayBuffer());
  const ok = await verifySync(c.env.STORE_SYNC_SECRET, c.req.header(TIMESTAMP_HEADER), c.req.header(SIGNATURE_HEADER), body);
  if (!ok) return c.json({ error: "signature refused" }, 401);

  let req: SyncRequest;
  try { req = JSON.parse(new TextDecoder().decode(body)) as SyncRequest; }
  catch { return c.json({ error: "the body is not JSON" }, 400); }
  if (req.protocol !== PROTOCOL) return c.json({ protocol: PROTOCOL }, 409);

  const db = c.env.DB;
  await ensureSchema(db);
  const generation = (await meta(db, "generation")) ?? "";
  const ts = now();

  // ── The store and its catalogue: a snapshot, written whole ──
  await db.prepare(
    `INSERT INTO store (id, json, catalogue_json, catalogue_hash, pushed_at, app_version)
     VALUES (1, ?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, catalogue_json = excluded.catalogue_json,
       catalogue_hash = excluded.catalogue_hash, pushed_at = excluded.pushed_at, app_version = excluded.app_version`,
  ).bind(JSON.stringify(req.store), JSON.stringify(req.catalogue), req.catalogue.hash ?? "", ts, req.appVersion ?? "").run();

  // ── Who may buy: replaced whole, so a removed entry is gone at once ──
  const allowed: D1PreparedStatement[] = [db.prepare(`DELETE FROM allowed`)];
  for (const a of req.store.allowed ?? [])
    allowed.push(db.prepare(`INSERT OR REPLACE INTO allowed (id, kind, name) VALUES (?1, ?2, ?3)`).bind(a.id, a.kind, a.name ?? ""));
  await db.batch(allowed);

  // ── The banner: only its hash travels here; the bytes come on their own call when the reply
  //    shows the site lacks them. Null says the store has none now. Absent says nothing — an
  //    older app — and what the site holds stays. ──
  if (req.store.banner === null) await db.prepare(`DELETE FROM assets WHERE kind = 'banner'`).run();

  // ── The order book: upserts by the app's id, tombstones, and what became of web orders ──
  const writes: D1PreparedStatement[] = [];
  const ordersApplied: number[] = [];
  for (const o of req.orders ?? []) {
    writes.push(db.prepare(
      `INSERT INTO orders (id, buyer_id, buyer_type, web_order_id, status, json, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET buyer_id = excluded.buyer_id, buyer_type = excluded.buyer_type,
         web_order_id = excluded.web_order_id, status = excluded.status, json = excluded.json, updated_at = excluded.updated_at`,
    ).bind(o.id, o.buyerId, o.buyerType ?? "", o.webOrderId ?? "", o.status, JSON.stringify(o), ts));
    // A row carrying a web id is that web order, booked: the app's reference replaces "unconfirmed".
    if (o.webOrderId)
      writes.push(db.prepare(
        `UPDATE web_orders SET state = 'booked', app_ref = ?2, reason = '', updated_at = ?3 WHERE id = ?1 AND state <> 'booked'`,
      ).bind(o.webOrderId, o.ref ?? "", ts));
    ordersApplied.push(o.id);
  }
  const removedApplied: number[] = [];
  for (const id of req.removed ?? []) {
    writes.push(db.prepare(`DELETE FROM orders WHERE id = ?1`).bind(id));
    removedApplied.push(id);
  }
  for (const w of req.webOrders ?? [])
    writes.push(db.prepare(
      `UPDATE web_orders SET state = ?2, reason = ?3, updated_at = ?4 WHERE id = ?1 AND state IN ('submitted', 'review')`,
    ).bind(w.webOrderId, w.state, w.reason ?? "", ts));
  // Events the app has applied are done with.
  writes.push(db.prepare(`DELETE FROM events WHERE seq <= ?1`).bind(req.cursor ?? 0));
  if (writes.length > 0) await db.batch(writes);

  // ── What buyers did since the cursor ──
  const rows = await db.prepare(`SELECT seq, kind, json FROM events WHERE seq > ?1 ORDER BY seq LIMIT ?2`)
    .bind(req.cursor ?? 0, EVENTS_PER_REPLY).all<{ seq: number; kind: string; json: string }>();
  const events: SiteEvent[] = rows.results.map((r) => ({ ...(JSON.parse(r.json) as SiteEvent), seq: r.seq }));

  const since = new Date(Date.now() - ACTIVE_MINUTES * 60_000).toISOString();
  const active = await db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE last_seen_at > ?1 AND expires_at > ?2`)
    .bind(since, ts).first<{ n: number }>();
  const orderCount = await db.prepare(`SELECT COUNT(*) AS n FROM orders`).first<{ n: number }>();

  const response: SyncResponse = {
    protocol: PROTOCOL,
    siteVersion: c.env.SITE_VERSION ?? "",
    schemaVersion: SCHEMA_VERSION,
    generation,
    catalogueHash: req.catalogue.hash ?? "",
    ordersApplied,
    removedApplied,
    events,
    activeSessions: active?.n ?? 0,
    // No order rows at all, and none in this call, from an app that thinks it has pushed
    // them: a database restored from before its ledger. It resends everything.
    needsFullOrders: (orderCount?.n ?? 0) === 0 && (req.orders?.length ?? 0) === 0 && req.generation === generation,
    bannerSha256: await bannerHash(db),
    serverTime: ts,
  };
  return c.json(response);
}

/** GET /api/version — for the app's update check. Nothing secret, nothing about buyers. Which EVE
 * application the site signs in with is said as the client id (public in every login redirect)
 * and a short fingerprint of the secret, so the app can tell whether they are the keys it holds. */
export async function handleVersion(c: Context<AppEnv>): Promise<Response> {
  await ensureSchema(c.env.DB);
  const clientId = c.env.EVE_CLIENT_ID ?? "";
  const secret = c.env.EVE_CLIENT_SECRET ?? "";
  return c.json({
    protocol: PROTOCOL,
    siteVersion: c.env.SITE_VERSION ?? "",
    schemaVersion: SCHEMA_VERSION,
    generation: (await meta(c.env.DB, "generation")) ?? "",
    ssoConfigured: !!(clientId && secret),
    ssoClientId: clientId,
    ssoKeyFingerprint: secret ? (await sha256Hex(secret.trim())).slice(0, 12) : "",
  });
}

/** PUT /api/sync/banner — the banner's bytes, sent when the sync reply shows the site does not
 * hold the one the store has. Signed like the sync call; base64 inside JSON, so the content
 * type is under the same signature as the bytes. */
export async function handleBanner(c: Context<AppEnv>): Promise<Response> {
  const body = new Uint8Array(await c.req.arrayBuffer());
  const ok = await verifySync(c.env.STORE_SYNC_SECRET, c.req.header(TIMESTAMP_HEADER), c.req.header(SIGNATURE_HEADER), body);
  if (!ok) return c.json({ error: "signature refused" }, 401);

  let up: BannerUpload;
  try { up = JSON.parse(new TextDecoder().decode(body)) as BannerUpload; }
  catch { return c.json({ error: "the body is not JSON" }, 400); }
  if (!BANNER_TYPES.has(up.contentType)) return c.json({ error: `a banner is a PNG, JPEG, WebP or GIF, not ${up.contentType}` }, 415);

  let bytes: Uint8Array;
  try { bytes = base64Decode(up.data ?? ""); }
  catch { return c.json({ error: "the picture is not base64" }, 400); }
  if (bytes.length === 0 || bytes.length > BANNER_MAX_BYTES)
    return c.json({ error: `a banner is at most ${BANNER_MAX_BYTES.toLocaleString("en-US")} bytes; this one is ${bytes.length.toLocaleString("en-US")}` }, 413);
  if ((await sha256Hex(bytes)) !== up.sha256) return c.json({ error: "the picture does not match its hash" }, 400);

  await ensureSchema(c.env.DB);
  await c.env.DB.prepare(
    `INSERT INTO assets (kind, content_type, sha256, bytes, updated_at) VALUES ('banner', ?1, ?2, ?3, ?4)
     ON CONFLICT(kind) DO UPDATE SET content_type = excluded.content_type, sha256 = excluded.sha256,
       bytes = excluded.bytes, updated_at = excluded.updated_at`,
  ).bind(up.contentType, up.sha256, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), now()).run();
  return c.json({ ok: true, sha256: up.sha256 });
}


