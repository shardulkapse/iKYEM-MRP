import Link from "next/link";
import { Field, FormNote } from "@/components/fields";
import { FormDialog } from "@/components/form-dialog";
import { Streamed } from "@/components/page";
import { Pager } from "@/components/pager";
import { Sk, SkeletonStrip, SkeletonTable } from "@/components/skeletons";
import { getRole, requireRole } from "@/lib/auth";
import { customerDetail } from "@/lib/customer-queries";
import { todayInFactory } from "@/lib/dates";
import { dayShort } from "@/lib/day";
import { LOCATION_TYPE_LABEL, placeName } from "@/lib/locations";
import { formatRupees } from "@/lib/money";
import { periodRange } from "@/lib/periods";
import { listBallTypes, listGrades } from "@/lib/setup-queries";
import { OrderDetails, PaymentButton, makeNames } from "../../orders/order-bits";
import { deleteCustomer, saveCustomer } from "../actions";
import "../customers.css";

export const metadata = { title: "Customer" };

export default function CustomerPage({ params, searchParams }: PageProps<"/customers/[id]">) {
  return (
    <>
      <Link className="back" href="/customers">‹ Customers</Link>
      <Streamed fallback={<><div className="top"><div><Sk w={260} h={30} /><Sk w={300} h={14} style={{ marginTop: 10 }} /></div></div><SkeletonStrip plain /><section className="panel"><SkeletonTable rows={6} cols={6} /></section></>}>
        <Customer params={params} searchParams={searchParams} />
      </Streamed>
    </>
  );
}

// 2026 -> "FY 2026–27" style label from the shared periods helper
const fyLabel = (fy: number) => periodRange("year", `${fy}-04-01`).label;

async function Customer({ params, searchParams }: { params: PageProps<"/customers/[id]">["params"]; searchParams: PageProps<"/customers/[id]">["searchParams"] }) {
  await requireRole();
  const [{ id }, sp, today, role, types, grades] = await Promise.all([params, searchParams, todayInFactory(), getRole(), listBallTypes(), listGrades()]);
  const data = await customerDetail(id, sp.page, sp.ppage);
  if (!data) {
    return <section className="panel empty"><b>This customer isn&apos;t on the list</b>The link may be out of date. <Link href="/customers">See all customers</Link></section>;
  }
  const { customer: c, totals: t } = data;
  const owner = role === "owner";
  const names = makeNames(types, grades);
  const path = `/customers/${c.id}`;
  const facts = [c.phone, t.first ? `Customer since ${dayShort(t.first)}` : null].filter(Boolean).join(" · ");

  return (
    <>
      <div className="top">
        <div>
          <h1>{c.name}</h1>
          {facts ? <p>{facts}</p> : null}
        </div>
        <div className="row-actions">
          <FormDialog title={`Edit ${c.name}`} trigger="Edit details" triggerClassName="btn" action={saveCustomer}>
            <input type="hidden" name="id" value={c.id} />
            <Field label="Name"><input name="name" defaultValue={c.name} required autoComplete="off" /></Field>
            <Field label="Phone"><input name="phone" defaultValue={c.phone ?? ""} inputMode="tel" /></Field>
            <Field label="Notes" full><textarea name="notes" defaultValue={c.notes ?? ""} rows={3} placeholder="Contact person, address, GST number, how they like to pay…" /></Field>
            <FormNote>New orders are matched to a customer by name, so typing this name on an order adds it to this customer.</FormNote>
          </FormDialog>
          {!t.orders ? (
            <FormDialog title={`Delete ${c.name}?`} trigger="Delete" triggerClassName="btn danger" submitLabel="Delete customer" action={deleteCustomer}>
              <input type="hidden" name="id" value={c.id} />
              <FormNote>{c.name} has no orders, so nothing else changes.</FormNote>
            </FormDialog>
          ) : null}
        </div>
      </div>

      {c.notes ? <p className="cnotes">{c.notes}</p> : null}

      <div className="strip plain">
        <div className="hero"><b>{formatRupees(t.bought)}</b><span>Bought, {t.balls} balls delivered</span></div>
        <div><b>{formatRupees(t.received)}</b><span>Paid to you</span></div>
        <div className={t.owed ? "alert" : ""}><b>{formatRupees(t.owed)}</b><span>Owes now</span></div>
        <div><b>{t.orders}</b><span>{t.orders === 1 ? "Order" : "Orders"}{t.open ? `, ${t.open} open` : ""}</span></div>
      </div>

      <div className="grid">
        {data.places.length ? (
          <section className="panel">
            <h2>Where they order to</h2>
            <div className="list">
              {data.places.map((p) => (
                <div key={`${p.t}|${p.code}`} className="row">
                  <span><b>{placeName(p.t, p.code)}</b> <span className="muted">{LOCATION_TYPE_LABEL[p.t]}</span>{p.note ? <><br /><small className="muted">{p.note}</small></> : null}</span>
                  <span className="muted nw">{p.orders} {p.orders === 1 ? "order" : "orders"}, last {dayShort(p.last)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="panel">
          <h2>Orders <small>newest first</small></h2>
          {data.orders.length ? (
            <>
              <div className="tbl">
                <table>
                  <thead><tr><th>Ordered</th><th>Due</th><th className="num">Balls</th><th className="num">Value</th><th>Status</th><th className="num">Owes</th><th /></tr></thead>
                  <tbody>
                    {data.orders.map((o) => (
                      <tr key={o.id}>
                        <td className="nw">{dayShort(indiaDate(o.createdAt))}</td>
                        <td className="nw">{dayShort(o.dueOn)}</td>
                        <td className="num">{o.ballsOrdered}{o.ballsDelivered && o.ballsDelivered !== o.ballsOrdered ? <><br /><small className="muted">{o.ballsDelivered} sent</small></> : null}</td>
                        <td className="num">{formatRupees(o.valuePaise)}</td>
                        <td>{o.status === "closed" ? <span className="chip done">Delivered</span> : o.ballsDelivered ? <span className="chip progress">Part delivered</span> : <span className="chip draft">Open</span>}</td>
                        <td className={`num ${o.owedPaise ? "bad" : ""}`}>{o.owedPaise ? formatRupees(o.owedPaise) : "—"}</td>
                        <td className="nw"><span className="row-actions">{o.owedPaise || (o.status === "open" && o.balancePaise) ? <PaymentButton o={o} today={today} /> : null}<OrderDetails o={o} names={names} owner={owner} /></span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager p={data.orderPaging} href={withOther(path, "ppage", sp.ppage)} noun={["order", "orders"]} />
            </>
          ) : <p className="muted" style={{ margin: 0 }}>No orders. <Link href="/orders">Take one on the Orders screen</Link>.</p>}
        </section>

        {data.byType.length || data.years.length ? (
          <div className="grid g2">
            {data.byType.length ? (
              <section className="panel">
                <h2>What they buy <small>all time</small></h2>
                <div className="tbl">
                  <table>
                    <thead><tr><th>Balls</th><th className="num">Delivered</th><th className="num">Average price</th><th>Last</th></tr></thead>
                    <tbody>
                      {data.byType.map((b) => {
                        const ty = names.type(b.ballTypeId);
                        return (
                          <tr key={`${b.ballTypeId}|${b.gradeId}`}>
                            <td><span className={`swatch sw-${ty.colour}`} />{ty.name}, {names.grade(b.gradeId)}</td>
                            <td className="num">{b.balls}<br /><small className="muted">{formatRupees(b.value)}</small></td>
                            <td className="num">{formatRupees(Math.round(b.value / b.balls))}</td>
                            <td className="nw">{dayShort(b.last)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
            {data.years.length ? (
              <section className="panel">
                <h2>Year by year <small>April to March</small></h2>
                <div className="tbl">
                  <table>
                    <thead><tr><th>Year</th><th className="num">Orders</th><th className="num">Balls</th><th className="num">Sales</th><th className="num">Paid</th></tr></thead>
                    <tbody>
                      {data.years.map((y) => (
                        <tr key={y.fy}>
                          <td className="nw">{fyLabel(y.fy)}</td>
                          <td className="num">{y.orders || "—"}</td>
                          <td className="num">{y.balls || "—"}</td>
                          <td className="num">{y.sales ? formatRupees(y.sales) : "—"}</td>
                          <td className="num">{y.received ? formatRupees(y.received) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {data.payments.length ? (
          <section className="panel">
            <h2>Payments <small>newest first</small></h2>
            <div className="tbl">
              <table>
                <thead><tr><th>Received</th><th className="num">Amount</th><th>How</th><th>For the order of</th><th>Note</th></tr></thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="nw">{dayShort(p.receivedOn)}</td>
                      <td className="num"><b>{formatRupees(p.amount)}</b></td>
                      <td>{p.mode === "cash" ? "Cash" : "Online"}</td>
                      <td className="nw">{dayShort(p.orderOn)}</td>
                      <td className="muted">{p.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager p={data.paymentPaging} href={withOther(path, "page", sp.page)} noun={["payment", "payments"]} param="ppage" />
          </section>
        ) : null}
      </div>
    </>
  );
}

// The date an order was entered, in India (its timestamp is stored in UTC).
const indiaDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

// Keeps the other list's page in the address when moving through this one.
function withOther(path: string, param: string, value: string | string[] | undefined) {
  return typeof value === "string" && /^\d+$/.test(value) && value !== "1" ? `${path}?${param}=${value}` : path;
}
