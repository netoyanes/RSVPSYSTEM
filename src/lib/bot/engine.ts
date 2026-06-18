import type { Channel, Conversation, IncomingMessage, OutgoingMessage } from "@/lib/bot/types";
import { classifyMessage, type IntentResult } from "@/lib/bot/llm";
import { getOrCreateConversation, logMessage, saveConversation } from "@/lib/bot/state";
import { botAvailability, botCreateHold, type Slot } from "@/lib/bot/services";
import { BRUMA, INFO } from "@/lib/bot/venue";
import { formatMoney } from "@/lib/booking/rules";
import { formatSlotTime, todayInTz } from "@/lib/booking/datetime";

/**
 * Channel-agnostic conversation engine. One brain for every channel: the adapter
 * hands us a normalized message, we classify intent (LLM), drive the reservation
 * state machine (deterministic), and return normalized replies for the adapter
 * to deliver. No channel specifics leak in here.
 */

const T = {
  handoff:
    "Con gusto. Te conecto con una persona del equipo de BRUMA, en breve te responden por aquí. 🙌",
  menu:
    "¡Hola! Soy el asistente de BRUMA 🎶 Puedo ayudarte a *reservar una mesa*, darte *horarios* o *ubicación*, o conectarte con una persona. ¿Qué necesitas?",
  askDate: "¿Para qué día quieres tu reserva? (ej. hoy, mañana, el viernes)",
  askParty: "¿Cuántas personas son?",
  askName: "¿A nombre de quién hago la reserva?",
  askPhone: "¿Me compartes un teléfono de contacto (WhatsApp)?",
  askChoice: "Responde con el número de la opción que prefieras. 🙂",
  noAvail:
    "No encontré disponibilidad para ese grupo en esa fecha. ¿Quieres probar otro día?",
  error: "Tuvimos un problema procesando tu solicitud. ¿Lo intentamos de nuevo?",
  slotTaken:
    "Esa mesa se acaba de ocupar. Te muestro otras opciones, dame un momento. ¿Confirmas el día y las personas?",
};

export async function handleIncoming(
  channel: Channel,
  incoming: IncomingMessage,
): Promise<OutgoingMessage[]> {
  const venue = BRUMA;
  const conv = await getOrCreateConversation(
    channel,
    incoming.externalId,
    venue.id,
    incoming.profileName,
  );
  await logMessage(conv, "in", incoming.text);

  // Handed off to a human → the bot stays silent so staff own the thread.
  if (conv.assigned_human) return [];

  const cls = await classifyMessage({
    text: incoming.text,
    today: todayInTz(venue.timezone),
    step: conv.flow === "reserve" ? (conv.step ?? "reserva") : "inicio",
    venueName: venue.name,
  });

  let out: OutgoingMessage[];

  if (cls.intent === "hablar_con_humano") {
    conv.assigned_human = true;
    conv.flow = "idle";
    conv.step = null;
    out = [{ text: T.handoff }];
  } else if (conv.flow === "reserve") {
    out = await advanceReservation(conv, channel, cls, incoming);
  } else {
    switch (cls.intent) {
      case "reservar":
        conv.flow = "reserve";
        conv.step = "date";
        conv.context = {};
        out = await advanceReservation(conv, channel, cls, incoming);
        break;
      case "horarios":
        out = [{ text: INFO.horarios }];
        break;
      case "ubicacion":
        out = [{ text: INFO.ubicacion }];
        break;
      case "menu":
        out = [{ text: INFO.menu }];
        break;
      case "faq":
        out = [{ text: INFO.faq }];
        break;
      default:
        out = [{ text: T.menu }];
    }
  }

  await saveConversation(conv);
  for (const m of out) await logMessage(conv, "out", m.text);
  return out;
}

/** Deterministic reservation FSM. Consumes entities extracted by the LLM. */
async function advanceReservation(
  conv: Conversation,
  channel: Channel,
  cls: IntentResult,
  incoming: IncomingMessage,
): Promise<OutgoingMessage[]> {
  const ctx = conv.context;

  // Absorb newly-mentioned entities; a changed date/party invalidates options.
  if (cls.date && cls.date !== ctx.date) {
    ctx.date = cls.date;
    ctx.options = undefined;
    ctx.selected = undefined;
  }
  if (cls.party_size && cls.party_size !== ctx.party) {
    ctx.party = cls.party_size;
    ctx.options = undefined;
    ctx.selected = undefined;
  }

  if (!ctx.date) {
    conv.step = "date";
    return [{ text: T.askDate }];
  }
  if (!ctx.party) {
    conv.step = "party";
    return [{ text: T.askParty }];
  }

  // Need fresh availability.
  if (!ctx.options) {
    const { data, error } = await botAvailability(BRUMA.slug, ctx.date, ctx.party);
    if (error) return [{ text: T.error }];
    if (!data || data.length === 0) {
      ctx.date = undefined;
      conv.step = "date";
      return [{ text: T.noAvail }];
    }
    ctx.options = data.slice(0, 6);
    conv.step = "choice";
    return [{ text: renderOptions(ctx.options, conv.locale) }];
  }

  if (conv.step === "choice") {
    const idx = cls.choice;
    if (!idx || idx < 1 || idx > ctx.options.length) {
      return [{ text: T.askChoice }];
    }
    ctx.selected = ctx.options[idx - 1];
    if (channel === "whatsapp") ctx.phone = incoming.externalId; // wa_id is the phone
    if (!ctx.name) {
      conv.step = "name";
      return [{ text: T.askName }];
    }
    if (!ctx.phone) {
      conv.step = "phone";
      return [{ text: T.askPhone }];
    }
    return finalizeHold(conv);
  }

  if (conv.step === "name") {
    ctx.name = incoming.text.trim();
    if (!ctx.phone) {
      conv.step = "phone";
      return [{ text: T.askPhone }];
    }
    return finalizeHold(conv);
  }

  if (conv.step === "phone") {
    ctx.phone = incoming.text.trim();
    return finalizeHold(conv);
  }

  return [{ text: T.menu }];
}

async function finalizeHold(conv: Conversation): Promise<OutgoingMessage[]> {
  const ctx = conv.context;
  if (!ctx.selected || !ctx.party || !ctx.name || !ctx.phone) {
    return [{ text: T.error }];
  }

  const { data, error } = await botCreateHold({
    slug: BRUMA.slug,
    roomId: ctx.selected.room_id,
    slotStart: ctx.selected.slot_start,
    party: ctx.party,
    name: ctx.name,
    phone: ctx.phone,
  });

  if (error) {
    if (error.message.includes("slot_taken")) {
      ctx.options = undefined;
      ctx.selected = undefined;
      conv.step = "choice";
      return [{ text: T.slotTaken }];
    }
    return [{ text: T.error }];
  }

  const res = data?.[0];
  const when = formatSlotTime(ctx.selected.slot_start, BRUMA.timezone, conv.locale);
  const room = ctx.selected.room_name;
  const party = ctx.party;

  // Reset the flow for the next conversation.
  conv.flow = "idle";
  conv.step = null;
  conv.context = {};

  if (res && res.deposit_cents > 0) {
    const amount = formatMoney(res.deposit_cents, "es-MX", BRUMA.currency);
    return [
      {
        text: `He apartado tu mesa en *${room}* a las ${when} para ${party} personas. 🎶\n\nEste horario es premium (DJ en vivo): se requiere un anticipo de *${amount}*, redimible esa misma noche. Te enviaremos el enlace de pago en breve para asegurar la mesa.`,
      },
    ];
  }

  return [
    {
      text: `¡Listo! Reserva confirmada en *${room}* a las ${when} para ${party} personas. ✨\nTe enviaremos un recordatorio por WhatsApp. ¡Te esperamos en BRUMA!`,
    },
  ];
}

function renderOptions(options: Slot[], locale: string): string {
  const lines = options.map((o, i) => {
    const when = formatSlotTime(o.slot_start, BRUMA.timezone, locale);
    const deposit =
      o.deposit_cents > 0
        ? ` — anticipo ${formatMoney(o.deposit_cents, "es-MX", BRUMA.currency)}`
        : "";
    return `${i + 1}. ${when} · ${o.room_name}${deposit}`;
  });
  return `Estas son las opciones disponibles:\n\n${lines.join("\n")}\n\nResponde con el número que prefieras.`;
}
