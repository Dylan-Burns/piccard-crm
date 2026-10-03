import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

async function signOut(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const reason = request.nextUrl.searchParams.get("reason");
  const url = new URL("/login", request.url);
  if (reason === "deactivated") url.searchParams.set("error", "deactivated");
  return NextResponse.redirect(url, { status: 303 });
}

// POST from the user menu; GET from requireRole() when a deactivated user is detected.
export const POST = signOut;
export const GET = signOut;
