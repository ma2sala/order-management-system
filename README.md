# Order Management System

Waiter → Barista order flow with real-time Socket.io updates, manager-gated
voids, and an audit-logged daily reconciliation report.

```
order-management-system/
├── prisma/schema.prisma       # Postgres schema (Users, Tables, Menu, Orders, AuditLog)
├── src/                       # Express + Socket.io backend
├── public/waiter/             # Waiter mobile ordering screen (HTML/CSS/JS)
├── public/barista/            # Barista Display System (HTML/CSS/JS)
└── docker-compose.yml         # Local Postgres, so you don't need to install it yourself
```

## Requirements

- Node.js 18+ and npm
- Docker (recommended, for Postgres) — or your own local Postgres instance

## 1. Install dependencies

```bash
npm install
```

## 2. Start a database

**Option A — Docker (easiest):**
```bash
docker compose up -d
```
This starts Postgres on `localhost:5432` with user/password `postgres`/`postgres`
and a database named `kds_db`, matching the default `.env` values below.

**Option B — your own Postgres:** create a database and note its connection string.

## 3. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and set `JWT_SECRET` to a random string. You can generate one with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
If you used `docker compose up -d` above, `DATABASE_URL` in `.env.example`
already points at the right place — no changes needed there.

## 4. Create the database tables

```bash
npx prisma migrate dev --name init
npx prisma generate
```

## 5. Seed demo data (users, tables, menu items)

```bash
npm run seed
```

This creates three demo logins (all with password `password123`):

| Role    | Email               |
|---------|----------------------|
| Manager | manager@demo.com     |
| Waiter  | waiter@demo.com      |
| Barista | barista@demo.com     |

It also creates 10 tables (T1–T10) and a starter menu across Drinks, Snacks,
and Meals categories.

## 6. Run the app

```bash
npm start
```

You should see:
```
Order Management System running:
  → API:     http://localhost:4000/api
  → Waiter:  http://localhost:4000/waiter/
  → Barista: http://localhost:4000/barista/
```

## 7. Try it out

1. Open **http://localhost:4000/waiter/** in one browser tab (or your phone,
   if it's on the same network — use your machine's LAN IP instead of
   `localhost`). Sign in as `waiter@demo.com`.
2. Open **http://localhost:4000/barista/** in another tab. Sign in as
   `barista@demo.com`.
3. On the waiter screen: pick a table, add a few items, and tap **Send to
   Barista**. It should appear instantly on the barista screen with a chime
   and a flash — no page refresh needed.
4. On the barista screen: tap **Start Preparing**, then **Mark Complete**.
   Switch back to the waiter tab's **Active Orders** view — the status
   updates live via the same socket connection.
5. Notice the waiter's ticket has a **locked Cancel button** — that's
   intentional. Voiding an order requires a manager, via
   `DELETE /api/orders/:id`, which is blocked server-side by role for any
   other account (see `src/middleware/roleGuard.js`).

For development with auto-restart on file changes, use `npm run dev`
instead of `npm start` (requires `nodemon`, already in devDependencies).

## Daily reconciliation report

While logged in as a manager, you can call:
```
GET /api/reports/daily
```
with your manager JWT in the `Authorization: Bearer <token>` header (e.g. via
curl or Postman — there's no UI for this yet). It compares live order totals
against the audit log and flags any blocked void/delete/edit attempts from
that day. See `src/controllers/reportController.js` for exactly what it
checks and why.

## Notes on this build

- **No React/build step for the frontends** — `public/waiter` and
  `public/barista` are plain HTML/CSS/JS served directly by Express via
  `express.static`, so there's nothing to compile.
- **Socket.io auth** uses the same JWT as the HTTP API — see `src/socket.js`.
- **Audit logging** (`src/middleware/auditLogger.js`) records every order
  creation and every attempt (successful or blocked) to edit/void/delete an
  order, including who tried it and from what IP — this is what the daily
  report cross-checks against.
- **Prisma Studio** (`npx prisma studio`) is a quick way to browse the actual
  database tables while testing.
