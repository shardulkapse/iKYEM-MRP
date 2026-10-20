import { PageHeader, Streamed } from "@/components/page";
import { SkeletonDay } from "@/components/skeletons";
import { requireRole } from "@/lib/auth";
import { todayInFactory } from "@/lib/dates";
import { isValidDay } from "@/lib/day";
import { loadDay } from "@/lib/day-queries";
import { DayEditor } from "./day-editor";

export const metadata = { title: "Daily entry" };

export default function TodayPage({ searchParams }: PageProps<"/today">) {
  return (
    <>
      <PageHeader title="Daily entry" sub="Who came in, what each stage finished, and what got graded. Pick any earlier date to fill in a day you missed." />
      <Streamed fallback={<SkeletonDay />}>
        <Day searchParams={searchParams} />
      </Streamed>
    </>
  );
}

async function Day({ searchParams }: { searchParams: PageProps<"/today">["searchParams"] }) {
  await requireRole();
  const [params, today] = await Promise.all([searchParams, todayInFactory()]);
  const asked = typeof params.date === "string" ? params.date : today;
  const day = isValidDay(asked) && asked <= today ? asked : today;
  const data = await loadDay(day, today);
  // keyed by day so switching dates starts a fresh editor
  return <DayEditor key={day} data={data} />;
}
