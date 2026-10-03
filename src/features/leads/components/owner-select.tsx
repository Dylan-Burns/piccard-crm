"use client";

import { useActionState } from "react";
import { NativeSelect } from "@/components/shared/native-select";
import { useActionToast } from "@/components/shared/use-action-toast";
import { assignOwner } from "@/features/leads/actions";
import type { StaffOption } from "@/lib/settings";

/** Owner picker that saves on change (through the assign_owner RPC). */
export function OwnerSelect({
  opportunityId,
  customerId,
  ownerId,
  staff,
  className,
}: {
  opportunityId: string;
  customerId: string;
  ownerId: string | null;
  staff: StaffOption[];
  className?: string;
}) {
  const [state, action, pending] = useActionState(assignOwner, null);
  useActionToast(state, "Owner updated");

  return (
    <form action={action} className={className}>
      <input type="hidden" name="opportunity_id" value={opportunityId} />
      <input type="hidden" name="customer_id" value={customerId} />
      <NativeSelect
        name="owner_id"
        aria-label="Owner"
        defaultValue={ownerId ?? ""}
        disabled={pending}
        onChange={(e) => e.currentTarget.value && e.currentTarget.form?.requestSubmit()}
      >
        {ownerId ? null : <option value="">Unassigned</option>}
        {staff.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </NativeSelect>
    </form>
  );
}
