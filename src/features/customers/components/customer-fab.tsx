"use client";

import { useState } from "react";
import { CheckSquare, Phone, Plus, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AddTaskDialog } from "@/components/shared/add-task-dialog";
import { NoteComposer } from "@/components/shared/note-composer";
import { LogContactDialog } from "@/features/leads/components/log-contact-dialog";
import type { StaffOption } from "@/lib/settings";

/** Phone-only floating button: add a note, log a call, add a task (spec §5.4). */
export function CustomerFab({
  customerId,
  customerName,
  primaryDealId,
  users,
  currentUserId,
  defaultDue,
}: {
  customerId: string;
  customerName: string;
  primaryDealId: string | null;
  users: StaffOption[];
  currentUserId: string;
  defaultDue: string;
}) {
  const [open, setOpen] = useState(false);
  const parent = primaryDealId ? { opportunity_id: primaryDealId } : { customer_id: customerId };
  const path = `/customers/${customerId}`;

  return (
    <>
      <Button
        aria-label="Quick actions"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 size-14 rounded-full shadow-lg md:hidden"
      >
        <Plus className="size-6" aria-hidden />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle>Quick actions</SheetTitle>
            <SheetDescription>{customerName}</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-4">
            <NoteComposer parent={parent} revalidate={path} showShare onSaved={() => setOpen(false)} />
            <div className="grid grid-cols-3 gap-2">
              {primaryDealId ? (
                <LogContactDialog
                  opportunityId={primaryDealId}
                  customerId={customerId}
                  customerName={customerName}
                  trigger={
                    <Button variant="outline" className="h-14 flex-col gap-1">
                      <Phone className="size-4" aria-hidden />
                      Log call
                    </Button>
                  }
                />
              ) : (
                <Button variant="outline" disabled className="h-14 flex-col gap-1">
                  <Phone className="size-4" aria-hidden />
                  Log call
                </Button>
              )}
              <AddTaskDialog
                parent={parent}
                users={users}
                defaultAssignee={currentUserId}
                defaultDue={defaultDue}
                revalidate={path}
                trigger={
                  <Button variant="outline" className="h-14 flex-col gap-1">
                    <CheckSquare className="size-4" aria-hidden />
                    Add task
                  </Button>
                }
              />
              {/* Photo upload arrives with the files phase. */}
              <Button variant="outline" disabled className="h-14 flex-col gap-1">
                <Camera className="size-4" aria-hidden />
                Add photos
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
