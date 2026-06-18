import { notFound } from "next/navigation";
import { defaultLocale, getDictionary } from "@/i18n";

/**
 * Venue booking entry, themed via [data-venue]. Phase 0 renders the branded
 * shell + hero; the multi-step booking flow (date → party → rooms → pay) lands
 * in Phase 1.
 */

// Phase 0 venue registry stub. Replaced by a Supabase lookup in Phase 1.
const KNOWN_VENUES: Record<string, { name: string; tagline: string }> = {
  bruma: {
    name: "BRUMA",
    tagline: "Bar de vinilo · Cocteles de autor · Mazatlán",
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
      <div className="container-app flex min-h-dvh flex-col justify-between py-12">
        <header className="pt-8">
          <p className="text-sm uppercase tracking-[0.3em] text-muted">
            {meta.tagline}
          </p>
          <h1 className="mt-4 font-display text-6xl font-light leading-none text-text">
            {meta.name}
          </h1>
        </header>

        <section className="space-y-6">
          <h2 className="font-display text-2xl text-text">{t.booking.title}</h2>
          <p className="text-muted">{t.booking.chooseDate}</p>
          <button
            type="button"
            className="w-full rounded-token bg-accent px-6 py-4 text-base font-medium text-accent-fg transition active:scale-[0.99]"
          >
            {t.common.book}
          </button>
          <p className="text-center text-xs text-muted">
            {t.confirmation.reminder}
          </p>
        </section>

        <footer className="pb-2 text-center text-xs text-muted">
          Jue–Sáb 18:00–02:00 · Dom/Mar/Mié 18:00–00:00 · Lun cerrado
        </footer>
      </div>
    </main>
  );
}

export function generateStaticParams() {
  return Object.keys(KNOWN_VENUES).map((venue) => ({ venue }));
}
