# The sync protocol

Version **1**. The single exchange between EVE Console and a store's web site. The app is the
only side that ever calls; the site holds what it was told and what buyers did.

The app's copy of this contract is `Services/WebStore/WebStoreProtocol.cs` in the EVE Console
repository. The two must agree on every field; the version number is what the two sides check
before anything else.

## The call

`POST {site}/api/sync`, JSON body, with two headers:

| header | value |
|---|---|
| `X-EveConsole-Timestamp` | Unix seconds at the moment of signing |
| `X-EveConsole-Signature` | `v1=` + lower-case hex of HMAC-SHA256 over `timestamp + "\n" + body`, keyed by the store's secret |

The site verifies the signature with the same secret, in constant time, and refuses a timestamp
more than five minutes from its own clock. The secret itself never travels. It is set on the
site as the `STORE_SYNC_SECRET` secret and shown on the store's Config tab in the app.

Responses:

| status | meaning |
|---|---|
| `200` | the reply below |
| `401` | signature or timestamp refused |
| `409` | protocol mismatch; body `{ "protocol": n }` says what the site speaks |
| other | the app records the status and tries again next cycle |

Every call is idempotent. A reply the app never received is simply requested again: the
catalogue is a snapshot, order rows are upserts, and events are only acknowledged by the cursor
in the next call.

## Request

```jsonc
{
  "protocol": 1,
  "appVersion": "0.9.14",
  "cursor": 123,               // last event seq the app has applied; the site may prune at and below
  "generation": "8f2a…",       // the site database generation the app last saw, "" on first contact
  "store": {
    "name": "Some Shop",
    "blurb": "Plain text. Blank lines separate paragraphs.",
    "characterName": "Some Seller",   // who issues contracts; "" for a web-only store with no character
    "pickup": "Jita IV - Moon 4 - Caldari Navy Assembly Plant",   // the posting's location, may be ""
    "senderPolicy": "list",           // "anyone" | "list"
    "allowed": [ { "id": 2118000001, "kind": "character", "name": "Some Buyer" } ],  // kinds: character | corporation | alliance
    "mailUpdates": true,              // the owner also mails buyers as orders move (informational)
    "theme": {
      "key": "blue-dark",             // the app's theme key
      "buyerMaySwitch": true,         // may a buyer flip to the paired light/dark variant
      "default": "dark",              // which variant is the store's own: "dark" | "light"
      "variants": {
        "dark":  { "surface-base": "#121a26", "surface-panel": "#192434", "...": "..." },
        "light": { "surface-base": "#dfe6ee", "...": "..." }
      }
    }
  },
  "catalogue": {
    "hash": "sha256 hex of the catalogue content",
    "asOf": "2026-09-19T20:00:00Z",
    "showInStock": true, "showInBuild": true, "showReserved": true, "showCompletionDate": false,
    "colourByState": false, "colourInStock": "#4a9a5a", "colourInBuild": "#c8a84b", "colourNone": "#888899",
    "sections": [
      {
        "name": "Hulls", "prefix": "", "headerColour": null, "rowColour": null,
        "items": [
          {
            "typeId": 2001,
            "name": "★ Shiny Gadget",     // what the buyer sees (the posting's prefix and override applied)
            "typeName": "Gadget",         // the item's own name, for the icon and for search
            "groupName": "Titan",
            "unitPrice": 1100000,         // per unit, already rounded as the price list rounds; null = not for sale
            "inStock": 5, "inBuild": 2, "reserved": 1,
            "earliestJobEnd": null,       // ISO time or null
            "colour": null
          }
        ]
      }
    ]
  },
  "orders": [                     // rows changed since the last acknowledged push; upsert by id
    {
      "id": 41, "ref": "K7P2QX", "webOrderId": "",       // webOrderId set for orders placed on the site
      "buyerId": 2118000001, "buyerType": "character", "buyerName": "Some Buyer",
      "contractToId": 2118000001, "contractToName": "Some Buyer",
      "typeId": 2001, "typeName": "Widget", "units": 2, "totalPrice": 2200000,
      "status": "pending",        // pending | completed | canceled
      "fulfilment": "stock",      // "" | stock | job | contract
      "estimatedDate": "2026-09-20", "contractId": null,
      "createdAt": "2026-09-19T19:58:00Z", "completedOn": null,
      "storeId": 3,
      "channel": "web"            // web | mail | manual
    }
  ],
  "removed": [ 7, 9 ],            // app order ids the site should hide
  "webOrders": [                  // web orders that never became order rows
    { "webOrderId": "01J…", "state": "review",   "reason": "" },
    { "webOrderId": "01K…", "state": "rejected", "reason": "Type 9999 is not on the price list." }
  ],
  "more": false                   // more order rows are waiting; the app calls again at once
}
```

Theme token names are the app's palette tokens in kebab case: `surface-base`, `surface-panel`,
`surface-panel-alt`, `surface-header`, `surface-raised`, `surface-input`, `surface-hover`,
`surface-selected`, `border-subtle`, `border-default`, `border-strong`, `text-faint`,
`text-dim`, `text-muted`, `text-secondary`, `text-primary`, `text-bright`, `accent`,
`accent-hover`, `accent-pressed`, `accent-surface`, `accent-deep`, `accent-pale`, `good`,
`bad`, `warn`, `info`, `good-surface`, `bad-surface`, `warn-surface`, `info-surface`,
`surface-overlay`, `surface-overlay-strong`. Values are `#rrggbb` or `#aarrggbb` (the two
overlays carry alpha first, as Avalonia writes it).

## Reply

```jsonc
{
  "protocol": 1,
  "siteVersion": "1.0.0",
  "schemaVersion": 1,
  "generation": "8f2a…",          // random id minted when the site's database was first initialised
  "catalogueHash": "…",           // what the site now holds
  "ordersApplied": [ 41 ],        // ids upserted this call
  "removedApplied": [ 7, 9 ],
  "events": [                     // since the app's cursor, in seq order
    {
      "seq": 124, "kind": "order", "at": "2026-09-19T20:01:00Z",
      "webOrderId": "01J…",
      "buyer": { "id": 2118000001, "name": "Some Buyer", "corporationId": 98000001, "allianceId": null },
      "contractTo": null,          // or { "id", "name", "kind" } when the buyer named someone else
      "note": "",
      "catalogueHash": "…",        // the catalogue the buyer was looking at
      "lines": [ { "typeId": 2001, "units": 2, "unitPrice": 1100000 } ]   // priced by the site from its stored catalogue
    },
    {
      "seq": 125, "kind": "cancel", "at": "2026-09-19T20:05:00Z",
      "buyer": { "id": 2118000001, "name": "Some Buyer", "corporationId": 98000001, "allianceId": null },
      "orderId": 41,               // the app's id where the site knows it; else webOrderId of an unconfirmed order
      "webOrderId": "",
      "reason": ""
    }
  ],
  "activeSessions": 2,            // signed-in sessions active in the last few minutes
  "needsFullOrders": false,       // the site holds no order rows: the app resends them all
  "serverTime": "2026-09-19T20:06:00Z"
}
```

## What each side promises

**The app**

- Pushes the whole catalogue every call; the site skips the write when the hash is unchanged.
- Pushes only order rows whose content changed since the site last acknowledged them, and
  resends everything when `generation` changes or `needsFullOrders` is true.
- Books an order only when every line's item is on the posting, quantities are within bounds,
  the buyer passes the sender policy, and the quoted price is within tolerance of the posting.
  Anything else is reported back in `webOrders` as `review` or `rejected`, with the reason.
- Acknowledges events by sending the highest `seq` it has applied as `cursor`.
- Never sends the secret, and never trusts a price from the site without checking it.

**The site**

- Prices an order from its own stored catalogue, never from the browser, and records the
  catalogue hash the buyer was looking at.
- Shows every order as the app last pushed it, and shows a web order as unconfirmed until the
  app's push carries a row with its `webOrderId`, or `webOrders` names it.
- Keeps events until the app's cursor passes them.
- Marks a web order withdrawn the moment its buyer cancels it and raises the `cancel` event so the
  app closes its review row; a withdrawn order is not relabelled by a later `rejected`.
- Enforces the sender policy on every request, not only at sign-in.
- Answers `409` with its own protocol number when the versions differ, and reports its version
  at `GET /api/version` for the app's update check, together with whether it holds EVE application
  keys (`ssoConfigured`), so the app can say when sign-in is not set up.
