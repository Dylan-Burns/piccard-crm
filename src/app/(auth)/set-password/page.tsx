import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SetPasswordForm } from "@/features/auth/components/set-password-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set password" };

export default async function SetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login?error=link");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Set your password</h1>
        <p className="text-muted-foreground">{data.claims.email ?? "Choose a password to finish signing in."}</p>
      </div>
      <SetPasswordForm />
    </div>
  );
}
