import { activeTypesAndGrades, readyStockByTypeAndGrade, wipByTypeAndBuffer } from "@/lib/queries";

const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 1 });
const BUFFERS = [["cut", "Cut leather"], ["cups", "Cups"], ["machine_stitched", "Machine stitched"], ["closed", "Closed"], ["awaiting_grading", "Waiting for grading"]] as const;

export async function ReadyStockTable() {
  const [{ types, grades }, stock] = await Promise.all([activeTypesAndGrades(), readyStockByTypeAndGrade()]);
  if (!types.length || !grades.length) return <p className="muted" style={{ margin: 0 }}>Add ball types and grades in Setup to see ready stock.</p>;
  return (
    <div className="tbl">
      <table>
        <thead><tr><th>Ball type</th>{grades.map((g) => <th key={g.id} className="num">{g.name}</th>)}<th className="num">Total</th></tr></thead>
        <tbody>
          {types.map((t) => {
            const vals = grades.map((g) => stock.get(`${t.id}|${g.id}`) ?? 0);
            return (
              <tr key={t.id}>
                <td><span className={`swatch sw-${t.colour}`} />{t.name}</td>
                {vals.map((v, i) => <td key={grades[i].id} className={`num ${v ? "" : "muted"}`}>{fmt(v)}</td>)}
                <td className="num"><b>{fmt(vals.reduce((a, b) => a + Math.max(0, b), 0))}</b></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export async function WipTable() {
  const [{ types }, wip] = await Promise.all([activeTypesAndGrades(), wipByTypeAndBuffer()]);
  if (!types.length) return null;
  return (
    <div className="tbl">
      <table>
        <thead><tr><th>Ball type</th>{BUFFERS.map(([, l]) => <th key={l} className="num">{l}</th>)}</tr></thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.id}>
              <td><span className={`swatch sw-${t.colour}`} />{t.name}<br /><small className="muted">{t.workflow === "hand" ? "Hand stitched" : "Machine stitched"}</small></td>
              {BUFFERS.map(([b]) => {
                const v = wip.get(`${t.id}|${b}`);
                return <td key={b} className="num">{v == null ? <span className="muted">—</span> : fmt(v)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
