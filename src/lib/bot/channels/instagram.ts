import type { ChannelAdapter, IncomingMessage } from "@/lib/bot/types";
import { verifyMetaSignature } from "@/lib/bot/security";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Instagram Messaging API (Meta) adapter. Same app/secret as WhatsApp; the
 *  webhook payload shape differs (entry[].messaging[]). */
export const instagramAdapter: ChannelAdapter = {
  channel: "instagram",

  verifyWebhook(params) {
    const mode = params.get("hub.mode");
    const token = params.get("hub.verify_token");
    const challenge = params.get("hub.challenge");
    if (mode === "subscribe" && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
      return challenge;
    }
    return null;
  },

  verifySignature(rawBody, signatureHeader) {
    return verifyMetaSignature(
      rawBody,
      signatureHeader,
      process.env.META_APP_SECRET ?? "",
    );
  },

  parse(body) {
    const messages: IncomingMessage[] = [];
    const entries = (body as InstagramWebhook)?.entry ?? [];
    for (const entry of entries) {
      for (const event of entry.messaging ?? []) {
        // Ignore our own echoes and non-text events.
        if (event.message?.is_echo) continue;
        const text = event.message?.text;
        if (text && event.sender?.id) {
          messages.push({
            channel: "instagram",
            externalId: event.sender.id,
            text,
          });
        }
      }
    }
    return messages;
  },

  async send(to, messages) {
    const igId = process.env.INSTAGRAM_ACCOUNT_ID;
    const token = process.env.INSTAGRAM_ACCESS_TOKEN;
    if (!igId || !token) return;
    for (const m of messages) {
      await fetch(`${GRAPH}/${igId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipient: { id: to },
          message: { text: m.text },
        }),
      });
    }
  },
};

type InstagramWebhook = {
  entry?: {
    messaging?: {
      sender?: { id?: string };
      message?: { text?: string; is_echo?: boolean };
    }[];
  }[];
};
