import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import app from "../src/index";
import { sha256Hex, signSync, verifySync } from "../src/crypto";

import { PROTOCOL, SIGNATURE_HEADER, TIMESTAMP_HEADER, type SyncRequest, type SyncResponse } from "../src/protocol";
import { ensureSchema } from "../src/db";
import { placeOrder, cancelOrder } from "../src/orders";
import { isAllowed } from "../src/policy";
import type { Session } from "../src/env";
import { periodStart } from "../src/limits";


const SECRET = "test-secret-do-not-use";
const enc = new TextEncoder();

async function sync(body: SyncRequest, secret = SECRET, ts = Math.floor(Date.now() / 1000)): Promise<Response> {
  const bytes = enc.encode(JSON.stringify(body));
  const sig = await signSync(secret, String(ts), bytes);
  return app.request("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", [TIMESTAMP_HEADER]: String(ts), [SIGNATURE_HEADER]: sig },
    body: bytes,
  }, env);
}

const catalogue = {
  hash: "abc", asOf: "2026-09-19T20:00:00Z",
  showInStock: true, showInBuild: true, showReserved: true, showCompletionDate: false,
  colourByState: false,
  sections: [{ name: "Hulls", items: [
    { typeId: 2001, name: "Widget", typeName: "Widget", groupName: "Titan", unitPrice: 1_100_000, inStock: 3, inBuild: 0, reserved: 1 },
    { typeId: 2002, name: "Gadget", typeName: "Gadget", unitPrice: null, inStock: 0, inBuild: 0, reserved: 0 },
  ] }],
};

function push(over: Partial<SyncRequest> = {}): SyncRequest {
  return {
    protocol: PROTOCOL, appVersion: "test", cursor: 0, generation: "",
    store: { name: "Test Shop", senderPolicy: "list", allowed: [{ id: 2118000001, kind: "character", name: "Some Buyer" }],
             theme: { key: "dark", buyerMaySwitch: true, default: "dark", variants: { dark: { "surface-base": "#14141c" }, light: { "surface-base": "#e2e0e8" } } } },
    catalogue, orders: [], removed: [], webOrders: [],
    ...over,
  };
}

const buyer: Session = { id: "s1", characterId: 2118000001, name: "Some Buyer", corporationId: 98000001, allianceId: null, csrf: "x" };
const stranger: Session = { id: "s2", characterId: 2118000002, name: "A Stranger", corporationId: 98000002, allianceId: null, csrf: "y" };

describe("the limit's period", () => {
  it("steps the calendar for months and years, and has no start for all time", () => {
    const now = new Date("2026-03-31T12:00:00Z");
    expect(periodStart({ units: 1, scope: "type", period: "days", count: 30 }, now)?.toISOString()).toBe("2026-03-01T12:00:00.000Z");
    expect(periodStart({ units: 1, scope: "type", period: "months", count: 1 }, now)?.toISOString()).toBe("2026-03-03T12:00:00.000Z");
    expect(periodStart({ units: 1, scope: "type", period: "years", count: 2 }, now)?.toISOString()).toBe("2024-03-31T12:00:00.000Z");
    expect(periodStart({ units: 1, scope: "type", period: "all", count: 1 }, now)).toBeNull();
  });
});

describe("signing", () => {

  it("matches the vector EVE Console's signer produces (openssl)", async () => {
    expect(await signSync(SECRET, "1700000000", enc.encode('{"a":1}')))
      .toBe("v1=5f8bf2fc50ad4097f6e84a0c2765157b0606bcea123e2aa72071f4986db11641");
  });

  it("verifies its own signature and refuses a stale timestamp or a wrong secret", async () => {
    const body = enc.encode("{}");
    const sig = await signSync(SECRET, "1700000000", body);
    expect(await verifySync(SECRET, "1700000000", sig, body, 1700000010)).toBe(true);
    expect(await verifySync(SECRET, "1700000000", sig, body, 1700000000 + 600)).toBe(false);
    expect(await verifySync("other", "1700000000", sig, body, 1700000010)).toBe(false);
  });
});

describe("the sync call", () => {
  it("refuses a bad signature with 401 and the wrong protocol with 409", async () => {
    expect((await sync(push(), "wrong")).status).toBe(401);
    const r = await sync(push({ protocol: 99 }));
    expect(r.status).toBe(409);
    expect((await r.json<{ protocol: number }>()).protocol).toBe(PROTOCOL);
  });

  it("stores the push, mints a generation, and reports it", async () => {
    const r = await sync(push({ orders: [{ id: 41, ref: "K7P2QX", buyerId: 2118000001, buyerType: "character", typeId: 2001, units: 1, totalPrice: 1_100_000, status: "pending", createdAt: "2026-09-19T00:00:00Z" }] }));
    expect(r.status).toBe(200);
    const body = await r.json<SyncResponse>();
    expect(body.protocol).toBe(PROTOCOL);
    expect(body.generation.length).toBeGreaterThan(0);
    expect(body.ordersApplied).toEqual([41]);
    expect(body.catalogueHash).toBe("abc");
    expect(body.needsFullOrders).toBe(false);

    const page = await app.request("/api/version", {}, env);
    expect((await page.json<{ generation: string }>()).generation).toBe(body.generation);
  });

  it("applies the sender policy to a signed-in character", async () => {
    await sync(push());
    await ensureSchema(env.DB);
    const store = { name: "Test Shop", senderPolicy: "list" as const, allowed: [], theme: push().store.theme };
    expect(await isAllowed(env.DB, store, buyer)).toBe(true);
    expect(await isAllowed(env.DB, store, stranger)).toBe(false);
    expect(await isAllowed(env.DB, { ...store, senderPolicy: "anyone" }, stranger)).toBe(true);
  });

  it("hands a placed order back as an event, prices it from the catalogue, and marks it booked when the app's row arrives", async () => {
    const first = await (await sync(push())).json<SyncResponse>();
    const placed = await placeOrder(env.DB, buyer, catalogue, "abc", 2001, 2, "no rush", true);
    expect(placed.ok).toBe(true);
    const id = placed.ok ? placed.id! : "";

    const r = await (await sync(push({ generation: first.generation }))).json<SyncResponse>();
    const ev = r.events.find((e) => e.webOrderId === id);
    expect(ev).toBeDefined();
    expect(ev!.kind).toBe("order");
    expect(ev!.lines).toEqual([{ typeId: 2001, units: 2, unitPrice: 1_100_000 }]);
    expect(ev!.buyer.id).toBe(2118000001);
    expect(ev!.catalogueHash).toBe("abc");

    // Acknowledged by the cursor: it is not sent again, and it is pruned.
    const again = await (await sync(push({ generation: first.generation, cursor: ev!.seq }))).json<SyncResponse>();
    expect(again.events.find((e) => e.seq === ev!.seq)).toBeUndefined();

    // The app booked it: its row names the web order and the web order reads as booked.
    await sync(push({ generation: first.generation, cursor: ev!.seq, orders: [
      { id: 42, ref: "AB12CD", webOrderId: id, buyerId: 2118000001, buyerType: "character", typeId: 2001, units: 2, totalPrice: 2_200_000, status: "pending", fulfilment: "stock", createdAt: "2026-09-19T00:00:00Z" },
    ] }));
    const row = await env.DB.prepare(`SELECT state, app_ref FROM web_orders WHERE id = ?1`).bind(id).first<{ state: string; app_ref: string }>();
    expect(row).toEqual({ state: "booked", app_ref: "AB12CD" });
  });

  it("refuses to order what is not priced, more than the bound, or by the wrong person", async () => {
    await sync(push());
    expect((await placeOrder(env.DB, buyer, catalogue, "abc", 2002, 1, "", true)).ok).toBe(false);
    expect((await placeOrder(env.DB, buyer, catalogue, "abc", 9999, 1, "", true)).ok).toBe(false);
    expect((await placeOrder(env.DB, buyer, catalogue, "abc", 2001, 10_001, "", true)).ok).toBe(false);
    expect((await placeOrder(env.DB, buyer, catalogue, "abc", 2001, 0, "", true)).ok).toBe(false);

    await sync(push({ orders: [{ id: 43, ref: "ZZ", buyerId: 2118000001, buyerType: "character", typeId: 2001, units: 1, totalPrice: 1, status: "pending", createdAt: "2026-09-19T00:00:00Z" }] }));
    expect((await cancelOrder(env.DB, stranger, 43)).ok).toBe(false);
    expect((await cancelOrder(env.DB, buyer, 43)).ok).toBe(true);
  });

  it("marks a web order held or declined from the app's word, and clears it when the app removes the row", async () => {
    const first = await (await sync(push())).json<SyncResponse>();
    const placed = await placeOrder(env.DB, buyer, catalogue, "abc", 2001, 1, "", true);
    const id = placed.ok ? placed.id! : "";
    await sync(push({ generation: first.generation, webOrders: [{ webOrderId: id, state: "rejected", reason: "Type not on the list." }] }));
    const row = await env.DB.prepare(`SELECT state, reason FROM web_orders WHERE id = ?1`).bind(id).first<{ state: string; reason: string }>();
    expect(row).toEqual({ state: "rejected", reason: "Type not on the list." });
  });
});

describe("pages", () => {
  it("shows the not-open page before any push, and a sign-in prompt for a private shop after", async () => {
    // A fresh isolate may or may not have seen a push from another test; both answers are pages.
    const home = await app.request("/", {}, env);
    expect(home.status).toBe(200);
    const text = await home.text();
    expect(text).toMatch(/Not open yet|Sign in with EVE|private shop/);
    expect(text).toContain("--surface-base");
  });

  it("says so, rather than sending anyone to EVE, while the site has no application keys", async () => {
    const r = await app.request("/auth/login", {}, { ...env, EVE_CLIENT_ID: "" });
    expect(r.status).toBe(503);
    expect(await r.text()).toContain("Sign-in is not set up yet");
    const v = await (await app.request("/api/version", {}, env)).json<{ ssoConfigured: boolean; ssoClientId: string; ssoKeyFingerprint: string }>();
    expect(v.ssoConfigured).toBe(true);
    expect(v.ssoClientId).toBe("test-client");
    expect(v.ssoKeyFingerprint).toBe((await sha256Hex("test-secret")).slice(0, 12));

    const w = await (await app.request("/api/version", {}, { ...env, EVE_CLIENT_SECRET: "" })).json<{ ssoConfigured: boolean }>();
    expect(w.ssoConfigured).toBe(false);
  });

  it("refuses a form without the session's token", async () => {

    const r = await app.request("/orders", { method: "POST", body: new URLSearchParams({ typeId: "2001", units: "1" }) }, env);
    expect([302, 403]).toContain(r.status);
  });
});

describe("the buyer's pages", () => {
  /** A session row of the buyer's, the way sign-in leaves one, and the cookie that names it. */
  async function signedIn(): Promise<{ cookie: string; csrf: string }> {
    await ensureSchema(env.DB);
    const ts = new Date().toISOString();
    const id = "test-session-" + Math.random().toString(36).slice(2);
    await env.DB.prepare(
      `INSERT INTO sessions (id, character_id, name, corp_id, alliance_id, csrf, created_at, expires_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, NULL, 'tok', ?5, ?6, ?5)`,
    ).bind(id, buyer.characterId, buyer.name, buyer.corporationId, ts, new Date(Date.now() + 3_600_000).toISOString()).run();
    return { cookie: `sid=${id}`, csrf: "tok" };
  }

  it("renders the price list with items, prices and stock for a public shop", async () => {
    await sync(push({ store: { ...push().store, senderPolicy: "anyone" } }));
    const r = await app.request("/", {}, env);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("Widget");
    expect(html).toContain("1,100,000 ISK");
    expect(html).toContain("2 available now");   // 3 in stock, 1 reserved
    expect(html).toContain("not for sale");      // Gadget carries no price
    expect(html).toContain("Sign in with EVE");
  });

  it("lets a signed-in buyer order from the page, see it waiting, and withdraw it", async () => {
    await sync(push({ store: { ...push().store, senderPolicy: "anyone" } }));
    const s = await signedIn();
    const home = await (await app.request("/", { headers: { Cookie: s.cookie } }, env)).text();
    expect(home).toContain(buyer.name);
    expect(home).toContain('name="_csrf" value="tok"');

    const placed = await app.request("/orders", {
      method: "POST", headers: { Cookie: s.cookie },
      body: new URLSearchParams({ _csrf: s.csrf, typeId: "2001", units: "2" }),
    }, env);
    expect(placed.status).toBe(302);
    expect(placed.headers.get("Location")).toBe("/orders");
    const flashCookie = (placed.headers.get("Set-Cookie") ?? "").split(";")[0];
    expect(flashCookie).toMatch(/^flash=/);

    const html = await (await app.request("/orders", { headers: { Cookie: `${s.cookie}; ${flashCookie}` } }, env)).text();
    expect(html).toContain("Order sent to the store");
    expect(html).toContain("2 × Widget");
    expect(html).toContain("2,200,000 ISK");
    expect(html).toContain("not confirmed yet");
    const id = /\/web-orders\/([a-z0-9]+)\/cancel/.exec(html)?.[1];
    expect(id).toBeDefined();

    const withdrawn = await app.request(`/web-orders/${id}/cancel`, {
      method: "POST", headers: { Cookie: s.cookie }, body: new URLSearchParams({ _csrf: s.csrf }),
    }, env);
    expect(withdrawn.status).toBe(302);
    const row = await env.DB.prepare(`SELECT state FROM web_orders WHERE id = ?1`).bind(id).first<{ state: string }>();
    expect(row?.state).toBe("cancelled");
    const after = await (await app.request("/orders", { headers: { Cookie: s.cookie } }, env)).text();
    expect(after).toContain("Withdrawn");
    expect(after).toContain('id="cancel"');   // the confirmation the Cancel buttons open

  });

  it("asks about EVE mail only when the store has a mailbox, and carries the answer to the store", async () => {
    await sync(push({ store: { ...push().store, senderPolicy: "anyone" } }));
    const s = await signedIn();
    const post = (body: Record<string, string>) => app.request("/orders", {
      method: "POST", headers: { Cookie: s.cookie },
      body: new URLSearchParams({ _csrf: s.csrf, typeId: "2001", units: "1", ...body }),
    }, env);
    expect((await post({ mailUpdatesAsked: "1" })).status).toBe(302);                     // asked, box unticked
    expect((await post({ mailUpdatesAsked: "1", mailUpdates: "1" })).status).toBe(302);   // asked, ticked
    expect((await post({})).status).toBe(302);                                            // never asked
    const r = await (await sync(push({ store: { ...push().store, senderPolicy: "anyone" } }))).json<SyncResponse>();
    const mine = r.events.filter((e) => e.kind === "order" && e.buyer.id === buyer.characterId).slice(-3);
    expect(mine.map((e) => e.mailUpdates)).toEqual([false, true, true]);

    const plain = await (await app.request("/", { headers: { Cookie: s.cookie } }, env)).text();
    expect(plain).toContain('id="confirm"');
    expect(plain).not.toContain('name="mailUpdatesAsked"');   // no mailbox on this store
    await sync(push({ store: { ...push().store, senderPolicy: "anyone", characterName: "Some Pilot", mailUpdates: true } }));
    const withBox = await (await app.request("/", { headers: { Cookie: s.cookie } }, env)).text();
    expect(withBox).toContain('name="mailUpdatesAsked"');
  });

  it("holds a buyer to the store's purchase limit", async () => {
    const limited = { ...push().store, senderPolicy: "anyone" as const, limit: { units: 1, scope: "type" as const, period: "all" as const, count: 1 } };
    const wider = { ...catalogue, sections: [{ name: "Hulls", items: [
      ...catalogue.sections[0].items,
      { typeId: 2003, name: "Gizmo", typeName: "Gizmo", unitPrice: 5, inStock: 9, inBuild: 0, reserved: 0 },
    ] }] };
    await sync(push({ store: limited, catalogue: wider, orders: [
      { id: 77, ref: "FIRST1", buyerId: buyer.characterId, buyerType: "character", typeId: 2001, units: 1, totalPrice: 1_100_000, status: "completed", createdAt: "2026-01-01T00:00:00Z" },
    ] }));
    const s = await signedIn();
    const home = await (await app.request("/", { headers: { Cookie: s.cookie } }, env)).text();
    expect(home).toContain("limits each buyer to 1 unit of each item ever");
    expect(home).toContain("Limit reached");                       // Widget: one already, none left
    expect(home).toContain('name="units" class="fixed"');          // Gizmo: still open, box fixed at 1
    expect(home).toContain("You have not ordered any yet");        // said in the dialog for Gizmo

    const over = await app.request("/orders", { method: "POST", headers: { Cookie: s.cookie }, body: new URLSearchParams({ _csrf: s.csrf, typeId: "2001", units: "1" }) }, env);
    expect(over.status).toBe(302);
    expect(over.headers.get("Location")).toBe("/");                 // refused, back to the list
    expect(over.headers.get("Set-Cookie") ?? "").toContain("flash=");

    // The whole store, a thousand units in thirty days: everything open, boxes capped at what is left.
    await sync(push({ store: { ...limited, limit: { units: 1000, scope: "store", period: "days", count: 30 } }, catalogue: wider }));
    const wide = await (await app.request("/", { headers: { Cookie: s.cookie } }, env)).text();
    expect(wide).not.toContain("Limit reached");
    expect(wide).toMatch(/name="units" min="1" max="\d+"/);
    expect(wide).toContain("1,000 units from this store per 30 days");
  });

  it("refuses a form whose token is not the session's", async () => {
    const s = await signedIn();
    const r = await app.request("/orders", {
      method: "POST", headers: { Cookie: s.cookie }, body: new URLSearchParams({ _csrf: "wrong", typeId: "2001", units: "1" }),
    }, env);
    expect(r.status).toBe(403);
  });
});
