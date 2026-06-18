# RSVP System

White-label, multi-venue table reservation platform. Mobile-first on both sides
(customer booking + staff night-service panel). First venue: **BRUMA**.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design, data model,
phase plan, and security/compliance notes.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind (CSS design tokens) · PWA ·
Supabase (Postgres + Auth + Realtime + RLS) · Stripe (card-only deposits) ·
WhatsApp Cloud API · Vercel.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase / Stripe / WhatsApp keys
npm run dev                  # http://localhost:3000 → redirects to /bruma
```

## Database

Migrations live in `supabase/migrations/`:

| File | Purpose |
|---|---|
| `0001_init.sql` | Core multi-venue schema + constraints (incl. the partial unique index that prevents double-booking a slot). |
| `0002_rls.sql` | Row-Level Security — tenant isolation at the DB. |
| `0003_seed_bruma.sql` | BRUMA rooms, hours, and the Fri/Sat 10pm premium rule — all as data. |

Apply with the Supabase CLI:

```bash
supabase db reset            # local
# or push migrations to a linked project
supabase db push
```

## Project layout

```
src/
  app/                 Next.js routes (root → /bruma, /[venue] themed shell)
  lib/booking/rules.ts Pure booking rules (capacity fit, deposit calc)
  lib/supabase/        Browser + server Supabase clients
  lib/types/db.ts      DB types (regenerate in Phase 1 via supabase gen types)
  styles/tokens.css    Themeable design tokens (BRUMA = default skin)
  i18n/                Spanish (default) + English dictionaries
supabase/migrations/   SQL schema, RLS, seed
public/                PWA manifest + icons
```

## Status

**Phase 0 — Foundations** (this scaffold). Next: Phase 1 BRUMA MVP — booking
flow, Stripe deposit, staff panel. See `ARCHITECTURE.md` §9.
