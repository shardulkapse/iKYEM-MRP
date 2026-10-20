import { ComingNext, PageHeader, Streamed } from "@/components/page";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Orders" };

export default function Page() {
  return (
    <>
      <PageHeader title="Orders" />
      <Streamed><Content /></Streamed>
    </>
  );
}

async function Content() {
  await requireRole();
  return <ComingNext what="Open orders checked against ready stock, deliveries, part payments and the delivered archive." />;
}
