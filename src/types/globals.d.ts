export type Role = "owner" | "manager";

declare global {
  // Requires the session token customisation described in the README:
  // { "metadata": "{{user.public_metadata}}" }
  interface CustomJwtSessionClaims {
    metadata?: { role?: Role };
  }
}
