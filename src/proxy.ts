import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { OWNER_ONLY_PREFIXES } from "@/lib/nav";

const isPublic = createRouteMatcher(["/sign-in(.*)"]);
const isOwnerOnly = createRouteMatcher(OWNER_ONLY_PREFIXES.map((p) => `${p}(.*)`));

// First line of defence: signed-out people go to sign-in, people without a role see the
// no-access page, and managers are bounced off owner-only sections. Pages and actions check
// again with requireRole(), which is what actually protects the data.
export default clerkMiddleware(async (auth, req) => {
  if (isPublic(req)) return;
  await auth.protect();
  const role = (await auth()).sessionClaims?.metadata?.role;
  const path = req.nextUrl.pathname;
  if (!role && path !== "/no-access") return NextResponse.redirect(new URL("/no-access", req.url));
  if (role && role !== "owner" && isOwnerOnly(req)) return NextResponse.redirect(new URL("/", req.url));
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
