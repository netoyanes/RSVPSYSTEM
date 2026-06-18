"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/booking/rules";
import {
  createHold,
  getAvailability,
  type AvailabilitySlot,
  type HoldResult,
} from "@/lib/booking/api";
import {
  formatDateLabel,
  formatSlotTime,
  todayInTz,
} from "@/lib/booking/datetime";
import { interpolate } from "@/i18n";

type Slot = AvailabilitySlot;
type Selection = Slot;

// Minimal shape of the i18n dictionary fields this component uses.
type Dict = {
  common: { book: string; next: string; back: string; guests: string; date: string };
  booking: {
    title: string;
    chooseDate: string;
    chooseParty: string;
    availableRooms: string;
    noAvailability: string;
    premiumNotice: string;
    depositRedeemable: string;
  };
  confirmation: { title: string; reminder: string };
};

type Step = "party" | "slots" | "details" | "done";

export default function BookingFlow({
  slug,
  currency,
  timezone,
  locale,
  t,
}: {
  slug: string;
  currency: string;
  timezone: string;
  locale: string;
  t: Dict;
}) {
  const moneyLocale = locale === "en" ? "en-US" : "es-MX";

  const [step, setStep] = useState<Step>("party");
  const [date, setDate] = useState<string>(() => todayInTz(timezone));
  const [party, setParty] = useState<number>(2);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", occasion: "" });
  const [result, setResult] = useState<HoldResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const money = (cents: number) => formatMoney(cents, moneyLocale, currency);

  // Group available slots by start time, sorted, for the slot picker.
  const slotsByTime = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const s of slots) {
      const arr = map.get(s.slot_start) ?? [];
      arr.push(s);
      map.set(s.slot_start, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [slots]);

  async function loadAvailability() {
    setLoading(true);
    setError(null);
    const { data, error } = await getAvailability({ slug, date, party });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSlots(data ?? []);
    setStep("slots");
  }

  async function submitHold() {
    if (!selection || !form.name.trim() || !form.phone.trim()) return;
    setLoading(true);
    setError(null);
    const { data, error } = await createHold({
      slug,
      roomId: selection.room_id,
      slotStart: selection.slot_start,
      party,
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      occasion: form.occasion.trim() || null,
    });
    setLoading(false);
    if (error) {
      setError(
        error.message.includes("slot_taken")
          ? locale === "en"
            ? "That table was just taken. Please pick another."
            : "Esa mesa se acaba de ocupar. Elige otra opción."
          : error.message,
      );
      return;
    }
    setResult(data?.[0] ?? null);
    setStep("done");
  }

  return (
    <div className="container-app flex min-h-dvh flex-col py-10">
      <Stepper step={step} />

      {/* STEP 1 — date + party */}
      {step === "party" && (
        <section className="mt-8 flex flex-1 flex-col gap-8">
          <h2 className="font-display text-3xl text-text">{t.booking.title}</h2>

          <label className="block">
            <span className="text-sm text-muted">{t.booking.chooseDate}</span>
            <input
              type="date"
              value={date}
              min={todayInTz(timezone)}
              onChange={(e) => setDate(e.target.value)}
              className="mt-2 w-full rounded-token border border-border bg-surface px-4 py-3 text-text"
            />
          </label>

          <div>
            <span className="text-sm text-muted">{t.booking.chooseParty}</span>
            <div className="mt-2 flex items-center justify-between rounded-token border border-border bg-surface px-4 py-3">
              <button
                type="button"
                aria-label="−"
                onClick={() => setParty((p) => Math.max(1, p - 1))}
                className="h-10 w-10 rounded-full bg-elevated text-2xl text-text active:scale-95"
              >
                −
              </button>
              <span className="font-display text-3xl text-text">{party}</span>
              <button
                type="button"
                aria-label="+"
                onClick={() => setParty((p) => Math.min(20, p + 1))}
                className="h-10 w-10 rounded-full bg-elevated text-2xl text-text active:scale-95"
              >
                +
              </button>
            </div>
            <p className="mt-1 text-xs text-muted">{t.common.guests}</p>
          </div>

          <div className="mt-auto">
            <PrimaryButton onClick={loadAvailability} loading={loading}>
              {t.common.next}
            </PrimaryButton>
          </div>
        </section>
      )}

      {/* STEP 2 — slot + room */}
      {step === "slots" && (
        <section className="mt-8 flex flex-1 flex-col gap-5">
          <BackButton onClick={() => setStep("party")} />
          <h2 className="font-display text-2xl text-text">
            {t.booking.availableRooms}
          </h2>
          <p className="text-sm text-muted">
            {formatDateLabel(date, locale)} · {party} {t.common.guests}
          </p>

          {slotsByTime.length === 0 && (
            <p className="rounded-token border border-border bg-surface p-4 text-muted">
              {t.booking.noAvailability}
            </p>
          )}

          <div className="flex flex-col gap-6">
            {slotsByTime.map(([time, rooms]) => {
              const deposit = rooms[0].deposit_cents;
              return (
                <div key={time}>
                  <div className="mb-2 flex items-center gap-3">
                    <span className="font-display text-xl text-text">
                      {formatSlotTime(time, timezone, locale)}
                    </span>
                    {deposit > 0 && (
                      <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent">
                        Premium
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {rooms.map((r) => (
                      <button
                        key={r.room_id}
                        type="button"
                        onClick={() => {
                          setSelection(r);
                          setStep("details");
                        }}
                        className="rounded-token border border-border bg-surface px-4 py-3 text-left text-text transition active:scale-[0.98]"
                      >
                        <span className="block text-sm">{r.room_name}</span>
                        {r.deposit_cents > 0 && (
                          <span className="mt-1 block text-xs text-accent">
                            {money(r.deposit_cents)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* STEP 3 — customer details */}
      {step === "details" && selection && (
        <section className="mt-8 flex flex-1 flex-col gap-4">
          <BackButton onClick={() => setStep("slots")} />
          <h2 className="font-display text-2xl text-text">
            {selection.room_name} ·{" "}
            {formatSlotTime(selection.slot_start, timezone, locale)}
          </h2>

          {selection.deposit_cents > 0 && (
            <div className="rounded-token border border-accent/30 bg-accent/10 p-4">
              <p className="text-sm text-text">
                {interpolate(t.booking.premiumNotice, {
                  amount: money(selection.deposit_cents / party),
                })}
              </p>
              <p className="mt-2 text-sm font-medium text-accent">
                {money(selection.deposit_cents)}
              </p>
              <p className="mt-1 text-xs text-muted">
                {t.booking.depositRedeemable}
              </p>
            </div>
          )}

          <Field
            label={locale === "en" ? "Full name" : "Nombre completo"}
            value={form.name}
            onChange={(v) => setForm((f) => ({ ...f, name: v }))}
            required
          />
          <Field
            label={locale === "en" ? "Phone (WhatsApp)" : "Teléfono (WhatsApp)"}
            value={form.phone}
            onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
            inputMode="tel"
            required
          />
          <Field
            label="Email"
            value={form.email}
            onChange={(v) => setForm((f) => ({ ...f, email: v }))}
            inputMode="email"
          />
          <Field
            label={locale === "en" ? "Special occasion (optional)" : "Ocasión especial (opcional)"}
            value={form.occasion}
            onChange={(v) => setForm((f) => ({ ...f, occasion: v }))}
          />

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="mt-auto pt-4">
            <PrimaryButton
              onClick={submitHold}
              loading={loading}
              disabled={!form.name.trim() || !form.phone.trim()}
            >
              {selection.deposit_cents > 0
                ? locale === "en"
                  ? "Hold table"
                  : "Apartar mesa"
                : t.common.book}
            </PrimaryButton>
          </div>
        </section>
      )}

      {/* STEP 4 — confirmation */}
      {step === "done" && result && (
        <section className="mt-8 flex flex-1 flex-col items-center justify-center gap-4 text-center">
          {result.deposit_cents > 0 ? (
            <>
              <h2 className="font-display text-3xl text-text">
                {locale === "en" ? "Table held" : "Mesa apartada"}
              </h2>
              <p className="text-muted">
                {locale === "en"
                  ? "Pay the deposit to secure your table."
                  : "Paga el depósito para asegurar tu mesa."}
              </p>
              <p className="font-display text-2xl text-accent">
                {money(result.deposit_cents)}
              </p>
              <div className="mt-2 rounded-token border border-border bg-surface p-4 text-sm text-muted">
                {locale === "en"
                  ? "Online deposit payment (Stripe) is wired in the next step."
                  : "El pago en línea del depósito (Stripe) se integra en el siguiente paso."}
              </div>
            </>
          ) : (
            <>
              <h2 className="font-display text-3xl text-text">
                {t.confirmation.title}
              </h2>
              <p className="text-muted">{t.confirmation.reminder}</p>
            </>
          )}
        </section>
      )}
    </div>
  );
}

/* ----------------------------- small UI bits ----------------------------- */

function Stepper({ step }: { step: Step }) {
  const order: Step[] = ["party", "slots", "details", "done"];
  const idx = order.indexOf(step);
  return (
    <div className="flex gap-1.5">
      {order.map((s, i) => (
        <span
          key={s}
          className={`h-1 flex-1 rounded-full ${i <= idx ? "bg-accent" : "bg-border"}`}
        />
      ))}
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  loading,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      className="w-full rounded-token bg-accent px-6 py-4 text-base font-medium text-accent-fg transition active:scale-[0.99] disabled:opacity-50"
    >
      {loading ? "…" : children}
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start text-sm text-muted active:scale-95"
    >
      ← {""}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  inputMode?: "tel" | "email" | "text";
}) {
  return (
    <label className="block">
      <span className="text-sm text-muted">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-token border border-border bg-surface px-4 py-3 text-text"
      />
    </label>
  );
}
