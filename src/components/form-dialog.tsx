"use client";

import { useActionState, useRef, useState } from "react";
import type { ActionResult } from "@/lib/action-result";

type Action = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

type Props = {
  title: string;
  trigger: React.ReactNode;
  triggerClassName?: string;
  submitLabel?: string;
  action: Action;
  children: React.ReactNode;
};

// A button that opens a modal form. The form posts to a server action; on success the dialog
// closes and the page refreshes with the saved data, on failure the error shows in the dialog.
export function FormDialog({ title, trigger, triggerClassName = "btn sm", submitLabel = "Save", action, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [openCount, setOpenCount] = useState(0);
  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => {
          setOpenCount((n) => n + 1); // fresh form, and no stale error, every time it opens
          ref.current?.showModal();
        }}
      >
        {trigger}
      </button>
      <dialog ref={ref} className="dlg" aria-label={title}>
        <DialogForm key={openCount} title={title} submitLabel={submitLabel} action={action} close={() => ref.current?.close()}>
          {children}
        </DialogForm>
      </dialog>
    </>
  );
}

function DialogForm({ title, submitLabel, action, close, children }: { title: string; submitLabel: string; action: Action; close: () => void; children: React.ReactNode }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (prev, fd) => {
    const result = await action(prev, fd);
    if (result.ok) close();
    return result;
  }, null);
  return (
    <form action={formAction}>
      <header className="dlg-head">
        <h3>{title}</h3>
        <button type="button" className="x" onClick={close} aria-label="Close">✕</button>
      </header>
      <div className="dlg-body">
        {children}
        {state && !state.ok ? <p className="form-error" role="alert">{state.error}</p> : null}
      </div>
      <footer className="dlg-foot">
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="submit" className="btn primary" disabled={pending}>{pending ? "Saving…" : submitLabel}</button>
      </footer>
    </form>
  );
}
