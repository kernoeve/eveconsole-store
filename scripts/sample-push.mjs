// Pushes a sample store to a site the way EVE Console does, so a local `npm run dev` has
// something to show. Nothing in it is real: made-up buyers, made-up stock, list prices.
//
//   node scripts/sample-push.mjs                  → http://localhost:8787
//   node scripts/sample-push.mjs https://my-shop.example.workers.dev
//
// The secret comes from SITE_SECRET, else STORE_SYNC_SECRET in .dev.vars. CURSOR and
// GENERATION may be set to see how the site answers a second call.

import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const site = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");
let secret = process.env.SITE_SECRET;
if (!secret) {
  const f = resolve(import.meta.dirname, "..", ".dev.vars");
  if (existsSync(f)) secret = /^STORE_SYNC_SECRET=(.*)$/m.exec(readFileSync(f, "utf8"))?.[1]?.trim();
}
if (!secret) {
  console.error("No secret: set SITE_SECRET, or put STORE_SYNC_SECRET in .dev.vars");
  process.exit(1);
}

// The app's own dark and light palettes, as WebThemes pushes them (Avalonia #aarrggbb where alpha appears).
const dark = {
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
};
const light = {
  "surface-base": "#e2e0e8", "surface-panel": "#eeecf2", "surface-panel-alt": "#e8e6ee", "surface-header": "#d8d5e0",
  "surface-raised": "#f6f5f8", "surface-input": "#f8f7fa", "surface-hover": "#dcd9e6", "surface-selected": "#d8dcf0",
  "border-subtle": "#dedce6", "border-default": "#c6c3d2", "border-strong": "#a8a4b8",
  "text-faint": "#8a8698", "text-dim": "#757182", "text-muted": "#5d596a", "text-secondary": "#454152",
  "text-primary": "#2e2a3a", "text-bright": "#17141f",
  "accent": "#8a6a12", "accent-hover": "#a8842a", "accent-pressed": "#6d520a", "accent-surface": "#f6ecd0",
  "accent-deep": "#503c06", "accent-pale": "#c9a94e",
  "good": "#1f7a52", "bad": "#b03030", "warn": "#a86410", "info": "#1f6f88",
  "good-surface": "#dff0e6", "bad-surface": "#fadedd", "warn-surface": "#faecd4", "info-surface": "#dcecf2",
  "surface-overlay": "#e0eeecf2", "surface-overlay-strong": "#f2f6f5f8",
};

const inDays = (d) => new Date(Date.now() + d * 86_400_000).toISOString();
const item = (typeId, name, groupName, unitPrice, inStock = 0, inBuild = 0, reserved = 0, earliestJobEnd = null) =>
  ({ typeId, name, typeName: name, groupName, unitPrice, inStock, inBuild, reserved, earliestJobEnd });

const request = {
  protocol: 1,
  appVersion: "sample-push",
  cursor: Number(process.env.CURSOR ?? 0),
  generation: process.env.GENERATION ?? "",
  store: {
    name: "Sample Shop",
    blurb: "Hulls and minerals built to order in Jita. Contracts go out within a day of an order being confirmed; anything not in stock is built first and the price list says how long that takes.\n\nPrices are as listed at the moment you order.",
    characterName: "Some Pilot",
    pickup: "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
    senderPolicy: "anyone",
    allowed: [],
    mailUpdates: false,
    theme: { key: "dark", buyerMaySwitch: true, default: "dark", variants: { dark, light } },
  },
  catalogue: {
    hash: "sample-" + new Date().toISOString().slice(0, 13),
    asOf: new Date().toISOString(),
    showInStock: true, showInBuild: true, showReserved: true, showCompletionDate: true,
    colourByState: false,
    sections: [
      { name: "Frigates and destroyers", items: [
        item(587, "Rifter", "Frigate", 4_200_000, 5),
        item(22456, "Sabre", "Interdictor", 68_000_000, 0, 2, 0, inDays(2)),
      ] },
      { name: "Cruisers and battlecruisers", items: [
        item(12005, "Ishtar", "Heavy Assault Cruiser", 320_000_000, 2, 0, 1),
        item(24702, "Hurricane", "Combat Battlecruiser", 62_000_000, 0, 3, 3, inDays(1)),
        item(16227, "Ferox", "Combat Battlecruiser", 58_000_000, 4),
      ] },
      { name: "Battleships", items: [
        item(645, "Dominix", "Battleship", 245_000_000, 1),
        item(28606, "Orca", "Industrial Command Ship", null, 0),
      ] },
      { name: "Minerals", items: [
        item(34, "Tritanium", "Mineral", 4.5, 2_400_000),
        item(35, "Pyerite", "Mineral", 12, 800_000),
      ] },
    ],
  },
  // Two orders in a made-up buyer's name: one delivered, one being built.
  orders: [
    { id: 41, ref: "K7P2QX", buyerId: 2118000001, buyerType: "character", buyerName: "Some Buyer", typeId: 587, typeName: "Rifter",
      units: 2, totalPrice: 8_400_000, status: "completed", fulfilment: "contract", contractId: 210000001,
      createdAt: inDays(-9), completedOn: inDays(-8).slice(0, 10), storeId: 1, channel: "mail" },
    { id: 42, ref: "AB12CD", buyerId: 2118000001, buyerType: "character", buyerName: "Some Buyer", typeId: 24702, typeName: "Hurricane",
      units: 1, totalPrice: 62_000_000, status: "pending", fulfilment: "job", estimatedDate: inDays(1).slice(0, 10),
      createdAt: inDays(-1), storeId: 1, channel: "web" },
  ],
  removed: [],
  webOrders: [],
};

const body = JSON.stringify(request);
const ts = String(Math.floor(Date.now() / 1000));
const signature = "v1=" + createHmac("sha256", secret).update(ts + "\n" + body).digest("hex");
const r = await fetch(site + "/api/sync", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-EveConsole-Timestamp": ts, "X-EveConsole-Signature": signature },
  body,
});
console.log(r.status, JSON.stringify(await r.json(), null, 2));
