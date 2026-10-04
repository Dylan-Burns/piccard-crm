"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { useActionToast } from "@/components/shared/use-action-toast";
import { backfillGoogle, disconnectGoogle, retryGoogleSync } from "@/features/settings/integration-actions";

/** Disconnect (asks twice) and Backfill for the Google Calendar card. */
export function GoogleCalendarControls({ connected }: { connected: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [disconnectState, disconnect, disconnecting] = useActionState(disconnectGoogle, null);
  const [backfillState, backfill, backfilling] = useActionState(backfillGoogle, null);
  useActionToast(disconnectState, "Google Calendar disconnected", () => setConfirming(false));
  useActionToast(backfillState, backfillState?.ok ? `${backfillState.data.queued} appointment${backfillState.data.queued === 1 ? "" : "s"} queued` : "Queued");

  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild className="h-11 md:h-9">
        {/* A full navigation, not a client-side one: the route redirects to Google. */}
        <a href="/api/integrations/google/connect">{connected ? "Reconnect" : "Connect Google Calendar"}</a>
      </Button>
      {connected ? (
        <>
          <form action={backfill}>
            <Button type="submit" variant="outline" className="h-11 md:h-9" disabled={backfilling}>
              Backfill upcoming appointments
            </Button>
          </form>
          <form action={disconnect}>
            {confirming ? (
              <Button type="submit" variant="destructive" className="h-11 md:h-9" disabled={disconnecting}>
                Confirm disconnect
              </Button>
            ) : (
              <Button type="button" variant="ghost" className="h-11 text-red-600 md:h-9" onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            )}
          </form>
        </>
      ) : null}
    </div>
  );
}

export function RetrySyncButton({ appointmentId }: { appointmentId: string }) {
  const [state, action, pending] = useActionState(retryGoogleSync, null);
  useActionToast(state, "Retried");
  return (
    <form action={action}>
      <input type="hidden" name="appointment_id" value={appointmentId} />
      <Button type="submit" variant="outline" className="h-11 md:h-8" disabled={pending}>
        Retry
      </Button>
    </form>
  );
}
