export interface Bindings {
  DB: D1Database;
  /** Shared with EVE Console; the HMAC key for every sync call. Never sent, never logged. */
  STORE_SYNC_SECRET: string;
  /** The EVE developer application registered for this site, callback /auth/callback. */
  EVE_CLIENT_ID: string;
  EVE_CLIENT_SECRET: string;
  SITE_VERSION: string;
}

export interface Session {
  id: string;
  characterId: number;
  name: string;
  corporationId: number;
  allianceId: number | null;
  csrf: string;
}

export type Variables = {
  session: Session | null;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
