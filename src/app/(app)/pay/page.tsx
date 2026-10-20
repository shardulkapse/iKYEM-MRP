import { ComingNext, PageHeader, Streamed } from "@/components/page";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Pay" };

export default function Page() {
  return (
    <>
      <PageHeader title="Pay" />
      <Streamed><Content /></Streamed>
    </>
  );
}

async function Content() {
  await requireRole(["owner"]);
  return <ComingNext what="Weekly payday, month-end salaries, advances and the team list." />;
}
