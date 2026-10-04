import { NextResponse } from "next/server";
import { BUCKET } from "@/features/files/categories";
import { isToken, PUBLIC_HEADERS } from "@/features/estimates/public";
import { createAdminClient } from "@/lib/supabase/admin";

/** The stored PDF snapshot for a token, as a redirect to a 5-minute signed link. */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const notFound = NextResponse.json({ error: "Not found" }, { status: 404, headers: PUBLIC_HEADERS });
  if (!isToken(token)) return notFound;
  const db = createAdminClient();
  const { data: estimate } = await db.from("estimates").select("status, pdf_path").eq("public_token", token).maybeSingle();
  if (!estimate?.pdf_path || !["sent", "viewed", "accepted", "declined"].includes(estimate.status)) return notFound;
  const { data } = await db.storage.from(BUCKET).createSignedUrl(estimate.pdf_path, 300);
  if (!data?.signedUrl) return notFound;
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: PUBLIC_HEADERS });
}
