import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);
  // Customer-facing estimate pages and their endpoints are never cached or indexed (spec §7.4).
  // Set here as well as in next.config.ts, because the framework writes its own Cache-Control for pages.
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/e/") || pathname.startsWith("/api/public/")) {
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Robots-Tag", "noindex");
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except Next.js internals and static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
