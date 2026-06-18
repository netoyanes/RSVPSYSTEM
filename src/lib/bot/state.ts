import { createServiceClient } from "@/lib/supabase/service";
import type { Channel, Conversation } from "@/lib/bot/types";

/** Conversation + message persistence for the bot (service-role, bypasses RLS). */

type AnyClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (c: string, v: unknown) => {
        eq: (c: string, v: unknown) => {
          maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
        };
      };
    };
    insert: (rows: unknown) => {
      select: (cols: string) => {
        single: () => Promise<{ data: unknown; error: { message: string } | null }>;
      };
    };
    update: (vals: unknown) => { eq: (c: string, v: unknown) => Promise<{ error: unknown }> };
  };
};

function db(): AnyClient {
  return createServiceClient() as unknown as AnyClient;
}

export async function getOrCreateConversation(
  channel: Channel,
  externalId: string,
  venueId: string,
  profileName: string | null | undefined,
): Promise<Conversation> {
  const client = db();
  const { data } = await client
    .from("bot_conversations")
    .select(
      "id, venue_id, channel, external_id, profile_name, flow, step, context, locale, assigned_human",
    )
    .eq("channel", channel)
    .eq("external_id", externalId)
    .maybeSingle();

  if (data) return data as Conversation;

  const { data: created, error } = await client
    .from("bot_conversations")
    .insert({
      venue_id: venueId,
      channel,
      external_id: externalId,
      profile_name: profileName ?? null,
    })
    .select(
      "id, venue_id, channel, external_id, profile_name, flow, step, context, locale, assigned_human",
    )
    .single();

  if (error) throw new Error(error.message);
  return created as Conversation;
}

export async function saveConversation(conv: Conversation): Promise<void> {
  await db()
    .from("bot_conversations")
    .update({
      flow: conv.flow,
      step: conv.step,
      context: conv.context,
      assigned_human: conv.assigned_human,
      profile_name: conv.profile_name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conv.id);
}

export async function logMessage(
  conv: Conversation,
  direction: "in" | "out",
  text: string,
): Promise<void> {
  await db()
    .from("bot_messages")
    .insert({
      conversation_id: conv.id,
      venue_id: conv.venue_id,
      direction,
      text,
    })
    .select("id")
    .single();
}
