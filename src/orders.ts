// What buyers do on the site: place an order, cancel one, and see their own.
//
// A web order lives here from submission until EVE Console books or declines it, and the
// app is told through an event. Nothing here decides anything about stock or price beyond
// quoting the catalogue the app pushed; the app confirms, and its next push says so.

import type { Session } from "./env";
import { newId } from "./crypto";
import { now } from "./db";
import { said, type Said } from "./i18n";
import type { CatalogueItem, Listing, Need, OrderRow, SiteEvent } from "./protocol";

/** One line of a web order, with the listing it came from: "buy" is an offer to sell to the store. */
export interface WebOrderLine {
  typeId: number; name: string; units: number; unitPrice: number; postingId?: number; side?: "sell" | "buy";
  /** An offer's expected contract date, "yyyy-mm-dd", shown on My orders until the store books it. */
  expectedDate?: string;
}

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

/** The most of one item a web order may ask for — the same bound the app's mail path enforces:
 * a full stack, the most the game holds in one place and an item exchange contract can carry
 * (2^31 − 1). It was 10,000, which turned away offers of ore, ice and minerals. */
export const MAX_UNITS = 2_147_483_647;

/** Units of each type in web orders the app has not yet taken: shown as unavailable so two
 * buyers cannot both see the last unit. Offers to sell take nothing off the shelf. */
export async function pendingUnits(db: D1Database): Promise<Map<number, number>> {
  const rows = await db.prepare(`SELECT lines_json FROM web_orders WHERE state IN ('submitted', 'review')`).all<{ lines_json: string }>();
  const map = new Map<number, number>();
  for (const r of rows.results)
    for (const l of JSON.parse(r.lines_json) as WebOrderLine[])
      if (l.side !== "buy") map.set(l.typeId, (map.get(l.typeId) ?? 0) + l.units);
  return map;
}

/** The key {@link offeredUnits} counts by: a listing (0 for none) and an item type. */
export const offerKey = (postingId: number | undefined, typeId: number) => `${postingId ?? 0}:${typeId}`;

/** Units on offers to sell the app has not answered yet, by listing and type: what a Buy item's
 * need cannot know of yet. Booked offers are not counted: the app has them in the need already. */
export async function offeredUnits(db: D1Database): Promise<Map<string, number>> {
  const rows = await db.prepare(`SELECT lines_json FROM web_orders WHERE state IN ('submitted', 'review')`).all<{ lines_json: string }>();
  const map = new Map<string, number>();
  for (const r of rows.results)
    for (const l of JSON.parse(r.lines_json) as WebOrderLine[])
      if (l.side === "buy") {
        const key = offerKey(l.postingId, l.typeId);
        map.set(key, (map.get(key) ?? 0) + l.units);
      }
  return map;
}

/** A need's figures as whole numbers, none negative; null when the item carries none. */
export function needOf(item: CatalogueItem): Need | null {
  const n = item.need;
  if (!n || typeof n !== "object") return null;
  const whole = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  return { needed: whole(n.needed), wanted: whole(n.wanted), onHand: whole(n.onHand), inBuild: whole(n.inBuild), onOrder: whole(n.onOrder) };
}

/** How many more of a Buy item the store takes now: its need less the offers still waiting on
 * the app, never below none. Null for an item without a need, which is not capped. */
export function stillNeeded(item: CatalogueItem, postingId: number | undefined, offered: Map<string, number>): number | null {
  const need = needOf(item);
  if (!need) return null;
  return Math.max(0, need.needed - (offered.get(offerKey(postingId, item.typeId)) ?? 0));
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

/** A refusal is said, not worded: the page words it in the store's language. */
export type Outcome = { ok: true; id?: string } | { ok: false; reason: Said };

/**
 * Books nothing: records what the buyer asked for, priced from the listing the site holds,
 * and raises the event the app will act on. A Buy listing's is an offer to sell to the store.
 */
export async function placeOrder(
  db: D1Database, s: Session, listing: Listing,
  typeId: number, units: number, note: string, mailUpdates: boolean, expectedDate?: string,
): Promise<Outcome> {

  const buying = listing.side === "buy";
  // The seller's own estimate of when the contract comes; only an offer has one.
  const expected = buying ? contractDate(expectedDate) : undefined;
  const catalogue = listing.catalogue;
  const catalogueHash = catalogue.hash ?? "";
  const item = catalogue.sections.flatMap((x) => x.items).find((i) => i.typeId === typeId);
  if (!item) return { ok: false, reason: said(buying ? "notOnBuyList" : "notOnPriceList") };
  if (item.unitPrice == null) return { ok: false, reason: said("noPrice") };
  if (!Number.isInteger(units) || units < 1) return { ok: false, reason: said("badQuantity") };

  // The listing travels with the line, so the app checks it against that listing's prices; an
  // older app's one listing (id 0) is named by nothing, as before.
  const postingId = listing.id > 0 ? listing.id : undefined;

  // A Buy item with a need takes no more than is still needed, less what others have offered and
  // the app has not answered. Read now, not when the page was drawn; two offers at once can still
  // both pass, and the app checks again when it books.
  if (buying && item.need) {
    const left = stillNeeded(item, postingId, await offeredUnits(db));
    if (left === 0) return { ok: false, reason: said("notNeeded") };
    if (left !== null && units > left) return { ok: false, reason: said("overNeed", { n: left }) };
  }
  if (units > MAX_UNITS) return { ok: false, reason: said("tooMany", { max: MAX_UNITS }) };
  const line: WebOrderLine = { typeId, name: item.name, units, unitPrice: item.unitPrice, postingId, side: buying ? "buy" : undefined, expectedDate: expected };
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
      lines: [{ typeId, units, unitPrice: item.unitPrice, postingId }],
      contractTo: null, note: note.slice(0, 500), catalogueHash, mailUpdates,
      ...(buying ? { side: "buy" as const } : {}),
      ...(expected ? { expectedDate: expected } : {}),
    }),
  ]);
  return { ok: true, id };
}

/**
 * An offer's expected contract date as the form sent it, "yyyy-mm-dd", or undefined. Blank, not
 * a real date, or before yesterday (EVE time; the seller's own day may still be yesterday) is
 * none: the picker offers nothing earlier, so only a hand-made form sends one, and the offer
 * stands without it.
 */
export function contractDate(v: string | undefined | null): string | undefined {
  const s = (v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(s + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return undefined;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return s >= yesterday ? s : undefined;
}

/** Withdraws a web order the app has not booked yet. */
export async function cancelWebOrder(db: D1Database, s: Session, id: string): Promise<Outcome> {
  const row = await db.prepare(`SELECT buyer_id, state FROM web_orders WHERE id = ?1`).bind(id).first<{ buyer_id: number; state: string }>();
  if (!row || row.buyer_id !== s.characterId) return { ok: false, reason: said("noSuchOrderOfYours") };
  if (row.state !== "submitted" && row.state !== "review") return { ok: false, reason: said("pastCancelling") };
  await db.prepare(`UPDATE web_orders SET state = 'cancelled', updated_at = ?2 WHERE id = ?1`).bind(id, now()).run();
  await raise(db, { kind: "cancel", at: now(), webOrderId: id, buyer: buyerOf(s), orderId: null, reason: "" });
  return { ok: true };
}

/** Asks the store to cancel an order in the book — the buyer's own, whatever channel placed it. */
export async function cancelOrder(db: D1Database, s: Session, appOrderId: number): Promise<Outcome> {
  const row = await db.prepare(`SELECT buyer_id, buyer_type, status, web_order_id FROM orders WHERE id = ?1`)
    .bind(appOrderId).first<{ buyer_id: number; buyer_type: string; status: string; web_order_id: string }>();
  if (!row) return { ok: false, reason: said("noSuchOrder") };
  const mine = row.buyer_id === s.characterId || (row.buyer_type === "corporation" && row.buyer_id === s.corporationId);
  if (!mine) return { ok: false, reason: said("notYours") };
  if (row.status !== "pending") return { ok: false, reason: said("alreadySettled") };
  await raise(db, { kind: "cancel", at: now(), webOrderId: row.web_order_id, buyer: buyerOf(s), orderId: appOrderId, reason: "" });
  return { ok: true };
}
