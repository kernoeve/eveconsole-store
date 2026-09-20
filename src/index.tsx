// A shop front for one EVE Console store. See README.md and docs/protocol.md.

import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "./env";
import { beginLogin, csrfOk, finishLogin, logout, safeNext, sessionMiddleware } from "./auth";
import { bannerHash, ensureSchema, loadStore, type StoreState } from "./db";
import { isAllowed } from "./policy";
import { cancelOrder, cancelWebOrder, ordersFor, pendingFor, pendingUnits, placeOrder, waitingFor } from "./orders";
import { allowanceFor, describeLimit, orderedByScope } from "./limits";

import { handleBanner, handleSync, handleVersion } from "./sync";
import { BANNER_PATH, SYNC_PATH, type Theme } from "./protocol";
import { pickVariant } from "./theme";
import { Layout, Message, type Flash } from "./views/layout";
import { CataloguePage, OrdersPage } from "./views/pages";

const app = new Hono<AppEnv>();
type Ctx = Context<AppEnv>;

// ── The app's endpoints: no session, no cookies, only the signature ──
app.post(SYNC_PATH, handleSync);
app.put(BANNER_PATH, handleBanner);
app.get("/api/version", handleVersion);

// The banner, for the page's <img>: public, no session, cached for good when the page names the
// exact version (?v=hash) and briefly otherwise.
app.get("/banner", async (c) => {
  await ensureSchema(c.env.DB);
  const row = await c.env.DB.prepare(`SELECT content_type, sha256, bytes FROM assets WHERE kind = 'banner'`)
    .first<{ content_type: string; sha256: string; bytes: ArrayBuffer | number[] }>();
  if (!row) return c.notFound();
  // A BLOB is an ArrayBuffer from D1 itself and an array of numbers from the local runtime.
  const bytes = row.bytes instanceof ArrayBuffer ? new Uint8Array(row.bytes) : Uint8Array.from(row.bytes);
  const etag = `"${row.sha256}"`;
  if (c.req.header("If-None-Match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
  const pinned = c.req.query("v") === row.sha256;
  return new Response(bytes, {
    headers: { "Content-Type": row.content_type, ETag: etag, "Cache-Control": pinned ? "public, max-age=31536000, immutable" : "public, max-age=300" },
  });
});

// ── Everything else is for buyers ──
app.use("*", sessionMiddleware);

/** What every page needs: the store as the app last pushed it, the theme for this request,
 * the session, and any message left for this page by the last POST. */
async function page(c: Ctx) {
  await ensureSchema(c.env.DB);
  const store = await loadStore(c.env.DB);
  const theme: Theme = store?.info.theme ?? fallbackTheme;
  const { variant, explicit } = pickVariant(theme, getCookie(c, "theme"));
  return { store, theme, variant, explicit, session: c.get("session"), flash: takeFlash(c), siteVersion: c.env.SITE_VERSION };
}

// A one-shot message travels in a short-lived cookie, never in the URL: nobody can craft a
// link that makes the site show a message of their own.
const FLASH_COOKIE = "flash";
const isHttps = (c: Ctx) => new URL(c.req.url).protocol === "https:";

function flash(c: Ctx, kind: Flash["kind"], text: string): void {
  setCookie(c, FLASH_COOKIE, JSON.stringify({ kind, text }), { path: "/", httpOnly: true, sameSite: "Lax", maxAge: 60, secure: isHttps(c) });
}

function takeFlash(c: Ctx): Flash | null {
  const raw = getCookie(c, FLASH_COOKIE);
  if (!raw) return null;
  deleteCookie(c, FLASH_COOKIE, { path: "/" });
  try {
    const f = JSON.parse(raw) as Partial<Flash>;
    if ((f.kind === "good" || f.kind === "bad" || f.kind === "info") && typeof f.text === "string")
      return { kind: f.kind, text: f.text.slice(0, 300) };
  } catch { /* not a message of ours */ }
  return null;
}

/** Reads the form and checks its token; null means the caller answers 403. */
async function signedForm(c: Ctx): Promise<FormData | null> {
  const session = c.get("session");
  if (!session) return null;
  const form = await c.req.formData();
  return csrfOk(session, form) ? form : null;
}

// ── Pages ─────────────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const { store, ...common } = await page(c);
  const session = common.session;

  if (!store?.catalogue)
    return c.html(<Layout storeName="Store" active="none" {...common}>
      <Message title="Not open yet" text="This site has not heard from its store's EVE Console yet. Once the store's web channel is switched on, the price list appears here." />
    </Layout>);

  const allowed = session ? await isAllowed(c.env.DB, store.info, session) : false;
  if (store.info.senderPolicy === "list" && !allowed)
    return c.html(<Layout storeName={store.info.name} active="catalogue" {...common}>
      {session
        ? <Message title="A private shop" text={`${store.info.name} serves a list of buyers, and ${session.name} is not on it.`} />
        : <Message title={store.info.name} text="This shop serves a list of buyers. Sign in with EVE to see whether you are on it." link={{ href: "/auth/login", label: "Sign in with EVE" }} />}
    </Layout>);

  // With a purchase limit, what this buyer has taken already decides what the list offers them.
  const limit = store.info.limit ?? null;
  const taken = limit && session && allowed
    ? orderedByScope(limit, store.catalogue, await ordersFor(c.env.DB, session), await pendingFor(c.env.DB, session.characterId), session.characterId)
    : null;
  return c.html(<Layout storeName={store.info.name} active="catalogue" asOf={asOf(store)} {...common}>
    <CataloguePage store={store.info} catalogue={store.catalogue} pending={await pendingUnits(c.env.DB)} session={session} allowed={allowed}
                   limit={limit} taken={taken} banner={await bannerHash(c.env.DB)} />
  </Layout>);

});

app.get("/orders", async (c) => {
  const { store, ...common } = await page(c);
  const session = common.session;
  if (!session) return c.redirect("/auth/login?next=/orders");
  return c.html(<Layout storeName={store?.info.name ?? "Store"} active="orders" asOf={asOf(store)} {...common}>
    <OrdersPage session={session} waiting={await waitingFor(c.env.DB, session.characterId)} orders={await ordersFor(c.env.DB, session)} />
  </Layout>);
});

// ── What a buyer does ─────────────────────────────────────────────────────

app.post("/orders", async (c) => {
  const session = c.get("session");
  if (!session) return c.redirect("/auth/login");
  const form = await signedForm(c);
  if (!form) return c.text("Refused.", 403);

  await ensureSchema(c.env.DB);
  const store = await loadStore(c.env.DB);
  if (!store?.catalogue) { flash(c, "bad", "The price list is not available."); return c.redirect("/"); }
  if (!(await isAllowed(c.env.DB, store.info, session))) return c.redirect("/");

  const typeId = Number(form.get("typeId"));
  const units  = Number(form.get("units"));

  // The store's purchase limit, refused here as it would be refused by the app: the list greys
  // out what is over, but a form can be sent regardless.
  if (store.info.limit) {
    const limit = store.info.limit;
    const taken = orderedByScope(limit, store.catalogue, await ordersFor(c.env.DB, session), await pendingFor(c.env.DB, session.characterId), session.characterId);
    const item  = store.catalogue.sections.flatMap((x) => x.items).find((i) => i.typeId === typeId);
    const a     = allowanceFor(limit, taken, typeId, item?.groupId);
    if (units > a.remaining) {
      flash(c, "bad", a.remaining === 0
        ? `You have reached this store's limit for that item: ${describeLimit(limit)}.`
        : `This store limits each buyer to ${describeLimit(limit)}; you may order ${a.remaining.toLocaleString("en-US")} more, not ${units.toLocaleString("en-US")}.`);
      return c.redirect("/");
    }
  }

  // The mail question is only asked when the store has a mailbox; a form that never asked it
  // (no script, or no mailbox) means the default, which is yes.
  const asked = form.get("mailUpdatesAsked") != null;
  const mailUpdates = asked ? form.get("mailUpdates") != null : true;
  const r = await placeOrder(c.env.DB, session, store.catalogue, store.catalogueHash,
    typeId, units, String(form.get("note") ?? ""), mailUpdates);


  if (r.ok) {
    flash(c, "good", "Order sent to the store. It is confirmed once the store's system has taken it, usually within a couple of minutes.");
    return c.redirect("/orders");
  }
  flash(c, "bad", r.reason);
  return c.redirect("/");
});

app.post("/orders/:id/cancel", async (c) => {
  const session = c.get("session");
  if (!session) return c.redirect("/auth/login");
  if (!(await signedForm(c))) return c.text("Refused.", 403);
  const r = await cancelOrder(c.env.DB, session, Number(c.req.param("id")));
  if (r.ok) flash(c, "info", "Cancellation sent to the store."); else flash(c, "bad", r.reason);
  return c.redirect("/orders");
});

app.post("/web-orders/:id/cancel", async (c) => {
  const session = c.get("session");
  if (!session) return c.redirect("/auth/login");
  if (!(await signedForm(c))) return c.text("Refused.", 403);
  const r = await cancelWebOrder(c.env.DB, session, c.req.param("id"));
  if (r.ok) flash(c, "info", "Order withdrawn."); else flash(c, "bad", r.reason);
  return c.redirect("/orders");
});

app.post("/theme", async (c) => {
  const form = await c.req.formData();
  const to = String(form.get("to"));
  await ensureSchema(c.env.DB);
  const theme = (await loadStore(c.env.DB))?.info.theme ?? fallbackTheme;
  if (theme.buyerMaySwitch && (to === "dark" || to === "light"))
    setCookie(c, "theme", to, { path: "/", sameSite: "Lax", maxAge: 365 * 86_400, secure: isHttps(c) });
  const referer = c.req.header("Referer");
  return c.redirect(safeNext(referer ? new URL(referer).pathname : "/"));
});

// ── Sign-in ───────────────────────────────────────────────────────────────

app.get("/auth/login", async (c) => {
  // Without an EVE application there is nowhere to send the buyer; say so here rather than let
  // EVE answer "client could not be found" for an id of undefined.
  if (!c.env.EVE_CLIENT_ID || !c.env.EVE_CLIENT_SECRET) {
    const { store, ...common } = await page(c);
    return c.html(<Layout storeName={store?.info.name ?? "Store"} active="none" {...common}>
      <Message title="Sign-in is not set up yet"
               text="This site has no EVE application keys. The store's owner enters the application's Client ID and Secret Key in EVE Console (Stores, Config, EVE application), or sets them as the site's EVE_CLIENT_ID and EVE_CLIENT_SECRET secrets." />
    </Layout>, 503);
  }
  return beginLogin(c);
});


app.get("/auth/callback", async (c) => {
  const result = await finishLogin(c);
  if (result.ok) return c.redirect(result.next);
  const { store, ...common } = await page(c);
  return c.html(<Layout storeName={store?.info.name ?? "Store"} active="none" {...common}>
    <Message title="Sign-in did not complete" text={result.reason} link={{ href: "/auth/login", label: "Try again" }} />
  </Layout>, 400);
});

app.post("/auth/logout", async (c) => {
  if (c.get("session") && !(await signedForm(c))) return c.text("Refused.", 403);
  await logout(c);
  return c.redirect("/");
});

app.onError((err, c) => {
  console.error(err);
  // The app shows the reason on its Stores screen; a buyer gets a plain page.
  if (c.req.path.startsWith("/api/")) return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  return c.text("Something went wrong on the site. The store's owner can see why in Cloudflare's logs.", 500);
});


function asOf(store: StoreState | null): string | null {
  const t = store?.catalogue?.asOf ?? store?.pushedAt;
  return t ? t.slice(0, 16).replace("T", " ") + " EVE time" : null;
}

/** Before the first push there is no theme yet; the app's own dark palette stands in. */
const fallbackTheme: Theme = {
  key: "dark", buyerMaySwitch: false, default: "dark",
  variants: {
    dark: {
      "surface-base": "#14141c", "surface-panel": "#1b1b25", "surface-panel-alt": "#1f1f2b", "surface-header": "#25252f",
      "surface-raised": "#2c2c3a", "surface-input": "#191922", "surface-hover": "#2a2a38", "surface-selected": "#26304a",
      "border-subtle": "#2a2a36", "border-default": "#36364a", "border-strong": "#454560",
      "text-faint": "#6b6b80", "text-dim": "#7c7c92", "text-muted": "#9a9ab0", "text-secondary": "#b6b6cc",
      "text-primary": "#d2d2e2", "text-bright": "#eeeef6",
      "accent": "#c8a84b", "accent-hover": "#dcc06a", "accent-pressed": "#a88a34", "accent-surface": "#3a3020",
      "accent-deep": "#886810", "accent-pale": "#e8d898",
      "good": "#6aba90", "bad": "#c85555", "warn": "#d09050", "info": "#5fa8bc",
      "good-surface": "#1c3028", "bad-surface": "#3a1e1e", "warn-surface": "#33260f", "info-surface": "#22323c",
      "surface-overlay": "#cc1b1b25", "surface-overlay-strong": "#f0161620",
    },
  },
};

export default app;
