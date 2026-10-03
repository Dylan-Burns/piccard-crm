import type { Metadata } from "next";
import { LoginForm } from "@/features/auth/components/login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  link: "That link is invalid or has expired. Request a new one below.",
  deactivated: "This account has been deactivated. Contact an admin.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const errorKey = typeof params.error === "string" ? params.error : undefined;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="text-muted-foreground">Use the email address your admin invited.</p>
      </div>
      {errorKey && ERRORS[errorKey] ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
          {ERRORS[errorKey]}
        </p>
      ) : null}
      <LoginForm next={next} />
    </div>
  );
}
