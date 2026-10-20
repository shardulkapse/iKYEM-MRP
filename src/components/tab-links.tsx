import Link from "next/link";

// Tabs as plain links (?tab=...), so each tab has its own address and works with back/forward.
export function TabLinks({ base, current, tabs }: { base: string; current: string; tabs: { key: string; label: string }[] }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {tabs.map((t, i) => (
        <Link key={t.key} href={i === 0 ? base : `${base}?tab=${t.key}`} aria-current={current === t.key ? "page" : undefined} scroll={false}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
