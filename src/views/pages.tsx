import type { FC } from "hono/jsx";
import type { Session } from "../env";
import type { Catalogue, CatalogueItem, OrderRow, StoreInfo } from "../protocol";
import type { WebOrder } from "../orders";

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

export const CataloguePage: FC<CatalogueProps> = (p) => {
  const c = p.catalogue;
  const canOrder = !!p.session && p.allowed;
  // The mail question is only worth asking when the store has a mailbox and writes from it.
  const mailbox  = p.store.mailUpdates === true;


  const showColumns = { stock: c.showInStock, build: c.showInBuild, reserved: c.showReserved };
  return (
    <>
      {p.store.blurb && (
        <div class="panel blurb">
          {p.store.blurb.split(/\n\s*\n/).map((para) => <p>{para}</p>)}
        </div>
      )}
      {/* Nothing about who issues contracts or where to collect is guessed: the owner's own
          words above are the only place such things are said. */}

      {!p.session && (
        <div class="flash info">Sign in with EVE to place an order. Prices are as listed at the moment you order.</div>
      )}
      {p.session && !p.allowed && (
        <div class="flash bad">This shop serves a list of buyers, and {p.session.name} is not on it.</div>
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
                  <td colspan={7}>{s.prefix ? `${s.prefix} ` : ""}{s.name}</td>
                </tr>
                {s.items.map((i) => {
                  const available = availableNow(i, p.pending);
                  const st = stateOf(i, available);
                  const rowStyle = c.colourByState
                    ? `color:${available > 0 ? c.colourInStock : i.inBuild > 0 ? c.colourInBuild : c.colourNone}`
                    : i.colour ? `color:${i.colour}` : s.rowColour ? `color:${s.rowColour}` : undefined;
                  return (
                    <tr style={rowStyle}>
                      <td><Item typeId={i.typeId} name={i.name} group={i.groupName} /></td>
                      <td class="num">{i.unitPrice != null ? formatIsk(i.unitPrice) : <span class="dim">not for sale</span>}</td>
                      <td>
                        {st.text ? <span class={`state ${st.cls}`}>{st.text}</span> : null}
                        {c.showCompletionDate && i.earliestJobEnd && available === 0 && i.inBuild > 0 && (
                          <span class="dim"> · earliest {i.earliestJobEnd.slice(0, 10)}</span>
                        )}
                      </td>
                      {showColumns.stock && <td class="num optional">{formatUnits(i.inStock)}</td>}
                      {showColumns.build && <td class="num optional">{formatUnits(i.inBuild)}</td>}
                      {showColumns.reserved && <td class="num optional">{formatUnits(i.reserved)}</td>}
                      {canOrder && (
                        <td>
                          {i.unitPrice != null ? (
                            <form class="order" method="post" action="/orders"
                                  data-name={i.name} data-price={String(i.unitPrice)} data-icon={iconUrl(i.typeId)}>

                              <input type="hidden" name="_csrf" value={p.session!.csrf} />
                              <input type="hidden" name="typeId" value={String(i.typeId)} />
                              <input type="number" name="units" min="1" max="10000" value="1" required />
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
    </form>
  </dialog>
);

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
      dlg.querySelector('input[name=typeId]').value = form.querySelector('input[name=typeId]').value;
      dlg.querySelector('input[name=units]').value = String(units);
      dlg.showModal();
    });
  });
  dlg.querySelector('[data-close]').addEventListener('click', function () { dlg.close(); });
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
                      <form method="post" action={`/web-orders/${w.id}/cancel`}>
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
                  <td class="optional dim">{o.channel === "web" ? "this site" : o.channel === "mail" ? "EVE mail" : "the store"}</td>
                  <td class="right">
                    {o.status === "pending" && (
                      <form method="post" action={`/orders/${o.id}/cancel`}>
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
  </>
);
