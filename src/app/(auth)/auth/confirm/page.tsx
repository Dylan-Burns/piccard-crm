import type { Metadata } from "next";
import { ConfirmLinkForm } from "@/features/auth/components/confirm-link-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Continue" };

const TYPE_COPY: Record<string, { title: string; body: string }> = {
  invite: { title: "Accept your invitation", body: "Continue to set your password and finish creating your account." },
  recovery: { title: "Reset your password", body: "Continue to choose a new password." },
};

/**
 * Landing page for invite and reset links. Nothing is verified on GET: the visitor must press
 * Continue, which posts the token. That keeps email scanners from using up one-time links and
 * stops a crafted link from silently signing someone into another account.
 */
export default async function ConfirmPage({ searchParams }: PageProps<"/auth/confirm">) {
  const params = await searchParams;
  const pick = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  const type = pick("type");
  const copy = TYPE_COPY[type] ?? { title: "Continue to the CRM", body: "Continue to finish signing in." };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const currentEmail = typeof data?.claims?.email === "string" ? data.claims.email : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">{copy.title}</h1>
        <p className="text-muted-foreground">{copy.body}</p>
      </div>
      {currentEmail ? (
        <p className="rounded-md border border-warning/40 bg-warning/5 p-3">
          You are signed in as <span className="font-medium">{currentEmail}</span>. Continuing signs you out and signs in
          the account this link was created for. Only continue if you were expecting this link.
        </p>
      ) : null}
      <ConfirmLinkForm tokenHash={pick("token_hash")} type={type} code={pick("code")} next={pick("next")} />
    </div>
  );
}
