import { ComingNext, PageHeader, Streamed } from "@/components/page";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Setup" };

export default function Page() {
  return (
    <>
      <PageHeader title="Setup" />
      <Streamed><Content /></Streamed>
    </>
  );
}

async function Content() {
  await requireRole(["owner"]);
  return <ComingNext what="Ball types, grades, materials, suppliers and factory settings." />;
}
