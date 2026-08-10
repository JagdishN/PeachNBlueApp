# Peach & Blue — Backend

Node.js + Express + TypeScript API, Prisma ORM against PostgreSQL (Supabase). See `.claude/CLAUDE.md` for product/architecture context and `/docs` for the full design docs.

## Setup

```
npm install
cp .env.example .env   # fill in real values — see below
npx prisma generate
npm run dev
```

## Environment variables

Copy `.env.example` to `.env` and fill in:

- `DATABASE_URL` — Postgres connection string (Supabase).
- `JWT_SECRET` — signing secret for auth tokens. Must not be left as the fallback value in any non-local environment.
- `REDIS_URL` — see "Redis setup" below.
- `MSG91_*` — MSG91 credentials. WhatsApp only (CLAUDE.md "Messaging migration — MSG91, WhatsApp-only") — SMS is not sent anywhere, including OTP login. `MSG91_INTEGRATED_NUMBER` is the shared/default sending number, used only when a branch has no `whatsappNumber` of its own configured (each branch ideally has its own number registered under the same MSG91/Meta WABA).
- `RAZORPAY_*` — use test-mode keys for local development; never live keys outside production.

### MSG91 / WhatsApp templates

Every business-initiated WhatsApp message (OTP, pickup confirmation, etc.) requires a pre-approved Meta message template — a WhatsApp Business Platform rule, not an MSG91-specific limitation. `src/constants/msg91Templates.ts` lists every template this app needs, with placeholder names and each one's required variable count/order — these must be created and approved in Meta Business Manager (via the MSG91 panel) before real sends will work; update the `name` values there to match whatever Meta actually approves them as. `src/lib/msg91Client.ts`'s request shape is built from MSG91's commonly published API examples, not confirmed against a live account from this environment — verify it with a real test send (MSG91's dashboard has a test-send tool) before relying on it.

## Redis setup

OTP codes and OTP rate-limiting are stored in Redis (not in-memory — an in-memory store doesn't survive a restart or work across multiple API instances). Docker isn't required; pick whichever is easiest for you:

- **Local, native Windows**: install [Memurai](https://www.memurai.com/) (a Redis-compatible server for Windows) and use the default `REDIS_URL=redis://localhost:6379`.
- **Hosted, free tier**: create a free database on [Upstash](https://upstash.com/) (or any managed Redis) and set `REDIS_URL` to the connection string it gives you.

Either option works with no code changes — the app just reads `REDIS_URL`.

## Scripts

- `npm run dev` — run the API with hot reload.
- `npm run build` — compile TypeScript to `dist/`.
- `npm start` — run the compiled server.
- `npm test` — unit tests (no network access required).
- `npx prisma generate` — regenerate the Prisma client after a schema change.
