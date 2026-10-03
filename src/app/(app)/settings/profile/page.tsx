import type { Metadata } from "next";
import { PasswordForm, ProfileForm } from "@/features/settings/components/profile-forms";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const profile = await requireRole();
  return (
    <div className="max-w-lg space-y-10">
      <section className="space-y-4">
        <h2 className="text-base font-semibold">Profile</h2>
        <ProfileForm fullName={profile.full_name} phone={profile.phone ?? ""} email={profile.email} />
      </section>
      <section className="space-y-4">
        <h2 className="text-base font-semibold">Change password</h2>
        <PasswordForm />
      </section>
    </div>
  );
}
