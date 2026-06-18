import Anthropic from "@anthropic-ai/sdk";

/**
 * Intent router. A single Claude Haiku call classifies the message and extracts
 * entities (date, party size, menu choice) under a JSON-schema structured output,
 * so the response is always valid JSON. The deterministic state machine in
 * engine.ts drives the flow and actions; the LLM only understands language.
 *
 * Adding a capability = add an intent to the enum + a handler in the engine.
 */

const INTENTS = [
  "reservar",
  "horarios",
  "ubicacion",
  "menu",
  "faq",
  "hablar_con_humano",
  "saludo",
  "otro",
] as const;

export type IntentResult = {
  intent: (typeof INTENTS)[number];
  date: string | null;
  party_size: number | null;
  choice: number | null;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: INTENTS as unknown as string[] },
    date: { type: ["string", "null"] },
    party_size: { type: ["integer", "null"] },
    choice: { type: ["integer", "null"] },
  },
  required: ["intent", "date", "party_size", "choice"],
};

const FALLBACK: IntentResult = {
  intent: "otro",
  date: null,
  party_size: null,
  choice: null,
};

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // Reads ANTHROPIC_API_KEY from the environment.
  if (!client) client = new Anthropic();
  return client;
}

export async function classifyMessage(opts: {
  text: string;
  today: string;
  step: string;
  venueName: string;
}): Promise<IntentResult> {
  const system = `Eres el asistente de reservas por mensajería de ${opts.venueName}, un bar de vinilo en Mazatlán.
Hoy es ${opts.today} (zona horaria America/Mazatlan). El cliente está en el paso "${opts.step}" de la conversación.
Clasifica el mensaje del cliente y extrae entidades.

Intenciones:
- reservar: quiere una mesa / reservar / lugar / disponibilidad.
- horarios: pregunta por horarios o días de apertura.
- ubicacion: pregunta dónde están / cómo llegar.
- menu: pregunta por la carta, comida, bebidas o cocteles.
- faq: pregunta general sobre el lugar.
- hablar_con_humano: pide hablar con una persona, agente o staff.
- saludo: saludo o inicio de conversación sin intención clara.
- otro: cualquier otra cosa.

Entidades:
- date: si menciona una fecha (incluyendo "hoy", "mañana", "el viernes"), resuélvela a YYYY-MM-DD respecto a hoy; si no, null.
- party_size: número de personas, o null.
- choice: si el cliente elige una opción de una lista numerada, el número (base 1); si no, null.`;

  try {
    const res = await getClient().messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: opts.text }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
    });

    const block = res.content.find((b) => b.type === "text");
    const text = block && block.type === "text" ? block.text : "";
    const parsed = JSON.parse(text) as IntentResult;
    return parsed.intent ? parsed : FALLBACK;
  } catch {
    return FALLBACK;
  }
}
