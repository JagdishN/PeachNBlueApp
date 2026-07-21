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
- `TWILIO_*` — Twilio credentials. Twilio is used for **both** WhatsApp and SMS (two separate "from" numbers: `TWILIO_WHATSAPP_FROM` for the WhatsApp-enabled sender, `TWILIO_SMS_FROM` for plain SMS). Both channels are always sent together — never one as a fallback for the other. `TWILIO_WHATSAPP_FROM` is the bare number (no `whatsapp:` prefix) — the code adds that itself.
- `RAZORPAY_*` — use test-mode keys for local development; never live keys outside production.

### Twilio trial mode

While the Twilio account is on the free trial tier, two real limitations apply — see `.claude/CLAUDE.md`'s "Twilio trial mode" section for the full detail:

- **SMS** only reaches phone numbers manually verified in the Twilio Console (Phone Numbers → Verified Caller IDs).
- **WhatsApp** only reaches numbers that have joined Twilio's WhatsApp Sandbox (recipient sends a join code to the sandbox number first) — this is separate from Meta's WhatsApp Business API production approval process (see the Technical Design Document's WhatsApp setup section).

Real customer numbers won't receive anything until the client upgrades Twilio billing (for SMS) and completes WhatsApp Business API approval separately (for WhatsApp) — these are two independent upgrades, not one.

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
