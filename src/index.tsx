// A shop front for one EVE Console store. See README.md and docs/protocol.md.

import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "./env";
import { beginLogin, csrfOk, finishLogin, logout, safeNext, sessionMiddleware } from "./auth";
import { bannerHash, buyerTheme, ensureSchema, loadStore, saveBuyerTheme, storeLanguage, type StoreState } from "./db";
import { langOf, t, tell, type Lang } from "./i18n";
import { isAllowed, restrictedText } from "./policy";
import { cancelOrder, cancelWebOrder, ordersFor, pendingFor, pendingUnits, placeOrder, waitingFor } from "./orders";
import { allowanceFor, describeLimit, orderedByScope } from "./limits";

import { handleBanner, handleSync, handleVersion } from "./sync";
import { BANNER_PATH, SYNC_PATH, type Catalogue, type Listing, type Theme } from "./protocol";
import { pickTheme, themeOptions } from "./theme";
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
  const lang = langOf(store?.info.language);
  c.set("lang", lang);
  // A signed-in buyer's saved pick comes before this browser's cookie, so it follows them.
  const session = c.get("session");
  const saved = session ? await buyerTheme(c.env.DB, session.characterId) : null;
  const theme = pickTheme(store?.info.theme ?? fallbackTheme, saved ?? getCookie(c, "theme"), lang);
  return { store, lang, theme, session, flash: takeFlash(c), siteVersion: c.env.SITE_VERSION };
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

/** The answer to a form without the session's token. */
async function refused(c: Ctx): Promise<Response> {
  await ensureSchema(c.env.DB);
  return c.text(t(await storeLanguage(c.env.DB), "refused"), 403);
}

/** Reads the form and checks its token; null means the caller answers 403. */
async function signedForm(c: Ctx): Promise<FormData | null> {
  const session = c.get("session");
  if (!session) return null;
  const form = await c.req.formData();
  return csrfOk(session, form) ? form : null;
}

// ── Pages ─────────────────────────────────────────────────────────────────

/** Every Sell listing's items as one catalogue: what a purchase limit looks groups up in. */
function sellCatalogue(store: StoreState): Catalogue | null {
  const sell = store.listings.filter((l) => l.side !== "buy");
  if (sell.length === 0) return null;
  return { ...sell[0].catalogue, sections: sell.flatMap((l) => l.catalogue.sections) };
}

/** The listing a page or a form names by ?list= / postingId, or the store's first. */
function listingOf(store: StoreState, id: number): Listing | undefined {
  return store.listings.find((l) => l.id === id) ?? store.listings[0];
}

app.get("/", async (c) => {
  const { store, ...common } = await page(c);
  const { session, lang } = common;

  if (!store || store.listings.length === 0)
    return c.html(<Layout storeName={t(lang, "storeFallback")} active="none" {...common}>
      <Message title={t(lang, "notOpenTitle")} text={t(lang, "notOpenText")} />
    </Layout>);

  const allowed = session ? await isAllowed(c.env.DB, store.info, session) : false;
  if (store.info.senderPolicy === "list" && !allowed)
  {
    // A session whose character is not on the list — the list changed under them, or the
    // session predates the check at sign-in — ends here, with the same refusal sign-in gives.
    if (session) return refuse(c, store, session.name);
    return c.html(<Layout storeName={store.info.name} active="catalogue" {...common}>
      <Message title={store.info.name} text={t(lang, "listOnlyText")} link={{ href: "/auth/login", label: t(lang, "signIn") }} />
    </Layout>);
  }

  // The listing this page shows: a tab each, the first by default.
  const listing = listingOf(store, Number(c.req.query("list") ?? 0))!;
  const buying  = listing.side === "buy";

  // With a purchase limit, what this buyer has taken already decides what the list offers them.
  // Sell listings only: the limit is on what a buyer takes from the shelf.
  const limit = buying ? null : store.info.limit ?? null;
  const taken = limit && session && allowed
    ? orderedByScope(limit, sellCatalogue(store), await ordersFor(c.env.DB, session), await pendingFor(c.env.DB, session.characterId), session.characterId)
    : null;
  return c.html(<Layout storeName={store.info.name} active="catalogue" asOf={asOf(store)} {...common}>
    <CataloguePage lang={lang} store={store.info} listing={listing} listings={store.listings}
                   pending={await pendingUnits(c.env.DB)} session={session} allowed={allowed}
                   limit={limit} taken={taken} banner={await bannerHash(c.env.DB)} />
  </Layout>);

});

/** Ends the session and shows the refusal: the store serves a list and this character is not on it. */
async function refuse(c: Ctx, store: StoreState, characterName: string): Promise<Response> {
  await logout(c);
  const { store: _s, session: _session, ...common } = await page(c);
  return c.html(<Layout storeName={store.info.name} active="none" {...common} session={null}>
    <Message title={t(common.lang, "restrictedTitle")} text={tell(common.lang, restrictedText(store.info.name, characterName))} />
  </Layout>, 403);
}

app.get("/orders", async (c) => {
  const { store, ...common } = await page(c);
  const session = common.session;
  if (!session) return c.redirect("/auth/login?next=/orders");
  if (store && store.info.senderPolicy === "list" && !(await isAllowed(c.env.DB, store.info, session)))
    return refuse(c, store, session.name);
  return c.html(<Layout storeName={store?.info.name ?? t(common.lang, "storeFallback")} active="orders" asOf={asOf(store)} {...common}>
    <OrdersPage lang={common.lang} session={session} waiting={await waitingFor(c.env.DB, session.characterId)} orders={await ordersFor(c.env.DB, session)}
                buyAssignee={store?.info.buyAssignee ?? null} buyLocation={store?.info.buyLocation ?? null} />
  </Layout>);
});

// ── What a buyer does ─────────────────────────────────────────────────────

app.post("/orders", async (c) => {
  const session = c.get("session");
  if (!session) return c.redirect("/auth/login");
  const form = await signedForm(c);
  if (!form) return refused(c);

  await ensureSchema(c.env.DB);
  const store = await loadStore(c.env.DB);
  const lang = langOf(store?.info.language);
  if (!store || store.listings.length === 0) { flash(c, "bad", t(lang, "priceListUnavailable")); return c.redirect("/"); }
  if (!(await isAllowed(c.env.DB, store.info, session))) return c.redirect("/");

  const typeId = Number(form.get("typeId"));
  const units  = Number(form.get("units"));

  // The listing the form came from. A form from before listings names none, and meant the
  // store's first Sell listing — the only price list there was.
  const named   = Number(form.get("postingId") ?? 0);
  const listing = named > 0
    ? store.listings.find((l) => l.id === named)
    : store.listings.find((l) => l.side !== "buy");
  if (!listing) { flash(c, "bad", t(lang, "priceListUnavailable")); return c.redirect("/"); }
  const buying = listing.side === "buy";
  const back   = listing.id > 0 ? `/?list=${listing.id}` : "/";

  // An offer needs someone to make its contract out to; without one the store takes none.
  if (buying && !store.info.buyAssignee) { flash(c, "bad", t(lang, "buyNotTaking")); return c.redirect(back); }

  // The store's purchase limit, refused here as it would be refused by the app: the list greys
  // out what is over, but a form can be sent regardless. Not on an offer to sell.
  if (store.info.limit && !buying) {
    const limit = store.info.limit;
    const taken = orderedByScope(limit, sellCatalogue(store), await ordersFor(c.env.DB, session), await pendingFor(c.env.DB, session.characterId), session.characterId);
    const item  = listing.catalogue.sections.flatMap((x) => x.items).find((i) => i.typeId === typeId);
    const a     = allowanceFor(limit, taken, typeId, item?.groupId);
    if (units > a.remaining) {
      flash(c, "bad", a.remaining === 0
        ? t(lang, "limitReachedFlash", { limit: describeLimit(lang, limit) })
        : t(lang, "limitOverFlash", { limit: describeLimit(lang, limit), left: a.remaining, asked: units }));
      return c.redirect(back);
    }
  }

  // The mail question is only asked when the store has a mailbox; a form that never asked it
  // (no script, or no mailbox) means the default, which is yes.
  const asked = form.get("mailUpdatesAsked") != null;
  const mailUpdates = asked ? form.get("mailUpdates") != null : true;
  const r = await placeOrder(c.env.DB, session, listing,
    typeId, units, String(form.get("note") ?? ""), mailUpdates);


  if (r.ok) {
    flash(c, "good", buying ? t(lang, "offerSent", { myOrders: t(lang, "navMyOrders") }) : t(lang, "orderSent"));
    return c.redirect("/orders");
  }
  flash(c, "bad", tell(lang, r.reason));
  return c.redirect(back);
});

app.post("/orders/:id/cancel", async (c) => {
  const session = c.get("session");
  if (!session) return c.redirect("/auth/login");
  if (!(await signedForm(c))) return refused(c);
  const r = await cancelOrder(c.env.DB, session, Number(c.req.param("id")));
  const lang = await storeLanguage(c.env.DB);
  if (r.ok) flash(c, "info", t(lang, "cancellationSent")); else flash(c, "bad", tell(lang, r.reason));
  return c.redirect("/orders");
});

app.post("/web-orders/:id/cancel", async (c) => {
  const session = c.get("session");
  if (!session) return c.redirect("/auth/login");
  if (!(await signedForm(c))) return refused(c);
  const r = await cancelWebOrder(c.env.DB, session, c.req.param("id"));
  const lang = await storeLanguage(c.env.DB);
  if (r.ok) flash(c, "info", t(lang, "orderWithdrawn")); else flash(c, "bad", tell(lang, r.reason));
  return c.redirect("/orders");
});

app.post("/theme", async (c) => {
  const form = await c.req.formData();
  const to = String(form.get("to"));
  await ensureSchema(c.env.DB);
  const theme = (await loadStore(c.env.DB))?.info.theme ?? fallbackTheme;
  if (themeOptions(theme).some((o) => o.key === to)) {
    setCookie(c, "theme", to, { path: "/", sameSite: "Lax", maxAge: 365 * 86_400, secure: isHttps(c) });
    // Kept by character too, so the pick follows a signed-in buyer to any browser.
    const session = c.get("session");
    if (session) await saveBuyerTheme(c.env.DB, session.characterId, to);
  }
  const referer = c.req.header("Referer");
  return c.redirect(safeNext(referer ? new URL(referer).pathname : "/"));
});

// ── Sign-in ───────────────────────────────────────────────────────────────

app.get("/auth/login", async (c) => {
  // Without an EVE application there is nowhere to send the buyer; say so here rather than let
  // EVE answer "client could not be found" for an id of undefined.
  if (!c.env.EVE_CLIENT_ID || !c.env.EVE_CLIENT_SECRET) {
    const { store, ...common } = await page(c);
    return c.html(<Layout storeName={store?.info.name ?? t(common.lang, "storeFallback")} active="none" {...common}>
      <Message title={t(common.lang, "ssoNotSetUpTitle")} text={t(common.lang, "ssoNotSetUpText")} />
    </Layout>, 503);
  }
  return beginLogin(c);
});


app.get("/auth/callback", async (c) => {
  const result = await finishLogin(c);
  if (result.ok) return c.redirect(result.next);
  const { store, ...common } = await page(c);
  const lang = common.lang;
  const storeName = store?.info.name ?? t(lang, "storeFallback");
  if (result.restricted)
    return c.html(<Layout storeName={storeName} active="none" {...common}>
      <Message title={t(lang, "restrictedTitle")} text={tell(lang, result.reason)} />
    </Layout>, 403);
  return c.html(<Layout storeName={storeName} active="none" {...common}>
    <Message title={t(lang, "ssoFailedTitle")} text={tell(lang, result.reason)} link={{ href: "/auth/login", label: t(lang, "tryAgain") }} />
  </Layout>, 400);
});

app.post("/auth/logout", async (c) => {
  if (c.get("session") && !(await signedForm(c))) return refused(c);
  await logout(c);
  return c.redirect("/");
});

app.onError((err, c) => {
  console.error(err);
  // The app shows the reason on its Stores screen; a buyer gets a plain page.
  if (c.req.path.startsWith("/api/")) return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  return c.text(t(c.get("lang") ?? "en", "siteError"), 500);
});


function asOf(store: StoreState | null): string | null {
  const at = store?.catalogue?.asOf ?? store?.pushedAt;
  return at ? at.slice(0, 16).replace("T", " ") : null;
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
