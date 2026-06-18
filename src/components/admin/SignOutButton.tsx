"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/admin/login");
    router.refresh();
  }
  return (
    <button
      type="button"
      onClick={signOut}
      className="text-xs text-muted underline-offset-2 hover:underline"
    >
      Salir
    </button>
  );
}
