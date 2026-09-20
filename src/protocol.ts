// The exchange with EVE Console — see docs/protocol.md. Mirrors the app's WebStoreProtocol.cs.

export const PROTOCOL = 1;
export const SYNC_PATH = "/api/sync";
export const TIMESTAMP_HEADER = "X-EveConsole-Timestamp";
export const SIGNATURE_HEADER = "X-EveConsole-Signature";

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
  theme: Theme;
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
