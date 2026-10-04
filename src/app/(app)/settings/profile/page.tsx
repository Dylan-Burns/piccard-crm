import type { Metadata } from "next";
import { MailboxCard } from "@/features/email/components/mailbox-card";
import { emailProviderReady } from "@/features/email/providers";
import { getMyMailbox } from "@/features/email/queries";
import { PasswordForm, ProfileForm } from "@/features/settings/components/profile-forms";
import { requireRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { getTimeZone } from "@/lib/settings";

export const metadata: Metadata = { title: "Profile" };

const EMAIL_NOTICE: Record<string, { tone: "ok" | "bad"; text: string }> = {
  linked: { tone: "ok", text: "Your mailbox is linked. Recent customer email is being copied onto deals now." },
  cancelled: { tone: "bad", text: "Sign-in was cancelled. Nothing changed." },
  error: { tone: "bad", text: "The mailbox could not be linked. Try again." },
  no_refresh_token: { tone: "bad", text: "The provider did not grant ongoing access. Remove this app from your account's connected apps, then link again." },
  not_configured: { tone: "bad", text: "That provider has not been set up for this company yet." },
};

export default async function ProfilePage({ searchParams }: PageProps<"/settings/profile">) {
  const profile = await requireRole();
  const params = await searchParams;
  const staff = profile.role !== "field";
  // Field users cannot link a mailbox: customer email can contain prices.
  const [mailbox, timeZone] = staff ? await Promise.all([getMyMailbox(profile.id), getTimeZone()]) : [null, ""];

  return (
    <div className="max-w-lg space-y-10">
      <section className="space-y-4">
        <h2 className="text-base font-semibold">Profile</h2>
        <ProfileForm fullName={profile.full_name} phone={profile.phone ?? ""} email={profile.email} />
      </section>
      {staff ? (
        <MailboxCard
          mailbox={mailbox ? { provider: mailbox.provider, email: String(mailbox.email_address), status: mailbox.status, lastSynced: mailbox.last_synced_at ? formatDateTime(mailbox.last_synced_at, timeZone) : null, lastError: mailbox.last_error } : null}
          ready={{ google: emailProviderReady("google"), microsoft: emailProviderReady("microsoft") }}
          notice={typeof params.email === "string" ? (EMAIL_NOTICE[params.email] ?? null) : null}
        />
      ) : null}
      <section className="space-y-4">
        <h2 className="text-base font-semibold">Change password</h2>
        <PasswordForm />
      </section>
    </div>
  );
}
