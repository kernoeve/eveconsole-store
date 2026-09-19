// Sign-in with EVE SSO, and the session that follows it.
//
// The character in the token is the only identity the site ever uses. PKCE and a state
// parameter guard the redirect; the token's signature is checked against EVE's published keys
// along with issuer, audience and expiry; the character's corporation and alliance come from
// ESI's public affiliation endpoint, since a private shop may list either. Sessions are rows in
// D1 behind a secure, HTTP-only, same-site cookie, and every form carries a second token so a
// cross-site request cannot order or cancel.

import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv, Session } from "./env";
import { base64url, base64urlDecode, randomToken, sha256Hex } from "./crypto";
import { ensureSchema, now } from "./db";

const SSO_AUTHORIZE = "https://login.eveonline.com/v2/oauth/authorize/";
const SSO_TOKEN     = "https://login.eveonline.com/v2/oauth/token";
const SSO_JWKS      = "https://login.eveonline.com/oauth/jwks";
const SSO_ISSUERS   = ["login.eveonline.com", "https://login.eveonline.com"];
const ESI_AFFILIATION = "https://esi.evetech.net/latest/characters/affiliation/";
export const USER_AGENT = "eveconsole-store (+https://github.com/kernoeve/eveconsole-store)";

export const SESSION_COOKIE = "sid";
const SESSION_DAYS   = 14;
const STATE_MINUTES  = 10;
const TOUCH_SECONDS  = 60;

function secure(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === "https:";
}

function callbackUrl(c: Context<AppEnv>): string {
  return new URL("/auth/callback", c.req.url).toString();
}

/** A safe "where to go after": a path on this site, nothing else. */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

// ── Login ─────────────────────────────────────────────────────────────────

export async function beginLogin(c: Context<AppEnv>): Promise<Response> {
  await ensureSchema(c.env.DB);
  const state    = randomToken(16);
  const verifier = randomToken(32);
  const challenge = base64url(await sha256Bytes(verifier));
  await c.env.DB.prepare(`INSERT INTO oauth_states (state, verifier, next, created_at) VALUES (?1, ?2, ?3, ?4)`)
    .bind(state, verifier, safeNext(c.req.query("next")), now()).run();

  const url = new URL(SSO_AUTHORIZE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", callbackUrl(c));
  url.searchParams.set("client_id", c.env.EVE_CLIENT_ID);
  url.searchParams.set("scope", "");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return c.redirect(url.toString(), 302);
}

async function sha256Bytes(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

export interface LoginResult {
  ok: true;
  session: Session;
  next: string;
}
export interface LoginFailure {
  ok: false;
  reason: string;
}

/** The callback half: code to token, token to character, character to session. */
export async function finishLogin(c: Context<AppEnv>): Promise<LoginResult | LoginFailure> {
  const db = c.env.DB;
  await ensureSchema(db);

  const code  = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return { ok: false, reason: "EVE did not send a code back." };

  const pending = await db.prepare(`SELECT verifier, next, created_at FROM oauth_states WHERE state = ?1`)
    .bind(state).first<{ verifier: string; next: string; created_at: string }>();
  await db.prepare(`DELETE FROM oauth_states WHERE state = ?1 OR created_at < ?2`)
    .bind(state, new Date(Date.now() - STATE_MINUTES * 60_000).toISOString()).run();
  if (!pending || Date.parse(pending.created_at) < Date.now() - STATE_MINUTES * 60_000)
    return { ok: false, reason: "The sign-in took too long or was started elsewhere. Try again." };

  // Code to token. The client secret goes in the Basic header; the verifier proves this is
  // the browser that started the flow.
  const tokenResponse = await fetch(SSO_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + btoa(`${c.env.EVE_CLIENT_ID}:${c.env.EVE_CLIENT_SECRET}`),
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: pending.verifier }),
  });
  if (!tokenResponse.ok) return { ok: false, reason: `EVE refused the sign-in (${tokenResponse.status}).` };
  const token = await tokenResponse.json<{ access_token?: string }>();
  if (!token.access_token) return { ok: false, reason: "EVE sent no token." };

  const claims = await verifyJwt(token.access_token, c.env.EVE_CLIENT_ID);
  if (!claims) return { ok: false, reason: "The token from EVE did not verify." };

  const characterId = Number(String(claims.sub).split(":").pop());
  const name = String(claims.name ?? "");
  if (!Number.isFinite(characterId) || characterId <= 0) return { ok: false, reason: "The token names no character." };

  const affiliation = await fetchAffiliation(characterId);

  const session: Session = {
    id: randomToken(24),
    characterId,
    name,
    corporationId: affiliation?.corporationId ?? 0,
    allianceId: affiliation?.allianceId ?? null,
    csrf: randomToken(16),
  };
  const created = now();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
  await db.prepare(
    `INSERT INTO sessions (id, character_id, name, corp_id, alliance_id, csrf, created_at, expires_at, last_seen_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?7)`,
  ).bind(session.id, characterId, name, session.corporationId, session.allianceId, session.csrf, created, expires).run();

  setCookie(c, SESSION_COOKIE, session.id, {
    httpOnly: true, secure: secure(c), sameSite: "Lax", path: "/", maxAge: SESSION_DAYS * 86_400,
  });
  return { ok: true, session, next: safeNext(pending.next) };
}

export async function logout(c: Context<AppEnv>): Promise<void> {
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ?1`).bind(sid).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

// ── Sessions ──────────────────────────────────────────────────────────────

/** Loads the session behind the cookie, if any, and keeps its last-seen time fresh. */
export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("session", null);
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) {
    await ensureSchema(c.env.DB);
    const ts = now();
    const row = await c.env.DB.prepare(
      `SELECT id, character_id, name, corp_id, alliance_id, csrf, last_seen_at FROM sessions WHERE id = ?1 AND expires_at > ?2`,
    ).bind(sid, ts).first<{ id: string; character_id: number; name: string; corp_id: number; alliance_id: number | null; csrf: string; last_seen_at: string }>();
    if (row) {
      c.set("session", { id: row.id, characterId: row.character_id, name: row.name, corporationId: row.corp_id, allianceId: row.alliance_id, csrf: row.csrf });
      // Touched at most once a minute: it feeds the app's "somebody is here" signal, not an audit.
      if (Date.parse(row.last_seen_at) < Date.now() - TOUCH_SECONDS * 1000)
        c.executionCtx.waitUntil(c.env.DB.prepare(`UPDATE sessions SET last_seen_at = ?2 WHERE id = ?1`).bind(sid, ts).run());
    } else {
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
    }
  }
  await next();
};

/** True when the form's token is the session's. Every state-changing POST checks this first. */
export function csrfOk(session: Session, form: FormData): boolean {
  const given = form.get("_csrf");
  return typeof given === "string" && given.length > 0 && given === session.csrf;
}

// ── The token ─────────────────────────────────────────────────────────────

interface Jwk { kid?: string; kty: string; alg?: string; n?: string; e?: string; crv?: string; x?: string; y?: string }
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

async function jwks(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < 3_600_000) return jwksCache.keys;
  const r = await fetch(SSO_JWKS, { headers: { "User-Agent": USER_AGENT } });
  if (!r.ok) throw new Error(`JWKS ${r.status}`);
  const doc = await r.json<{ keys: Jwk[] }>();
  jwksCache = { keys: doc.keys, fetchedAt: Date.now() };
  return doc.keys;
}

interface Claims { sub: string; name?: string; iss: string; aud: string | string[]; exp: number }

/**
 * Verifies an EVE SSO access token and returns its claims, or null.
 *
 * RS256 and ES256 both appear on EVE's key set; the key is picked by kid. The audience must
 * include this site's client id — a token issued to another application is not a sign-in here.
 */
export async function verifyJwt(token: string, clientId: string): Promise<Claims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const header = JSON.parse(new TextDecoder().decode(base64urlDecode(h))) as { alg: string; kid?: string };
  const keys = await jwks();
  const jwk = keys.find((k) => k.kid === header.kid) ?? keys.find((k) => k.alg === header.alg);
  if (!jwk) return null;

  const data = new TextEncoder().encode(`${h}.${p}`);
  const sig  = base64urlDecode(s);
  let ok = false;
  if (header.alg === "RS256" && jwk.kty === "RSA") {
    const key = await crypto.subtle.importKey("jwk", jwk as JsonWebKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
  } else if (header.alg === "ES256" && jwk.kty === "EC") {
    const key = await crypto.subtle.importKey("jwk", jwk as JsonWebKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, data);
  }
  if (!ok) return null;

  const claims = JSON.parse(new TextDecoder().decode(base64urlDecode(p))) as Claims;
  if (!claims.exp || claims.exp * 1000 < Date.now()) return null;
  if (!SSO_ISSUERS.includes(claims.iss)) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) return null;
  return claims;
}

async function fetchAffiliation(characterId: number): Promise<{ corporationId: number; allianceId: number | null } | null> {
  try {
    const r = await fetch(ESI_AFFILIATION, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT, "X-Compatibility-Date": "2026-08-01" },
      body: JSON.stringify([characterId]),
    });
    if (!r.ok) return null;
    const rows = await r.json<{ character_id: number; corporation_id: number; alliance_id?: number }[]>();
    const row = rows.find((x) => x.character_id === characterId);
    return row ? { corporationId: row.corporation_id, allianceId: row.alliance_id ?? null } : null;
  } catch {
    return null;
  }
}
