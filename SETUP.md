# Setup & Operations Guide

Step-by-step runbook to take the RSVP System scaffold from a fresh clone to a
running BRUMA instance — locally and deployed. Follow the sections in order.

> Conventions: commands run from the repo root. Never commit real secrets —
> everything sensitive goes in `.env.local` (git-ignored) or the host's secret store.

---

## 0. Accounts you'll need

Create these first (free tiers are fine to start):

| Service | Used for | Sign up |
|---|---|---|
| **Supabase** | Postgres DB, Auth, Realtime, Storage | https://supabase.com |
| **Stripe** | Card deposits (premium slot) | https://dashboard.stripe.com |
| **Vercel** | Hosting the Next.js app | https://vercel.com |
| **Meta for Developers** | WhatsApp Cloud API (reminders/confirmations) | https://developers.facebook.com |
| **Resend** *(optional)* | Email fallback | https://resend.com |
| **Twilio** *(optional)* | SMS fallback | https://twilio.com |

---

## 1. Prerequisites on your machine

- **Node.js 22+** and npm 10+ — check: `node -v && npm -v`
- **Git**
- **Supabase CLI** — for running migrations:
  ```bash
  npm install -g supabase
  # or: brew install supabase/tap/supabase
  supabase --version
  ```

---

## 2. Clone & install

```bash
git clone <repo-url>
cd RSVPSYSTEM
git checkout claude/great-pasteur-31cafh   # current working branch
npm install
```

Verify the toolchain is healthy:

```bash
npm run typecheck    # tsc, should print nothing
npm run lint         # eslint, should print nothing
```

---

## 3. Create the Supabase project & apply the schema

1. In the Supabase dashboard → **New project**. Pick a region close to Mazatlán
   (e.g. `us-west-1`). Save the **database password** somewhere safe.
2. Get your keys from **Project Settings → API**:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` *(server-only, never ship to the browser)*
3. Link the CLI and push the migrations (creates schema, RLS, and seeds BRUMA):
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
   This runs, in order:
   - `0001_init.sql` — tables, enums, the anti-double-booking unique index
   - `0002_rls.sql` — Row-Level Security policies
   - `0003_seed_bruma.sql` — BRUMA venue, rooms, hours, premium rule

   **Local alternative** (Docker required) — run the whole stack on your machine:
   ```bash
   supabase start          # boots local Postgres + Studio
   supabase db reset       # applies all migrations + seed to the local DB
   ```
4. Sanity check in the SQL editor (or Studio):
   ```sql
   select name, min_capacity, max_capacity from rooms order by sort_order;
   select name, weekdays, start_time, deposit_per_person_cents
     from slot_rules where is_premium;
   ```
   You should see the 6 BRUMA rooms and the Fri/Sat 10pm $200/person rule.

---

## 4. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```bash
# Supabase (from step 3)
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>

# Stripe (step 5) — start in TEST mode
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# WhatsApp (step 6)
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_VERIFY_TOKEN=<a random string you choose>

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> Stripe/WhatsApp values can stay blank until Phase 1 wires those flows; the app
> runs and the booking shell renders with just the Supabase vars set.

---

## 5. Stripe (card deposits) — TEST mode first

1. Dashboard → **Developers → API keys**: copy the **test** publishable + secret keys.
2. Keep **Mexico / MXN** as the account currency.
3. Local webhook forwarding (needed once the deposit flow exists in Phase 1):
   ```bash
   stripe login
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
   The CLI prints a `whsec_...` signing secret → put it in `STRIPE_WEBHOOK_SECRET`.
4. Test cards: `4242 4242 4242 4242`, any future expiry, any CVC.
5. We use **card-only** Payment Intents for the premium slot (instant capture),
   so OXXO/SPEI do **not** need enabling.

---

## 6. WhatsApp Cloud API (Meta)

> This has the longest lead time (business verification + template approval).
> **Start this early** — decide who owns the BRUMA WhatsApp Business number.

1. Create a **Meta Business** account and a **Meta App** (type: Business).
2. Add the **WhatsApp** product → you get a test number + `Phone number ID` and a
   temporary access token. Put them in `WHATSAPP_PHONE_NUMBER_ID` /
   `WHATSAPP_ACCESS_TOKEN`.
3. For production: register the real BRUMA number, complete **business verification**,
   and submit **message templates** for approval:
   - `reservation_confirmation` (booking summary)
   - `reservation_reminder` (sent 24h and 3h before)
   - `waitlist_offer` (table opened — confirm within the window)
4. `WHATSAPP_VERIFY_TOKEN` is any string you pick; Meta echoes it back when
   verifying the webhook callback URL (`/api/webhooks/whatsapp`, Phase 1).

---

## 7. Run it locally

```bash
npm run dev
```

Open http://localhost:3000 → it redirects to **/bruma**, the branded booking
shell in BRUMA's dark/vinyl theme. To preview a production build:

```bash
npm run build && npm start
```

---

## 8. Create your first staff user (for the admin panel)

Staff sign in through Supabase Auth; access to a venue comes from
`venue_memberships`. To make yourself an **owner** of BRUMA:

1. Supabase dashboard → **Authentication → Users → Add user** (email + password),
   or sign up through the app once the staff login exists. Copy the user's `id`.
2. In the SQL editor:
   ```sql
   insert into venue_memberships (user_id, venue_id, role)
   values (
     '<your-auth-user-id>',
     '00000000-0000-0000-0000-0000000000b1',  -- BRUMA
     'owner'
   );
   ```
3. That user can now read/write all BRUMA data; RLS blocks everything else.
   Roles: `owner` / `manager` (full) vs `host` (operational).

---

## 9. Deploy to Vercel

1. Push your branch to GitHub (already connected to this repo).
2. Vercel → **New Project** → import the repo. Framework auto-detects Next.js.
3. **Environment Variables**: add every key from `.env.local` (use Stripe **live**
   keys and the production Supabase project for the prod environment; keep a
   separate Preview environment on test keys).
4. Deploy. Set `NEXT_PUBLIC_APP_URL` to the production domain.
5. Point the production webhooks at the deployed URLs:
   - Stripe → `https://<domain>/api/webhooks/stripe`
   - WhatsApp → `https://<domain>/api/webhooks/whatsapp`
6. Add the custom domain (e.g. `reservas.bruma.mx`) in Vercel → **Domains**.

---

## 10. Onboarding a second venue (no code)

Because rooms, hours, pricing, and branding are **data**, a new venue is a seed
like `0003_seed_bruma.sql`:

1. `insert into venues (...)` with a new `slug`.
2. Insert its `venue_branding` (theme tokens), `venue_settings`, `rooms`,
   `operating_hours`, and any `slot_rules`.
3. Add a token block in `src/styles/tokens.css` under `[data-venue="<slug>"]`
   (or load `venue_branding.theme_tokens` at runtime).
4. Visit `/<slug>` — it renders in that venue's skin. No redeploy of logic.

---

## Daily commands cheat-sheet

```bash
npm run dev          # local dev server
npm run build        # production build
npm run typecheck    # TypeScript, no emit
npm run lint         # ESLint
supabase db push     # apply new migrations to the linked project
supabase db reset    # rebuild the local DB from migrations + seed
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Invalid API key` from Supabase | Re-check `NEXT_PUBLIC_SUPABASE_URL` / anon key; restart `npm run dev` after editing `.env.local`. |
| Build fails on missing env in CI | CI passes placeholder Supabase vars (see `.github/workflows/ci.yml`); real values live in Vercel. |
| RLS "permission denied" for staff | Ensure a `venue_memberships` row exists for that user + venue. |
| Migrations won't push | `supabase link` to the right project-ref; confirm the DB password. |
| WhatsApp template rejected | Templates must match Meta's policy; avoid promotional wording in utility templates. |
