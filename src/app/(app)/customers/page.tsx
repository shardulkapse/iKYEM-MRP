import Link from "next/link";
import { PageHeader, Streamed } from "@/components/page";
import { Pager } from "@/components/pager";
import { SelectNav } from "@/components/select-nav";
import { Sk, SkeletonStrip, SkeletonTable } from "@/components/skeletons";
import { requireRole } from "@/lib/auth";
import { CUSTOMER_SORTS, customerList, isCustomerSort, type CustomerSort } from "@/lib/customer-queries";
import { dayShort } from "@/lib/day";
import { placeName } from "@/lib/locations";
import { formatRupees } from "@/lib/money";
import "./customers.css";

export const metadata = { title: "Customers" };

export default function CustomersPage({ searchParams }: PageProps<"/customers">) {
  return (
    <>
      <PageHeader title="Customers" sub="Everyone you've taken an order from, what they've bought and what they owe. A customer is added with their first order." />
      <Streamed fallback={<><div className="csearch"><Sk w={320} h={40} r={10} /><Sk w={220} h={40} r={10} /></div><SkeletonStrip plain cells={3} /><section className="panel"><SkeletonTable rows={8} cols={6} /></section></>}>
        <CustomersBody searchParams={searchParams} />
      </Streamed>
    </>
  );
}

// /customers?q=pune&sort=owes&page=2
const listHref = (q: string, sort: CustomerSort) => {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (sort !== "name") p.set("sort", sort);
  const s = p.toString();
  return s ? `/customers?${s}` : "/customers";
};

async function CustomersBody({ searchParams }: { searchParams: PageProps<"/customers">["searchParams"] }) {
  await requireRole();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const sort: CustomerSort = isCustomerSort(params.sort) ? params.sort : "name";
  const { rows, paging, totals } = await customerList(q, sort, params.page);

  if (!totals.customers) {
    return (
      <section className="panel empty">
        <b>No customers yet</b>
        A customer is added the first time you take an order from them.
        <div style={{ marginTop: 14 }}><Link className="btn primary" href="/orders">Go to Orders</Link></div>
      </section>
    );
  }

  return (
    <>
      <div className="csearch">
        <form action="/customers" role="search">
          <input type="search" name="q" defaultValue={q} placeholder="Search by name or phone" aria-label="Search customers" />
          {sort !== "name" ? <input type="hidden" name="sort" value={sort} /> : null}
          <button className="btn" type="submit">Search</button>
          {q ? <Link className="btn ghost" href={listHref("", sort)}>Clear</Link> : null}
        </form>
        <SelectNav label="Sort by" value={sort} groups={[{ choices: CUSTOMER_SORTS.map((s) => ({ value: s.key, label: s.label, href: listHref(q, s.key) })) }]} />
      </div>

      <div className="strip plain">
        <div><b>{totals.customers}</b><span>Customers</span></div>
        <div className={totals.owed ? "alert" : ""}><b>{formatRupees(totals.owed)}</b><span>Owed to you by {totals.owing} {totals.owing === 1 ? "customer" : "customers"}</span></div>
        <div><b>{totals.open}</b><span>Open {totals.open === 1 ? "order" : "orders"}</span></div>
      </div>

      {rows.length ? (
        <section className="panel">
          <h2>{q ? <>Matching &ldquo;{q}&rdquo;</> : "Everyone"} <small>{paging.total} {paging.total === 1 ? "customer" : "customers"}</small></h2>
          <div className="tbl">
            <table>
              <thead>
                <tr><th>Customer</th><th>Location</th><th className="num">Orders</th><th>Last order</th><th className="num">Bought</th><th className="num">Owes</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td><Link className="who" href={`/customers/${c.id}`}>{c.name}</Link>{c.phone ? <><br /><small className="muted">{c.phone}</small></> : null}</td>
                    <td>{c.locationType ? <>{placeName(c.locationType, c.locationCode)}{c.locationType === "international" ? <><br /><small className="muted">International</small></> : null}</> : <span className="muted">Not set</span>}</td>
                    <td className="num">{c.orders}{c.open ? <><br /><small className="muted">{c.open} open</small></> : null}</td>
                    <td className="nw">{c.lastOrder ? dayShort(c.lastOrder) : <span className="muted">None</span>}</td>
                    <td className="num">{formatRupees(c.bought)}<br /><small className="muted">{c.balls} balls</small></td>
                    <td className={`num ${c.owed ? "bad" : ""}`}><b>{c.owed ? formatRupees(c.owed) : "—"}</b></td>
                    <td className="num"><Link className="btn sm" href={`/customers/${c.id}`} aria-label={`View ${c.name}`}>View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager p={paging} href={listHref(q, sort)} noun={["customer", "customers"]} />
        </section>
      ) : (
        <section className="panel empty"><b>Nobody matches &ldquo;{q}&rdquo;</b>Try part of the name or phone number. <Link href={listHref("", sort)}>Show everyone</Link></section>
      )}
      <p className="hint" style={{ marginTop: 12 }}>Bought is the value of balls delivered, all time. Owes adds up what each order still owes for balls delivered; an advance paid on one order doesn&apos;t cancel what another owes.</p>
    </>
  );
}
