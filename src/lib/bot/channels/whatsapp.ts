import type { ChannelAdapter, IncomingMessage, OutgoingMessage } from "@/lib/bot/types";
import { verifyMetaSignature } from "@/lib/bot/security";

const GRAPH = "https://graph.facebook.com/v21.0";

/** WhatsApp Cloud API (Meta, direct) adapter. */
export const whatsappAdapter: ChannelAdapter = {
  channel: "whatsapp",

  verifyWebhook(params) {
    const mode = params.get("hub.mode");
    const token = params.get("hub.verify_token");
    const challenge = params.get("hub.challenge");
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
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
    const entries = (body as WhatsAppWebhook)?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const profileName = value?.contacts?.[0]?.profile?.name ?? null;
        for (const msg of value?.messages ?? []) {
          if (msg.type === "text" && msg.text?.body) {
            messages.push({
              channel: "whatsapp",
              externalId: msg.from,
              text: msg.text.body,
              profileName,
            });
          }
        }
      }
    }
    return messages;
  },

  async send(to, messages) {
    const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    if (!phoneId || !token) return;
    for (const m of messages) {
      await fetch(`${GRAPH}/${phoneId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: m.text },
        }),
      });
    }
  },
};

type WhatsAppWebhook = {
  entry?: {
    changes?: {
      value?: {
        contacts?: { profile?: { name?: string } }[];
        messages?: {
          from: string;
          type: string;
          text?: { body?: string };
        }[];
      };
    }[];
  }[];
};

export type { OutgoingMessage };
