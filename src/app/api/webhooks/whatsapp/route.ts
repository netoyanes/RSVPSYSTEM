import { whatsappAdapter } from "@/lib/bot/channels/whatsapp";
import { makeWebhookHandlers } from "@/lib/bot/webhook";

// Node runtime: the engine uses the Anthropic SDK and crypto for signatures.
export const runtime = "nodejs";

const handlers = makeWebhookHandlers(whatsappAdapter);
export const GET = handlers.GET;
export const POST = handlers.POST;
