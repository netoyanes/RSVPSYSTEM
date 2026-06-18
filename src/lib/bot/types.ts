/** Channel-agnostic bot contracts. Adapters translate each platform's webhook
 *  payload into these shapes so the core logic never knows which channel it's on. */

export type Channel = "whatsapp" | "instagram";

/** A normalized inbound message from any channel. */
export type IncomingMessage = {
  channel: Channel;
  externalId: string; // wa_id (phone) for WhatsApp, scoped sender id for Instagram
  text: string;
  profileName?: string | null;
};

/** A normalized outbound message. Kept minimal (text) for now; buttons/quick
 *  replies are an additive extension on the adapter, not a core change. */
export type OutgoingMessage = {
  text: string;
};

/** Every channel implements this. Adding a channel = one new adapter, no core change. */
export interface ChannelAdapter {
  channel: Channel;
  /** Verify the webhook subscription handshake (GET). Returns the challenge to echo, or null. */
  verifyWebhook(params: URLSearchParams): string | null;
  /** Verify the request signature (HMAC) against the raw body. */
  verifySignature(rawBody: string, signatureHeader: string | null): boolean;
  /** Parse a webhook POST body into normalized messages. */
  parse(body: unknown): IncomingMessage[];
  /** Send messages back to a recipient on this channel. */
  send(to: string, messages: OutgoingMessage[]): Promise<void>;
}

/** Reservation flow state persisted in bot_conversations.context. */
export type BotContext = {
  date?: string;
  party?: number;
  options?: {
    room_id: string;
    room_name: string;
    slot_start: string;
    deposit_cents: number;
  }[];
  selected?: {
    room_id: string;
    room_name: string;
    slot_start: string;
    deposit_cents: number;
  };
  name?: string;
  phone?: string;
};

export type Conversation = {
  id: string;
  venue_id: string;
  channel: Channel;
  external_id: string;
  profile_name: string | null;
  flow: "idle" | "reserve";
  step: string | null;
  context: BotContext;
  locale: string;
  assigned_human: boolean;
};
