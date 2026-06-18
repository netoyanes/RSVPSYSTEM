/**
 * Venue config + knowledge base for the bot. For BRUMA today this is a static
 * record; in Phase 3 it's loaded per-venue from Supabase so each venue answers
 * with its own hours, location, menu and FAQ — no code change.
 */
export const BRUMA = {
  slug: "bruma",
  id: "00000000-0000-0000-0000-0000000000b1",
  name: "BRUMA",
  timezone: "America/Mazatlan",
  currency: "MXN",
};

/** Stateless informational answers, keyed by intent. */
export const INFO: Record<string, string> = {
  horarios:
    "🕕 Horarios BRUMA:\n• Dom, Mar y Mié: 6:00 pm – 12:00 am\n• Jue, Vie y Sáb: 6:00 pm – 2:00 am\n• Lunes: cerrado",
  ubicacion:
    "📍 Estamos en Mazatlán, Sinaloa. Te compartimos la ubicación exacta al confirmar tu reserva. ¿Quieres reservar?",
  menu:
    "🎶 BRUMA es un bar de vinilo: cocteles de autor y street-food de altura. Carta completa en el lugar. ¿Te ayudo a reservar una mesa?",
  faq:
    "Con gusto te ayudo. Puedo: reservar una mesa, darte horarios y ubicación, o conectarte con una persona del equipo. ¿Qué necesitas?",
};
