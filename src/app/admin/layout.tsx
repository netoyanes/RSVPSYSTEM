import { createClient } from "@/lib/supabase/server";
import SignOutButton from "@/components/admin/SignOutButton";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Unauthenticated requests only reach the login page (middleware enforces it);
  // render it bare, without the panel chrome.
  if (!user) {
    return <div className="min-h-dvh bg-bg text-text">{children}</div>;
  }

  return (
    <div className="min-h-dvh bg-bg text-text">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/90 backdrop-blur">
        <div className="container-app flex items-center justify-between py-3">
          <span className="text-sm font-medium tracking-wide text-text">
            BRUMA · Panel
          </span>
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
