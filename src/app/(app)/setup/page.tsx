import { ArchiveButton } from "@/components/archive-button";
import { Field, FormNote } from "@/components/fields";
import { FormDialog } from "@/components/form-dialog";
import { PageHeader, Streamed } from "@/components/page";
import { SkeletonLines, SkeletonList } from "@/components/skeletons";
import type { ballTypes, grades, materials, suppliers } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { workWeekText } from "@/lib/day";
import { COLOUR_LABEL, CONSTRUCTION_LABEL, MATERIAL_KIND_LABEL, WEEKDAYS, WORKFLOW_LABEL } from "@/lib/labels";
import { getSettings, listBallTypes, listGrades, listMaterials, listSuppliers } from "@/lib/setup-queries";
import { saveBallType, saveGrade, saveMaterial, saveSettings, saveSupplier } from "./actions";

export const metadata = { title: "Setup" };

type BallType = typeof ballTypes.$inferSelect;
type Grade = typeof grades.$inferSelect;
type Material = typeof materials.$inferSelect;
type Supplier = typeof suppliers.$inferSelect;

export default function SetupPage() {
  return (
    <>
      <PageHeader title="Setup" sub="The products you make, the grades you sort them into, the materials and suppliers you buy from, and how the factory runs." />
      <div className="grid g2">
        <section className="panel">
          <div className="panel-head"><h2>Ball types</h2><FormDialog title="New ball type" trigger="Add ball type" triggerClassName="btn sm primary" action={saveBallType}><BallTypeFields /></FormDialog></div>
          <Streamed fallback={<SkeletonList rows={4} />}><BallTypeList /></Streamed>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Grades</h2><FormDialog title="New grade" trigger="Add grade" triggerClassName="btn sm primary" action={saveGrade}><GradeFields /></FormDialog></div>
          <Streamed fallback={<SkeletonList rows={3} />}><GradeList /></Streamed>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Materials</h2><FormDialog title="New material" trigger="Add material" triggerClassName="btn sm primary" action={saveMaterial}><MaterialFields /></FormDialog></div>
          <Streamed fallback={<SkeletonList rows={4} />}><MaterialList /></Streamed>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Suppliers</h2><FormDialog title="New supplier" trigger="Add supplier" triggerClassName="btn sm primary" action={saveSupplier}><SupplierFields /></FormDialog></div>
          <Streamed fallback={<SkeletonList rows={3} />}><SupplierList /></Streamed>
        </section>
        <section className="panel">
          <h2>Factory settings</h2>
          <Streamed fallback={<SkeletonLines lines={3} />}><Settings /></Streamed>
        </section>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ lists */

function Rows<T extends { id: string; archivedAt: Date | null }>({ items, empty, render, archivedLabel }: { items: T[]; empty: string; render: (item: T) => React.ReactNode; archivedLabel: string }) {
  const active = items.filter((i) => !i.archivedAt);
  const archived = items.filter((i) => i.archivedAt);
  return (
    <>
      {active.length ? <div className="list">{active.map((i) => <div key={i.id} className="row">{render(i)}</div>)}</div> : <p className="muted" style={{ margin: 0 }}>{empty}</p>}
      {archived.length ? (
        <details className="more">
          <summary>{archivedLabel} ({archived.length})</summary>
          <div className="list">{archived.map((i) => <div key={i.id} className="row archived">{render(i)}</div>)}</div>
        </details>
      ) : null}
    </>
  );
}

async function BallTypeList() {
  await requireRole(["owner"]);
  const items = await listBallTypes();
  return (
    <Rows
      items={items}
      empty="No ball types yet. These are the products you sell, like red 4-piece hand stitched."
      archivedLabel="Archived ball types"
      render={(t) => (
        <>
          <span><span className={`swatch sw-${t.colour}`} /><b>{t.name}</b><br /><small className="muted">{CONSTRUCTION_LABEL[t.construction]}, {WORKFLOW_LABEL[t.workflow].toLowerCase()}{t.weightGrams ? `, ${Number(t.weightGrams)} g` : ""}</small></span>
          <span className="row-actions">
            <FormDialog title={`Edit ${t.name}`} trigger="Edit" action={saveBallType}><BallTypeFields t={t} /></FormDialog>
            <ArchiveButton entity="ballType" id={t.id} archived={!!t.archivedAt} />
          </span>
        </>
      )}
    />
  );
}

async function GradeList() {
  await requireRole(["owner"]);
  const items = await listGrades();
  return (
    <Rows
      items={items}
      empty="No grades yet. Add the grades you sort finished balls into, best first."
      archivedLabel="Archived grades"
      render={(g) => (
        <>
          <span><b>{g.name}</b>{g.note ? <><br /><small className="muted">{g.note}</small></> : null}</span>
          <span className="row-actions">
            <FormDialog title={`Edit ${g.name}`} trigger="Edit" action={saveGrade}><GradeFields g={g} /></FormDialog>
            <ArchiveButton entity="grade" id={g.id} archived={!!g.archivedAt} />
          </span>
        </>
      )}
    />
  );
}

async function MaterialList() {
  await requireRole(["owner"]);
  const items = await listMaterials();
  return (
    <Rows
      items={items}
      empty="No materials yet. Add each kind of leather sheet, the cork core, and other items like thread."
      archivedLabel="Archived materials"
      render={(m) => (
        <>
          <span>{m.colour ? <span className={`swatch sw-${m.colour}`} /> : null}<b>{m.name}</b><br /><small className="muted">{MATERIAL_KIND_LABEL[m.kind]}, counted in {m.unit}, supplier takes {m.leadDays} days</small></span>
          <span className="row-actions">
            <FormDialog title={`Edit ${m.name}`} trigger="Edit" action={saveMaterial}><MaterialFields m={m} /></FormDialog>
            <ArchiveButton entity="material" id={m.id} archived={!!m.archivedAt} />
          </span>
        </>
      )}
    />
  );
}

async function SupplierList() {
  await requireRole(["owner"]);
  const items = await listSuppliers();
  return (
    <Rows
      items={items}
      empty="No suppliers yet. Add the vendors you buy leather, cork and other materials from."
      archivedLabel="Archived suppliers"
      render={(s) => (
        <>
          <span><b>{s.name}</b>{s.phone || s.notes ? <><br /><small className="muted">{[s.phone, s.notes].filter(Boolean).join(", ")}</small></> : null}</span>
          <span className="row-actions">
            <FormDialog title={`Edit ${s.name}`} trigger="Edit" action={saveSupplier}><SupplierFields s={s} /></FormDialog>
            <ArchiveButton entity="supplier" id={s.id} archived={!!s.archivedAt} />
          </span>
        </>
      )}
    />
  );
}

async function Settings() {
  await requireRole(["owner"]);
  const s = await getSettings();
  return (
    <>
      <dl className="kv">
        <dt>Working days</dt><dd>{workWeekText(s.weeklyOff)}</dd>
        <dt>Payday</dt><dd>Every {WEEKDAYS[s.payWeekday]}, for the work week {s.weeklyOff == null ? "before it" : `${WEEKDAYS[(s.weeklyOff + 1) % 7]} to ${WEEKDAYS[(s.weeklyOff + 6) % 7]}`}</dd>
        <dt>Factory time zone</dt><dd>India (IST)</dd>
      </dl>
      <div style={{ marginTop: 14 }}>
        <FormDialog title="Factory settings" trigger="Edit settings" action={saveSettings}>
          <Field label="Weekly holiday" hint="The day the factory is shut every week.">
            <select name="weeklyOff" defaultValue={s.weeklyOff ?? ""}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              <option value="">None, open every day</option>
            </select>
          </Field>
          <Field label="Payday">
            <select name="payWeekday" defaultValue={s.payWeekday}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          </Field>
          <FormNote>The work week runs from the day after the holiday to the day before it. A payday pays for the latest work week that has ended by then, so with Wednesday off a Tuesday payday pays Thursday to that Tuesday.</FormNote>
        </FormDialog>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ form fields */

function BallTypeFields({ t }: { t?: BallType }) {
  return (
    <>
      <input type="hidden" name="id" value={t?.id ?? ""} />
      <Field label="Name" full><input name="name" defaultValue={t?.name} required placeholder="e.g. Red 4-piece" autoComplete="off" /></Field>
      <Field label="Leather colour">
        <select name="colour" defaultValue={t?.colour ?? "red"}>{Object.entries(COLOUR_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      <Field label="Construction">
        <select name="construction" defaultValue={t?.construction ?? "4pc"}>{Object.entries(CONSTRUCTION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      <Field label="Stitching">
        <select name="workflow" defaultValue={t?.workflow ?? "hand"}>{Object.entries(WORKFLOW_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      <Field label="Weight in grams (optional)"><input name="weightGrams" inputMode="decimal" defaultValue={t?.weightGrams ? String(Number(t.weightGrams)) : ""} placeholder="156" /></Field>
      <Field label="Position in lists" hint="Lower numbers show first."><input name="sortOrder" type="number" min={0} max={999} defaultValue={t?.sortOrder ?? 0} /></Field>
      <FormNote>2-piece balls skip quarter stitching. For a different weight, add a separate type so each weight&apos;s stock stays separate. Once a type has production or orders, its construction and stitching are locked.</FormNote>
    </>
  );
}

function GradeFields({ g }: { g?: Grade }) {
  return (
    <>
      <input type="hidden" name="id" value={g?.id ?? ""} />
      <Field label="Name"><input name="name" defaultValue={g?.name} required placeholder="e.g. Grade A, Match, Practice" autoComplete="off" /></Field>
      <Field label="Position in lists" hint="Put your best grade first (0)."><input name="sortOrder" type="number" min={0} max={999} defaultValue={g?.sortOrder ?? 0} /></Field>
      <Field label="What it means (optional)" full><input name="note" defaultValue={g?.note ?? ""} placeholder="e.g. No marks, seam even all round" /></Field>
    </>
  );
}

function MaterialFields({ m }: { m?: Material }) {
  return (
    <>
      <input type="hidden" name="id" value={m?.id ?? ""} />
      <Field label="Name" full><input name="name" defaultValue={m?.name} required placeholder="e.g. Red leather, alum tanned" autoComplete="off" /></Field>
      <Field label="Kind">
        <select name="kind" defaultValue={m?.kind ?? "leather"}>{Object.entries(MATERIAL_KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      <Field label="Colour" hint="Only used for leather.">
        <select name="colour" defaultValue={m?.colour ?? "red"}>{Object.entries(COLOUR_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </Field>
      <Field label="Counted in"><input name="unit" defaultValue={m?.unit ?? "sheets"} required placeholder="sheets, cores, spools, litres" /></Field>
      <Field label="Days the supplier takes to deliver"><input name="leadDays" type="number" min={0} max={365} defaultValue={m?.leadDays ?? 7} /></Field>
      <FormNote>You can have several kinds of leather in the same colour. Each cutting entry says which one was used. There is one cork core material, used one per ball at closing.</FormNote>
    </>
  );
}

function SupplierFields({ s }: { s?: Supplier }) {
  return (
    <>
      <input type="hidden" name="id" value={s?.id ?? ""} />
      <Field label="Name" full><input name="name" defaultValue={s?.name} required autoComplete="off" /></Field>
      <Field label="Phone"><input name="phone" type="tel" defaultValue={s?.phone ?? ""} /></Field>
      <Field label="Notes"><input name="notes" defaultValue={s?.notes ?? ""} placeholder="What they supply, quality" /></Field>
    </>
  );
}
