import { type NextRequest } from "next/server";
import type { ChannelAdapter } from "@/lib/bot/types";
import { handleIncoming } from "@/lib/bot/engine";

/**
 * Builds the GET (verification handshake) and POST (message delivery) handlers
 * for a channel. The two webhook routes are one-liners over this — the logic is
 * identical across channels because the adapter abstracts the differences.
 */
export function makeWebhookHandlers(adapter: ChannelAdapter) {
  async function GET(req: NextRequest) {
    const challenge = adapter.verifyWebhook(req.nextUrl.searchParams);
    if (challenge !== null) return new Response(challenge, { status: 200 });
    return new Response("Forbidden", { status: 403 });
  }

  async function POST(req: NextRequest) {
    const raw = await req.text();
    const signature = req.headers.get("x-hub-signature-256");

    if (!adapter.verifySignature(raw, signature)) {
      return new Response("Invalid signature", { status: 401 });
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const incoming = adapter.parse(body);
    await Promise.all(
      incoming.map(async (msg) => {
        try {
          const replies = await handleIncoming(adapter.channel, msg);
          if (replies.length > 0) await adapter.send(msg.externalId, replies);
        } catch (err) {
          // Never fail the webhook on a per-message error — Meta would retry/disable.
          console.error(`[bot:${adapter.channel}] handler error`, err);
        }
      }),
    );

    // Always 200 quickly so Meta considers the delivery acknowledged.
    return new Response("ok", { status: 200 });
  }

  return { GET, POST };
}
