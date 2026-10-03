"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { useActionToast } from "@/components/shared/use-action-toast";
import { retrySubmission, runRetries, sendTestLead } from "@/features/settings/integration-actions";

export function LeadIngestionControls() {
  const [testState, testAction, testing] = useActionState(sendTestLead, null);
  const [retryState, retryAction, retrying] = useActionState(runRetries, null);
  useActionToast(testState, "Test lead created. Check the Leads page.");
  useActionToast(retryState, retryState?.ok ? `Retried ${retryState.data.leads} submissions; sent ${retryState.data.emails} emails` : "Done");

  return (
    <div className="flex flex-wrap gap-2">
      <form action={testAction}>
        <Button type="submit" variant="outline" className="h-11 md:h-9" disabled={testing}>
          {testing ? "Sending…" : "Send test lead"}
        </Button>
      </form>
      <form action={retryAction}>
        <Button type="submit" variant="outline" className="h-11 md:h-9" disabled={retrying}>
          {retrying ? "Retrying…" : "Retry failed items"}
        </Button>
      </form>
    </div>
  );
}

export function RetrySubmissionButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(retrySubmission, null);
  useActionToast(state, "Processed");
  return (
    <form action={action}>
      <input type="hidden" name="submission_id" value={id} />
      <Button type="submit" variant="outline" className="h-11 md:h-8" disabled={pending}>
        Retry
      </Button>
    </form>
  );
}
