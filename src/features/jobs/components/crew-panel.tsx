"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/shared/native-select";
import { assignUsers, unassignUser } from "@/features/jobs/actions";
import type { StaffOption } from "@/lib/settings";

/** Staff add or remove crew members. Work days are set from Schedule job. */
export function CrewEditor({ jobId, crew, users }: { jobId: string; crew: StaffOption[]; users: StaffOption[] }) {
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState("");
  const available = users.filter((u) => !crew.some((c) => c.id === u.id));

  const run = (work: () => ReturnType<typeof assignUsers>, done: string) =>
    startTransition(async () => {
      const result = await work();
      if (result.ok) toast.success(done);
      else toast.error(result.error.message);
    });

  return (
    <div className="space-y-2">
      {crew.length === 0 ? (
        <p className="text-muted-foreground">No one is assigned yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {crew.map((member) => (
            <li key={member.id} className="flex min-h-11 items-center justify-between gap-2 px-3">
              <span className="truncate">{member.name}</span>
              <Button variant="ghost" size="icon" aria-label={`Remove ${member.name}`} className="size-11 shrink-0 md:size-8" disabled={pending} onClick={() => run(() => unassignUser({ jobId, userId: member.id }), `${member.name} removed`)}>
                <X className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {available.length > 0 ? (
        <div className="flex gap-2">
          <NativeSelect aria-label="Add to crew" value={adding} onChange={(event) => setAdding(event.target.value)}>
            <option value="">Add someone…</option>
            {available.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            className="h-11 shrink-0 md:h-9"
            disabled={pending || !adding}
            onClick={() => {
              const id = adding;
              setAdding("");
              run(() => assignUsers({ jobId, userIds: [id] }), "Crew updated");
            }}
          >
            Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}
