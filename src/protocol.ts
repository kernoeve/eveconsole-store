// The exchange with EVE Console — see docs/protocol.md. Mirrors the app's WebStoreProtocol.cs.

export const PROTOCOL = 1;
export const SYNC_PATH = "/api/sync";
export const TIMESTAMP_HEADER = "X-EveConsole-Timestamp";
export const SIGNATURE_HEADER = "X-EveConsole-Signature";

/** Where the app puts the banner's bytes, signed like the sync call. */
export const BANNER_PATH = "/api/sync/banner";
/** The most a banner may be, in bytes as stored: well under D1's row limit. */
export const BANNER_MAX_BYTES = 1_000_000;
export const BANNER_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export interface SyncRequest {
  protocol: number;
  appVersion?: string;
  cursor: number;
  generation: string;
  store: StoreInfo;
  /** The store's first Sell listing, for a site from before listings; one that reads
   * {@link listings} shows those instead. */
  catalogue: Catalogue;
  /** Every listing in the store's order, each a tab (app 0.9.17+). Absent from an older app,
   * whose one catalogue is then the only, Sell, listing. */
  listings?: Listing[];
  orders: OrderRow[];
  removed: number[];
  webOrders: WebOrderState[];
  more?: boolean;
  /** Whether the app knows the "visit" event kind; without it none are sent, so an older app
   * never sees a kind it would refuse. */
  visits?: boolean;
  /** How many order rows the app believes the site holds (its ledger). Zero says there is
   * nothing to resend, so an empty order book is not taken for a lost one. */
  pushedOrders?: number;
}

export interface StoreInfo {
  name: string;
  /** The language the store speaks to its buyers, as the app's code ("en", "ru", "zh-Hans"): the
   * site words every page in it. Absent from an older app, which means English. */
  language?: string;
  blurb?: string;
  characterName?: string;
  pickup?: string;
  senderPolicy: "anyone" | "list";
  allowed: Allowed[];
  mailUpdates?: boolean;
  /** The store's per-buyer purchase limit, when it has one. */
  limit?: Limit | null;
  /** The banner across the top of the price list, by hash: null says there is none now, and a
   * push without the field (an older app) leaves whatever the site holds alone. The bytes come
   * on their own call. */
  banner?: BannerInfo | null;
  theme: Theme;
  /** Who a Buy listing's sellers make their Item Exchange contracts out to; null or absent
   * when nobody is named, and then no offers are taken. */
  buyAssignee?: Assignee | null;
  /** Where sellers are asked to create those contracts, named in the store's language; null or
   * absent when the store does not say (app 0.9.17+). Told, not enforced. */
  buyLocation?: Place | null;
  /** Every place sellers may create those contracts, in order, named in the store's language
   * (app 0.9.19+); buyLocation is always the first of them, for an older site. Null or absent:
   * none, or an older app, whose buyLocation is then the only one. */
  buyLocations?: Place[] | null;
}

export interface Assignee {
  id: number;
  kind: "character" | "corporation" | "alliance" | string;
  name: string;
}

/** An NPC station or a structure, by its EVE id. */
export interface Place {
  id: number;
  name: string;
}

/**
 * One of the store's listings, a tab of its own. "sell" is the price list it always was;
 * "buy" is the prices the store pays, with no counts, which a visitor offers to sell to.
 */
export interface Listing {
  /** The posting's id in EVE Console; what an order names the listing by. 0 for the one
   * listing of an older app. */
  id: number;
  title: string;
  side: "sell" | "buy" | string;
  catalogue: Catalogue;
}

/** So many units of each item type, each item group, or anything in the store, within a rolling period or ever. */
export interface Limit {
  units: number;
  scope: "type" | "group" | "store";
  period: "days" | "months" | "years" | "all";
  count: number;
}


export interface BannerInfo {
  sha256: string;
  contentType: string;
}

/** PUT /api/sync/banner: the bytes as base64, in JSON so the type travels under the signature. */
export interface BannerUpload extends BannerInfo {
  data: string;
}

export interface Allowed {
  id: number;
  kind: "character" | "corporation" | "alliance";
  name?: string;
}

export interface Theme {
  key: string;
  buyerMaySwitch: boolean;
  default: "dark" | "light";
  variants: Record<string, Record<string, string>>;
  /** Every theme the buyer may pick from, the store's own first; absent from an older app,
   * which pushes only the dark/light pair above. */
  themes?: ThemeOption[];
}

export interface ThemeOption {
  key: string;
  name: string;
  base: "dark" | "light";
  tokens: Record<string, string>;
}

export interface Catalogue {
  hash: string;
  asOf: string;
  showInStock: boolean;
  showInBuild: boolean;
  showReserved: boolean;
  showCompletionDate: boolean;
  colourByState: boolean;
  colourInStock?: string;
  colourInBuild?: string;
  colourNone?: string;
  /** A Buy listing that tracks need: whether sellers see how many each item still needs (app
   * 0.9.19+). The cap on offers holds wherever an item carries {@link CatalogueItem.need},
   * shown or not. */
  showNeed?: boolean;
  sections: CatalogueSection[];
}

export interface CatalogueSection {
  name: string;
  prefix?: string;
  headerColour?: string | null;
  rowColour?: string | null;
  items: CatalogueItem[];
}

export interface CatalogueItem {
  typeId: number;
  name: string;
  typeName: string;
  groupName?: string;
  groupId?: number;
  unitPrice?: number | null;

  inStock: number;
  inBuild: number;
  reserved: number;
  earliestJobEnd?: string | null;
  colour?: string | null;
  /** On a Buy listing that tracks need: how many the store's production plan still wants (app
   * 0.9.19+). Absent = no cap, as before. */
  need?: Need | null;
}

/**
 * What a Buy listing's item is still wanted for, in units, as of the catalogue's asOf. All
 * whole numbers, none negative. Offers the app has booked are inside onOrder, so the site
 * takes off only its own offers the app has not answered yet.
 */
export interface Need {
  /** max(0, wanted − onHand − inBuild − onOrder): what is still wanted. */
  needed: number;
  /** What the production plan needs in all. */
  wanted: number;
  /** Held already. */
  onHand: number;
  /** Coming out of running industry jobs. */
  inBuild: number;
  /** On open offers to this store the app has booked. */
  onOrder: number;
}

export interface OrderRow {
  id: number;
  ref: string;
  webOrderId?: string;
  buyerId: number;
  buyerType: string;
  buyerName?: string;
  contractToId?: number;
  contractToName?: string;
  typeId: number;
  typeName?: string;
  groupId?: number;
  groupName?: string;
  units: number;

  totalPrice: number;
  status: "pending" | "completed" | "canceled" | string;
  fulfilment?: "" | "stock" | "job" | "contract" | string;
  estimatedDate?: string | null;
  contractId?: number | null;
  createdAt: string;
  completedOn?: string | null;
  storeId?: number;
  channel?: "web" | "mail" | "manual" | string;
  /** "buy": the other party sells to the store, off a Buy listing; absent or "sell" otherwise. */
  side?: "sell" | "buy" | string;
  postingId?: number;
  /** A buy order: what the seller's contracts ask, once any have come in. */
  contractedPrice?: number | null;
}

export interface WebOrderState {
  webOrderId: string;
  state: "review" | "rejected";
  reason?: string;
}

export interface SyncResponse {
  protocol: number;
  siteVersion: string;
  schemaVersion: number;
  generation: string;
  catalogueHash: string;
  ordersApplied: number[];
  removedApplied: number[];
  events: SiteEvent[];
  activeSessions: number;
  needsFullOrders: boolean;
  /** The hash of the banner the site holds, "" for none: the app sends the bytes when it differs from the store's. */
  bannerSha256: string;
  serverTime: string;
}

export interface SiteBuyer {
  id: number;
  name: string;
  corporationId: number;
  allianceId?: number | null;
}

export interface SiteEvent {
  seq: number;
  kind: "order" | "cancel" | "visit";
  at: string;
  webOrderId: string;
  buyer: SiteBuyer;
  lines?: { typeId: number; units: number; unitPrice: number; postingId?: number }[];
  /** "buy" for an offer to sell to a Buy listing; absent for an order. */
  side?: "buy";
  /** An offer only: when the seller expects to make the contract, "yyyy-mm-dd"; absent when they left it blank. */
  expectedDate?: string;
  contractTo?: { id: number; name: string; kind: "character" | "corporation" } | null;
  note?: string;
  /** The buyer's answer to "keep me posted by EVE mail"; absent means yes. */
  mailUpdates?: boolean;
  catalogueHash?: string;

  orderId?: number | null;
  reason?: string;

  /** A visit: how long the buyer had been away, or null when they just signed in. */
  awayMinutes?: number | null;
}
