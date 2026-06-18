"use client";

import { useState } from "react";
import {
  getAvailability,
  createHold,
  type AvailabilitySlot,
} from "@/lib/booking/api";
import { formatMoney } from "@/lib/booking/rules";
import { formatSlotTime } from "@/lib/booking/datetime";

/**
 * Manual reservation creation for staff. Reuses the same secure RPCs as the
 * customer flow (availability + hold), so capacity fit, premium deposit, and the
 * double-booking guard all apply identically. Premium-deposit bookings come back
 * as "held"; staff can take the deposit in person and tap Confirmar on the board.
 */
export default function AddReservation({
  venueSlug,
  date,
  currency,
  timezone,
  onClose,
  onCreated,
}: {
  venueSlug: string;
  date: string;
  currency: string;
  timezone: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [party, setParty] = useState(2);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null);
  const [selected, setSelected] = useState<AvailabilitySlot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setLoading(true);
    setError(null);
    setSelected(null);
    const { data, error } = await getAvailability({ slug: venueSlug, date, party });
    setLoading(false);
    if (error) return setError(error.message);
    setSlots(data ?? []);
  }

  async function create() {
    if (!selected || !name.trim() || !phone.trim()) return;
    setLoading(true);
    setError(null);
    const { error } = await createHold({
      slug: venueSlug,
      roomId: selected.room_id,
      slotStart: selected.slot_start,
      party,
      name: name.trim(),
      phone: phone.trim(),
    });
    setLoading(false);
    if (error) {
      setError(
        error.message.includes("slot_taken")
          ? "Esa mesa se acaba de ocupar."
          : error.message,
      );
      return;
    }
    onCreated();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/60">
      <div className="max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-bg p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl text-text">Nueva reserva</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted"
            aria-label="Cerrar"
          >
            Cerrar
          </button>
        </div>

        {/* Party */}
        <div className="mb-3 flex items-center justify-between rounded-token border border-border bg-surface px-4 py-3">
          <span className="text-sm text-muted">Personas</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setParty((p) => Math.max(1, p - 1))}
              className="h-8 w-8 rounded-full bg-elevated text-xl text-text"
            >
              −
            </button>
            <span className="font-display text-2xl text-text">{party}</span>
            <button
              type="button"
              onClick={() => setParty((p) => Math.min(20, p + 1))}
              className="h-8 w-8 rounded-full bg-elevated text-xl text-text"
            >
              +
            </button>
          </div>
        </div>

        <input
          placeholder="Nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-2 w-full rounded-token border border-border bg-surface px-4 py-3 text-text"
        />
        <input
          placeholder="Teléfono (WhatsApp)"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="mb-3 w-full rounded-token border border-border bg-surface px-4 py-3 text-text"
        />

        <button
          type="button"
          onClick={search}
          disabled={loading}
          className="mb-3 w-full rounded-token border border-border bg-elevated px-4 py-3 text-sm text-text disabled:opacity-50"
        >
          {loading && !slots ? "Buscando…" : "Buscar disponibilidad"}
        </button>

        {slots && slots.length === 0 && (
          <p className="text-sm text-muted">Sin disponibilidad para ese grupo.</p>
        )}

        {slots && slots.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-2">
            {slots.map((s) => {
              const active =
                selected?.room_id === s.room_id &&
                selected?.slot_start === s.slot_start;
              return (
                <button
                  key={`${s.room_id}-${s.slot_start}`}
                  type="button"
                  onClick={() => setSelected(s)}
                  className={`rounded-token border px-3 py-2 text-left text-sm ${
                    active
                      ? "border-accent bg-accent/10 text-text"
                      : "border-border bg-surface text-text"
                  }`}
                >
                  <span className="block">
                    {formatSlotTime(s.slot_start, timezone, "es-MX")} · {s.room_name}
                  </span>
                  {s.deposit_cents > 0 && (
                    <span className="text-xs text-accent">
                      {formatMoney(s.deposit_cents, "es-MX", currency)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {error && <p className="mb-3 text-sm text-danger">{error}</p>}

        <button
          type="button"
          onClick={create}
          disabled={loading || !selected || !name.trim() || !phone.trim()}
          className="w-full rounded-token bg-accent px-6 py-4 font-medium text-accent-fg transition active:scale-[0.99] disabled:opacity-50"
        >
          Crear reserva
        </button>
      </div>
    </div>
  );
}
