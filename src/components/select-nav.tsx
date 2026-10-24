"use client";

import { useRouter } from "next/navigation";
import "./select-nav.css";

export type NavChoice = { value: string; label: string; href: string };
export type NavGroup = { group?: string; choices: NavChoice[] };

// A labelled dropdown where every choice is a page address: picking one opens that address,
// so the choice lives in the URL like the tabs and period bar do.
export function SelectNav({ label, value, groups }: { label: string; value: string; groups: NavGroup[] }) {
  const router = useRouter();
  const all = groups.flatMap((g) => g.choices);
  return (
    <label className="selnav">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => {
          const c = all.find((x) => x.value === e.target.value);
          if (c) router.push(c.href, { scroll: false });
        }}
      >
        {groups.map((g, i) =>
          g.group ? (
            <optgroup key={g.group} label={g.group}>
              {g.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </optgroup>
          ) : (
            g.choices.map((c) => <option key={`${i}-${c.value}`} value={c.value}>{c.label}</option>)
          ),
        )}
      </select>
    </label>
  );
}
