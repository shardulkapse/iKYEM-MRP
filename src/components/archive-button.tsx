import { setArchived } from "@/app/(app)/setup/actions";

// Works without JavaScript: a tiny form that posts straight to the server action.
export function ArchiveButton({ entity, id, archived }: { entity: "ballType" | "grade" | "material" | "supplier"; id: string; archived: boolean }) {
  return (
    <form action={setArchived}>
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="archive" value={archived ? "0" : "1"} />
      <button type="submit" className="btn sm ghost">{archived ? "Restore" : "Archive"}</button>
    </form>
  );
}
