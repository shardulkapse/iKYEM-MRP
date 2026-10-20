import { ComingNext, PageHeader, Streamed } from "@/components/page";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Today" };

export default function Page() {
  return (
    <>
      <PageHeader title="Today" />
      <Streamed><Content /></Streamed>
    </>
  );
}

async function Content() {
  await requireRole();
  return <ComingNext what="The daily sheet: attendance, work per stage, cutting with leather and supplier, and grading, for any date." />;
}
