"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  fetchDay,
  fetchRooms,
  setStatus,
  moveReservation,
  type AdminReservation,
  type Room,
} from "@/lib/admin/data";
import type { ReservationStatus, StaffRole } from "@/lib/types/db";
import { formatMoney } from "@/lib/booking/rules";
import {
  formatDateLabel,
  formatSlotTime,
  todayInTz,
} from "@/lib/booking/datetime";
import AddReservation from "@/components/admin/AddReservation";

const STATUS_META: Record<
  ReservationStatus,
  { label: string; cls: string }
> = {
  held: { label: "Apartada", cls: "bg-warning/15 text-warning" },
  pending_payment: { label: "Pago pendiente", cls: "bg-warning/15 text-warning" },
  confirmed: { label: "Confirmada", cls: "bg-accent/15 text-accent" },
  checked_in: { label: "En mesa", cls: "bg-success/15 text-success" },
  no_show: { label: "No-show", cls: "bg-danger/15 text-danger" },
  cancelled: { label: "Cancelada", cls: "bg-elevated text-muted" },
};

// Active statuses count toward "occupied"; the rest are historical.
const ACTIVE: ReservationStatus[] = [
  "held",
  "pending_payment",
  "confirmed",
  "checked_in",
];

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export default function FloorPanel({
  venueId,
  role,
  timezone,
  currency,
}: {
  venueId: string;
  role: StaffRole;
  timezone: string;
  currency: string;
}) {
  const [date, setDate] = useState(() => todayInTz(timezone));
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reservations, setReservations] = useState<AdminReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchDay(venueId, date);
      setReservations(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [venueId, date]);

  // Always call the freshest reload (which closes over the current date) from
  // the realtime callback without re-subscribing on every date change.
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  // Load rooms once.
  useEffect(() => {
    fetchRooms(venueId).then(setRooms).catch(() => {});
  }, [venueId]);

  // Load the day whenever venue/date changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchDay(venueId, date);
        if (!cancelled) setReservations(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venueId, date]);

  // Subscribe to realtime reservation changes for this venue.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`reservations-${venueId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "reservations",
          filter: `venue_id=eq.${venueId}`,
        },
        () => {
          void reloadRef.current();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [venueId]);

  const byRoom = useMemo(() => {
    const map = new Map<string, AdminReservation[]>();
    for (const r of reservations) {
      const arr = map.get(r.room_id) ?? [];
      arr.push(r);
      map.set(r.room_id, arr);
    }
    return map;
  }, [reservations]);

  const totals = useMemo(() => {
    const active = reservations.filter((r) => ACTIVE.includes(r.status));
    return {
      count: active.length,
      guests: active.reduce((n, r) => n + r.party_size, 0),
    };
  }, [reservations]);

  async function act(id: string, status: ReservationStatus) {
    setBusyId(id);
    try {
      await setStatus(id, status);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusyId(null);
    }
  }

  async function move(id: string, roomId: string) {
    setBusyId(id);
    try {
      await moveReservation(id, roomId);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="container-app pb-28 pt-4">
      {/* Date nav */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setDate((d) => addDays(d, -1))}
          className="h-10 w-10 rounded-full bg-surface text-text active:scale-95"
          aria-label="Día anterior"
        >
          ‹
        </button>
        <div className="text-center">
          <p className="font-display text-xl text-text">
            {formatDateLabel(date, "es-MX")}
          </p>
          <button
            type="button"
            onClick={() => setDate(todayInTz(timezone))}
            className="text-xs text-muted underline-offset-2 hover:underline"
          >
            Hoy
          </button>
        </div>
        <button
          type="button"
          onClick={() => setDate((d) => addDays(d, 1))}
          className="h-10 w-10 rounded-full bg-surface text-text active:scale-95"
          aria-label="Día siguiente"
        >
          ›
        </button>
      </div>

      {/* Summary */}
      <div className="mt-3 flex items-center gap-3 text-sm text-muted">
        <span>{totals.count} reservas activas</span>
        <span>·</span>
        <span>{totals.guests} personas</span>
        <span className="ml-auto rounded-full bg-elevated px-2 py-0.5 text-xs uppercase tracking-wide">
          {role}
        </span>
      </div>

      {error && (
        <p className="mt-3 rounded-token border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Rooms */}
      <div className="mt-4 flex flex-col gap-4">
        {rooms.map((room) => {
          const list = (byRoom.get(room.id) ?? []).filter((r) =>
            ACTIVE.includes(r.status),
          );
          const free = list.length === 0;
          return (
            <section
              key={room.id}
              className="rounded-token border border-border bg-surface p-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg text-text">{room.name}</h2>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs ${
                    free ? "bg-elevated text-muted" : "bg-accent/15 text-accent"
                  }`}
                >
                  {free
                    ? "Libre"
                    : `${list.length} ${list.length === 1 ? "reserva" : "reservas"}`}
                </span>
              </div>

              {list.map((r) => (
                <ReservationCard
                  key={r.id}
                  r={r}
                  rooms={rooms}
                  busy={busyId === r.id}
                  timezone={timezone}
                  currency={currency}
                  onAct={act}
                  onMove={move}
                />
              ))}
            </section>
          );
        })}
        {loading && rooms.length === 0 && (
          <p className="text-sm text-muted">Cargando…</p>
        )}
      </div>

      {/* Add reservation FAB */}
      <button
        type="button"
        onClick={() => setShowAdd(true)}
        className="fixed bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full bg-accent px-6 py-3.5 text-sm font-medium text-accent-fg shadow-lg active:scale-95"
      >
        + Nueva reserva
      </button>

      {showAdd && (
        <AddReservation
          venueSlug="bruma"
          date={date}
          currency={currency}
          timezone={timezone}
          onClose={() => setShowAdd(false)}
          onCreated={() => {
            setShowAdd(false);
            reload();
          }}
        />
      )}
    </main>
  );
}

function ReservationCard({
  r,
  rooms,
  busy,
  timezone,
  currency,
  onAct,
  onMove,
}: {
  r: AdminReservation;
  rooms: Room[];
  busy: boolean;
  timezone: string;
  currency: string;
  onAct: (id: string, status: ReservationStatus) => void;
  onMove: (id: string, roomId: string) => void;
}) {
  const meta = STATUS_META[r.status];
  return (
    <div className="mt-3 border-t border-border pt-3 first:mt-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-text">
            <span className="font-display text-lg">
              {formatSlotTime(r.slot_start, timezone, "es-MX")}
            </span>{" "}
            · {r.party_size}p
          </p>
          <p className="text-sm text-muted">{r.customer_name ?? "—"}</p>
          {r.customer_phone && (
            <a
              href={`https://wa.me/${r.customer_phone.replace(/\D/g, "")}`}
              className="text-xs text-accent"
            >
              {r.customer_phone}
            </a>
          )}
          {r.special_occasion && (
            <p className="text-xs text-muted">🎉 {r.special_occasion}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`rounded-full px-2.5 py-0.5 text-xs ${meta.cls}`}>
            {meta.label}
          </span>
          {r.deposit_cents > 0 && (
            <span className="text-xs text-accent">
              {formatMoney(r.deposit_cents, "es-MX", currency)}
            </span>
          )}
        </div>
      </div>

      {/* Lifecycle actions */}
      <div className="mt-3 flex flex-wrap gap-2">
        {r.status === "held" && (
          <ActionBtn busy={busy} onClick={() => onAct(r.id, "confirmed")}>
            Confirmar
          </ActionBtn>
        )}
        {r.status === "confirmed" && (
          <ActionBtn busy={busy} onClick={() => onAct(r.id, "checked_in")}>
            Check-in
          </ActionBtn>
        )}
        {(r.status === "confirmed" || r.status === "held") && (
          <ActionBtn busy={busy} variant="danger" onClick={() => onAct(r.id, "no_show")}>
            No-show
          </ActionBtn>
        )}
        {r.status !== "cancelled" && r.status !== "no_show" && (
          <ActionBtn busy={busy} variant="ghost" onClick={() => onAct(r.id, "cancelled")}>
            Cancelar
          </ActionBtn>
        )}
        <select
          aria-label="Mover de sala"
          disabled={busy}
          value={r.room_id}
          onChange={(e) => e.target.value !== r.room_id && onMove(r.id, e.target.value)}
          className="rounded-token border border-border bg-elevated px-2 py-1.5 text-xs text-text"
        >
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ActionBtn({
  children,
  onClick,
  busy,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy: boolean;
  variant?: "primary" | "danger" | "ghost";
}) {
  const styles = {
    primary: "bg-accent text-accent-fg",
    danger: "bg-danger/15 text-danger",
    ghost: "bg-elevated text-muted",
  }[variant];
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`rounded-token px-3 py-1.5 text-xs font-medium transition active:scale-95 disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}
