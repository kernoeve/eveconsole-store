// Who the store serves: the same rule EVE Console applies to a mail's sender, applied to a
// signed-in character. "anyone" serves everyone; "list" serves the entries the app pushed, by
// the character's own id or through their corporation or alliance.

import type { Session } from "./env";
import type { StoreInfo } from "./protocol";

export async function isAllowed(db: D1Database, store: StoreInfo, s: Session): Promise<boolean> {
  if (store.senderPolicy === "anyone") return true;
  const rows = await db.prepare(
    `SELECT 1 AS hit FROM allowed
      WHERE (kind = 'character' AND id = ?1)
         OR (kind = 'corporation' AND id = ?2)
         OR (kind = 'alliance' AND ?3 IS NOT NULL AND id = ?3)
      LIMIT 1`,
  ).bind(s.characterId, s.corporationId, s.allianceId).first();
  return !!rows;
}
