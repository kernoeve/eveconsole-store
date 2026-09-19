// Small crypto helpers over WebCrypto: the sync signature, ids, hashes.

const enc = new TextEncoder();

export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (const b of view) out += b.toString(16).padStart(2, "0");
  return out;
}

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
}

/** 26 characters of lower-case base32: sortable enough, unguessable, safe in a URL. */
export function newId(): string {
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const t = Date.now();
  let out = "";
  for (let i = 9; i >= 0; i--) out += alphabet[Math.floor(t / Math.pow(32, i)) % 32];
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i] % 32];
  return out;
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** The signature EVE Console puts on a sync call: v1= + hex HMAC-SHA256 over ts + "\n" + body. */
export async function signSync(secret: string, timestamp: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prefix = enc.encode(timestamp + "\n");
  const data = new Uint8Array(prefix.length + body.length);
  data.set(prefix, 0);
  data.set(body, prefix.length);
  return "v1=" + bytesToHex(await crypto.subtle.sign("HMAC", key, data));
}

const WINDOW_SECONDS = 5 * 60;

/** Whether a sync call is EVE Console's: right secret, and a timestamp within the window. */
export async function verifySync(
  secret: string, timestamp: string | undefined, signature: string | undefined,
  body: Uint8Array, nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > WINDOW_SECONDS) return false;
  const expected = await signSync(secret, timestamp, body);
  return timingSafeEqual(expected, signature);
}

export function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
