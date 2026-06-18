/** Date/time helpers for the booking UI, all timezone-aware per venue. */

/** Today's date as YYYY-MM-DD in the venue's timezone. */
export function todayInTz(timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // en-CA → YYYY-MM-DD
}

/** Format an ISO timestamptz as a local time label, e.g. "10:00 p.m." */
export function formatSlotTime(iso: string, timezone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** Format a YYYY-MM-DD date as a readable label, e.g. "vie 20 jun". */
export function formatDateLabel(ymd: string, locale: string): string {
  // Parse as a local calendar date (no timezone shift).
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}
