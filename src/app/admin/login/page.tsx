"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh items-center bg-bg text-text">
      <div className="container-app flex flex-col gap-6">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-muted">Panel</p>
          <h1 className="mt-2 font-display text-4xl text-text">Acceso staff</h1>
        </div>

        <div className="flex flex-col gap-4">
          <label className="block">
            <span className="text-sm text-muted">Email</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full rounded-token border border-border bg-surface px-4 py-3 text-text"
            />
          </label>
          <label className="block">
            <span className="text-sm text-muted">Contraseña</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && signIn()}
              className="mt-1.5 w-full rounded-token border border-border bg-surface px-4 py-3 text-text"
            />
          </label>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="button"
            onClick={signIn}
            disabled={loading || !email || !password}
            className="w-full rounded-token bg-accent px-6 py-4 font-medium text-accent-fg transition active:scale-[0.99] disabled:opacity-50"
          >
            {loading ? "…" : "Entrar"}
          </button>
        </div>
      </div>
    </main>
  );
}
