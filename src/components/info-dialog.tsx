"use client";

import { useRef } from "react";

// A button that opens a read-only panel in a dialog. Content is rendered on the server.
export function InfoDialog({ title, trigger, triggerClassName = "btn sm", children }: { title: string; trigger: React.ReactNode; triggerClassName?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => ref.current?.showModal()}>{trigger}</button>
      <dialog ref={ref} className="dlg wide" aria-label={title}>
        <div className="dlg-shell">
          <header className="dlg-head"><h3>{title}</h3><button type="button" className="x" onClick={() => ref.current?.close()} aria-label="Close">✕</button></header>
          <div className="dlg-body single">{children}</div>
          <footer className="dlg-foot"><button type="button" className="btn" onClick={() => ref.current?.close()}>Close</button></footer>
        </div>
      </dialog>
    </>
  );
}
