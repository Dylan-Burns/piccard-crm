import type { Metadata } from "next";
import { InviteUserDialog } from "@/features/settings/components/invite-user-dialog";
import { UsersTable } from "@/features/settings/components/users-table";
import { listProfiles } from "@/features/settings/queries";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requireRole("admin");
  const users = await listProfiles();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Users</h2>
          <p className="text-muted-foreground">Invite people and set what they can access.</p>
        </div>
        <InviteUserDialog />
      </div>
      <UsersTable users={users} currentUserId={me.id} />
    </div>
  );
}
