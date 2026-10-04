"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyLink } from "@/components/shared/copy-link";
import { NativeSelect } from "@/components/shared/native-select";
import { useActionToast } from "@/components/shared/use-action-toast";
import { createResetLink, setUserActive, updateUserRole } from "@/features/settings/actions";
import { ROLE_DESCRIPTIONS } from "@/features/settings/components/role-labels";
import type { Database } from "@/types/database";

type UserRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "email" | "phone" | "role" | "is_active"
>;

export function UsersTable({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  return (
    <ul className="divide-y rounded-md border bg-card">
      {users.map((user) => (
        <UserRowItem key={user.id} user={user} isSelf={user.id === currentUserId} />
      ))}
    </ul>
  );
}

function UserRowItem({ user, isSelf }: { user: UserRow; isSelf: boolean }) {
  const [roleState, roleAction, rolePending] = useActionState(updateUserRole, null);
  const [activeState, activeAction, activePending] = useActionState(setUserActive, null);
  useActionToast(roleState, "Role updated");
  useActionToast(activeState, user.is_active ? "User reactivated" : "User deactivated");
  const [resetState, resetAction, resetPending] = useActionState(createResetLink, null);
  useActionToast(resetState, "Reset link created");
  const resetLink = resetState?.ok ? resetState.data.link : null;

  return (
    <li className="space-y-3 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-medium">
          <span className="truncate">{user.full_name}</span>
          {isSelf ? <Badge variant="secondary">You</Badge> : null}
          {user.is_active ? null : <Badge variant="outline">Deactivated</Badge>}
        </p>
        <p className="truncate text-muted-foreground">{user.email}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form action={resetAction}>
          <input type="hidden" name="user_id" value={user.id} />
          <Button type="submit" variant="ghost" className="h-11 md:h-9" disabled={resetPending || !user.is_active}>
            Reset link
          </Button>
        </form>
        <form action={roleAction}>
          <input type="hidden" name="user_id" value={user.id} />
          <NativeSelect
            name="role"
            aria-label={`Role for ${user.full_name}`}
            defaultValue={user.role}
            disabled={isSelf || rolePending || !user.is_active}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="w-28"
          >
            {Object.entries(ROLE_DESCRIPTIONS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </form>
        <form action={activeAction}>
          <input type="hidden" name="user_id" value={user.id} />
          <input type="hidden" name="is_active" value={user.is_active ? "false" : "true"} />
          <Button type="submit" variant="outline" className="h-11 w-28 md:h-9" disabled={isSelf || activePending}>
            {user.is_active ? "Deactivate" : "Reactivate"}
          </Button>
        </form>
      </div>
      </div>
      {resetLink ? (
        <div className="space-y-1.5">
          <p className="text-muted-foreground">One-time password reset link for {user.full_name}. Expires in 24 hours.</p>
          <CopyLink link={resetLink} label={`Reset link for ${user.full_name}`} />
        </div>
      ) : null}
    </li>
  );
}
