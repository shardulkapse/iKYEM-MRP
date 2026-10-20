"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";
import type { Role } from "@/types/globals";
import { Icon } from "./icon";

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

// role = null while the session is still loading: show only what every role can see.
export function NavLinks({ role, variant }: { role: Role | null; variant: "side" | "tabbar" }) {
  const path = usePathname();
  const items = NAV.filter((n) => (role ? n.roles.includes(role) : n.roles.length === 2)).filter((n) => variant === "side" || n.href !== "/setup");
  return (
    <>
      {items.map((n) => (
        <Link key={n.href} href={n.href} aria-current={isActive(path, n.href) ? "page" : undefined} className={variant === "side" && n.href === "/setup" ? "minor" : undefined}>
          <Icon name={n.icon} />
          {variant === "side" ? n.label : <span>{n.label}</span>}
        </Link>
      ))}
    </>
  );
}

export function SetupLink() {
  const path = usePathname();
  return (
    <Link href="/setup" aria-label="Setup" aria-current={isActive(path, "/setup") ? "page" : undefined} className="btn" style={{ width: 38, padding: 0 }}>
      <Icon name="setup" />
    </Link>
  );
}
