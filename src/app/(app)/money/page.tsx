import { ComingNext, PageHeader, Streamed } from "@/components/page";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Money" };

export default function Page() {
  return (
    <>
      <PageHeader title="Money" />
      <Streamed><Content /></Streamed>
    </>
  );
}

async function Content() {
  await requireRole(["owner"]);
  return <ComingNext what="Period statements, cost per ball, break-even, expenses, the loan and Excel export." />;
}
