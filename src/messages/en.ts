// The site's words in English: the catalogue every other language is checked against.
//
// Notes for translators sit above the messages that need them. {name} is a placeholder, filled
// with a number already formatted in the language, a date (2026-09-29, EVE time), a name, or
// another message. Plural messages choose their form by {n}; see src/i18n.ts.

import type { Message } from "../i18n";

export const en = {
  // ── Every page ───────────────────────────────────────────────────────────
  /** The store's name before the site has heard from EVE Console: the page title and header. */
  storeFallback: "Store",
  navPriceList: "Price list",
  /** Also named in confirmNote as the place an order can be cancelled from. */
  navMyOrders: "My orders",
  /** The accessible name of the header's theme dropdown. */
  themeLabel: "Theme",
  /** Applies the theme picked in the dropdown; only shown when the browser runs no scripts. */
  themeApply: "Apply",
  /** The theme names an older EVE Console sends none of. */
  themeDark: "Dark",
  themeLight: "Light",
  signOut: "Sign out",
  /** EVE's own single sign-on: the link that starts it, and the advice to use it. */
  signIn: "Sign in with EVE",
  /** The footer. {time} is when EVE Console last sent stock and prices, "2026-09-29 20:00", in EVE time (UTC). */
  footerAsOf: "Stock and prices as the store's system last reported them, {time} EVE time.",
  /** The footer's last words: the site's software and its version, "0.1.13". */
  footerSite: "EVE Console store {version}.",
  footerSiteNoVersion: "EVE Console store.",
  /** Every amount of ISK on the site. {amount} is already formatted, "1,100,000". */
  iskAmount: "{amount} ISK",
  /** A page answering a form it cannot trust: the session changed, or the form came from elsewhere. */
  refused: "Refused.",
  siteError: "Something went wrong on the site. The store's owner can see why in Cloudflare's logs.",

  // ── Pages that are only a message ────────────────────────────────────────
  notOpenTitle: "Not open yet",
  notOpenText: "This site has not heard from its store's EVE Console yet. Once the store's web channel is switched on, the price list appears here.",
  /** A store that sells only to the characters, corporations and alliances on its list, to a buyer not signed in. */
  listOnlyText: "This shop serves a list of buyers. Sign in with EVE to see whether you are on it.",
  restrictedTitle: "A restricted store",
  /** Shown to a signed-in character the store's list does not name. {store} is the store's name, {name} the character's. */
  restrictedText: "{store} sells only to buyers on its list, and {name} is not on it. Sign-in has been refused. If you should be on the list, ask the store's owner to add you.",
  ssoNotSetUpTitle: "Sign-in is not set up yet",
  /** For the store's owner. "Stores", "Config" and "EVE application" are EVE Console's own tab and section names:
   *  use the app's words for them in this language. EVE_CLIENT_ID and EVE_CLIENT_SECRET stay as they are. */
  ssoNotSetUpText: "This site has no EVE application keys. The store's owner enters the application's Client ID and Secret Key in EVE Console (Stores, Config, EVE application), or sets them as the site's EVE_CLIENT_ID and EVE_CLIENT_SECRET secrets.",
  ssoFailedTitle: "Sign-in did not complete",
  tryAgain: "Try again",
  ssoNoCode: "EVE did not send a code back.",
  ssoTooSlow: "The sign-in took too long or was started elsewhere. Try again.",
  /** {status} is an HTTP status code such as 400. */
  ssoRefused: "EVE refused the sign-in ({status}).",
  ssoNoToken: "EVE sent no token.",
  ssoBadToken: "The token from EVE did not verify.",
  ssoNoCharacter: "The token names no character.",

  // ── The price list ───────────────────────────────────────────────────────
  signInToOrder: "Sign in with EVE to place an order. Prices are as listed at the moment you order.",
  /** A signed-in character a list store does not serve. {name} is the character's name. */
  notOnList: "This shop serves a list of buyers, and {name} is not on it.",
  /** {limit} is a limitPhrase, "1 unit of each item per 30 days". */
  limitNote: "This store limits each buyer to {limit}. What you may no longer order is greyed out.",
  colItem: "Item",
  colPrice: "Price",
  colAvailability: "Availability",
  colInStock: "In stock",
  colInBuild: "In build",
  colReserved: "Reserved",
  /** The heading over the column of order buttons. */
  colOrderAction: "Order",
  /** A price list section with no rows at all. */
  emptyList: "Nothing on the price list yet.",
  /** In the price column, for an item listed without a price. Lower case in English: it sits where a number would. */
  notForSale: "not for sale",
  /** The availability of an item. {n} units can be taken from stock now. */
  stateAvailable: "{n} available now",
  /** {n} units are being manufactured. */
  stateInBuild: "{n} in build",
  stateBuiltToOrder: "Built to order",
  /** Instead of the availability, when the buyer has used up the store's purchase limit for the item. */
  limitReached: "Limit reached",
  /** After stateInBuild ("3 in build"), when the store shows it: the soonest a build finishes. {date} is "2026-09-29". */
  earliest: "earliest {date}",
  /** The button that orders the item (a verb). */
  orderButton: "Order",
  availabilityNote: "Availability is as the store's system last reported it. An order is confirmed once the store has taken it, usually within a couple of minutes; until then it is listed as sent.",

  // ── The purchase limit: limitPhrase puts the three pieces in order ──────
  /** How much of the limit: "1 unit", "1,000 units". */
  limitUnits: { one: "{n} unit", other: "{n} units" },
  /** What the units are counted over. */
  scopeType: "of each item",
  scopeGroup: "of each item group",
  scopeStore: "from this store",
  /** Over what time: "per day", "per 30 days". */
  periodDays: { "=1": "per day", other: "per {n} days" },
  periodMonths: { "=1": "per month", other: "per {n} months" },
  periodYears: { "=1": "per year", other: "per {n} years" },
  /** No period: counted over everything the buyer has ever ordered here. */
  periodEver: "ever",
  /** The whole limit, "1 unit of each item per 30 days": reorder the pieces as the language needs. */
  limitPhrase: "{units} {scope} {period}",
  /** In the order dialog. {limit} is a limitPhrase. */
  allowanceNone: "This store limits each buyer to {limit}. You have not ordered any yet.",
  /** {ordered} units ordered already within the limit's period, {left} more may still be ordered. */
  allowanceSome: "This store limits each buyer to {limit}. You have ordered {ordered} so far, so {left} more.",
  allowanceAll: "This store limits each buyer to {limit}. You have ordered {ordered} so far.",
  /** After an order the limit refuses. */
  limitReachedFlash: "You have reached this store's limit for that item: {limit}.",
  limitOverFlash: "This store limits each buyer to {limit}; you may order {left} more, not {asked}.",

  // ── Ordering ─────────────────────────────────────────────────────────────
  confirmTitle: "Confirm your order",
  /** Labels in the order and cancel dialogs, and column headings in the buyer's orders. */
  units: "Units",
  priceEach: "Price each",
  total: "Total",
  state: "State",
  mailUpdatesAsk: "Keep me posted by EVE mail as this order moves",
  /** {myOrders} is navMyOrders, the page's name in the header. */
  confirmNote: "The price is as listed now. The store confirms the order within a couple of minutes, and it can be cancelled from {myOrders} until it is contracted.",
  /** Closes a dialog without doing anything (not "cancel the order"). */
  dialogCancel: "Cancel",
  placeOrder: "Place order",
  placingOrder: "Placing your order… this takes a few seconds.",
  orderSent: "Order sent to the store. It is confirmed once the store's system has taken it, usually within a couple of minutes.",
  priceListUnavailable: "The price list is not available.",
  notOnPriceList: "That item is not on the price list.",
  noPrice: "That item is listed without a price and cannot be ordered.",
  badQuantity: "The quantity has to be a whole number of at least one.",
  /** {max} is 10,000. */
  tooMany: "At most {max} of one item per order.",

  // ── The buyer's orders ───────────────────────────────────────────────────
  waitingTitle: "Waiting on the store",
  yourOrders: "Your orders",
  noOrders: "No orders in your name yet.",
  /** When the order was placed. */
  colPlaced: "Placed",
  /** The items an order asks for, as orderLines. */
  colItems: "Items",
  /** The order's reference. */
  colOrderRef: "Order",
  /** How the order reached the store: viaWebsite, viaMail or viaStore. */
  colVia: "Via",
  viaWebsite: "website",
  viaMail: "EVE mail",
  /** An order the store's owner entered themselves. */
  viaStore: "the store",
  /** One line of an order: {units} of the item called {name}, "2 × Rifter". */
  orderLine: "{units} × {name}",
  /** An item whose name the site was not sent. {id} is EVE's number for the item type. */
  typeFallback: "Type {id}",
  /** {ref} is the store's reference for the order, "AB12CD". */
  orderRef: "Order {ref}",
  /** A web order the store has not answered yet, where an order's reference would be. */
  notYetConfirmed: "Not yet confirmed by the store",
  /** The button that cancels an order (not "close the dialog"). */
  cancelOrderButton: "Cancel",
  cancelTitle: "Cancel this order?",
  cancelContractNote: "A contract is already made out for it. Cancelling tells the store to withdraw it; the contract itself stays until they remove it in game.",
  cancelHeardNote: "The store hears of it at its next check-in, usually within a couple of minutes.",
  keepOrder: "Keep the order",
  cancelOrder: "Cancel the order",
  cancelling: "Cancelling… this takes a few seconds.",
  cancelledContractNote: "Cancelling an order with a contract already made out tells the store to withdraw it; the contract itself is theirs to remove in game.",
  cancellationSent: "Cancellation sent to the store.",
  orderWithdrawn: "Order withdrawn.",
  noSuchOrderOfYours: "No such order of yours.",
  pastCancelling: "That order is past cancelling here.",
  noSuchOrder: "No such order.",
  notYours: "That order is not yours.",
  alreadySettled: "That order is already settled.",

  // ── Where an order stands ────────────────────────────────────────────────
  stateDelivered: "Delivered",
  stateCancelled: "Cancelled",
  /** {id} is the in-game contract's number. */
  stateContract: "Contract {id} — accept it in game",
  stateContractIssued: "Contract issued",
  /** {date} is the store's estimate, "2026-10-02". */
  stateInStockBy: "In stock · expected {date}",
  stateInStock: "In stock",
  stateBuildingBy: "Being built · expected {date}",
  stateBuilding: "Being built",
  stateWaitingSlot: "Confirmed · waiting for a build slot",
  webSubmitted: "Sent to the store — not confirmed yet",
  webReview: "The store is looking at it",
  /** {reason} is the store's own explanation, already in the store's language. */
  webDeclinedBecause: "Declined — {reason}",
  webDeclined: "Declined",
  webWithdrawn: "Withdrawn",
} as const satisfies Record<string, Message>;
