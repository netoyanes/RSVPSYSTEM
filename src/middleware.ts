import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

// Only run on the staff panel; the public booking site is untouched.
export const config = {
  matcher: ["/admin/:path*"],
};
