"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { approveEstimate, declineEstimate } from "@/features/estimates/public-actions";

/**
 * Tells the server the estimate was really looked at: only after the page has been visible for
 * two seconds. Email security scanners fetch links without running this, so they never count.
 */
export function ViewTracker({ token }: { token: string }) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const arm = () => {
      clearTimeout(timer);
      if (done || document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        done = true;
        void fetch(`/api/public/estimates/${token}/view`, { method: "POST", keepalive: true }).catch(() => undefined);
      }, 2000);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [token]);
  return null;
}

/** Approve (typed name and a tick) or decline (optional reason). Wording says approve, not sign. */
export function PublicEstimateActions({ token, customerName }: { token: string; customerName: string }) {
  const [approval, approve, approving] = useActionState(approveEstimate, null);
  const [refusal, decline, declining] = useActionState(declineEstimate, null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const error = approval?.ok === false ? approval.error.message : refusal?.ok === false ? refusal.error.message : null;

  return (
    <section aria-label="Approve or decline" className="space-y-4 rounded-md border bg-card p-4">
      <h2 className="text-base font-semibold">Approve this estimate</h2>
      <form action={approve} className="space-y-3">
        <input type="hidden" name="token" value={token} />
        <div className="space-y-1.5">
          <Label htmlFor="approve-name">Your full name</Label>
          <Input id="approve-name" name="name" required minLength={2} maxLength={200} autoComplete="name" placeholder={customerName} className="h-12" />
        </div>
        <label className="flex min-h-11 items-start gap-2.5">
          <input type="checkbox" name="agree" required className="mt-1 size-5 shrink-0 accent-primary" />
          <span>I approve this estimate. I understand a written contract will follow.</span>
        </label>
        <Button type="submit" className="h-12 w-full text-base" disabled={approving || declining}>
          {approving ? "Approving…" : "Approve estimate"}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {declineOpen ? (
        <form action={decline} className="space-y-3 border-t pt-4">
          <input type="hidden" name="token" value={token} />
          <div className="space-y-1.5">
            <Label htmlFor="decline-reason">What would you change? (optional)</Label>
            <Textarea id="decline-reason" name="reason" rows={3} maxLength={1000} />
          </div>
          <Button type="submit" variant="outline" className="h-12 w-full" disabled={approving || declining}>
            {declining ? "Sending…" : "Decline estimate"}
          </Button>
        </form>
      ) : (
        <Button type="button" variant="ghost" className="h-11 w-full text-muted-foreground" onClick={() => setDeclineOpen(true)}>
          Not right for you? Decline
        </Button>
      )}
    </section>
  );
}
