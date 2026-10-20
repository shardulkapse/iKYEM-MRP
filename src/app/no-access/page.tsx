import { SignOutButton } from "@clerk/nextjs";
import { BallMark } from "@/components/icon";

export const metadata = { title: "No access yet" };

export default function NoAccessPage() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <section className="panel" style={{ maxWidth: 440, textAlign: "center" }}>
        <BallMark size={44} />
        <h2 style={{ marginTop: 12 }}>You don&apos;t have access yet</h2>
        <p className="muted">You&apos;re signed in, but the owner hasn&apos;t given your account a role. Ask them to add you, then sign in again.</p>
        <SignOutButton><button className="btn">Sign out</button></SignOutButton>
      </section>
    </main>
  );
}
