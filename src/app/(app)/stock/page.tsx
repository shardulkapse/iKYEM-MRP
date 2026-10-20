import { PageHeader, Streamed } from "@/components/page";
import { ReadyStockTable, WipTable } from "@/components/stock-tables";
import { requireRole } from "@/lib/auth";
import { materialsWithStock } from "@/lib/queries";

export const metadata = { title: "Stock" };

export default function StockPage() {
  return (
    <>
      <PageHeader title="Stock" sub="Ready stock by grade, balls in production and raw materials. Purchases, yield by supplier and corrections come next." />
      <div style={{ display: "grid", gap: 18 }}>
        <section className="panel"><h2>Ready stock</h2><Streamed><Guarded><ReadyStockTable /></Guarded></Streamed></section>
        <section className="panel"><h2>Balls in production</h2><Streamed><Guarded><WipTable /></Guarded></Streamed></section>
        <section className="panel"><h2>Materials on hand</h2><Streamed><Materials /></Streamed></section>
      </div>
    </>
  );
}

async function Guarded({ children }: { children: React.ReactNode }) {
  await requireRole();
  return children;
}

async function Materials() {
  await requireRole();
  const rows = await materialsWithStock();
  if (!rows.length) return <p className="muted" style={{ margin: 0 }}>No materials yet.</p>;
  return (
    <div className="tbl">
      <table>
        <thead><tr><th>Material</th><th>Kind</th><th className="num">On hand</th></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td>{m.colour ? <span className={`swatch sw-${m.colour}`} /> : null}{m.name}</td>
              <td className="muted">{m.kind === "leather" ? "Leather" : m.kind === "cork" ? "Cork core" : "Other"}</td>
              <td className="num">{Number(m.qty ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })} {m.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
