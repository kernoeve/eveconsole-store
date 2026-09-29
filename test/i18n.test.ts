import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import app from "../src/index";
import { signSync } from "../src/crypto";
import { catalogues, formatNumber, LANGUAGES, langOf, t, type Lang, type Message } from "../src/i18n";
import { en } from "../src/messages/en";
import { describeLimit } from "../src/limits";
import { PROTOCOL, SIGNATURE_HEADER, TIMESTAMP_HEADER, type SyncRequest } from "../src/protocol";

// ── Every translation against the English ─────────────────────────────────

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const forms = (m: Message): [string, string][] => (typeof m === "string" ? [["", m]] : Object.entries(m));
/** What English fills in: its string's, or its "other" form's. */
const englishNeeds = (m: Message) => placeholders(typeof m === "string" ? m : m.other);

/** The plural categories a language uses for whole numbers: what a plural message has to cover. */
function integerCategories(lang: Lang): Map<string, number[]> {
  const rules = new Intl.PluralRules(lang);
  const seen = new Map<string, number[]>();
  for (let n = 0; n <= 1000; n++) seen.set(rules.select(n), [...(seen.get(rules.select(n)) ?? []), n]);
  return seen;
}

function problems(lang: Lang): string[] {
  const found: string[] = [];
  const translation = catalogues[lang];
  const categories = integerCategories(lang);
  for (const key of Object.keys(translation))
    if (!(key in en)) found.push(`${key}: not an English key`);
  for (const [key, english] of Object.entries(en) as [keyof typeof en, Message][]) {
    const m = translation[key];
    if (m === undefined) { found.push(`${key}: missing`); continue; }
    const needs = englishNeeds(english).join(",");
    for (const [form, text] of forms(m)) {
      const has = placeholders(text).join(",");
      if (/\{(?!\w+\})|(?<!\{\w*)\}/.test(text)) found.push(`${key}${form && `.${form}`}: a brace that is not a placeholder`);
      if (form.startsWith("=")) {
        const extra = placeholders(text).filter((p) => !englishNeeds(english).includes(p));
        if (extra.length) found.push(`${key}.${form}: unknown {${extra.join("}, {")}}`);
      } else if (has !== needs) {
        found.push(`${key}${form && `.${form}`}: placeholders {${has}} where English has {${needs}}`);
      }
      if (text.trim() === "") found.push(`${key}${form && `.${form}`}: empty`);
    }
    // A plural in English is a plural wherever whole numbers take more than one form, and no
    // number may fall back to "other" when its own category is another.
    if (typeof english !== "string" && typeof m === "string" && categories.size > 1)
      found.push(`${key}: needs plural forms (${[...categories.keys()].join(", ")})`);
    if (typeof m !== "string")
      for (const [category, numbers] of categories) {
        if (category === "other" || m[category as "one"] !== undefined) continue;
        const uncovered = numbers.filter((n) => m[`=${n}`] === undefined);
        if (uncovered.length) found.push(`${key}: no "${category}" form (for ${uncovered.slice(0, 4).join(", ")}…)`);
      }
  }
  // Names the owner types exactly as written.
  for (const word of ["EVE_CLIENT_ID", "EVE_CLIENT_SECRET"])
    if (!String(translation.ssoNotSetUpText ?? "").includes(word)) found.push(`ssoNotSetUpText: ${word} changed or missing`);
  return found;
}

describe("the site's languages", () => {
  for (const lang of LANGUAGES.filter((l) => l !== "en"))
    it(`${lang} has every message, with English's placeholders and its own plural forms`, () => {
      expect(problems(lang)).toEqual([]);
    });

  it("reads the store's language code, and falls back to English", () => {
    expect(langOf("de")).toBe("de");
    expect(langOf("zh-hans")).toBe("zh-Hans");
    expect(langOf("pt")).toBe("en");
    expect(langOf("")).toBe("en");
    expect(langOf(undefined)).toBe("en");
  });

  it("writes numbers as each language does", () => {
    expect(formatNumber("en", 1_100_000)).toBe("1,100,000");
    expect(formatNumber("de", 1_100_000)).toBe("1.100.000");
    expect(formatNumber("fr", 1_100_000)).toBe("1 100 000");
    expect(formatNumber("ru", 1_100_000)).toBe("1 100 000");
    expect(formatNumber("ja", 1_100_000)).toBe("1,100,000");
  });

  it("picks exact and plural forms", () => {
    expect(t("en", "limitUnits", { n: 1 })).toBe("1 unit");
    expect(t("en", "limitUnits", { n: 1000 })).toBe("1,000 units");
    expect(t("en", "periodDays", { n: 1 })).toBe("per day");
    expect(t("en", "periodDays", { n: 21 })).toBe("per 21 days");
    expect(describeLimit("en", { units: 3, scope: "group", period: "months", count: 1 })).toBe("3 units of each item group per month");
    // Russian: 1 and 21 share a form, 2 and 22 another, 5 and 11 a third.
    const ru = (n: number) => t("ru", "limitUnits", { n }).replace(/[\d ]+/g, "#");
    expect(ru(1)).toBe(ru(21));
    expect(ru(2)).toBe(ru(22));
    expect(ru(5)).toBe(ru(11));
    expect(new Set([ru(1), ru(2), ru(5)]).size).toBe(3);
  });
});

// ── A store that speaks German ────────────────────────────────────────────

const SECRET = "test-secret-do-not-use";

/** Text as the page carries it: Hono escapes these five in text and attributes. */
const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

async function push(body: SyncRequest): Promise<Response> {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const ts = String(Math.floor(Date.now() / 1000));
  return app.request("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", [TIMESTAMP_HEADER]: ts, [SIGNATURE_HEADER]: await signSync(SECRET, ts, bytes) },
    body: bytes,
  }, env);
}

function germanStore(): SyncRequest {
  return {
    protocol: PROTOCOL, appVersion: "test", cursor: 0, generation: "",
    store: { name: "Testladen", language: "de", senderPolicy: "anyone", allowed: [],
             limit: { units: 5, scope: "type", period: "days", count: 30 },
             theme: { key: "dark", buyerMaySwitch: true, default: "dark", variants: { dark: { "surface-base": "#14141c" }, light: { "surface-base": "#e2e0e8" } } } },
    catalogue: {
      hash: "de1", asOf: "2026-09-19T20:00:00Z",
      showInStock: true, showInBuild: true, showReserved: true, showCompletionDate: false, colourByState: false,
      sections: [{ name: "Schiffe", items: [
        { typeId: 587, name: "Rifter", typeName: "Rifter", unitPrice: 1_100_000, inStock: 1500, inBuild: 0, reserved: 0 },
      ] }],
    },
    orders: [], removed: [], webOrders: [],
  };
}

describe("a store in German", () => {
  it("words and formats the price list in German", async () => {
    await push(germanStore());
    const page = await (await app.request("/", {}, env)).text();
    expect(page).toContain('<html lang="de"');
    expect(page).toContain(html(t("de", "navPriceList")));
    expect(page).toContain(html(t("de", "iskAmount", { amount: 1_100_000 })));
    expect(page).toContain("1.100.000");
    expect(page).toContain(html(t("de", "stateAvailable", { n: 1500 })));
    expect(page).toContain(html(t("de", "limitNote", { limit: describeLimit("de", germanStore().store.limit!) })));
    expect(page).toContain(`<option value="dark" selected="">${html(t("de", "themeDark"))}</option>`);
    expect(page).toContain(html(t("de", "footerAsOf", { time: "2026-09-19 20:00" })));
    expect(page).not.toContain(html(en.signInToOrder));
  });

  it("says what went wrong in German too", async () => {
    await push(germanStore());
    const refused = await app.request("/orders/1/cancel", { method: "POST", body: new URLSearchParams({}) }, env);
    expect([302, 403]).toContain(refused.status);   // no session: sent to sign in
    const r = await app.request("/auth/login", {}, { ...env, EVE_CLIENT_ID: "" });
    expect(r.status).toBe(503);
    expect(await r.text()).toContain(html(t("de", "ssoNotSetUpTitle")));
  });

  it("gives the order dialog the store's number format and ISK wording", async () => {
    await push(germanStore());
    const ts = new Date().toISOString();
    const id = "test-de-" + Math.random().toString(36).slice(2);
    await env.DB.prepare(
      `INSERT INTO sessions (id, character_id, name, corp_id, alliance_id, csrf, created_at, expires_at, last_seen_at)
       VALUES (?1, 2118000001, 'Some Buyer', 98000001, NULL, 'tok', ?2, ?3, ?2)`,
    ).bind(id, ts, new Date(Date.now() + 3_600_000).toISOString()).run();
    const page = await (await app.request("/", { headers: { Cookie: `sid=${id}` } }, env)).text();
    expect(page).toContain('new Intl.NumberFormat("de"');
    expect(page).toContain(JSON.stringify(t("de", "iskAmount")).replace(/</g, "\\u003c"));
    expect(page).toContain(html(t("de", "confirmNote", { myOrders: t("de", "navMyOrders") })));

    // A refused order comes back worded in German.
    const over = await app.request("/orders", {
      method: "POST", headers: { Cookie: `sid=${id}` },
      body: new URLSearchParams({ _csrf: "tok", typeId: "587", units: "6" }),
    }, env);
    expect(over.status).toBe(302);
    const flash = decodeURIComponent(/flash=([^;]+)/.exec(over.headers.get("Set-Cookie") ?? "")?.[1] ?? "");
    const limit = describeLimit("de", germanStore().store.limit!);
    expect(JSON.parse(flash).text).toBe(t("de", "limitOverFlash", { limit, left: 5, asked: 6 }));
  });
});
