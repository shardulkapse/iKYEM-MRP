// Plain markup helpers for forms. No client code, so they work inside server-rendered dialogs.

export function Field({ label, hint, full, children }: { label: string; hint?: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={full ? "fld full" : "fld"}>
      <span>{label}</span>
      {children}
      {hint ? <small className="hint">{hint}</small> : null}
    </label>
  );
}

export function FormNote({ children }: { children: React.ReactNode }) {
  return <p className="note">{children}</p>;
}
