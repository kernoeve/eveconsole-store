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
  catalogue: Catalogue;
  orders: OrderRow[];
  removed: number[];
  webOrders: WebOrderState[];
  more?: boolean;
}

export interface StoreInfo {
  name: string;
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
  kind: "order" | "cancel";
  at: string;
  webOrderId: string;
  buyer: SiteBuyer;
  lines?: { typeId: number; units: number; unitPrice: number }[];
  contractTo?: { id: number; name: string; kind: "character" | "corporation" } | null;
  note?: string;
  /** The buyer's answer to "keep me posted by EVE mail"; absent means yes. */
  mailUpdates?: boolean;
  catalogueHash?: string;

  orderId?: number | null;
  reason?: string;
}
