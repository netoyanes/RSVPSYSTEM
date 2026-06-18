# RSVP System — Multi-Venue Table Reservation Platform

**White-label reservation & revenue-management platform for premium hospitality.**
First venue: **BRUMA** — a vinyl bar in Mazatlán, Sinaloa.

> Status: **Architecture & design proposal** (pre-implementation). This document is
> the agreed foundation before any application code is written.

---

## 0. Decisions locked for the MVP

These were confirmed with the product owner and drive everything below:

| Decision | Choice | Notes |
|---|---|---|
| Backend / hosting | **Supabase (Postgres + Auth + Realtime + RLS + Storage) + Vercel** | Multi-tenant isolation enforced at the database layer. |
| Payment gateway | **Stripe — card only** | For the premium deposit we use **card payments only** (instant capture). OXXO/SPEI are *not* used for the prime slot: they settle asynchronously and can't guarantee an instant table lock. |
| Deposit handling | **Charge now → redeemable credit on the dashboard** | $200 MXN/person captured at booking and recorded as a **credit on the customer's account**, visible on the dashboard. Staff redeem it against the bill that night; **on a no-show the credit is retained, not lost** — it stays on the account to redeem on a future visit. |
| Slot hold (concurrency) | **10-minute TTL** | The slot is locked for 10 minutes while the customer completes checkout, then auto-released. |
| Reminders | **WhatsApp at 24h and 3h before** | Configurable per venue via `reminder_offsets`. |
| Languages | **Spanish default + English toggle** | ES-first for Mazatlán locals, EN for tourists. Full i18n from Phase 1. |
| First deliverable | **This design document** | Implementation follows after sign-off. |

---

## 1. Product summary

A booking system with two faces, both **mobile-first**:

- **Customer** — a responsive PWA to book a table in a few taps, pay the premium
  deposit when it applies, and join a waitlist when the prime slot is full.
- **Staff** — an installable PWA optimized for one-handed use during night service:
  live floor-plan, fast reservation actions, instant notifications, check-in /
  no-show / deposit-applied, all in a dark, high-contrast UI.

The platform is **white-label**: BRUMA is venue #1, but rooms, capacities,
schedules, pricing rules, and branding are **data, not code**. Onboarding a new
venue is configuration, never a redeploy.

---

## 2. Tech stack & justification

| Layer | Technology | Why |
|---|---|---|
| **Frontend** | Next.js 15 (App Router), React, TypeScript, Tailwind CSS, installable **PWA** (Workbox/`next-pwa`) | One mobile-first codebase serves both the customer site and the staff panel. SSR gives fast first paint on phones over flaky venue Wi-Fi. PWA = home-screen icon + push for staff, no App Store gatekeeping. |
| **Design system** | Tailwind + **CSS custom-property design tokens** + Radix UI primitives | Per-venue theming is a token swap (`--bg`, `--accent`, font, logo, copy) over one base. Dark / high-contrast is the *default*, not a mode. Radix gives accessible, unstyled primitives we skin. |
| **Backend** | Next.js **Route Handlers + Server Actions** (Node runtime), with a thin service layer | Small team, end-to-end TypeScript, co-located with the frontend. Heavy/scheduled work (reminders, waitlist expiry, hold cleanup) runs as **Supabase Edge Functions / cron** + Vercel Cron. |
| **Database** | **PostgreSQL** (via Supabase) | Relational integrity for reservations/payments and — critically — transactional row locks (`SELECT … FOR UPDATE`, advisory locks) and partial unique indexes to prevent double-booking the premium slot under concurrency. |
| **Auth** | **Supabase Auth** | Staff sign-in (email/OTP/password). Customers use guest checkout by default (phone-verified), with optional accounts later. |
| **Tenant isolation** | **Postgres Row-Level Security (RLS)** | Every tenant row carries `venue_id`; RLS policies enforce isolation at the DB, so a bug in app code can't leak another venue's data. |
| **Realtime** | **Supabase Realtime** (Postgres logical replication) | Drives the live floor-plan and new-reservation/payment alerts across staff phones with no extra infrastructure. |
| **Payments** | **Stripe** (Payment Intents, manual or automatic capture, webhooks, Radar) | See §6. MX support for cards, OXXO, SPEI. Idempotency keys + webhooks make the money flow reliable. |
| **Messaging** | **WhatsApp Cloud API (Meta)** primary; **Resend** (email) + **Twilio** (SMS) fallback | WhatsApp is *the* channel in Mexico. Meta's official Cloud API is the cheapest, most reliable path; pre-approved templates for confirmations/reminders/waitlist offers. |
| **Hosting** | **Vercel** (web/edge) + **Supabase** (data/auth/realtime/storage) | Edge CDN, preview deploys, instant rollbacks. |
| **Observability** | Sentry (errors), Vercel Analytics / PostHog (product + funnel) | Conversion funnel visibility for the revenue-management goal. |

### Why Stripe over Mercado Pago / Conekta for *this* product
All three work in Mexico. We chose **Stripe** because:
- **Deposit reliability:** first-class Payment Intents with idempotency keys and
  robust webhooks — essential when money and a table lock are coupled.
- **Fraud tooling:** Radar reduces chargebacks on card deposits out of the box.
- **DX & future-proofing:** clean APIs, test mode, and the option to switch a
  premium slot to a **pre-authorization hold** later without re-platforming.
- **Local methods covered:** cards, **OXXO**, and **SPEI** are supported for MX.

> Trade-off acknowledged: Mercado Pago has higher consumer brand trust and native
> MSI (meses sin intereses). If completion-rate testing later shows drop-off at
> checkout, the payment layer is abstracted (see §6.4) so adding Mercado Pago as a
> second provider is additive, not a rewrite.

---

## 3. PWA vs native — recommendation per profile

| Profile | Recommendation | Reasoning |
|---|---|---|
| **Customer** | **Responsive web + light PWA** | Booking is a low-frequency, high-intent task reached from a link (WhatsApp, Instagram bio, Google). Zero install friction is the priority — forcing an app download kills conversion. No native app. |
| **Staff** | **Installable PWA** (home-screen icon, push, offline shell) | Used nightly, benefits from an icon and push notifications, but doesn't need deep native APIs. PWA avoids App/Play Store review cycles and lets us ship fixes mid-service. **Caveat:** iOS web-push requires iOS 16.4+ and the PWA to be added to the home screen; we'll document this in staff onboarding. If push reliability on iOS proves insufficient in production, a thin native wrapper (Capacitor) reusing the same web UI is the fallback — not a rewrite. |

**Verdict:** PWA for both, native only as a contingency for staff push on iOS.

---

## 4. Data model (multi-venue from day one)

Every tenant-scoped table carries `venue_id`; RLS policies scope all reads/writes
by the caller's venue membership. Times are stored in UTC; each venue has a
`timezone` for correct local-day and slot math.

```
venues
  id (uuid, pk)
  slug (unique)            -- e.g. "bruma"
  name
  timezone                 -- "America/Mazatlan"
  currency                 -- "MXN"
  status                   -- active | onboarding | suspended
  created_at

venue_branding
  venue_id (fk, pk)
  logo_url
  theme_tokens (jsonb)     -- {bg, surface, accent, text, ...} CSS variables
  font
  copy (jsonb)             -- venue-specific microcopy / tone

venue_settings
  venue_id (fk, pk)
  cancellation_window_hrs  -- e.g. 24
  hold_ttl_minutes         -- 10 (slot lock during checkout)
  no_show_policy (jsonb)    -- {action: "retain_as_credit"} → deposit kept as
                            --   redeemable account credit, never forfeited
  reminder_offsets (jsonb)  -- [{channel:"whatsapp", hours_before:24},
                            --   {channel:"whatsapp", hours_before:3}]
  supported_languages       -- ["es","en"], default "es"
  default_slot_minutes      -- e.g. 120

rooms
  id (uuid, pk)
  venue_id (fk)
  name                     -- "Room 1", "Bar"
  min_capacity
  max_capacity
  sort_order
  active (bool)

operating_hours
  id (pk)
  venue_id (fk)
  weekday (0–6)            -- 0=Sun … 6=Sat
  opens_at (time)          -- 18:00
  closes_at (time)         -- 00:00 or 02:00
  closes_next_day (bool)   -- Thu/Fri/Sat → true; Monday has no row (closed)

slot_rules                 -- premium / pricing rules, fully data-driven
  id (pk)
  venue_id (fk)
  name                     -- "Premium 10pm DJ"
  weekdays (int[])         -- [5,6] = Fri, Sat
  start_time (time)        -- 22:00
  is_premium (bool)
  deposit_per_person_cents -- 20000 = $200 MXN
  min_party_for_deposit    -- 6  (i.e. "> 5 people")
  active (bool)
  -- BRUMA's rule lives entirely here. No business logic is hardcoded.

customers                  -- CRM record, deduped by phone within a venue
  id (uuid, pk)
  venue_id (fk)
  name
  phone                    -- unique within venue
  email
  birthday (date, null)
  marketing_opt_in (bool)
  total_visits (int)
  last_visit (timestamptz, null)
  tags (text[])            -- "VIP", "regular", ...
  created_at

reservations
  id (uuid, pk)
  venue_id (fk)
  room_id (fk)
  customer_id (fk)
  status                   -- held | pending_payment | confirmed |
                           --   checked_in | no_show | cancelled
  reserved_date (date)     -- venue-local service date
  slot_start (timestamptz)
  slot_end (timestamptz)
  party_size (int)
  deposit_required (bool)
  deposit_cents (int)
  special_occasion         -- birthday, anniversary, ... (null)
  notes
  source                   -- web | admin
  hold_expires_at (timestamptz, null)  -- concurrency lock TTL
  created_by (fk staff, null)
  created_at
  -- Partial unique index prevents double-booking an active slot:
  --   UNIQUE(room_id, slot_start) WHERE status IN
  --     ('held','pending_payment','confirmed','checked_in')

payments
  id (uuid, pk)
  venue_id (fk)
  reservation_id (fk)
  provider                 -- "stripe"
  provider_ref             -- payment_intent id
  amount_cents
  type                     -- deposit | refund
  status                   -- requires_action | processing | succeeded |
                           --   refunded | failed
  applied_to_bill (bool)   -- staff toggle on the night
  applied_at (timestamptz, null)
  raw_payload (jsonb)      -- last webhook event
  created_at

customer_credits           -- redeemable-deposit ledger (wallet), keyed to customer
  id (uuid, pk)
  venue_id (fk)
  customer_id (fk)
  reservation_id (fk, null)
  payment_id (fk, null)
  type                     -- earned (deposit paid) | redeemed (applied to bill) |
                           --   expired | adjusted
  amount_cents             -- signed: + earned, − redeemed
  redeemed_by (fk staff, null)
  note
  created_at
  -- A customer's available balance = SUM(amount_cents) for the venue.
  -- On no-show the "earned" entry stays; no negative offset is written, so the
  -- credit remains redeemable on a future visit (per no_show_policy).

waitlist
  id (uuid, pk)
  venue_id (fk)
  slot_rule_id (fk)
  reserved_date (date)
  customer_id (fk)
  party_size (int)
  position (int)
  status                   -- waiting | offered | expired | converted | cancelled
  offer_expires_at (timestamptz, null)  -- confirm-and-pay window when a table opens
  created_at

staff_users                -- Supabase auth users
  id (uuid, pk)
  email
  name

venue_memberships
  user_id (fk)
  venue_id (fk)
  role                     -- owner | manager | host
  PRIMARY KEY (user_id, venue_id)

notifications              -- delivery log / idempotency
  id (pk)
  venue_id (fk)
  reservation_id (fk, null)
  channel                  -- whatsapp | email | sms
  template
  status                   -- queued | sent | delivered | failed
  sent_at
  provider_ref

audit_log
  id (pk)
  venue_id (fk)
  actor_id (fk staff, null)
  action                   -- created_reservation, moved, cancelled, refunded …
  entity                   -- reservation | payment | room | slot_rule …
  before (jsonb)
  after (jsonb)
  at (timestamptz)
```

### Indexes & constraints that matter
- `reservations`: partial unique on `(room_id, slot_start)` for active statuses →
  the database itself refuses a double-booking.
- `reservations`: index on `(venue_id, reserved_date)` for the day floor-plan.
- `customers`: unique `(venue_id, phone)` for CRM dedup.
- `waitlist`: index on `(venue_id, slot_rule_id, reserved_date, position)`.
- All tenant tables: RLS policy `venue_id IN (SELECT venue_id FROM venue_memberships WHERE user_id = auth.uid())` for staff; public booking uses a scoped service path.

### BRUMA seed data (illustrative)
- **Rooms:** Room 1 (4–6), Room 2 (2–8), Room 3 (4–4), Room 4 (7–7), Room 5 (5–5), Bar (12–15).
- **operating_hours:** Sun/Tue/Wed 18:00→00:00; Thu/Fri/Sat 18:00→02:00 (`closes_next_day`); Mon absent.
- **slot_rules:** one row → `weekdays=[5,6]`, `start_time=22:00`, `is_premium=true`, `deposit_per_person_cents=20000`, `min_party_for_deposit=6`.

---

## 5. System architecture

```
                          ┌──────────────────────────────────────┐
                          │              Clients (PWA)            │
                          │  Customer web  │  Staff panel (dark)  │
                          └───────┬─────────────────┬─────────────┘
                                  │ HTTPS           │ HTTPS + Realtime (WSS)
                                  ▼                 ▼
                    ┌─────────────────────────────────────────────┐
                    │            Next.js on Vercel (edge/SSR)      │
                    │  Route Handlers · Server Actions · service   │
                    │  layer (booking, pricing, waitlist, auth)    │
                    └───┬───────────────┬───────────────┬──────────┘
                        │               │               │
            ┌───────────▼──┐   ┌────────▼────────┐  ┌───▼──────────────┐
            │   Supabase   │   │     Stripe      │  │  Messaging        │
            │  Postgres+RLS│   │ PaymentIntents  │  │  WhatsApp Cloud   │
            │  Auth        │   │ + Webhooks      │  │  Resend / Twilio  │
            │  Realtime    │   └────────┬────────┘  └───────────────────┘
            │  Storage     │            │ webhook
            └──────┬───────┘            │
                   │  ◄─────────────────┘  (Stripe → /api/webhooks/stripe)
                   │
        ┌──────────▼───────────┐
        │  Background workers   │   Vercel Cron + Supabase Edge Functions
        │  · expire held slots  │
        │  · waitlist offers    │
        │  · send reminders     │
        └───────────────────────┘
```

**Flow narratives**

- **Booking (happy path):** customer picks date → party size → the API returns
  only rooms whose `[min,max]` capacity fits and slots within `operating_hours`.
  On select, we create a `reservations` row with `status=held` and
  `hold_expires_at = now()+N min`. The partial unique index guarantees only one
  user can hold a given room/slot.
- **Premium deposit:** if `slot_rules` matches (Fri/Sat 22:00, party ≥ 6), the UI
  shows the redeemable-deposit explainer, we create a Stripe Payment Intent for
  `party_size × deposit_per_person_cents`, and move the reservation to
  `pending_payment`. On the `payment_intent.succeeded` webhook we flip to
  `confirmed` and fire the WhatsApp confirmation. If the hold expires first, a
  cron job releases the slot and cancels the intent.
- **Waitlist:** when the premium slot is full, customers join `waitlist`. When a
  matching table frees up (cancellation/no-show), a worker offers it to position 1
  with an `offer_expires_at` window, notifies via WhatsApp, and only converts on
  successful payment; otherwise it rolls to the next position.
- **Realtime floor-plan:** staff subscribe to `reservations` changes for the
  current `venue_id` + `reserved_date`; inserts/updates push to every device.

---

## 6. Payments — Stripe design (charge-now, credit-on-bill)

1. **Compute deposit** server-side from `slot_rules` (never trust the client):
   `amount = party_size × deposit_per_person_cents`.
2. **Create PaymentIntent** with `automatic` capture, `currency=mxn`,
   `payment_method_types=['card']` (**card only** — guarantees an instant lock; no
   async OXXO/SPEI for the prime slot), an **idempotency key** = reservation id,
   and metadata (`venue_id`, `reservation_id`). The slot is already `held`, so the
   table can't be lost while paying.
3. **Confirm on client** (Stripe.js / Payment Element, mobile-optimized, card).
4. **Webhook** `/api/webhooks/stripe` (signature-verified):
   `payment_intent.succeeded` → reservation `confirmed`, `payments.status=succeeded`,
   **and write an `earned` row to `customer_credits`** so the amount appears as a
   redeemable balance on the dashboard.
5. **On the night:** staff redeem the credit against the table's check from the
   dashboard → a `redeemed` (negative) row is written to `customer_credits` and
   `payments.applied_to_bill=true`. The customer's balance returns to zero.
6. **No-show:** per `no_show_policy = retain_as_credit`, the `earned` credit
   **stays on the customer's account** — it is not forfeited and not auto-refunded.
   The customer can redeem it on a future visit; staff can also issue a Stripe
   refund manually if they choose. Every action is written to `audit_log`.

**6.4 Provider abstraction.** All payment calls go through a `PaymentProvider`
interface (`createDeposit`, `refund`, `handleWebhook`). Stripe is the first
implementation; adding Mercado Pago later is a new adapter, not a refactor.

---

## 7. Concurrency & the premium slot (no double-booking)

Three layers defend the prime 10pm slot:

1. **Optimistic hold:** creating a `held` reservation with `hold_expires_at`
   reserves the slot the instant the user commits, before payment.
2. **Database guarantee:** the partial unique index on `(room_id, slot_start)` for
   active statuses makes a double-booking *impossible* — the second writer gets a
   constraint violation we translate into "just taken, try another slot."
3. **Serialized critical section:** the hold-creation runs inside a transaction
   using a Postgres **advisory lock** keyed on `(venue_id, room_id, slot_start)`
   so concurrent requests queue deterministically rather than race.

Expired holds are swept by a cron worker (release slot, cancel the unpaid intent,
promote the next waitlist entry).

---

## 8. Notifications

- **WhatsApp Cloud API** (primary): confirmation, configurable reminders
  (`reminder_offsets`), waitlist offers, cancellation notices — all via
  pre-approved message templates (required by Meta for business-initiated msgs).
- **Email (Resend)** + **SMS (Twilio)** as fallback / backup channel.
- Every send is logged in `notifications` for idempotency and delivery auditing;
  a queue + retry policy handles transient provider failures.

---

## 9. Development phase plan

**Phase 0 — Foundations (this doc + setup)**
Repo, Next.js + Tailwind + PWA shell, Supabase project, schema migrations, RLS
policies, design tokens, CI. *Exit:* schema deployed, theming proven with BRUMA tokens.

**Phase 1 — BRUMA MVP (single venue, go live)**
- Customer booking flow (date → party → fitting rooms/slots → confirm).
- Smart room assignment by capacity.
- Stripe deposit for the Fri/Sat 10pm premium rule (charge-now-credit-on-bill).
- Concurrency hold + unique-index protection.
- Staff PWA: live floor-plan, create/edit/move/cancel, check-in / no-show /
  deposit-applied, realtime alerts, dark mode.
- WhatsApp confirmation + reminder; CRM capture.
- *Exit:* BRUMA taking real reservations and deposits.

**Phase 2 — Operational depth**
- Waitlist for the premium slot with auto-offer + confirm window.
- Cancellation/no-show policy engine, refunds.
- Reports: occupancy by room/slot, deposit revenue, peak hours, no-shows,
  recurring-customer DB.
- Multi-role (owner/manager vs host).

**Phase 3 — Multi-venue / white-label**
- Venue onboarding from the panel (rooms, hours, slot rules, branding, staff).
- Per-venue theming end-to-end, slug-based routing.
- Tenant-aware reporting and billing.
- *Exit:* a second venue live with zero code changes.

**Phase 4 — Growth**
- MSI / Mercado Pago provider option, marketing automations (birthday/occasion),
  Google Reserve / Instagram entry points, A/B testing on the funnel.

---

## 10. Security, privacy & compliance

**Payments (PCI).** Card data never touches our servers — Stripe.js / Payment
Element tokenizes in the browser (SAQ-A scope). Webhooks are signature-verified;
amounts are always computed server-side from `slot_rules`; idempotency keys
prevent double charges; secrets live in environment variables, never in the repo.

**Personal data — LFPDPPP (México).** The platform handles personal data and must
comply with the *Ley Federal de Protección de Datos Personales en Posesión de los
Particulares*:
- **Aviso de privacidad** (privacy notice) shown at data capture, with explicit
  **consent** for marketing use (`marketing_opt_in` separate from booking).
- **ARCO rights** (Acceso, Rectificación, Cancelación, Oposición): customer data
  endpoints to export/correct/delete on request.
- **Data minimization:** birthday/occasion are optional; collect only what the
  reservation and CRM need.
- **Retention policy** per venue; deletion cascades respect audit/legal needs.

**Application security.**
- **RLS** isolates tenants at the database; staff scoped by `venue_memberships`.
- **RBAC** (owner/manager/host) enforced server-side, not just in the UI.
- HTTPS everywhere; httpOnly secure cookies; CSRF protection on mutations.
- Input validation (Zod) on every server action; rate limiting on booking and
  payment endpoints to deter abuse and slot-squatting.
- **Audit log** for every staff action on reservations, payments, and config.
- Least-privilege service keys; Supabase service-role key used only in trusted
  server contexts, never shipped to the client.

---

## 11. Open items — status

**Resolved with product owner:**

1. ✅ **Hold TTL** — **10 minutes**.
2. ✅ **No-show / deposit** — paid deposit becomes a **redeemable credit on the
   customer's account**, shown on the dashboard. On no-show it is **retained as
   credit, never forfeited** (`no_show_policy = retain_as_credit`); staff may still
   issue a manual refund.
3. ✅ **Reminder cadence** — **WhatsApp at 24h and 3h** before (configurable).
4. ✅ **WhatsApp** — Meta Business verification + template approval to start now
   (lead time). *Action: confirm who owns the BRUMA WhatsApp Business number.*
5. ✅ **Languages** — **Spanish default + English toggle.**
6. ✅ **Payment methods** — **card-only via Stripe** for the premium deposit (no
   async OXXO/SPEI on the prime slot).

**Still to confirm before Phase 1 ship:**

- **WhatsApp number ownership** — which entity/number registers as the BRUMA
  WhatsApp Business sender (blocks template approval).
- **Cancellation window** — hours before the reservation after which a customer
  can no longer self-cancel (default proposed: 24h). Note this is now decoupled
  from the deposit outcome, since the deposit is always retained as credit.
```
