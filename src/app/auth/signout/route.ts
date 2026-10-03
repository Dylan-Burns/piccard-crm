import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Ends the session of a user whose profile is deactivated or missing (requireRole redirects here).
 * It deliberately does nothing for an active user: sign-out over GET would let any site log a
 * user out with a link or image. Normal sign-out is the `signOutAction` server action (POST).
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return NextResponse.redirect(new URL("/login", request.url));

  const { data: profile } = await supabase.from("profiles").select("is_active").eq("id", userId).maybeSingle();
  if (profile?.is_active) return NextResponse.redirect(new URL("/", request.url));

  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login?error=deactivated", request.url));
}
