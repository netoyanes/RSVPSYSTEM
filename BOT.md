# Omnichannel Reservation Bot

A multifunctional conversational bot that runs on **WhatsApp Business Platform**
and **Instagram Messaging** over a single shared logic layer, connected to the
existing reservation system (Supabase RPCs + Stripe deposit, stubbed for now).

## Architecture

```
Inbound webhook (WhatsApp | Instagram)
   │  GET  → verify subscription (hub.challenge)
   │  POST → verify X-Hub-Signature-256 (HMAC-SHA256, META_APP_SECRET)
   ▼
Channel Adapter  (src/lib/bot/channels/*)
   parse(body) → IncomingMessage { channel, externalId, text, profileName }
   send(to, messages)
   ▼
SHARED LOGIC LAYER (channel-agnostic)
   engine.ts   → intent router + reservation state machine
   llm.ts      → Claude Haiku classifies intent + extracts date/party/choice
   state.ts    → conversation state in Supabase (bot_conversations/bot_messages)
   services.ts → reuses get_availability / create_hold RPCs
   venue.ts    → venue config + knowledge base (hours, location, menu, FAQ)
   ▼
Channel Adapter.send → WhatsApp / Instagram Graph API
```

**One brain, many channels.** The router and state machine never know which
channel they're on. Each channel implements the `ChannelAdapter` interface
(`verifyWebhook`, `verifySignature`, `parse`, `send`). Adding a channel (webchat,
Messenger, TikTok) is one new adapter — no change to the core.

**Extensible by intent.** Capabilities live in an intent registry classified by
the LLM and handled in `engine.ts`: `reservar`, `horarios`, `ubicacion`, `menu`,
`faq`, `hablar_con_humano` (handoff to staff), `saludo`. Adding a capability =
add an intent + a handler. The reservation flow is a deterministic state machine
(`date → party → choose → name → phone → confirm`); the LLM only interprets
language, never controls money or availability.

**Reuses the system.** Availability and holds go through the same secure
`get_availability` / `create_hold` RPCs as the web flow, so capacity rules, the
premium-deposit rule, and the double-booking guard are enforced in one place.

**Security.** Every webhook verifies Meta's HMAC signature over the raw body;
all secrets live only in Vercel env vars; conversation state is under RLS (staff
read-only; the bot writes with the service role). On `hablar_con_humano` the
conversation flips to `assigned_human` and the bot goes silent so staff own it.

## Environment variables (Vercel)

```
META_APP_SECRET=            # Meta app secret — verifies both channels' signatures
ANTHROPIC_API_KEY=          # Claude (intent router) — console.anthropic.com

# WhatsApp Cloud API
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=      # any string you choose; echoed during webhook setup

# Instagram Messaging (same Meta app; IG Business linked to a FB Page)
INSTAGRAM_ACCOUNT_ID=
INSTAGRAM_ACCESS_TOKEN=     # the linked Page access token
INSTAGRAM_VERIFY_TOKEN=
```

Plus the existing `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Database

Run `supabase/migrations/0008_bot.sql` (already folded into `supabase/setup.sql`).
It creates `bot_conversations` + `bot_messages`, their RLS, and adds
`bot_conversations` to the realtime publication so staff can watch handoffs.

## Meta setup

1. **Anthropic:** create an API key, put it in `ANTHROPIC_API_KEY`.
2. **Meta app:** in the Meta App → **App settings → Basic**, copy the **App
   Secret** → `META_APP_SECRET`.
3. **WhatsApp** product → get the **Phone number ID** and a **permanent access
   token** → `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN`. Pick any
   `WHATSAPP_VERIFY_TOKEN`.
4. **Configure the WhatsApp webhook:** callback URL
   `https://<domain>/api/webhooks/whatsapp`, verify token = your
   `WHATSAPP_VERIFY_TOKEN`, subscribe to **messages**.
5. **Instagram:** link an **Instagram Business** account to a **Facebook Page**,
   add the **Instagram** product, get the Page token → `INSTAGRAM_ACCESS_TOKEN`
   and the IG account id → `INSTAGRAM_ACCOUNT_ID`. Webhook callback
   `https://<domain>/api/webhooks/instagram`, subscribe to **messages**.
6. **Templates:** for business-initiated messages (reminders), WhatsApp requires
   pre-approved templates. The bot's *replies to inbound messages* run inside the
   24-hour customer-service window and don't need templates.

## Testing

After deploying with the env vars set and `setup.sql` applied:

- WhatsApp: message the number → "quiero reservar para mañana 4 personas" → the
  bot proposes available slots; reply with a number; give a name → it confirms
  (or, for a Fri/Sat 10pm group >5, holds and announces the redeemable deposit).
- Instagram: DM the account → same flow (it will also ask for a phone, since IG
  doesn't expose one).
- Handoff: "quiero hablar con una persona" → the bot hands off and goes silent;
  the conversation shows in `bot_conversations` with `assigned_human = true`.

## Status / next

- **Deposit link is stubbed** — the bot holds the table and announces the
  redeemable deposit; the real Stripe payment link + auto-confirm lands with the
  Stripe phase (Phase 1b).
- Bot replies are Spanish-first; the copy is centralized for easy EN addition.
- Staff handoff is currently "bot goes silent"; a staff inbox view on the panel
  is a natural follow-up.
