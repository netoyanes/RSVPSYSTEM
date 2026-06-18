import { instagramAdapter } from "@/lib/bot/channels/instagram";
import { makeWebhookHandlers } from "@/lib/bot/webhook";

export const runtime = "nodejs";

const handlers = makeWebhookHandlers(instagramAdapter);
export const GET = handlers.GET;
export const POST = handlers.POST;
