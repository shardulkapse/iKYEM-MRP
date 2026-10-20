<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## iKYEM MRP project rules

- Read README.md first: roles, data model and conventions are there.
- Cache Components is on. Anything that reads the session (`auth()`), the database or the current time
  must render inside `<Suspense>` (use `Streamed` from `src/components/page.tsx`). Keep page headers static.
- Every server component, server action and route handler that touches data calls `requireRole()` first.
  Pay, Money and Setup data is owner only.
- Money is stored in paise as integers. Never use floats for money in the database.
- Never store stock levels. Derive them from the views in `drizzle/0001_stock_views.sql`.
- "Today" is `todayInFactory()` (Asia/Kolkata), never the server's clock.
- Schema changes: edit `src/db/schema.ts`, then `npm run db:generate`. View changes go in a new custom
  migration (`npx drizzle-kit generate --custom --name <name>`).
- Multi-statement writes that must succeed together use `db.batch([...])` (Neon HTTP driver).
