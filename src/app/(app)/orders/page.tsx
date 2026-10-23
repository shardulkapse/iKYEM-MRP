import Link from "next/link";
import { Field, FormNote } from "@/components/fields";
import { FormDialog } from "@/components/form-dialog";
import { InfoDialog } from "@/components/info-dialog";
import { PageHeader, Streamed } from "@/components/page";
import { SkeletonTable, SkeletonTabs } from "@/components/skeletons";
import { getRole, requireRole } from "@/lib/auth";
import { todayInFactory } from "@/lib/dates";
import { addDays, dayShort, isValidDay } from "@/lib/day";
import { LOCATION_TYPE_LABEL, isLocationType, isPlace, placeName, type Place } from "@/lib/locations";
import { formatRupees, paiseToInput } from "@/lib/money";
import { deliveredPage, lineKey, ordersPageData, type OrderView, type StockCheck } from "@/lib/order-queries";
import { Pager } from "@/components/pager";
import { pageOf, paging } from "@/lib/paging";
import { PERIOD_KINDS, isPeriodKind, periodRange, shiftPeriod, type PeriodKind } from "@/lib/periods";
import { listBallTypes, listGrades } from "@/lib/setup-queries";
import { deleteReceipt, recordPayment, undoDelivery } from "./actions";
import { DeliverDialog } from "./deliver-dialog";
import { LocationFilter, type LocationScope } from "./location-filter";
import { OrderDialog, type OrderInitial } from "./order-dialog";

import "./orders.css";

export const metadata = { title: "Orders" };

export default function OrdersPage({ searchParams }: PageProps<"/orders">) {
  return (
    <>
      <PageHeader title="Orders" sub="Orders are filled from ready stock. Production carries on whether or not an order is waiting." />
      <Streamed fallback={<><SkeletonTabs tabs={3} /><section className="panel"><SkeletonTable rows={5} cols={7} /></section></>}>
        <OrdersBody searchParams={searchParams} />
      </Streamed>
    </>
  );
}

type Names = { type: (id: string) => { name: string; colour: string }; grade: (id: string) => string };

async function OrdersBody({ searchParams }: { searchParams: PageProps<"/orders">["searchParams"] }) {
  await requireRole();
  const [params, today, role, data, allTypes, allGrades] = await Promise.all([searchParams, todayInFactory(), getRole(), ordersPageData(), listBallTypes(), listGrades()]);
  const owner = role === "owner";
  const typeMap = new Map(allTypes.map((t) => [t.id, t]));
  const gradeMap = new Map(allGrades.map((g) => [g.id, g.name]));
  const names: Names = {
    type: (id) => ({ name: typeMap.get(id)?.name ?? "(removed type)", colour: typeMap.get(id)?.colour ?? "red" }),
    grade: (id) => gradeMap.get(id) ?? "(removed grade)",
  };
  const owing = data.owing;
  const tab = params.tab === "collect" || params.tab === "done" ? params.tab : "open";
  const formProps = {
    types: data.types.map((t) => ({ id: t.id, name: t.name })),
    grades: data.grades.map((g) => ({ id: g.id, name: g.name })),
    customers: data.customers,
    usedCountries: data.usedCountries,
    ready: data.ready,
    defaultDue: addDays(today, 14),
  };
  const canOrder = data.types.length > 0 && data.grades.length > 0;

  return (
    <>
      <div className="tabbar-row">
        <nav className="tabs" aria-label="Sections">
          <Link href="/orders" aria-current={tab === "open" ? "page" : undefined} scroll={false}>Open ({data.open.length})</Link>
          <Link href="/orders?tab=collect" aria-current={tab === "collect" ? "page" : undefined} scroll={false}>Money to collect ({owing.length})</Link>
          <Link href="/orders?tab=done" aria-current={tab === "done" ? "page" : undefined} scroll={false}>Delivered</Link>
        </nav>
        {canOrder ? <OrderDialog title="New order" trigger="New order" triggerClassName="btn sm primary" {...formProps} /> : null}
      </div>
      {!canOrder ? <section className="panel empty"><b>Add ball types and grades first</b>Every order line is a ball type and a grade. Set them up in Setup.</section>
        : tab === "open" ? <OpenTab orders={data.open} check={data.check} inProduction={data.inProduction} names={names} today={today} owner={owner} ready={data.ready} formProps={formProps} page={params.page} />
        : tab === "collect" ? <CollectTab orders={owing} names={names} today={today} owner={owner} page={params.page} />
        : <DoneTab names={names} today={today} owner={owner} kind={isPeriodKind(params.period) ? params.period : "month"} ref_={typeof params.ref === "string" && isValidDay(params.ref) ? params.ref : today}
            loc={params.loc} places={params.in} page={params.page} formProps={formProps} />}
    </>
  );
}

/* ------------------------------------------------------------ open orders */

function dueText(due: string, today: string) {
  const n = Math.round((Date.parse(due) - Date.parse(today)) / 86400000);
  return n < 0 ? `${-n} days late` : n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
}

function StockChip({ o, c, today }: { o: OrderView; c?: StockCheck; today: string }) {
  if (!c || !c.need) return <span className="chip draft">Nothing left to send</span>;
  if (c.short === 0) return <span className="chip done">In stock</span>;
  const soon = Date.parse(o.dueOn) - Date.parse(today) <= 7 * 86400000;
  return <span className={`chip ${soon ? "bad" : "progress"}`}>Short {c.short}</span>;
}

function OpenTab({ orders, check, inProduction, names, today, owner, ready, formProps, page }: {
  orders: OrderView[]; check: Record<string, StockCheck>; inProduction: Record<string, number>; names: Names; today: string; owner: boolean; ready: Record<string, number>;
  page: string | string[] | undefined;
  formProps: React.ComponentProps<typeof OrderDialog> extends infer P ? Omit<P, "title" | "trigger"> : never;
}) {
  if (!orders.length) return <section className="panel empty"><b>No open orders</b>When an order comes in, add it with the grade and price. It&apos;s checked against ready stock straight away.</section>;
  // Stock is checked against every open order (earliest due first); only the display is paged.
  const p = paging(page, orders.length);
  return (
    <>
    <div className="tbl card">
      <table>
        <thead><tr><th>Customer</th><th>Due</th><th>Balls</th><th className="num">Value</th><th className="num">Paid</th><th>Stock</th><th /></tr></thead>
        <tbody>
          {pageOf(orders, p).map((o) => {
            const c = check[o.id];
            const deliverLines = Object.entries(o.remaining).filter(([, left]) => left > 0).map(([k, left]) => {
              const [ballTypeId, gradeId] = k.split("|");
              const line = o.lines.find((l) => lineKey(l.ballTypeId, l.gradeId) === k);
              const t = names.type(ballTypeId);
              return { key: k, ballTypeId, gradeId, label: `${t.name}, ${names.grade(gradeId)}`, colour: t.colour, remaining: left, inStock: Math.max(0, ready[k] ?? 0), price: paiseToInput(line?.pricePaise) };
            });
            return (
              <tr key={o.id}>
                <td><b>{o.customer}</b>{o.phone ? <><br /><small className="muted">{o.phone}</small></> : null}<LocationLine o={o} />{o.notes ? <><br /><small className="muted">{o.notes}</small></> : null}</td>
                <td className={`nw ${o.dueOn < today ? "bad" : ""}`}>{dayShort(o.dueOn)}<br /><small className="muted">{dueText(o.dueOn, today)}</small></td>
                <td style={{ fontSize: 13.5 }}>
                  {o.lines.map((l) => {
                    const t = names.type(l.ballTypeId);
                    const sent = o.delivered[lineKey(l.ballTypeId, l.gradeId)];
                    return <div key={l.id}><span className={`swatch sw-${t.colour}`} />{l.qty} {t.name}, {names.grade(l.gradeId)} at {formatRupees(l.pricePaise)}{sent ? <span className="muted"> ({sent} sent)</span> : null}</div>;
                  })}
                </td>
                <td className="num">{formatRupees(o.valuePaise)}</td>
                <td className="num">{o.receivedPaise ? formatRupees(o.receivedPaise) : <span className="muted">—</span>}</td>
                <td>
                  <StockChip o={o} c={c} today={today} />
                  {c ? Object.entries(c.lines).filter(([, x]) => x.short > 0).map(([k, x]) => {
                    const [t, g] = k.split("|");
                    return <div key={k}><small className="muted">Make {x.short} {names.type(t).name}, {names.grade(g)}{inProduction[t] ? ` (${inProduction[t]} of this type in production)` : ""}</small></div>;
                  }) : null}
                </td>
                <td className="nw">
                  <span className="row-actions">
                    {deliverLines.length ? <DeliverDialog orderId={o.id} customer={o.customer} receivedPaise={o.receivedPaise} lines={deliverLines} today={today} /> : null}
                    <PaymentButton o={o} today={today} />
                    <OrderDialog
                      title={`Edit order: ${o.customer}`}
                      trigger="Edit"
                      initial={initialOf(o)}
                      delivered={o.delivered}
                      canDelete={!o.deliveries.length && !o.receipts.length}
                      {...formProps}
                    />
                    <OrderDetails o={o} names={names} owner={owner} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <Pager p={p} href="/orders" noun={["order", "orders"]} />
    </>
  );
}

/* ------------------------------------------------------------ location */

// What the edit form starts with for an existing order.
function initialOf(o: OrderView): OrderInitial {
  return {
    id: o.id, customer: o.customer, phone: o.phone ?? "", dueOn: o.dueOn, notes: o.notes ?? "",
    locationType: o.locationType, locationCode: o.locationCode ?? "", locationNote: o.locationNote ?? "",
    lines: o.lines.map((l) => ({ ballTypeId: l.ballTypeId, gradeId: l.gradeId, qty: l.qty, price: paiseToInput(l.pricePaise) })),
  };
}

// "Maharashtra", or "United Kingdom · International"
function locationText(o: OrderView) {
  if (!o.locationType) return null;
  const name = placeName(o.locationType, o.locationCode);
  return o.locationType === "international" ? `${name} · International` : name;
}

function LocationLine({ o }: { o: OrderView }) {
  const t = locationText(o);
  return t ? <><br /><small className="muted">{t}{o.locationNote ? `, ${o.locationNote}` : ""}</small></> : null;
}

/* ------------------------------------------------------------ payments */

function PaymentButton({ o, today, label = "Payment", primary }: { o: OrderView; today: string; label?: string; primary?: boolean }) {
  const due = o.deliveries.length ? o.owedPaise : o.balancePaise;
  return (
    <FormDialog title={`Payment from ${o.customer}`} trigger={label} triggerClassName={primary ? "btn sm primary" : "btn sm"} submitLabel="Record payment" action={recordPayment}>
      <input type="hidden" name="orderId" value={o.id} />
      <FormNote>
        Order worth <b>{formatRupees(o.valuePaise)}</b>{o.deliveries.length ? `, ${formatRupees(o.deliveredValuePaise)} delivered so far` : ", nothing delivered yet"}. Received <b>{formatRupees(o.receivedPaise)}</b>.
      </FormNote>
      <Field label={o.deliveries.length ? "Amount received (₹)" : "Advance received (₹)"}><input name="amount" inputMode="decimal" defaultValue={due ? paiseToInput(due) : ""} required /></Field>
      <Field label="Received on"><input name="receivedOn" type="date" defaultValue={today} max={today} required /></Field>
      <Field label="Paid by"><select name="mode" defaultValue="online"><option value="online">Online</option><option value="cash">Cash</option></select></Field>
      <Field label="Note"><input name="note" placeholder="UPI reference, advance…" /></Field>
    </FormDialog>
  );
}

function PaymentsList({ o, owner }: { o: OrderView; owner: boolean }) {
  if (!o.receipts.length) return <span className="muted">None yet</span>;
  return (
    <div className="pays">
      {o.receipts.map((r) => (
        <div key={r.id}>
          {dayShort(r.receivedOn)}: {formatRupees(r.amountPaise)} <span className="muted">{r.mode === "cash" ? "Cash" : "Online"}</span>
          {owner ? (
            <FormDialog title="Delete this payment?" trigger="✕" triggerClassName="x" submitLabel="Delete payment" action={deleteReceipt}>
              <input type="hidden" name="receiptId" value={r.id} />
              <FormNote>{formatRupees(r.amountPaise)} received {dayShort(r.receivedOn)} from {o.customer}. They&apos;ll show as owing it again.</FormNote>
            </FormDialog>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ order details */

function OrderDetails({ o, names, owner }: { o: OrderView; names: Names; owner: boolean }) {
  return (
    <InfoDialog title={o.customer} trigger="View">
      <dl className="kv">
        <dt>Due</dt><dd>{dayShort(o.dueOn)}</dd>
        <dt>Location</dt><dd>{o.locationType ? <>{placeName(o.locationType, o.locationCode)} <span className="muted">({LOCATION_TYPE_LABEL[o.locationType]})</span>{o.locationNote ? <><br /><span className="muted">{o.locationNote}</span></> : null}</> : <span className="muted">Not set</span>}</dd>
        <dt>Status</dt><dd>{o.status === "closed" ? "Delivered" : "Open"}</dd>
        <dt>Order value</dt><dd>{formatRupees(o.valuePaise)}</dd>
        <dt>Delivered</dt><dd>{formatRupees(o.deliveredValuePaise)}</dd>
        <dt>Received</dt><dd>{formatRupees(o.receivedPaise)}</dd>
        <dt>Still owed</dt><dd>{formatRupees(o.owedPaise)}</dd>
      </dl>
      <h4>Lines</h4>
      <div className="tbl"><table>
        <thead><tr><th>Balls</th><th className="num">Ordered</th><th className="num">Delivered</th><th className="num">Left</th><th className="num">Price</th></tr></thead>
        <tbody>{o.lines.map((l) => { const k = lineKey(l.ballTypeId, l.gradeId); const t = names.type(l.ballTypeId); return (
          <tr key={l.id}><td><span className={`swatch sw-${t.colour}`} />{t.name}, {names.grade(l.gradeId)}</td><td className="num">{l.qty}</td><td className="num">{o.delivered[k] ?? 0}</td><td className="num">{o.remaining[k] ?? 0}</td><td className="num">{formatRupees(l.pricePaise)}</td></tr>
        ); })}</tbody>
      </table></div>
      <h4>Deliveries</h4>
      {o.deliveries.length ? (
        <div className="list">{o.deliveries.map((d) => (
          <div key={d.id} className="row">
            <span>{dayShort(d.deliveredOn)}: {d.lines.map((l) => `${l.qty} ${names.type(l.ballTypeId).name}, ${names.grade(l.gradeId)}`).join("; ")}<br /><small className="muted">{formatRupees(d.valuePaise)}</small></span>
            {owner ? (
              <FormDialog title="Undo this delivery?" trigger="Undo" submitLabel="Undo delivery" action={undoDelivery}>
                <input type="hidden" name="deliveryId" value={d.id} />
                <FormNote>The balls go back into ready stock, the sale is removed, and the order reopens. Payments stay as they are.</FormNote>
              </FormDialog>
            ) : null}
          </div>
        ))}</div>
      ) : <p className="muted">None yet.</p>}
      <h4>Payments</h4>
      <PaymentsList o={o} owner={owner} />
    </InfoDialog>
  );
}

/* ------------------------------------------------------------ money to collect */

function CollectTab({ orders, names, today, owner, page }: { orders: OrderView[]; names: Names; today: string; owner: boolean; page: string | string[] | undefined }) {
  if (!orders.length) return <section className="panel empty"><b>Nobody owes you money</b>Delivered orders show here until they&apos;re paid in full.</section>;
  const days = (o: OrderView) => Math.round((Date.parse(today) - Date.parse(o.lastDelivery ?? today)) / 86400000);
  const total = orders.reduce((a, o) => a + o.owedPaise, 0);
  const old = orders.filter((o) => days(o) > 30).reduce((a, o) => a + o.owedPaise, 0);
  const p = paging(page, orders.length);
  return (
    <>
      <div className="strip plain">
        <div className="alert"><b>{formatRupees(total)}</b><span>Still to collect</span></div>
        <div><b>{orders.length}</b><span>Orders</span></div>
        <div className={old ? "alert" : ""}><b>{formatRupees(old)}</b><span>Waiting over 30 days</span></div>
      </div>
      <div className="tbl card">
        <table>
          <thead><tr><th>Customer</th><th>Last delivery</th><th className="num">Delivered worth</th><th>Payments so far</th><th className="num">Still owed</th><th /></tr></thead>
          <tbody>
            {pageOf(orders, p).map((o) => (
              <tr key={o.id}>
                <td><b>{o.customer}</b><LocationLine o={o} />{o.status === "open" ? <><br /><small className="muted">Part delivered</small></> : null}</td>
                <td className="nw">{o.lastDelivery ? dayShort(o.lastDelivery) : "—"}<br /><small className={days(o) > 30 ? "bad" : "muted"}>{days(o)} days ago</small></td>
                <td className="num">{formatRupees(o.deliveredValuePaise)}</td>
                <td><PaymentsList o={o} owner={owner} /></td>
                <td className="num"><b>{formatRupees(o.owedPaise)}</b></td>
                <td className="nw"><span className="row-actions"><PaymentButton o={o} today={today} label="Payment received" primary /><OrderDetails o={o} names={names} owner={owner} /></span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager p={p} href="/orders?tab=collect" noun={["order", "orders"]} />
    </>
  );
}

/* ------------------------------------------------------------ delivered archive */

async function DoneTab({ names, today, owner, kind, ref_, loc, places, page, formProps }: {
  names: Names; today: string; owner: boolean; kind: PeriodKind; ref_: string;
  loc: string | string[] | undefined; places: string | string[] | undefined; page: string | string[] | undefined;
  formProps: Omit<React.ComponentProps<typeof OrderDialog>, "title" | "trigger">;
}) {
  const p = periodRange(kind, ref_);
  const prevRef = shiftPeriod(kind, ref_, -1);
  const nextRef = shiftPeriod(kind, ref_, 1);
  const nextOk = periodRange(kind, nextRef).from <= today;

  // Location filter: ?loc=domestic|international|unset and, for the first two, ?in=MH,KA
  const scope: LocationScope = isLocationType(loc) || loc === "unset" ? loc : "";
  const picked = isLocationType(scope) && typeof places === "string" ? [...new Set(places.split(","))].filter((c) => isPlace(scope, c)) : [];
  const keep = `${scope ? `&loc=${scope}` : ""}${picked.length ? `&in=${picked.join(",")}` : ""}`;
  const href = (k: PeriodKind, r: string) => `/orders?tab=done&period=${k}&ref=${r}${keep}`;
  const { orders: completed, paging: pg, balls, sales, cash, online, places: used, hasUnset } = await deliveredPage(p.from, p.to, { scope, places: picked }, page);
  const optionsFor = (t: "domestic" | "international"): Place[] =>
    used.filter((u) => u.t === t).map((u) => ({ code: u.code, name: placeName(t, u.code) })).sort((a, b) => a.name.localeCompare(b.name, "en"));

  return (
    <>
      <div className="periodbar">
        <span className="seg">{PERIOD_KINDS.map((k) => <Link key={k.key} href={href(k.key, ref_)} aria-current={k.key === kind ? "page" : undefined} scroll={false}>{k.label}</Link>)}</span>
        <Link className="btn sm" href={href(kind, prevRef)} scroll={false} aria-label="Previous period">‹</Link>
        <b>{p.label}</b>
        {nextOk ? <Link className="btn sm" href={href(kind, nextRef)} scroll={false} aria-label="Next period">›</Link> : <span className="btn sm" aria-disabled="true">›</span>}
        {p.sub ? <span className="muted">{p.sub}</span> : null}
      </div>
      <LocationFilter scope={scope} selected={picked} options={{ domestic: optionsFor("domestic"), international: optionsFor("international") }}
        hasUnset={hasUnset} period={kind} refDay={ref_} />
      <div className="strip plain">
        <div><b>{pg.total}</b><span>Orders completed</span></div>
        <div><b>{balls}</b><span>Balls delivered</span></div>
        <div className="hero"><b>{formatRupees(sales)}</b><span>Sales</span></div>
        <div><b>{formatRupees(cash + online)}</b><span>Received: {formatRupees(cash)} cash, {formatRupees(online)} online</span></div>
      </div>
      {completed.length ? (
        <div className="tbl card">
          <table>
            <thead><tr><th>Customer</th><th>Location</th><th>Completed</th><th className="num">Balls</th><th className="num">Sold for</th><th>Payment</th><th /></tr></thead>
            <tbody>
              {completed.map((o) => (
                <tr key={o.id}>
                  <td><b>{o.customer}</b></td>
                  <td>{o.locationType ? <>{placeName(o.locationType, o.locationCode)}<br /><small className="muted">{LOCATION_TYPE_LABEL[o.locationType]}{o.locationNote ? `, ${o.locationNote}` : ""}</small></> : <span className="muted">Not set</span>}</td>
                  <td className="nw">{o.lastDelivery ? dayShort(o.lastDelivery) : "—"}</td>
                  <td className="num">{o.ballsDelivered}</td>
                  <td className="num">{formatRupees(o.deliveredValuePaise)}</td>
                  <td>{o.owedPaise === 0 ? <span className="chip done">Paid</span> : <span className={`chip ${o.receivedPaise ? "progress" : "bad"}`}>{formatRupees(o.owedPaise)} owed</span>}</td>
                  <td className="nw"><span className="row-actions"><OrderDialog title={`Edit order: ${o.customer}`} trigger="Edit" initial={initialOf(o)} delivered={o.delivered} canDelete={false} {...formProps} /><OrderDetails o={o} names={names} owner={owner} /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : scope ? <section className="panel empty"><b>No orders completed here in this period</b>Nothing delivered in this period matches the location filter. Clear it or pick another period.</section>
        : <section className="panel empty"><b>No orders completed in this period</b>Orders land here once everything on them is delivered. Sales above count every delivery in the period, including part deliveries.</section>}
      <Pager p={pg} href={href(kind, ref_)} noun={["order", "orders"]} />
      {scope ? <p className="hint" style={{ marginTop: 12 }}>The figures above only count orders that match the location filter.</p> : null}
      <p className="hint" style={{ marginTop: 12 }}>Costs, wages and what&apos;s left over for each period come with the Money screen.</p>
    </>
  );
}
