import { Field, FormNote } from "@/components/fields";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader, Streamed } from "@/components/page";
import { SkeletonCards, SkeletonTable, SkeletonTabs } from "@/components/skeletons";
import { ReadyStockTable, WipTable } from "@/components/stock-tables";
import { TabLinks } from "@/components/tab-links";
import { getRole, requireRole } from "@/lib/auth";
import { todayInFactory } from "@/lib/dates";
import { dayShort } from "@/lib/day";
import { MATERIAL_KIND_LABEL } from "@/lib/labels";
import { formatRupees } from "@/lib/money";
import { activeTypesAndGrades, readyStockByTypeAndGrade, wipByTypeAndBuffer } from "@/lib/queries";
import { BUFFER_LABEL, STAGES, stageAppliesTo } from "@/lib/stages";
import { gradesBySupplier, listPurchases, materialCards, purchaseFormOptions, recentCutting, yieldBySupplier, type MaterialCard } from "@/lib/stock-queries";
import { correctMaterial, correctReadyStock, correctWip, deletePurchase, recordPurchase } from "./actions";

export const metadata = { title: "Stock" };

const TABS = [
  { key: "ready", label: "Ready stock" },
  { key: "materials", label: "Materials" },
  { key: "yield", label: "Leather yield" },
  { key: "purchases", label: "Purchases" },
];

export default function StockPage({ searchParams }: PageProps<"/stock">) {
  return (
    <>
      <PageHeader title="Stock" sub="Ready stock by grade, raw materials and when to reorder, which supplier's leather goes furthest, and every purchase." />
      <Streamed fallback={<><SkeletonTabs /><section className="panel"><SkeletonTable rows={5} cols={5} /></section></>}>
        <StockBody searchParams={searchParams} />
      </Streamed>
    </>
  );
}

async function StockBody({ searchParams }: { searchParams: PageProps<"/stock">["searchParams"] }) {
  await requireRole();
  const params = await searchParams;
  const tab = TABS.some((t) => t.key === params.tab) ? String(params.tab) : "ready";
  const owner = (await getRole()) === "owner";
  return (
    <>
      <div className="tabbar-row">
        <TabLinks base="/stock" current={tab} tabs={TABS} />
        {owner ? <PurchaseButton /> : null}
      </div>
      <Streamed key={tab} fallback={tab === "materials" ? <SkeletonCards /> : <section className="panel"><SkeletonTable rows={5} cols={6} /></section>}>
        {tab === "ready" ? <ReadyTab owner={owner} /> : tab === "materials" ? <MaterialsTab owner={owner} /> : tab === "yield" ? <YieldTab owner={owner} /> : <PurchasesTab owner={owner} />}
      </Streamed>
    </>
  );
}

/* ------------------------------------------------------------ ready stock */

async function ReadyTab({ owner }: { owner: boolean }) {
  const [{ types, grades }, ready, wip] = await Promise.all([activeTypesAndGrades(), readyStockByTypeAndGrade(), wipByTypeAndBuffer()]);
  return (
    <div className="grid">
      <section className="panel"><h2>Ready stock by grade</h2><ReadyStockTable /></section>
      <section className="panel"><h2>Balls in production</h2><WipTable /></section>
      {owner && types.length ? (
        <details className="panel more">
          <summary>Correct a count</summary>
          <p className="hint">For opening stock, or when a physical count doesn&apos;t match. You enter what you counted; the app records the difference.</p>
          <div className="list">
            {types.map((t) => {
              const buffers = [...new Set(STAGES.filter((s) => stageAppliesTo(s, t)).map((s) => s.addsTo))];
              return (
                <div key={t.id} className="row">
                  <span><span className={`swatch sw-${t.colour}`} />{t.name}</span>
                  <span className="row-actions">
                    <FormDialog title={`Count ready stock: ${t.name}`} trigger="Ready stock" submitLabel="Set counts" action={correctReadyStock}>
                      <input type="hidden" name="ballTypeId" value={t.id} />
                      {grades.map((g) => (
                        <Field key={g.id} label={g.name}><input name={`g_${g.id}`} type="number" min={0} step={1} defaultValue={Math.max(0, ready.get(`${t.id}|${g.id}`) ?? 0)} required /></Field>
                      ))}
                      <FormNote>Enter how many graded balls of this type are on the shelf now.</FormNote>
                    </FormDialog>
                    <FormDialog title={`Count in production: ${t.name}`} trigger="In production" submitLabel="Set counts" action={correctWip}>
                      <input type="hidden" name="ballTypeId" value={t.id} />
                      {buffers.map((b) => (
                        <Field key={b} label={BUFFER_LABEL[b]}><input name={`b_${b}`} type="number" min={0} step={1} defaultValue={Math.max(0, wip.get(`${t.id}|${b}`) ?? 0)} required /></Field>
                      ))}
                      <FormNote>Enter what is physically at each stage, in balls.</FormNote>
                    </FormDialog>
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ materials */

const qty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

async function MaterialsTab({ owner }: { owner: boolean }) {
  const today = await todayInFactory();
  const cards = await materialCards(today);
  const main = cards.filter((c) => c.kind !== "other");
  const other = cards.filter((c) => c.kind === "other");
  if (!cards.length) return <section className="panel empty"><b>No materials yet</b>Add leather, the cork core and other items in Setup.</section>;
  return (
    <div className="grid">
      {main.length ? <div className="mcards">{main.map((c) => <MaterialCardView key={c.id} c={c} owner={owner} />)}</div> : null}
      <section className="panel">
        <h2>Other materials <small>not used up automatically: correct the count when you check</small></h2>
        {other.length ? (
          <div className="tbl">
            <table>
              <thead><tr><th>Item</th><th className="num">On hand</th>{owner ? <th className="num">Average price</th> : null}<th>Last bought</th>{owner ? <th /> : null}</tr></thead>
              <tbody>
                {other.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.name}</b></td>
                    <td className="num">{qty(c.onHand)} {c.unit}</td>
                    {owner ? <td className="num">{c.avgPricePaise ? formatRupees(Math.round(c.avgPricePaise)) : "—"}</td> : null}
                    <td>{c.lastBought ? `${dayShort(c.lastBought)}${c.lastSupplier ? `, ${c.lastSupplier}` : ""}` : "—"}</td>
                    {owner ? <td className="num"><span className="row-actions" style={{ justifyContent: "flex-end" }}><PurchaseButton materialId={c.id} label="Bought" /><CountButton c={c} /></span></td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>None added. Thread, lacquer and the like can be added in Setup.</p>}
      </section>
    </div>
  );
}

function MaterialCardView({ c, owner }: { c: MaterialCard; owner: boolean }) {
  const chip = c.status === "now" ? <span className="chip bad">Buy now</span> : c.status === "soon" ? <span className="chip progress">Buy by {dayShort(c.buyBy!)}</span> : <span className="chip good">Enough</span>;
  return (
    <section className={`panel mcard ${c.status}`}>
      <div className="mhead"><h2>{c.colour ? <span className={`swatch sw-${c.colour}`} /> : null}{c.name}</h2>{chip}</div>
      <div className="big">{qty(c.onHand)} <small>{c.unit}</small></div>
      <p className="muted" style={{ margin: "4px 0 12px", fontSize: 14 }}>
        {c.onHand < 0 ? "Below zero: record the purchases that came in, or correct the count. " : ""}
        {c.coverDays != null ? `Lasts about ${Math.max(0, Math.floor(c.coverDays))} working days at ${qty(c.perDay!)} ${c.unit} a day.` : "How long it lasts shows once it's being used."}
      </p>
      <dl className="kv">
        {owner ? <><dt>Average price</dt><dd>{c.avgPricePaise ? `${formatRupees(Math.round(c.avgPricePaise))} per ${c.unit.replace(/s$/, "")}` : "—"}</dd></> : null}
        {c.kind === "leather" ? <><dt>Balls per sheet</dt><dd>{c.ballsPerSheet ? c.ballsPerSheet.toFixed(1) : "No cutting yet"}</dd></> : null}
        {owner && c.kind === "leather" ? <><dt>Leather per ball</dt><dd>{c.avgPricePaise && c.ballsPerSheet ? formatRupees(Math.round(c.avgPricePaise / c.ballsPerSheet)) : "—"}</dd></> : null}
        <dt>Last bought</dt><dd>{c.lastBought ? `${dayShort(c.lastBought)}${c.lastSupplier ? `, ${c.lastSupplier}` : ""}` : "—"}</dd>
        <dt>Supplier takes</dt><dd>{c.leadDays} days</dd>
      </dl>
      {owner ? <div className="row-actions" style={{ marginTop: 14 }}><PurchaseButton materialId={c.id} label="Bought more" primary /><CountButton c={c} /></div> : null}
    </section>
  );
}

function CountButton({ c }: { c: MaterialCard }) {
  return (
    <FormDialog title={`Count ${c.name}`} trigger="Correct count" submitLabel="Set count" action={correctMaterial}>
      <input type="hidden" name="materialId" value={c.id} />
      <FormNote>The app thinks you have <b>{qty(c.onHand)} {c.unit}</b>.</FormNote>
      <Field label={`What you counted (${c.unit})`}><input name="counted" inputMode="decimal" defaultValue={Math.max(0, Math.round(c.onHand * 1000) / 1000)} required /></Field>
      <Field label="Reason"><input name="note" placeholder="Opening stock, monthly count…" /></Field>
    </FormDialog>
  );
}

/* ------------------------------------------------------------ purchases */

async function PurchaseButton({ materialId, label = "Record purchase", primary }: { materialId?: string; label?: string; primary?: boolean }) {
  const [{ materials, suppliers }, today] = await Promise.all([purchaseFormOptions(), todayInFactory()]);
  if (!materials.length) return null;
  return (
    <FormDialog title="Record purchase" trigger={label} triggerClassName={primary || !materialId ? "btn sm primary" : "btn sm"} submitLabel="Add to stock" action={recordPurchase}>
      <Field label="Material" full>
        <select name="materialId" defaultValue={materialId ?? materials[0].id}>
          {materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({MATERIAL_KIND_LABEL[m.kind]}, {m.unit})</option>)}
        </select>
      </Field>
      <Field label="Supplier">
        <select name="supplierId" defaultValue="">
          <option value="">{suppliers.length ? "Pick a supplier" : "No suppliers yet"}</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <Field label="Or a new supplier's name" hint="Gets added to your supplier list."><input name="newSupplier" autoComplete="off" /></Field>
      <Field label="Arrived on"><input name="receivedOn" type="date" defaultValue={today} max={today} required /></Field>
      <Field label="Quantity"><input name="qty" inputMode="decimal" required placeholder="12" /></Field>
      <Field label="Price per unit (₹)"><input name="price" inputMode="decimal" required placeholder="1450" /></Field>
      <Field label="Note" full><input name="note" placeholder="Quality, invoice number" /></Field>
    </FormDialog>
  );
}

async function PurchasesTab({ owner }: { owner: boolean }) {
  const rows = await listPurchases();
  if (!rows.length) return <section className="panel empty"><b>No purchases yet</b>Record every leather, cork and other material purchase with its supplier and price.</section>;
  return (
    <section className="panel">
      <h2>Purchases <small>latest {rows.length}</small></h2>
      <div className="tbl">
        <table>
          <thead><tr><th>Arrived</th><th>Material</th><th>Supplier</th><th className="num">Quantity</th>{owner ? <><th className="num">Price</th><th className="num">Total</th><th /></> : null}</tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="nw">{dayShort(p.receivedOn)}</td>
                <td>{p.colour ? <span className={`swatch sw-${p.colour}`} /> : null}{p.material}{p.note ? <><br /><small className="muted">{p.note}</small></> : null}</td>
                <td>{p.supplier ?? <span className="muted">—</span>}</td>
                <td className="num">{qty(Number(p.qty))} {p.unit}</td>
                {owner ? (
                  <>
                    <td className="num">{formatRupees(p.pricePaise)}</td>
                    <td className="num">{formatRupees(Math.round(Number(p.qty) * p.pricePaise))}</td>
                    <td className="num">
                      <FormDialog title="Delete this purchase?" trigger="✕" triggerClassName="x" submitLabel="Delete purchase" action={deletePurchase}>
                        <input type="hidden" name="id" value={p.id} />
                        <FormNote>{qty(Number(p.qty))} {p.unit} of {p.material} from {dayShort(p.receivedOn)}. Stock goes down by the same amount.</FormNote>
                      </FormDialog>
                    </td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ leather yield */

async function YieldTab({ owner }: { owner: boolean }) {
  const [rows, bySupplier, recent, { grades }] = await Promise.all([yieldBySupplier(), gradesBySupplier(), recentCutting(), activeTypesAndGrades()]);
  if (!rows.length) return <section className="panel empty"><b>No cutting recorded yet</b>Each cutting row on the daily sheet records the leather, supplier, sheets and balls cut. The comparison builds from there.</section>;
  const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : "—");
  return (
    <div className="grid">
      <section className="panel">
        <h2>Balls per sheet by supplier</h2>
        <div className="tbl">
          <table>
            <thead><tr><th>Leather</th><th>Supplier</th><th className="num">Days cut</th><th className="num">Sheets</th><th className="num">Balls</th><th className="num">Per sheet</th>{owner ? <th className="num">Leather per ball</th> : null}<th>Last cut</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.leatherId}|${r.supplierId}`}>
                  <td>{r.colour ? <span className={`swatch sw-${r.colour}`} /> : null}{r.leather}</td>
                  <td>{r.supplier ?? <span className="muted">Not sure</span>}</td>
                  <td className="num">{r.days}</td>
                  <td className="num">{qty(r.sheets)}</td>
                  <td className="num">{r.balls}</td>
                  <td className="num"><b>{r.perSheet.toFixed(1)}</b></td>
                  {owner ? <td className="num">{r.pricePaise ? formatRupees(Math.round(r.pricePaise / r.perSheet)) : <span className="muted">no price</span>}</td> : null}
                  <td className="nw">{dayShort(r.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel">
        <h2>Grades by leather supplier <small>from grading rows tagged with a supplier</small></h2>
        {bySupplier.length ? (
          <div className="tbl">
            <table>
              <thead><tr><th>Supplier</th><th className="num">Balls graded</th>{grades.map((g) => <th key={g.id} className="num">{g.name}</th>)}<th className="num">Rejected</th></tr></thead>
              <tbody>
                {bySupplier.map((s) => (
                  <tr key={s.id}>
                    <td><b>{s.supplier}</b></td>
                    <td className="num">{s.total}</td>
                    {grades.map((g) => <td key={g.id} className="num">{pct(s.byGrade.get(g.id) ?? 0, s.total)}</td>)}
                    <td className="num">{pct(s.rejected, s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>Pick the leather supplier on grading rows when you know it, and the grade split for each supplier shows here.</p>}
      </section>
      <details className="panel more">
        <summary>Recent cutting</summary>
        <div className="tbl" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Day</th><th>Ball type</th><th>Leather</th><th>Supplier</th><th className="num">Sheets</th><th className="num">Balls</th><th className="num">Per sheet</th></tr></thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td className="nw">{dayShort(r.day)}</td><td>{r.ball_type}</td><td>{r.leather ?? "—"}</td><td>{r.supplier ?? "—"}</td>
                  <td className="num">{r.sheets ? qty(Number(r.sheets)) : "—"}</td><td className="num">{r.good}</td>
                  <td className="num">{r.sheets && Number(r.sheets) > 0 ? (r.good / Number(r.sheets)).toFixed(1) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
