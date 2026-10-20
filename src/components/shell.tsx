import { Suspense } from "react";
import { UserButton } from "@clerk/nextjs";
import { getRole } from "@/lib/auth";
import { NAV } from "@/lib/nav";
import { BallMark, Icon } from "./icon";
import Link from "next/link";
import { NavLinks, SetupLink } from "./nav-links";

// Shown in the instant static shell while the session loads: no role, no active highlight.
function StaticSideNav() {
  return (
    <>
      {NAV.filter((n) => n.roles.length === 2).map((n) => (
        <Link key={n.href} href={n.href}><Icon name={n.icon} />{n.label}</Link>
      ))}
    </>
  );
}

async function SideNav() {
  return <NavLinks role={await getRole()} variant="side" />;
}

async function TabBar() {
  const role = await getRole();
  const count = NAV.filter((n) => role && n.roles.includes(role) && n.href !== "/setup").length;
  return (
    <nav className="tabbar" aria-label="Main" style={{ ["--tabs" as string]: count || 4 }}>
      <NavLinks role={role} variant="tabbar" />
    </nav>
  );
}

async function OwnerSetupLink() {
  return (await getRole()) === "owner" ? <SetupLink /> : null;
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="mbar">
        <div className="brand"><BallMark size={28} /><b>iKYEM</b></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Suspense><OwnerSetupLink /></Suspense>
          <UserButton />
        </div>
      </header>
      <div className="app">
        <aside className="side">
          <div className="brand"><BallMark /><div><b>iKYEM</b><small>Factory</small></div></div>
          <nav className="nav">
            <Suspense fallback={<StaticSideNav />}><SideNav /></Suspense>
          </nav>
          <div className="side-foot"><UserButton /><span>Signed in</span></div>
        </aside>
        <main className="page">{children}</main>
      </div>
      <Suspense><TabBar /></Suspense>
    </>
  );
}
