// The store's per-buyer purchase limit, as the site applies it.
//
// So many units of each item type, of each item group, or of anything in the store, counted over
// what the buyer has taken from this store within a rolling period or ever. The count is the
// store's own order book as EVE Console last pushed it (nothing cancelled) plus the web orders the
// store has not answered yet, so a buyer cannot place the same first order twice while the store
// is still confirming the first. The app checks again when it books; this is the shop window
// refusing what would be refused anyway.

import { t, type Lang } from "./i18n";
import type { Catalogue, Limit, OrderRow } from "./protocol";
import type { WebOrder } from "./orders";

/** The start of the period, or null for all time. Months and years step the calendar. */
export function periodStart(limit: Limit, now = new Date()): Date | null {
  const n = Math.max(1, limit.count);
  const d = new Date(now.getTime());
  switch (limit.period) {
    case "days":   d.setUTCDate(d.getUTCDate() - n); return d;
    case "months": d.setUTCMonth(d.getUTCMonth() - n); return d;
    case "years":  d.setUTCFullYear(d.getUTCFullYear() - n); return d;
    default:       return null;
  }
}

export function scopeWords(lang: Lang, limit: Limit): string {
  switch (limit.scope) {
    case "group": return t(lang, "scopeGroup");
    case "store": return t(lang, "scopeStore");
    default:      return t(lang, "scopeType");
  }
}

export function periodWords(lang: Lang, limit: Limit): string {
  const n = Math.max(1, limit.count);
  switch (limit.period) {
    case "days":   return t(lang, "periodDays", { n });
    case "months": return t(lang, "periodMonths", { n });
    case "years":  return t(lang, "periodYears", { n });
    default:       return t(lang, "periodEver");
  }
}

/** "1 unit of each item ever", in the store's language. */
export function describeLimit(lang: Lang, limit: Limit): string {
  return t(lang, "limitPhrase", {
    units: t(lang, "limitUnits", { n: Math.max(1, limit.units) }),
    scope: scopeWords(lang, limit),
    period: periodWords(lang, limit),
  });
}

/** The key one order line counts against: the type, its group, or the store as a whole. */
export function scopeKey(limit: Limit, typeId: number, groupId: number | undefined): string {
  switch (limit.scope) {
    case "group": return `g:${groupId ?? 0}`;
    case "store": return "store";
    default:      return `t:${typeId}`;
  }
}

/** Units the buyer has taken, by scope key, within the period. */
export function orderedByScope(
  limit: Limit, catalogue: Catalogue | null, orders: OrderRow[], waiting: WebOrder[], characterId: number, now = new Date(),
): Map<string, number> {
  const start = periodStart(limit, now);
  const groupOf = new Map<number, number>();
  for (const s of catalogue?.sections ?? []) for (const i of s.items) if (i.groupId != null) groupOf.set(i.typeId, i.groupId);

  const taken = new Map<string, number>();
  const add = (typeId: number, groupId: number | undefined, units: number) => {
    const key = scopeKey(limit, typeId, groupId ?? groupOf.get(typeId));
    taken.set(key, (taken.get(key) ?? 0) + units);
  };
  for (const o of orders) {
    if (o.buyerType !== "character" || o.buyerId !== characterId || o.status === "canceled") continue;
    if (start && new Date(o.createdAt) < start) continue;
    add(o.typeId, o.groupId, o.units);
  }
  for (const w of waiting) {
    if (w.buyerId !== characterId || (w.state !== "submitted" && w.state !== "review")) continue;
    if (start && new Date(w.createdAt) < start) continue;
    for (const l of w.lines) add(l.typeId, undefined, l.units);
  }
  return taken;
}

export interface Allowance { ordered: number; remaining: number }

/** What the buyer has taken against an item's key, and how much of the limit is left. */
export function allowanceFor(limit: Limit, taken: Map<string, number>, typeId: number, groupId: number | undefined): Allowance {
  const ordered = taken.get(scopeKey(limit, typeId, groupId)) ?? 0;
  return { ordered, remaining: Math.max(0, Math.max(1, limit.units) - ordered) };
}

/** The sentence the order dialog shows. */
export function allowanceWords(lang: Lang, limit: Limit, a: Allowance): string {
  const words = describeLimit(lang, limit);
  if (a.ordered === 0) return t(lang, "allowanceNone", { limit: words });
  return a.remaining > 0
    ? t(lang, "allowanceSome", { limit: words, ordered: a.ordered, left: a.remaining })
    : t(lang, "allowanceAll", { limit: words, ordered: a.ordered });
}
