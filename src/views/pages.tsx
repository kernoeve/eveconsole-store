import type { FC } from "hono/jsx";
import type { Session } from "../env";
import type { Catalogue, CatalogueItem, Limit, OrderRow, StoreInfo } from "../protocol";
import type { WebOrder } from "../orders";
import { allowanceFor, allowanceWords, describeLimit } from "../limits";
import { raw } from "hono/html";
import { renderBlurb } from "../markup";


const isk = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const formatIsk = (n: number) => `${isk.format(n)} ISK`;
export const formatUnits = (n: number) => isk.format(n);

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

// ── The price list ────────────────────────────────────────────────────────

export interface CatalogueProps {
  store: StoreInfo;
  catalogue: Catalogue;
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

function stateOf(i: CatalogueItem, available: number): { cls: string; text: string } {
  if (i.unitPrice == null) return { cls: "muted", text: "" };
  if (available > 0) return { cls: "good", text: `${formatUnits(available)} available now` };
  if (i.inBuild > 0) return { cls: "warn", text: `${formatUnits(i.inBuild)} in build` };
  return { cls: "muted", text: "Built to order" };
}

/** The owner's words, as HTML. With block tags the owner has done the layout; without them a
 * blank line starts a paragraph and every other newline is kept, as plain text always was. */
const Blurb: FC<{ text: string }> = ({ text }) => {
  const whole = renderBlurb(text);
  if (whole.blocks) return <div class="panel blurb html">{raw(whole.html)}</div>;
  return <div class="panel blurb">{text.split(/\n\s*\n/).map((para) => <p>{raw(renderBlurb(para).html)}</p>)}</div>;
};

export const CataloguePage: FC<CatalogueProps> = (p) => {
  const c = p.catalogue;
  const canOrder = !!p.session && p.allowed;
  // The mail question is only worth asking when the store has a mailbox and writes from it.
  const mailbox  = p.store.mailUpdates === true;


  const showColumns = { stock: c.showInStock, build: c.showInBuild, reserved: c.showReserved };
  return (
    <>
      {p.banner && (
        <div class="banner"><img src={`/banner?v=${p.banner}`} alt="" /></div>
      )}
      {p.store.blurb && <Blurb text={p.store.blurb} />}
      {/* Nothing about who issues contracts or where to collect is guessed: the owner's own
          words above are the only place such things are said. */}

      {!p.session && (
        <div class="flash info">Sign in with EVE to place an order. Prices are as listed at the moment you order.</div>
      )}
      {p.session && !p.allowed && (
        <div class="flash bad">This shop serves a list of buyers, and {p.session.name} is not on it.</div>
      )}
      {p.limit && (
        <p class="note" style="margin-top:12px">
          This store limits each buyer to {describeLimit(p.limit)}. What you may no longer order is greyed out.
        </p>
      )}

      <div class="panel" style="padding:0 0 8px">
        <table class="grid">
          <thead>
            <tr>
              <th>Item</th>
              <th class="num">Price</th>
              <th>Availability</th>
              {showColumns.stock && <th class="num optional">In stock</th>}
              {showColumns.build && <th class="num optional">In build</th>}
              {showColumns.reserved && <th class="num optional">Reserved</th>}
              {canOrder && <th class="right">Order</th>}
            </tr>
          </thead>
          <tbody>
            {c.sections.map((s) => (
              <>
                <tr class="section">
                  <td colspan={7}>{s.name}</td>

                </tr>
                {s.items.map((i) => {
                  const available = availableNow(i, p.pending);
                  const st = stateOf(i, available);
                  // Against the store's limit, when it has one and the buyer is known.
                  const a = p.limit && p.taken ? allowanceFor(p.limit, p.taken, i.typeId, i.groupId) : null;
                  const blocked = a !== null && a.remaining === 0 && i.unitPrice != null;

                  const rowStyle = c.colourByState
                    ? `color:${available > 0 ? c.colourInStock : i.inBuild > 0 ? c.colourInBuild : c.colourNone}`
                    : i.colour ? `color:${i.colour}` : s.rowColour ? `color:${s.rowColour}` : undefined;
                  return (
                    <tr style={rowStyle} class={blocked ? "ineligible" : undefined}>
                      <td><Item typeId={i.typeId} name={i.name} group={i.groupName} /></td>
                      <td class="num">{i.unitPrice != null ? formatIsk(i.unitPrice) : <span class="dim">not for sale</span>}</td>
                      <td>
                        {blocked ? (
                          <span class="state muted">Limit reached</span>
                        ) : (
                          <>
                            {st.text ? <span class={`state ${st.cls}`}>{st.text}</span> : null}
                            {c.showCompletionDate && i.earliestJobEnd && available === 0 && i.inBuild > 0 && (
                              <span class="dim"> · earliest {i.earliestJobEnd.slice(0, 10)}</span>
                            )}
                          </>
                        )}
                      </td>

                      {showColumns.stock && <td class="num optional">{formatUnits(i.inStock)}</td>}
                      {showColumns.build && <td class="num optional">{formatUnits(i.inBuild)}</td>}
                      {showColumns.reserved && <td class="num optional">{formatUnits(i.reserved)}</td>}
                      {canOrder && (
                        <td>
                          {i.unitPrice != null && !blocked ? (
                            <form class="order" method="post" action="/orders"
                                  data-name={i.name} data-price={String(i.unitPrice)} data-icon={iconUrl(i.typeId)}
                                  data-limit={a ? allowanceWords(p.limit!, a) : undefined}>
                              <input type="hidden" name="_csrf" value={p.session!.csrf} />
                              <input type="hidden" name="typeId" value={String(i.typeId)} />
                              {/* One unit each and the box is fixed at 1 (read-only, so it still posts); a
                                  larger limit caps the box at what the buyer has left. */}
                              {p.limit && p.limit.units === 1
                                ? <input type="number" name="units" class="fixed" min="1" max="1" value="1" readonly required />
                                : <input type="number" name="units" min="1" max={String(a ? Math.min(10_000, a.remaining) : 10_000)} value="1" required />}
                              <button type="submit">Order</button>
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
        {c.sections.every((s) => s.items.length === 0) && <div class="empty">Nothing on the price list yet.</div>}
      </div>
      {canOrder && <ConfirmDialog csrf={p.session!.csrf} mailbox={mailbox} />}
      {canOrder && <script dangerouslySetInnerHTML={{ __html: confirmScript }} />}
      <p class="faint">

        Availability is as the store's system last reported it. An order is confirmed once the
        store has taken it, usually within a couple of minutes; until then it is listed as sent.
      </p>
    </>
  );
};

/**
 * Asked before an order goes off: what, how many, at what each, the total, and — when the store
 * has a mailbox — whether to be kept posted by EVE mail. The row's own form still posts on its
 * own where the script does not run, so nothing depends on it.
 */
const ConfirmDialog: FC<{ csrf: string; mailbox: boolean }> = (p) => (
  <dialog id="confirm" class="confirm">
    <form method="post" action="/orders">
      <input type="hidden" name="_csrf" value={p.csrf} />
      <input type="hidden" name="typeId" value="" />
      <input type="hidden" name="units" value="" />
      <h2>Confirm your order</h2>
      <div class="item">
        <img data-f="icon" src="" alt="" width="32" height="32" />
        <div data-f="name"></div>
      </div>
      <table class="facts">
        <tr><th>Units</th><td data-f="units"></td></tr>
        <tr><th>Price each</th><td data-f="price"></td></tr>
        <tr><th>Total</th><td class="total" data-f="total"></td></tr>
      </table>
      <p class="note limit" data-f="limit" hidden></p>

      {p.mailbox && (
        <label class="check">
          <input type="hidden" name="mailUpdatesAsked" value="1" />
          <input type="checkbox" name="mailUpdates" value="1" checked />
          Keep me posted by EVE mail as this order moves
        </label>
      )}
      <p class="note">The price is as listed now. The store confirms the order within a couple of minutes, and it can be cancelled from My orders until it is contracted.</p>
      <div class="actions">
        <button type="button" class="link" data-close>Cancel</button>
        <button type="submit" class="primary">Place order</button>
      </div>
      {/* Shown from the click until the next page arrives, which takes a few seconds; the
          buttons are disabled meanwhile so a second click cannot place a second order. */}
      <div class="busy" hidden><span class="hourglass" aria-hidden="true">⌛</span> Placing your order… this takes a few seconds.</div>
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

const confirmScript = `
(function () {
  var dlg = document.getElementById('confirm');
  if (!dlg || typeof dlg.showModal !== 'function') return;
  var fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
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
      field('price').textContent = fmt.format(price) + ' ISK';
      field('total').textContent = fmt.format(units * price) + ' ISK';
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
const CancelDialog: FC<{ csrf: string }> = (p) => (
  <dialog id="cancel" class="confirm">
    <form method="post" action="">
      <input type="hidden" name="_csrf" value={p.csrf} />
      <h2>Cancel this order?</h2>
      <div class="item">
        <div>
          <div data-f="what"></div>
          <div class="group" data-f="ref"></div>
        </div>
      </div>
      <table class="facts">
        <tr><th>Total</th><td data-f="total"></td></tr>
        <tr><th>State</th><td data-f="state"></td></tr>
      </table>
      <p class="note" data-f="contract" hidden>A contract is already made out for it. Cancelling tells the store to withdraw it; the contract itself stays until they remove it in game.</p>
      <p class="note">The store hears of it at its next check-in, usually within a couple of minutes.</p>
      <div class="actions">
        <button type="button" class="link" data-close>Keep the order</button>
        <button type="submit" class="bad">Cancel the order</button>
      </div>
      <div class="busy" hidden><span class="hourglass" aria-hidden="true">⌛</span> Cancelling… this takes a few seconds.</div>
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
  session: Session;
  waiting: WebOrder[];
  orders: OrderRow[];
}

function orderState(o: OrderRow): { cls: string; text: string } {
  switch (o.status) {
    case "completed": return { cls: "good", text: "Delivered" };
    case "canceled":  return { cls: "bad",  text: "Cancelled" };
    default:
      switch (o.fulfilment) {
        case "contract": return { cls: "info", text: o.contractId ? `Contract ${o.contractId} — accept it in game` : "Contract issued" };
        case "stock":    return { cls: "good", text: o.estimatedDate ? `In stock · expected ${o.estimatedDate}` : "In stock" };
        case "job":      return { cls: "warn", text: o.estimatedDate ? `Being built · expected ${o.estimatedDate}` : "Being built" };
        default:         return { cls: "muted", text: "Confirmed · waiting for a build slot" };
      }
  }
}

function webState(w: WebOrder): { cls: string; text: string } {
  switch (w.state) {
    case "submitted":        return { cls: "muted", text: "Sent to the store — not confirmed yet" };
    case "review":           return { cls: "warn",  text: "The store is looking at it" };
    case "rejected":         return { cls: "bad",   text: w.reason ? `Declined — ${w.reason}` : "Declined" };
    case "cancelled":        return { cls: "muted", text: "Withdrawn" };
    default:                 return { cls: "muted", text: w.state };
  }
}

export const OrdersPage: FC<OrdersProps> = (p) => (
  <>
    {p.waiting.length > 0 && (
      <div class="panel">
        <h2>Waiting on the store</h2>
        <table class="grid">
          <thead>
            <tr><th>Placed</th><th>Items</th><th class="num">Total</th><th>State</th><th></th></tr>
          </thead>
          <tbody>
            {p.waiting.map((w) => {
              const st = webState(w);
              return (
                <tr>
                  <td class="num">{w.createdAt.slice(0, 16).replace("T", " ")}</td>
                  <td>{w.lines.map((l) => `${formatUnits(l.units)} × ${l.name}`).join(", ")}</td>
                  <td class="num">{formatIsk(w.total)}</td>
                  <td><span class={`state ${st.cls}`}>{st.text}</span></td>
                  <td class="right">
                    {(w.state === "submitted" || w.state === "review") && (
                      <form class="cancel" method="post" action={`/web-orders/${w.id}/cancel`}
                            data-what={w.lines.map((l) => `${formatUnits(l.units)} × ${l.name}`).join(", ")}
                            data-ref="Not yet confirmed by the store" data-total={formatIsk(w.total)} data-state={st.text} data-contract="0">
                        <input type="hidden" name="_csrf" value={p.session.csrf} />
                        <button class="bad" type="submit">Cancel</button>
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
      <h2>Your orders</h2>
      {p.orders.length === 0 ? (
        <div class="empty">No orders in your name yet.</div>
      ) : (
        <table class="grid">
          <thead>
            <tr>
              <th>Placed</th><th>Order</th><th>Item</th><th class="num">Units</th><th class="num">Total</th>
              <th>State</th><th class="optional">Via</th><th></th>
            </tr>
          </thead>
          <tbody>
            {p.orders.map((o) => {
              const st = orderState(o);
              return (
                <tr>
                  <td class="num">{o.createdAt.slice(0, 10)}</td>
                  <td>{o.ref}</td>
                  <td><Item typeId={o.typeId} name={o.typeName ?? `Type ${o.typeId}`} /></td>
                  <td class="num">{formatUnits(o.units)}</td>
                  <td class="num">{formatIsk(o.totalPrice)}</td>
                  <td><span class={`state ${st.cls}`}>{st.text}</span></td>
                  <td class="optional dim">{o.channel === "web" ? "website" : o.channel === "mail" ? "EVE mail" : "the store"}</td>

                  <td class="right">
                    {o.status === "pending" && (
                      <form class="cancel" method="post" action={`/orders/${o.id}/cancel`}
                            data-what={`${formatUnits(o.units)} × ${o.typeName ?? `Type ${o.typeId}`}`}
                            data-ref={`Order ${o.ref}`} data-total={formatIsk(o.totalPrice)} data-state={st.text}
                            data-contract={o.contractId ? "1" : "0"}>
                        <input type="hidden" name="_csrf" value={p.session.csrf} />
                        <button class="bad" type="submit">Cancel</button>
                      </form>

                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p class="faint">
        Cancelling an order with a contract already made out tells the store to withdraw it; the
        contract itself is theirs to remove in game.
      </p>
    </div>
    <CancelDialog csrf={p.session.csrf} />
    <script dangerouslySetInnerHTML={{ __html: cancelScript }} />
  </>
);

