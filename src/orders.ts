// What buyers do on the site: place an order, cancel one, and see their own.
//
// A web order lives here from submission until EVE Console books or declines it, and the
// app is told through an event. Nothing here decides anything about stock or price beyond
// quoting the catalogue the app pushed; the app confirms, and its next push says so.

import type { Session } from "./env";
import { newId } from "./crypto";
import { now } from "./db";
import type { Catalogue, OrderRow, SiteEvent } from "./protocol";

export interface WebOrderLine { typeId: number; name: string; units: number; unitPrice: number }

export interface WebOrder {
  id: string;
  buyerId: number;
  lines: WebOrderLine[];
  total: number;
  state: "submitted" | "review" | "rejected" | "booked" | "cancelled" | string;
  reason: string;
  appRef: string;
  createdAt: string;
}

/** The most of one item a web order may ask for — the same bound the app's mail path enforces. */
export const MAX_UNITS = 10_000;

/** Units of each type in web orders the app has not yet taken: shown as unavailable so two
 * buyers cannot both see the last unit. */
export async function pendingUnits(db: D1Database): Promise<Map<number, number>> {
  const rows = await db.prepare(`SELECT lines_json FROM web_orders WHERE state IN ('submitted', 'review')`).all<{ lines_json: string }>();
  const map = new Map<number, number>();
  for (const r of rows.results)
    for (const l of JSON.parse(r.lines_json) as WebOrderLine[])
      map.set(l.typeId, (map.get(l.typeId) ?? 0) + l.units);
  return map;
}

function toWebOrder(r: { id: string; buyer_id: number; lines_json: string; total: number; state: string; reason: string; app_ref: string; created_at: string }): WebOrder {
  return { id: r.id, buyerId: r.buyer_id, lines: JSON.parse(r.lines_json), total: r.total, state: r.state, reason: r.reason, appRef: r.app_ref, createdAt: r.created_at };
}

/** A buyer's web orders that are not yet, or never became, orders in the book. */
export async function waitingFor(db: D1Database, buyerId: number): Promise<WebOrder[]> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const rows = await db.prepare(
    `SELECT id, buyer_id, lines_json, total, state, reason, app_ref, created_at FROM web_orders
      WHERE buyer_id = ?1 AND state <> 'booked' AND created_at > ?2 ORDER BY created_at DESC`,
  ).bind(buyerId, since).all<Parameters<typeof toWebOrder>[0]>();
  return rows.results.map(toWebOrder);
}

/** The buyer's web orders the store has not answered yet, whatever their age: what a limit counts before the store confirms. */
export async function pendingFor(db: D1Database, buyerId: number): Promise<WebOrder[]> {
  const rows = await db.prepare(
    `SELECT id, buyer_id, lines_json, total, state, reason, app_ref, created_at FROM web_orders
      WHERE buyer_id = ?1 AND state IN ('submitted', 'review')`,
  ).bind(buyerId).all<Parameters<typeof toWebOrder>[0]>();
  return rows.results.map(toWebOrder);
}

/** Every order in the buyer's name as the app last pushed it — theirs, or their corporation's. */
export async function ordersFor(db: D1Database, s: Session): Promise<OrderRow[]> {
  const rows = await db.prepare(
    `SELECT json FROM orders
      WHERE buyer_id = ?1 OR (buyer_type = 'corporation' AND buyer_id = ?2)
      ORDER BY updated_at DESC`,
  ).bind(s.characterId, s.corporationId).all<{ json: string }>();
  return rows.results
    .map((r) => JSON.parse(r.json) as OrderRow)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

function eventStatement(db: D1Database, ev: Omit<SiteEvent, "seq">): D1PreparedStatement {
  return db.prepare(`INSERT INTO events (kind, json, created_at) VALUES (?1, ?2, ?3)`)
    .bind(ev.kind, JSON.stringify(ev), now());
}

async function raise(db: D1Database, ev: Omit<SiteEvent, "seq">): Promise<void> {
  await eventStatement(db, ev).run();
}


function buyerOf(s: Session): SiteEvent["buyer"] {
  return { id: s.characterId, name: s.name, corporationId: s.corporationId, allianceId: s.allianceId };
}

export type Outcome = { ok: true; id?: string } | { ok: false; reason: string };

/**
 * Books nothing: records what the buyer asked for, priced from the catalogue the site holds,
 * and raises the event the app will act on.
 */
export async function placeOrder(
  db: D1Database, s: Session, catalogue: Catalogue, catalogueHash: string,
  typeId: number, units: number, note: string, mailUpdates: boolean,
): Promise<Outcome> {

  const item = catalogue.sections.flatMap((x) => x.items).find((i) => i.typeId === typeId);
  if (!item) return { ok: false, reason: "That item is not on the price list." };
  if (item.unitPrice == null) return { ok: false, reason: "That item is listed without a price and cannot be ordered." };
  if (!Number.isInteger(units) || units < 1) return { ok: false, reason: "The quantity has to be a whole number of at least one." };
  if (units > MAX_UNITS) return { ok: false, reason: `At most ${MAX_UNITS.toLocaleString("en-US")} of one item per order.` };

  const line: WebOrderLine = { typeId, name: item.name, units, unitPrice: item.unitPrice };
  const id = newId();
  const ts = now();
  // One round trip for the order and its event: the buyer is waiting on this.
  await db.batch([
    db.prepare(
      `INSERT INTO web_orders (id, buyer_id, buyer_name, corp_id, alliance_id, lines_json, contract_to_json, note,
                               catalogue_hash, total, state, reason, app_ref, created_at, updated_at, mail_updates)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?9, 'submitted', '', '', ?10, ?10, ?11)`,
    ).bind(id, s.characterId, s.name, s.corporationId, s.allianceId, JSON.stringify([line]),
           note.slice(0, 500), catalogueHash, line.units * line.unitPrice, ts, mailUpdates ? 1 : 0),
    eventStatement(db, {
      kind: "order", at: ts, webOrderId: id, buyer: buyerOf(s),
      lines: [{ typeId, units, unitPrice: item.unitPrice }],
      contractTo: null, note: note.slice(0, 500), catalogueHash, mailUpdates,
    }),
  ]);
  return { ok: true, id };

}

/** Withdraws a web order the app has not booked yet. */
export async function cancelWebOrder(db: D1Database, s: Session, id: string): Promise<Outcome> {
  const row = await db.prepare(`SELECT buyer_id, state FROM web_orders WHERE id = ?1`).bind(id).first<{ buyer_id: number; state: string }>();
  if (!row || row.buyer_id !== s.characterId) return { ok: false, reason: "No such order of yours." };
  if (row.state !== "submitted" && row.state !== "review") return { ok: false, reason: "That order is past cancelling here." };
  await db.prepare(`UPDATE web_orders SET state = 'cancelled', updated_at = ?2 WHERE id = ?1`).bind(id, now()).run();
  await raise(db, { kind: "cancel", at: now(), webOrderId: id, buyer: buyerOf(s), orderId: null, reason: "" });
  return { ok: true };
}

/** Asks the store to cancel an order in the book — the buyer's own, whatever channel placed it. */
export async function cancelOrder(db: D1Database, s: Session, appOrderId: number): Promise<Outcome> {
  const row = await db.prepare(`SELECT buyer_id, buyer_type, status, web_order_id FROM orders WHERE id = ?1`)
    .bind(appOrderId).first<{ buyer_id: number; buyer_type: string; status: string; web_order_id: string }>();
  if (!row) return { ok: false, reason: "No such order." };
  const mine = row.buyer_id === s.characterId || (row.buyer_type === "corporation" && row.buyer_id === s.corporationId);
  if (!mine) return { ok: false, reason: "That order is not yours." };
  if (row.status !== "pending") return { ok: false, reason: "That order is already settled." };
  await raise(db, { kind: "cancel", at: now(), webOrderId: row.web_order_id, buyer: buyerOf(s), orderId: appOrderId, reason: "" });
  return { ok: true };
}
