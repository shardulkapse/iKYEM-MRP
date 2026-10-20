import "server-only";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { Role } from "@/types/globals";

export async function getRole(): Promise<Role | null> {
  const { sessionClaims } = await auth();
  return sessionClaims?.metadata?.role ?? null;
}

// Call at the top of every server component, action and route handler that touches data.
// The proxy already redirects, but this is the check that actually protects the data.
export async function requireRole(allowed: Role[] = ["owner", "manager"]) {
  const { userId, sessionClaims } = await auth();
  if (!userId) redirect("/sign-in");
  const role = sessionClaims?.metadata?.role ?? null;
  if (!role) redirect("/no-access");
  if (!allowed.includes(role)) redirect("/");
  return { userId, role };
}
