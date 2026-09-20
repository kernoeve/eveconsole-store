// A buyer arriving: one event per visit, not one per request.
//
// The store's owner wants to know when somebody comes to the site, and nothing about how many
// pages they turn. A visit is a sign-in, or the first request after a session has been quiet
// for a while; the session's last-seen time, kept anyway for the "somebody is here" signal to
// the app, is what says how long.

import type { Session } from "./env";
import { now } from "./db";
import type { SiteEvent } from "./protocol";

/** How long a buyer must have been away for their next request to count as a new visit. */
export const VISIT_GAP_MINUTES = 30;

/** Records that a buyer has arrived: on sign-in (no time away to speak of), or on the first
 * request after the gap, with how long they were away. The app pulls it with the other events. */
export async function recordVisit(db: D1Database, s: Session, awayMinutes: number | null): Promise<void> {
  const ev: Omit<SiteEvent, "seq"> = {
    kind: "visit",
    at: now(),
    webOrderId: "",
    buyer: { id: s.characterId, name: s.name, corporationId: s.corporationId, allianceId: s.allianceId },
    awayMinutes,
  };
  await db.prepare(`INSERT INTO events (kind, json, created_at) VALUES (?1, ?2, ?3)`).bind(ev.kind, JSON.stringify(ev), ev.at).run();
}
