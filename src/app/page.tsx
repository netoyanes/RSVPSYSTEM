import { redirect } from "next/navigation";

/**
 * Root entry. The first venue is BRUMA; route to its themed booking page.
 * Multi-venue routing lives under /[venue].
 */
export default function Home() {
  redirect("/bruma");
}
