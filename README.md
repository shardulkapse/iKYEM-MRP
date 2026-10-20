# iKYEM MRP

Production, stock, orders and pay for the iKYEM cricket ball factory.
Next.js 16 (App Router, Cache Components) · Clerk · Drizzle ORM · Neon Postgres · Vercel.

## First-time setup

### 1. Install

```bash
npm install
cp .env.example .env.local
```

### 2. Database (Neon)

Use the **pooled** connection string from your Neon project as `DATABASE_URL`.
If Neon is linked to the Vercel project, `npx vercel env pull .env.local` copies it down for you.

Create the tables and stock views:

```bash
npm run db:migrate
```

### 3. Sign-in (Clerk)

1. Create a Clerk application and put its two keys in `.env.local` (and in Vercel).
2. **Lock down sign-ups** so only people you invite can get in (Clerk's restricted / invitation-only sign-up mode).
3. **Customise the session token** so roles reach the app without an extra API call. Add this claim:
   ```json
   { "metadata": "{{user.public_metadata}}" }
   ```
4. Sign up yourself, then in Clerk set your user's **public metadata** to:
   ```json
   { "role": "owner" }
   ```
   A manager gets `{ "role": "manager" }`. Anyone without a role lands on a "no access yet" page.

### 4. Run

```bash
npm run dev
```

### 5. Deploy

Push to GitHub. In the Vercel project, set the same environment variables for Production and Preview,
then every push to `main` deploys.

## Roles

| | Owner | Manager |
|---|---|---|
| Home, Today, Orders, Stock | ✓ | ✓ |
| Pay, Money, Setup | ✓ | |

The proxy (`src/proxy.ts`) redirects people early, but the real protection is `requireRole()` in every
server component, action and route handler that reads or writes data.

## How the data works

- **Stock is never stored.** Ready stock, balls in production and material on hand are SQL views
  (`drizzle/0001_stock_views.sql`) over the movement tables: work entries, gradings, deliveries,
  purchases and adjustments. Back-filling a missed day updates everything after it automatically.
  Stock as of a date is `WHERE day < date` on the `*_movements` views.
- **Money is in paise** (`bigint`, ₹1 = 100). Convert only for display.
- **Dates are factory dates in India time.** Use `todayInFactory()` from `src/lib/dates.ts`, never
  `new Date()` on the server, because Vercel runs on UTC.
- **Workflows:** hand stitched is cutting → quarter stitching (4-piece) → closing → seam stitching.
  Machine stitched is cutting → quarter stitching (4-piece) → machine stitching → closing and seam.
  Which pile each stage takes from and adds to lives in the `stage_flow` view.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run db:generate` | New migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run db:studio` | Browse the database |
| `npm run typecheck` | TypeScript check |

## Layout

```
src/
  proxy.ts               auth and role redirects (Next 16's renamed middleware)
  app/
    layout.tsx           Clerk provider, font, global styles
    (app)/               signed-in area with the sidebar and phone tab bar
    sign-in/  no-access/
  components/            shell, nav, page pieces, stock tables
  db/schema.ts           every table, enum and (typed) view
  db/index.ts            Neon HTTP client
  lib/auth.ts            getRole(), requireRole()
  lib/dates.ts           factory-time dates
  lib/queries.ts         read queries
drizzle/                 SQL migrations (0000 tables, 0001 stock views)
```
