import type { FC } from "hono/jsx";
import type { Session } from "../env";
import type { Assignee, CatalogueItem, Limit, Listing, OrderRow, StoreInfo } from "../protocol";
import type { WebOrder } from "../orders";
import { allowanceFor, allowanceWords, describeLimit } from "../limits";
import { raw } from "hono/html";
import { renderBlurb } from "../markup";
import { formatIsk, formatNumber, t, template, type Lang } from "../i18n";


function iconUrl(typeId: number): string {
  return `https://images.evetech.net/types/${typeId}/icon?size=64`;
}

/** The item as a picture and a name, the way the app shows one in a grid. */
const Item: FC<{ typeId: number; name: string; typeName?: string; group?: string }> = (p) => (
  <div class="item">
    <img src={iconUrl(p.typeId)} alt="" loading="lazy" width="24" height="24" />
    <div>
      <div>{p.name}</div>
      {p.group && <div class="group">{p.group}</div>}
    </div>
  </div>
);

/** One line of an order, "2 × Rifter". */
const orderLine = (lang: Lang, units: number, name: string) => t(lang, "orderLine", { units, name });

// ── The price list ────────────────────────────────────────────────────────

export interface CatalogueProps {
  lang: Lang;
  store: StoreInfo;
  /** The listing shown, and all of them, for the tabs. */
  listing: Listing;
  listings: Listing[];
  /** Units of each type in web orders the store has not yet confirmed: taken off "available". */
  pending: Map<number, number>;
  session: Session | null;
  allowed: boolean;
  /** The store's purchase limit, and what this buyer has taken against it (only when signed in and allowed). */
  limit?: Limit | null;
  taken?: Map<string, number> | null;
  /** The hash of the banner the site holds; "" or absent for none. */
  banner?: string;
}


function availableNow(i: CatalogueItem, pending: Map<number, number>): number {
  return Math.max(0, i.inStock - i.reserved - (pending.get(i.typeId) ?? 0));
}

function stateOf(lang: Lang, i: CatalogueItem, available: number): { cls: string; text: string } {
  if (i.unitPrice == null) return { cls: "muted", text: "" };
  if (available > 0) return { cls: "good", text: t(lang, "stateAvailable", { n: available }) };
  if (i.inBuild > 0) return { cls: "warn", text: t(lang, "stateInBuild", { n: i.inBuild }) };
  return { cls: "muted", text: t(lang, "stateBuiltToOrder") };
}

/** The owner's words, as HTML. With block tags the owner has done the layout; without them a
 * blank line starts a paragraph and every other newline is kept, as plain text always was. */
const Blurb: FC<{ text: string }> = ({ text }) => {
  const whole = renderBlurb(text);
  if (whole.blocks) return <div class="panel blurb html">{raw(whole.html)}</div>;
  return <div class="panel blurb">{text.split(/\n\s*\n/).map((para) => <p>{raw(renderBlurb(para).html)}</p>)}</div>;
};

/** What a listing's tab says: its own title, or which way it goes. */
const listingTitle = (lang: Lang, l: Listing) =>
  l.title || t(lang, l.side === "buy" ? "tabBuyFallback" : "tabSellFallback");

/** The store's listings as tabs, when it has more than one. */
const Tabs: FC<{ lang: Lang; listings: Listing[]; current: Listing }> = (p) =>
  p.listings.length < 2 ? null : (
    <nav class="tabs" aria-label={t(p.lang, "listingsNav")}>
      {p.listings.map((l) => (
        <a href={l.id > 0 ? `/?list=${l.id}` : "/"} class={l === p.current ? "active" : undefined}
           aria-current={l === p.current ? "page" : undefined}>
          {listingTitle(p.lang, l)}{l.side === "buy" && <span class="side">{t(p.lang, "tabBuyMark")}</span>}
        </a>
      ))}
    </nav>
  );

export const CataloguePage: FC<CatalogueProps> = (p) => {
  const lang = p.lang;
  const c = p.listing.catalogue;
  const buying = p.listing.side === "buy";
  // An offer needs someone to make its contract out to; without one a Buy listing only shows prices.
  const takesOffers = !buying || !!p.store.buyAssignee;
  const canOrder = !!p.session && p.allowed && takesOffers;
  // The mail question is only worth asking when the store has a mailbox and writes from it.
  const mailbox  = p.store.mailUpdates === true;
  // The listing a form names, so the store checks it against this list's prices; nothing for an
  // older app's one listing.
  const postingId = p.listing.id > 0 ? String(p.listing.id) : undefined;
  const to = p.store.buyAssignee?.name ?? "";

  // ⚠️ A Buy listing counts nothing: what the store has is no business of someone selling to it.
  const showColumns = buying
    ? { stock: false, build: false, reserved: false }
    : { stock: c.showInStock, build: c.showInBuild, reserved: c.showReserved };
  return (
    <>
      {p.banner && (
        <div class="banner"><img src={`/banner?v=${p.banner}`} alt="" /></div>
      )}
      {p.store.blurb && <Blurb text={p.store.blurb} />}
      {/* Nothing about who issues contracts or where to collect is guessed: the owner's own
          words above are the only place such things are said. */}

      <Tabs lang={lang} listings={p.listings} current={p.listing} />

      {buying && (
        takesOffers
          ? <p class="note" style="margin-top:12px">{t(lang, "buyIntro", { to })}</p>
          : <div class="flash info">{t(lang, "buyNotTaking")}</div>
      )}
      {!p.session && takesOffers && (
        <div class="flash info">{t(lang, buying ? "signInToOffer" : "signInToOrder")}</div>
      )}
      {p.session && !p.allowed && (
        <div class="flash bad">{t(lang, "notOnList", { name: p.session.name })}</div>
      )}
      {p.limit && (
        <p class="note" style="margin-top:12px">
          {t(lang, "limitNote", { limit: describeLimit(lang, p.limit) })}
        </p>
      )}

      <div class="panel" style="padding:0 0 8px">
        <table class="grid">
          <thead>
            <tr>
              <th>{t(lang, "colItem")}</th>
              <th class="num">{t(lang, buying ? "colWePay" : "colPrice")}</th>
              {!buying && <th>{t(lang, "colAvailability")}</th>}
              {showColumns.stock && <th class="num optional">{t(lang, "colInStock")}</th>}
              {showColumns.build && <th class="num optional">{t(lang, "colInBuild")}</th>}
              {showColumns.reserved && <th class="num optional">{t(lang, "colReserved")}</th>}
              {canOrder && <th class="right">{t(lang, buying ? "colOfferAction" : "colOrderAction")}</th>}
            </tr>
          </thead>
          <tbody>
            {c.sections.map((s) => (
              <>
                <tr class="section">
                  <td colspan={7}>{s.name}</td>

                </tr>
                {s.items.map((i) => {
                  const available = buying ? 0 : availableNow(i, p.pending);
                  const st = stateOf(lang, i, available);
                  // Against the store's limit, when it has one and the buyer is known.
                  const a = p.limit && p.taken ? allowanceFor(p.limit, p.taken, i.typeId, i.groupId) : null;
                  const blocked = a !== null && a.remaining === 0 && i.unitPrice != null;

                  const rowStyle = c.colourByState && !buying
                    ? `color:${available > 0 ? c.colourInStock : i.inBuild > 0 ? c.colourInBuild : c.colourNone}`
                    : i.colour ? `color:${i.colour}` : s.rowColour ? `color:${s.rowColour}` : undefined;
                  return (
                    <tr style={rowStyle} class={blocked ? "ineligible" : undefined}>
                      <td><Item typeId={i.typeId} name={i.name} group={i.groupName} /></td>
                      <td class="num">{i.unitPrice != null ? formatIsk(lang, i.unitPrice) : <span class="dim">{t(lang, buying ? "notBuying" : "notForSale")}</span>}</td>
                      {!buying && <td>
                        {blocked ? (
                          <span class="state muted">{t(lang, "limitReached")}</span>
                        ) : (
                          <>
                            {st.text ? <span class={`state ${st.cls}`}>{st.text}</span> : null}
                            {c.showCompletionDate && i.earliestJobEnd && available === 0 && i.inBuild > 0 && (
                              <span class="dim"> · {t(lang, "earliest", { date: i.earliestJobEnd.slice(0, 10) })}</span>
                            )}
                          </>
                        )}
                      </td>}

                      {showColumns.stock && <td class="num optional">{formatNumber(lang, i.inStock)}</td>}
                      {showColumns.build && <td class="num optional">{formatNumber(lang, i.inBuild)}</td>}
                      {showColumns.reserved && <td class="num optional">{formatNumber(lang, i.reserved)}</td>}
                      {canOrder && (
                        <td>
                          {i.unitPrice != null && !blocked ? (
                            <form class="order" method="post" action="/orders"
                                  data-name={i.name} data-price={String(i.unitPrice)} data-icon={iconUrl(i.typeId)}
                                  data-limit={a ? allowanceWords(lang, p.limit!, a) : undefined}>
                              <input type="hidden" name="_csrf" value={p.session!.csrf} />
                              <input type="hidden" name="typeId" value={String(i.typeId)} />
                              {postingId && <input type="hidden" name="postingId" value={postingId} />}
                              {/* One unit each and the box is fixed at 1 (read-only, so it still posts); a
                                  larger limit caps the box at what the buyer has left. */}
                              {p.limit && p.limit.units === 1
                                ? <input type="number" name="units" class="fixed" min="1" max="1" value="1" readonly required />
                                : <input type="number" name="units" min="1" max={String(a ? Math.min(10_000, a.remaining) : 10_000)} value="1" required />}
                              <button type="submit">{t(lang, buying ? "offerButton" : "orderButton")}</button>
                            </form>
                          ) : null}

                        </td>
                      )}
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>
        </table>
        {c.sections.every((s) => s.items.length === 0) && <div class="empty">{t(lang, "emptyList")}</div>}
      </div>
      {canOrder && <ConfirmDialog lang={lang} csrf={p.session!.csrf} mailbox={mailbox} postingId={postingId} buying={buying} to={to} />}
      {canOrder && <script dangerouslySetInnerHTML={{ __html: confirmScript(lang) }} />}
      <p class="faint">{t(lang, buying ? "offerNote" : "availabilityNote")}</p>
    </>
  );
};

/**
 * Asked before an order goes off: what, how many, at what each, the total, and — when the store
 * has a mailbox — whether to be kept posted by EVE mail. The row's own form still posts on its
 * own where the script does not run, so nothing depends on it.
 */
const ConfirmDialog: FC<{ lang: Lang; csrf: string; mailbox: boolean; postingId?: string; buying: boolean; to: string }> = (p) => (
  <dialog id="confirm" class="confirm">
    <form method="post" action="/orders">
      <input type="hidden" name="_csrf" value={p.csrf} />
      <input type="hidden" name="typeId" value="" />
      <input type="hidden" name="units" value="" />
      {p.postingId && <input type="hidden" name="postingId" value={p.postingId} />}
      <h2>{t(p.lang, p.buying ? "confirmOfferTitle" : "confirmTitle")}</h2>
      <div class="item">
        <img data-f="icon" src="" alt="" width="32" height="32" />
        <div data-f="name"></div>
      </div>
      <table class="facts">
        <tr><th>{t(p.lang, "units")}</th><td data-f="units"></td></tr>
        <tr><th>{t(p.lang, p.buying ? "wePayEach" : "priceEach")}</th><td data-f="price"></td></tr>
        <tr><th>{t(p.lang, "total")}</th><td class="total" data-f="total"></td></tr>
      </table>
      <p class="note limit" data-f="limit" hidden></p>

      {p.mailbox && (
        <label class="check">
          <input type="hidden" name="mailUpdatesAsked" value="1" />
          <input type="checkbox" name="mailUpdates" value="1" checked />
          {t(p.lang, "mailUpdatesAsk")}
        </label>
      )}
      <p class="note">{p.buying
        ? t(p.lang, "confirmOfferNote", { to: p.to, myOrders: t(p.lang, "navMyOrders") })
        : t(p.lang, "confirmNote", { myOrders: t(p.lang, "navMyOrders") })}</p>
      <div class="actions">
        <button type="button" class="link" data-close>{t(p.lang, "dialogCancel")}</button>
        <button type="submit" class="primary">{t(p.lang, p.buying ? "sendOffer" : "placeOrder")}</button>
      </div>
      {/* Shown from the click until the next page arrives, which takes a few seconds; the
          buttons are disabled meanwhile so a second click cannot place a second order. */}
      <div class="busy" hidden><span class="hourglass" aria-hidden="true">⌛</span> {t(p.lang, p.buying ? "sendingOffer" : "placingOrder")}</div>
    </form>
  </dialog>
);


/**
 * The tail every confirmation dialog shares: from the click on its own button until the next
 * page arrives it shows "busy" with the buttons disabled and Escape ignored, so a second click
 * cannot act twice; Cancel closes it; coming back to the page resets it.
 */
const busyScript = `
  var acting = dlg.querySelector('form');
  var busy = false;
  acting.addEventListener('submit', function (e) {
    if (busy) { e.preventDefault(); return; }
    busy = true;
    acting.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    dlg.querySelector('.busy').hidden = false;
  });
  dlg.addEventListener('cancel', function (e) { if (busy) e.preventDefault(); });
  dlg.querySelector('[data-close]').addEventListener('click', function () { dlg.close(); });
  window.addEventListener('pageshow', function () {
    busy = false;
    acting.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
    dlg.querySelector('.busy').hidden = true;
  });
`;

/** A value for a script in the page: JSON, with "<" escaped so nothing in it can end the script. */
const scriptValue = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** Fills the dialog from the row's form. Numbers and amounts come out as the page's own do: in
 * the store's language, an amount worded by its catalogue's "{amount} ISK". */
const confirmScript = (lang: Lang) => `
(function () {
  var dlg = document.getElementById('confirm');
  if (!dlg || typeof dlg.showModal !== 'function') return;
  var fmt = new Intl.NumberFormat(${scriptValue(lang)}, { maximumFractionDigits: 0 });
  var iskWords = ${scriptValue(template(lang, "iskAmount"))};
  var isk = function (n) { return iskWords.replace('{amount}', fmt.format(n)); };
  var field = function (k) { return dlg.querySelector('[data-f=' + k + ']'); };
  document.querySelectorAll('form.order').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var units = parseInt(form.querySelector('input[name=units]').value, 10);
      if (!(units > 0)) return;
      var price = Number(form.dataset.price);
      field('name').textContent = form.dataset.name;
      field('icon').src = form.dataset.icon;
      field('units').textContent = fmt.format(units);
      field('price').textContent = isk(price);
      field('total').textContent = isk(units * price);
      field('limit').textContent = form.dataset.limit || '';
      field('limit').hidden = !form.dataset.limit;
      dlg.querySelector('input[name=typeId]').value = form.querySelector('input[name=typeId]').value;

      dlg.querySelector('input[name=units]').value = String(units);
      dlg.showModal();
    });
  });
${busyScript}
})();
`;

/**
 * Asked before an order is cancelled or a web order withdrawn: which order, its total and
 * state, and a word about a contract already made out. The row's own form still posts on its
 * own where the script does not run.
 */
const CancelDialog: FC<{ lang: Lang; csrf: string }> = (p) => (
  <dialog id="cancel" class="confirm">
    <form method="post" action="">
      <input type="hidden" name="_csrf" value={p.csrf} />
      <h2>{t(p.lang, "cancelTitle")}</h2>
      <div class="item">
        <div>
          <div data-f="what"></div>
          <div class="group" data-f="ref"></div>
        </div>
      </div>
      <table class="facts">
        <tr><th>{t(p.lang, "total")}</th><td data-f="total"></td></tr>
        <tr><th>{t(p.lang, "state")}</th><td data-f="state"></td></tr>
      </table>
      <p class="note" data-f="contract" hidden>{t(p.lang, "cancelContractNote")}</p>
      <p class="note">{t(p.lang, "cancelHeardNote")}</p>
      <div class="actions">
        <button type="button" class="link" data-close>{t(p.lang, "keepOrder")}</button>
        <button type="submit" class="bad">{t(p.lang, "cancelOrder")}</button>
      </div>
      <div class="busy" hidden><span class="hourglass" aria-hidden="true">⌛</span> {t(p.lang, "cancelling")}</div>
    </form>
  </dialog>
);

const cancelScript = `
(function () {
  var dlg = document.getElementById('cancel');
  if (!dlg || typeof dlg.showModal !== 'function') return;
  var field = function (k) { return dlg.querySelector('[data-f=' + k + ']'); };
  document.querySelectorAll('form.cancel').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      field('what').textContent = form.dataset.what;
      field('ref').textContent = form.dataset.ref;
      field('total').textContent = form.dataset.total;
      field('state').textContent = form.dataset.state;
      field('contract').hidden = form.dataset.contract !== '1';
      dlg.querySelector('form').action = form.getAttribute('action');
      dlg.showModal();
    });
  });
${busyScript}
})();
`;

// ── The buyer's orders ────────────────────────────────────────────────────

export interface OrdersProps {
  lang: Lang;
  session: Session;
  waiting: WebOrder[];
  orders: OrderRow[];
  /** Who an offer's contract goes to, as the store last said. */
  buyAssignee?: Assignee | null;
}

/** Where an offer to sell stands: the contract to make, the contract made, or paid. */
function offerState(lang: Lang, o: OrderRow, to: string): { cls: string; text: string } {
  switch (o.status) {
    case "completed": return { cls: "good", text: t(lang, "offerPaid") };
    case "canceled":  return { cls: "bad",  text: t(lang, "stateCancelled") };
    default:
      if (o.fulfilment === "contract" && o.contractId)
        return o.contractedPrice != null && o.contractedPrice > o.totalPrice + 0.5
          ? { cls: "warn", text: t(lang, "offerContractAsksMore", { id: String(o.contractId), asked: formatIsk(lang, o.contractedPrice), agreed: formatIsk(lang, o.totalPrice) }) }
          : { cls: "info", text: t(lang, "offerContractReceived", { id: String(o.contractId) }) };
      return { cls: "warn", text: t(lang, "offerMakeContract", { to, amount: formatIsk(lang, o.totalPrice) }) };
  }
}

function orderState(lang: Lang, o: OrderRow, to = ""): { cls: string; text: string } {
  if (o.side === "buy") return offerState(lang, o, to);
  switch (o.status) {
    case "completed": return { cls: "good", text: t(lang, "stateDelivered") };
    case "canceled":  return { cls: "bad",  text: t(lang, "stateCancelled") };
    default:
      switch (o.fulfilment) {
        case "contract": return { cls: "info", text: o.contractId ? t(lang, "stateContract", { id: String(o.contractId) }) : t(lang, "stateContractIssued") };
        case "stock":    return { cls: "good", text: o.estimatedDate ? t(lang, "stateInStockBy", { date: o.estimatedDate }) : t(lang, "stateInStock") };
        case "job":      return { cls: "warn", text: o.estimatedDate ? t(lang, "stateBuildingBy", { date: o.estimatedDate }) : t(lang, "stateBuilding") };
        default:         return { cls: "muted", text: t(lang, "stateWaitingSlot") };
      }
  }
}

function webState(lang: Lang, w: WebOrder): { cls: string; text: string } {
  switch (w.state) {
    case "submitted":        return { cls: "muted", text: t(lang, "webSubmitted") };
    case "review":           return { cls: "warn",  text: t(lang, "webReview") };
    case "rejected":         return { cls: "bad",   text: w.reason ? t(lang, "webDeclinedBecause", { reason: w.reason }) : t(lang, "webDeclined") };
    case "cancelled":        return { cls: "muted", text: t(lang, "webWithdrawn") };
    default:                 return { cls: "muted", text: w.state };
  }
}

/** How the order reached the store. */
function via(lang: Lang, o: OrderRow): string {
  return o.channel === "web" ? t(lang, "viaWebsite") : o.channel === "mail" ? t(lang, "viaMail") : t(lang, "viaStore");
}

export const OrdersPage: FC<OrdersProps> = (p) => {
  const lang = p.lang;
  const typeName = (o: OrderRow) => o.typeName ?? t(lang, "typeFallback", { id: String(o.typeId) });
  const to = p.buyAssignee?.name ?? "";
  // Which way each went, said only where the buyer has done both or sold at all: a column that
  // reads "You buy" on every row says nothing.
  const sold = p.orders.some((o) => o.side === "buy") || p.waiting.some((w) => w.lines.some((l) => l.side === "buy"));
  const direction = (buy: boolean) => <td class="optional dim">{t(lang, buy ? "dirYouSell" : "dirYouBuy")}</td>;
  return (
  <>
    {p.waiting.length > 0 && (
      <div class="panel">
        <h2>{t(lang, "waitingTitle")}</h2>
        <table class="grid">
          <thead>
            <tr><th>{t(lang, "colPlaced")}</th>{sold && <th class="optional">{t(lang, "colDirection")}</th>}<th>{t(lang, "colItems")}</th><th class="num">{t(lang, "total")}</th><th>{t(lang, "state")}</th><th></th></tr>
          </thead>
          <tbody>
            {p.waiting.map((w) => {
              const st = webState(lang, w);
              const lines = w.lines.map((l) => orderLine(lang, l.units, l.name)).join(", ");
              return (
                <tr>
                  <td class="num">{w.createdAt.slice(0, 16).replace("T", " ")}</td>
                  {sold && direction(w.lines.some((l) => l.side === "buy"))}
                  <td>{lines}</td>
                  <td class="num">{formatIsk(lang, w.total)}</td>
                  <td><span class={`state ${st.cls}`}>{st.text}</span></td>
                  <td class="right">
                    {(w.state === "submitted" || w.state === "review") && (
                      <form class="cancel" method="post" action={`/web-orders/${w.id}/cancel`}
                            data-what={lines}
                            data-ref={t(lang, "notYetConfirmed")} data-total={formatIsk(lang, w.total)} data-state={st.text} data-contract="0">
                        <input type="hidden" name="_csrf" value={p.session.csrf} />
                        <button class="bad" type="submit">{t(lang, "cancelOrderButton")}</button>
                      </form>

                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
    <div class="panel">
      <h2>{t(lang, "yourOrders")}</h2>
      {p.orders.length === 0 ? (
        <div class="empty">{t(lang, "noOrders")}</div>
      ) : (
        <table class="grid">
          <thead>
            <tr>
              <th>{t(lang, "colPlaced")}</th>{sold && <th class="optional">{t(lang, "colDirection")}</th>}<th>{t(lang, "colOrderRef")}</th><th>{t(lang, "colItem")}</th><th class="num">{t(lang, "units")}</th><th class="num">{t(lang, "total")}</th>
              <th>{t(lang, "state")}</th><th class="optional">{t(lang, "colVia")}</th><th></th>
            </tr>
          </thead>
          <tbody>
            {p.orders.map((o) => {
              const st = orderState(lang, o, to);
              return (
                <tr>
                  <td class="num">{o.createdAt.slice(0, 10)}</td>
                  {sold && direction(o.side === "buy")}
                  <td>{o.ref}</td>
                  <td><Item typeId={o.typeId} name={typeName(o)} /></td>
                  <td class="num">{formatNumber(lang, o.units)}</td>
                  <td class="num">{formatIsk(lang, o.totalPrice)}</td>
                  <td><span class={`state ${st.cls}`}>{st.text}</span></td>
                  <td class="optional dim">{via(lang, o)}</td>

                  <td class="right">
                    {o.status === "pending" && (
                      <form class="cancel" method="post" action={`/orders/${o.id}/cancel`}
                            data-what={orderLine(lang, o.units, typeName(o))}
                            data-ref={t(lang, "orderRef", { ref: o.ref })} data-total={formatIsk(lang, o.totalPrice)} data-state={st.text}
                            data-contract={o.contractId && o.side !== "buy" ? "1" : "0"}>
                        <input type="hidden" name="_csrf" value={p.session.csrf} />
                        <button class="bad" type="submit">{t(lang, "cancelOrderButton")}</button>
                      </form>

                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p class="faint">{t(lang, "cancelledContractNote")}</p>
    </div>
    <CancelDialog lang={lang} csrf={p.session.csrf} />
    <script dangerouslySetInnerHTML={{ __html: cancelScript }} />
  </>
  );
};
