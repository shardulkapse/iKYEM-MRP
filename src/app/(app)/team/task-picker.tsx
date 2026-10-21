import { SelectNav } from "@/components/select-nav";
import type { Workflow } from "@/lib/stages";
import { TASK_LABEL, taskGroups, type TaskKey } from "@/lib/team";

// The task dropdown. hrefFor builds each choice's address on the server, so the browser only
// receives plain links.
export function TaskPicker({ value, workflows, hrefFor }: { value: TaskKey; workflows: Workflow[]; hrefFor: (t: TaskKey) => string }) {
  return (
    <SelectNav
      label="Task"
      value={value}
      groups={[
        { choices: [{ value: "all", label: "All tasks", href: hrefFor("all") }] },
        ...taskGroups(workflows).map((g) => ({ group: g.group, choices: g.tasks.map((t) => ({ value: t, label: TASK_LABEL[t], href: hrefFor(t) })) })),
      ]}
    />
  );
}
