import { notFound } from "next/navigation";
import { defaultLocale, getDictionary } from "@/i18n";
import BookingFlow from "@/components/booking/BookingFlow";

/**
 * Venue booking page, themed via [data-venue]. Renders the branded header and
 * the mobile-first booking flow (date → party → rooms → details → confirm).
 */

// Phase 1 venue registry stub. Replaced by a Supabase lookup once multiple
// venues exist; rooms/hours/rules already live in the database.
const KNOWN_VENUES: Record<
  string,
  { name: string; tagline: string; timezone: string; currency: string }
> = {
  bruma: {
    name: "BRUMA",
    tagline: "Bar de vinilo · Cocteles de autor · Mazatlán",
    timezone: "America/Mazatlan",
    currency: "MXN",
  },
};

export default async function VenuePage({
  params,
}: {
  params: Promise<{ venue: string }>;
}) {
  const { venue } = await params;
  const meta = KNOWN_VENUES[venue];
  if (!meta) notFound();

  const t = getDictionary(defaultLocale);

  return (
    <main data-venue={venue} className="min-h-dvh bg-bg text-text">
      <header className="container-app pt-12">
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          {meta.tagline}
        </p>
        <h1 className="mt-3 font-display text-5xl font-light leading-none text-text">
          {meta.name}
        </h1>
      </header>

      <BookingFlow
        slug={venue}
        currency={meta.currency}
        timezone={meta.timezone}
        locale={defaultLocale}
        t={t}
      />
    </main>
  );
}

export function generateStaticParams() {
  return Object.keys(KNOWN_VENUES).map((venue) => ({ venue }));
}
