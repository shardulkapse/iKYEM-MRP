"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { AttendanceStatus, DayData } from "@/lib/day-queries";
import { addDays, dayLong, dayShort, isWorkDay } from "@/lib/day";
import { STAGES, STAGE_BY_ID, type StageDef, type StageId, WORKFLOWS, stageAppliesTo, stagesOf } from "@/lib/stages";
import { saveDaySheet } from "./actions";

/* ---------------------------------------------------------------- state */

type Row = { key: string; workerId: string; ballTypeId: string; good: string; rejected: string; leatherId: string; supplierId: string; sheets: string };
type GradeRow = { supplierId: string; byGrade: Record<string, string>; rejected: string };
type Sheet = { closed: boolean; attendance: Record<string, AttendanceStatus>; rows: Record<StageId, Row[]>; grading: Record<string, GradeRow> };

let keySeq = 0;
const newKey = () => `r${Date.now().toString(36)}${(keySeq++).toString(36)}`;
const str = (n: number | null | undefined) => (n == null || n === 0 ? "" : String(n));

function fromData(d: DayData): Sheet {
  const rows = Object.fromEntries(STAGES.map((s) => [s.id, [] as Row[]])) as Record<StageId, Row[]>;
  for (const w of d.work) {
    rows[w.stage].push({ key: newKey(), workerId: w.workerId ?? "", ballTypeId: w.ballTypeId, good: str(w.good), rejected: str(w.rejected), leatherId: w.leatherId ?? "", supplierId: w.supplierId ?? "", sheets: str(w.sheets) });
  }
  const grading: Record<string, GradeRow> = {};
  for (const t of d.types) grading[t.id] = { supplierId: "", byGrade: {}, rejected: "" };
  for (const g of d.grading) {
    const row = (grading[g.ballTypeId] ??= { supplierId: "", byGrade: {}, rejected: "" });
    if (g.supplierId) row.supplierId = g.supplierId;
    if (g.rejected) row.rejected = String(g.qty);
    else if (g.gradeId) row.byGrade[g.gradeId] = String(g.qty);
  }
  return { closed: d.sheet.closed, attendance: { ...d.attendance }, rows, grading };
}

// Strip display-only keys so "has anything changed?" compares data, not row ids.
const fingerprint = (s: Sheet) => JSON.stringify({ ...s, rows: Object.fromEntries(Object.entries(s.rows).map(([k, rs]) => [k, rs.map((r) => ({ ...r, key: undefined }))])) });

const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

/* --------------------------------------------------------------- editor */

export function DayEditor({ data }: { data: DayData }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(() => fromData(data));
  const [savedPrint, setSavedPrint] = useState(() => fingerprint(fromData(data)));
  const [updatedAt, setUpdatedAt] = useState(data.sheet.updatedAt);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const dirty = useMemo(() => fingerprint(sheet) !== savedPrint, [sheet, savedPrint]);

  const isToday = data.day === data.today;
  const typeById = useMemo(() => new Map(data.types.map((t) => [t.id, t])), [data.types]);
  const flows = WORKFLOWS.filter((f) => data.types.some((t) => t.workflow === f.id));

  // Warn before leaving with unsaved changes: closing the tab, or clicking any link in the app.
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target || a.origin !== window.location.origin) return;
      if (!window.confirm(`You have unsaved changes for ${dayShort(data.day)}. Leave without saving?`)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, data.day]);

  const goTo = (day: string) => {
    if (day > data.today || day === data.day) return;
    if (dirty && !window.confirm(`You have unsaved changes for ${dayShort(data.day)}. Leave without saving?`)) return;
    router.push(day === data.today ? "/today" : `/today?date=${day}`);
  };

  /* ---------- edits */
  const update = (fn: (s: Sheet) => Sheet) => {
    setMessage(null);
    setSheet(fn);
  };
  const setAtt = (workerId: string, v: AttendanceStatus) => update((s) => ({ ...s, attendance: { ...s.attendance, [workerId]: v } }));
  const allPresent = () => update((s) => ({ ...s, attendance: Object.fromEntries(data.workers.map((w) => [w.id, s.attendance[w.id] ?? "present"])) }));
  const setRow = (stage: StageId, key: string, patch: Partial<Row>) =>
    update((s) => ({ ...s, rows: { ...s.rows, [stage]: s.rows[stage].map((r) => (r.key === key ? { ...r, ...patch } : r)) } }));
  const removeRow = (stage: StageId, key: string) => update((s) => ({ ...s, rows: { ...s.rows, [stage]: s.rows[stage].filter((r) => r.key !== key) } }));
  const cutDefaults = (ballTypeId: string) => {
    const t = typeById.get(ballTypeId);
    const last = data.lastCut[ballTypeId];
    const leatherId = last?.leatherId && data.leathers.some((m) => m.id === last.leatherId) ? last.leatherId : (data.leathers.find((m) => m.colour === t?.colour)?.id ?? "");
    const supplierId = last?.supplierId && data.suppliers.some((x) => x.id === last.supplierId) ? last.supplierId : "";
    return { leatherId, supplierId };
  };
  const addRow = (st: StageDef) => {
    const options = data.types.filter((t) => stageAppliesTo(st, t));
    if (!options.length) return;
    update((s) => {
      const prev = s.rows[st.id].at(-1);
      const ballTypeId = prev && options.some((t) => t.id === prev.ballTypeId) ? prev.ballTypeId : options[0].id;
      const extra = st.id === "cutting" ? cutDefaults(ballTypeId) : { leatherId: "", supplierId: "" };
      return { ...s, rows: { ...s.rows, [st.id]: [...s.rows[st.id], { key: newKey(), workerId: "", ballTypeId, good: "", rejected: "", sheets: "", ...extra }] } };
    });
  };
  const setGrade = (typeId: string, patch: Partial<GradeRow>) =>
    update((s) => ({ ...s, grading: { ...s.grading, [typeId]: { ...(s.grading[typeId] ?? { supplierId: "", byGrade: {}, rejected: "" }), ...patch } } }));

  /* ---------- save */
  const save = (closedOverride?: boolean) => {
    const closed = closedOverride ?? sheet.closed;
    const work: Array<Record<string, unknown>> = [];
    for (const st of STAGES) {
      for (const r of sheet.rows[st.id]) {
        const good = num(r.good), rejected = num(r.rejected), sheets = num(r.sheets);
        if ([good, rejected, sheets].some((n) => !Number.isFinite(n) || n < 0)) return setMessage({ tone: "bad", text: `Check the numbers in ${st.name.toLowerCase()}: they must be zero or more.` });
        if (![good, rejected].every(Number.isInteger)) return setMessage({ tone: "bad", text: `Counts in ${st.name.toLowerCase()} are whole balls.` });
        if (!good && !rejected && !sheets) continue; // empty row, skip it
        if (st.id !== "cutting" && !r.workerId) return setMessage({ tone: "bad", text: `Pick who did the work on every ${st.name.toLowerCase()} row.` });
        work.push({
          stage: st.id, workerId: r.workerId || null, ballTypeId: r.ballTypeId, good, rejected: st.id === "cutting" ? 0 : rejected,
          leatherId: st.id === "cutting" ? r.leatherId || null : null, supplierId: st.id === "cutting" ? r.supplierId || null : null,
          sheets: st.id === "cutting" && sheets ? Math.round(sheets * 100) / 100 : null,
        });
      }
    }
    const grading: Array<Record<string, unknown>> = [];
    for (const [ballTypeId, g] of Object.entries(sheet.grading)) {
      const supplierId = g.supplierId || null;
      for (const [gradeId, v] of Object.entries(g.byGrade)) {
        const qty = num(v);
        if (!Number.isInteger(qty) || qty < 0) return setMessage({ tone: "bad", text: "Grading counts are whole balls, zero or more." });
        if (qty) grading.push({ ballTypeId, supplierId, gradeId, rejected: false, qty });
      }
      const rej = num(g.rejected);
      if (!Number.isInteger(rej) || rej < 0) return setMessage({ tone: "bad", text: "Grading counts are whole balls, zero or more." });
      if (rej) grading.push({ ballTypeId, supplierId, gradeId: null, rejected: true, qty: rej });
    }
    const next = { ...sheet, closed };
    startSaving(async () => {
      const res = await saveDaySheet({ day: data.day, closed, expectedUpdatedAt: updatedAt, attendance: sheet.attendance, work, grading });
      if (!res.ok) return setMessage({ tone: "bad", text: res.error });
      setSheet(next);
      setSavedPrint(fingerprint(next));
      setUpdatedAt(res.updatedAt);
      setMessage({ tone: "ok", text: `Saved ${dayShort(data.day)}.` });
    });
  };

  /* ---------- render helpers */
  const present = data.workers.reduce((n, w) => n + (sheet.attendance[w.id] === "present" ? 1 : sheet.attendance[w.id] === "half" ? 0.5 : 0), 0);
  const nothingEntered = !Object.values(sheet.rows).some((rs) => rs.length) && !Object.keys(sheet.attendance).length;
  const workerSelect = (value: string, onChange: (v: string) => void, emptyLabel: string) => (
    <select className="s" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Person">
      <option value="">{emptyLabel}</option>
      {data.workers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
    </select>
  );
  const numInput = (value: string, onChange: (v: string) => void, label: string, step = "1") => (
    <input className="n" type="number" min={0} step={step} inputMode={step === "1" ? "numeric" : "decimal"} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
  );

  const stageCard = (st: StageDef, n: number) => {
    const options = data.types.filter((t) => stageAppliesTo(st, t));
    if (!options.length) return null;
    const rows = sheet.rows[st.id];
    const cut = st.id === "cutting";
    const total = rows.reduce((a, r) => a + num(r.good), 0);
    return (
      <section key={st.id} className={`panel stcard${cut ? " wide" : ""}`}>
        <div className="sthead">
          <div><h2><span className="stepn">{n}</span>{st.name}</h2><span className="hint">{st.what}{st.only4pc ? ". 4-piece only." : "."}</span></div>
          {total ? <span className="hc">{total} {cut ? "cut" : "done"}</span> : null}
        </div>
        {!cut ? (
          <div className="wait">
            <span>Waiting at the start of the day:</span>
            {options.map((t) => <span key={t.id}><span className={`swatch sw-${t.colour}`} />{t.name} <b>{Math.max(0, data.startOfDay[`${t.id}|${st.takesFrom(t.construction)}`] ?? 0)}</b></span>)}
          </div>
        ) : null}
        {rows.length ? (
          <div className="tbl">
            <table>
              <thead>
                <tr>
                  <th>{cut ? "Cut by" : "Person"}</th><th>Ball type</th>
                  {cut ? <><th>Leather</th><th>Supplier</th><th className="num">Sheets</th><th className="num">Balls cut</th><th className="num">Per sheet</th></> : <><th className="num">Done</th><th className="num">Rejected</th></>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const t = typeById.get(r.ballTypeId);
                  return (
                    <tr key={r.key}>
                      <td>{workerSelect(r.workerId, (v) => setRow(st.id, r.key, { workerId: v }), cut ? "Manager or owner" : "Pick a person")}</td>
                      <td>
                        <select className="s" value={r.ballTypeId} aria-label="Ball type" onChange={(e) => {
                          const ballTypeId = e.target.value;
                          const nt = typeById.get(ballTypeId);
                          const leather = data.leathers.find((m) => m.id === r.leatherId);
                          setRow(st.id, r.key, cut && nt && leather?.colour !== nt.colour ? { ballTypeId, ...cutDefaults(ballTypeId) } : { ballTypeId });
                        }}>
                          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                      </td>
                      {cut ? (
                        <>
                          <td>
                            <select className="s" value={r.leatherId} onChange={(e) => setRow(st.id, r.key, { leatherId: e.target.value })} aria-label="Leather">
                              <option value="">Pick leather</option>
                              {data.leathers.filter((m) => !t || m.colour === t.colour || m.id === r.leatherId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                          </td>
                          <td>
                            <select className="s" value={r.supplierId} onChange={(e) => setRow(st.id, r.key, { supplierId: e.target.value })} aria-label="Supplier">
                              <option value="">Not sure</option>
                              {data.suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                            </select>
                          </td>
                          <td className="num">{numInput(r.sheets, (v) => setRow(st.id, r.key, { sheets: v }), "Sheets used", "0.25")}</td>
                          <td className="num">{numInput(r.good, (v) => setRow(st.id, r.key, { good: v }), "Balls cut")}</td>
                          <td className="num muted">{num(r.sheets) > 0 ? (num(r.good) / num(r.sheets)).toFixed(1) : "—"}</td>
                        </>
                      ) : (
                        <>
                          <td className="num">{numInput(r.good, (v) => setRow(st.id, r.key, { good: v }), "Done")}</td>
                          <td className="num">{numInput(r.rejected, (v) => setRow(st.id, r.key, { rejected: v }), "Rejected")}</td>
                        </>
                      )}
                      <td><button type="button" className="x" onClick={() => removeRow(st.id, r.key)} aria-label="Remove row">✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="hint" style={{ margin: 0 }}>Nothing entered yet.</p>}
        <div className="addrow">
          <button type="button" className="btn sm" onClick={() => addRow(st)}>{cut ? "Add cutting" : "Add work"}</button>
          {cut ? <span className="hint">One row per leather and supplier, so balls per sheet can be compared.</span> : null}
        </div>
      </section>
    );
  };

  /* ---------- page */
  return (
    <>
      <div className="daynav">
        <button type="button" className="btn" onClick={() => goTo(addDays(data.day, -1))}>‹ Previous day</button>
        <input type="date" value={data.day} max={data.today} aria-label="Date to fill in" onChange={(e) => e.target.value && goTo(e.target.value)} />
        <button type="button" className="btn" onClick={() => goTo(addDays(data.day, 1))} disabled={isToday}>Next day ›</button>
        {!isToday ? <button type="button" className="btn" onClick={() => goTo(data.today)}>Back to today</button> : null}
      </div>

      <h2 className="dayh">
        {dayLong(data.day)}
        {isToday ? <span className="chip good">Today</span> : null}
        {!isWorkDay(data.day, data.weeklyOff) ? <span className="chip draft">Holiday</span> : null}
        {data.sheet.exists ? <span className="chip draft">Saved before</span> : null}
        {dirty ? <span className="dirty">Unsaved changes</span> : null}
      </h2>

      {data.missing.filter((d) => d !== data.day).length ? (
        <div className="missing">
          <span>Not filled in yet:</span>
          {data.missing.filter((d) => d !== data.day).slice(-14).map((d) => (
            <Link key={d} className="btn sm" href={`/today?date=${d}`}>{dayShort(d)}</Link>
          ))}
        </div>
      ) : null}

      {!isToday ? <div className="banner">You&apos;re filling in <b>{dayLong(data.day)}</b>. Saving updates stock, pay and reports for that day, and the waiting counts on later days follow on from it.</div> : null}
      {data.negatives.length ? (
        <div className="banner bad">
          <b>Some counts are below zero</b>, so a day&apos;s entries took more balls than were there. Check the days around when these were entered:
          <ul>{data.negatives.slice(0, 6).map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      ) : null}
      {sheet.closed ? <div className="banner">This day is marked as closed. <button type="button" className="btn sm" onClick={() => update((s) => ({ ...s, closed: false }))}>Undo</button></div> : null}

      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="sthead">
          <div><h2>Who came in</h2><span className="hint">Anyone you log work for below is marked present when you save.</span></div>
          <span className="pctl"><span className="hc">{present} present</span><button type="button" className="btn sm" onClick={allPresent}>Mark everyone present</button></span>
        </div>
        {data.workers.length ? (
          <div className="people">
            {data.workers.map((w) => (
              <div key={w.id} className="person">
                <span><b>{w.name}</b>{w.role ? <small className="muted"> {w.role}</small> : null}</span>
                <span className="seg" role="group" aria-label={w.name}>
                  {(["present", "half", "absent"] as const).map((v) => (
                    <button key={v} type="button" className={v[0]} aria-pressed={sheet.attendance[w.id] === v} onClick={() => setAtt(w.id, v)}>
                      {v === "present" ? "Present" : v === "half" ? "Half" : "Absent"}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ) : <p className="hint" style={{ margin: 0 }}>Add your team on the Team page first.</p>}
      </section>

      <div className="stations">
        {stageCard(STAGE_BY_ID.cutting, 1)}
        {flows.map((f) => (
          <FlowSection key={f.id} name={f.name}>
            {stagesOf(f.id).map((st, i) => stageCard(st, i + 2))}
          </FlowSection>
        ))}

        <section className="panel stcard wide">
          <div className="sthead">
            <div><h2><span className="stepn">✓</span>Grading</h2><span className="hint">Grade balls once seam stitching is done. They move into ready stock under that grade. Pick whose leather a row came from when you know it.</span></div>
          </div>
          {data.grades.length ? (
            <div className="tbl">
              <table>
                <thead><tr><th>Ball type</th><th>Leather from</th><th className="num">Waiting at start</th>{data.grades.map((g) => <th key={g.id} className="num">{g.name}</th>)}<th className="num">Rejected</th></tr></thead>
                <tbody>
                  {data.types.map((t) => {
                    const g = sheet.grading[t.id] ?? { supplierId: "", byGrade: {}, rejected: "" };
                    return (
                      <tr key={t.id}>
                        <td><span className={`swatch sw-${t.colour}`} />{t.name}</td>
                        <td>
                          <select className="s" value={g.supplierId} onChange={(e) => setGrade(t.id, { supplierId: e.target.value })} aria-label={`Leather supplier for ${t.name}`}>
                            <option value="">Mixed or not sure</option>
                            {data.suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                        </td>
                        <td className="num muted">{Math.max(0, data.startOfDay[`${t.id}|awaiting_grading`] ?? 0)}</td>
                        {data.grades.map((gr) => <td key={gr.id} className="num">{numInput(g.byGrade[gr.id] ?? "", (v) => setGrade(t.id, { byGrade: { ...g.byGrade, [gr.id]: v } }), `${t.name} ${gr.name}`)}</td>)}
                        <td className="num">{numInput(g.rejected, (v) => setGrade(t.id, { rejected: v }), `${t.name} rejected`)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="hint" style={{ margin: 0 }}>Add your grades in Setup first.</p>}
        </section>
      </div>

      <div className="savebar">
        {message ? <span className={`savemsg ${message.tone}`} role="status">{message.text}</span> : null}
        {!isToday && !data.sheet.exists && !dirty && nothingEntered ? (
          <button type="button" className="btn" onClick={() => save(true)} disabled={saving}>Factory was closed</button>
        ) : null}
        <button type="button" className="btn primary big" onClick={() => save()} disabled={saving}>{saving ? "Saving…" : `Save ${dayShort(data.day)}`}</button>
      </div>
    </>
  );
}

function FlowSection({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <>
      <div className="flowsec"><h2>{name}</h2></div>
      {children}
    </>
  );
}
