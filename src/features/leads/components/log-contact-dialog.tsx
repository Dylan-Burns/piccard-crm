"use client";

import { useActionState, useState } from "react";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogTriggerSlot } from "@/components/shared/dialog-trigger-slot";
import { useActionToast } from "@/components/shared/use-action-toast";
import { logContact } from "@/features/leads/actions";
import { cn } from "@/lib/utils";

const TYPES = [
  { value: "call", label: "Call" },
  { value: "sms", label: "Text" },
  { value: "email", label: "Email" },
] as const;

const OUTCOMES = {
  call: [
    { value: "connected", label: "Connected" },
    { value: "left_voicemail", label: "Left voicemail" },
    { value: "no_answer", label: "No answer" },
  ],
  sms: [
    { value: "sent", label: "Sent, no reply yet" },
    { value: "connected", label: "They replied" },
  ],
  email: [
    { value: "sent", label: "Sent, no reply yet" },
    { value: "connected", label: "They replied" },
  ],
} as const;

type ContactType = keyof typeof OUTCOMES;

export function LogContactDialog({
  opportunityId,
  customerId,
  customerName,
  trigger,
}: {
  opportunityId: string;
  customerId: string;
  customerName: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [instance, setInstance] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setInstance((i) => i + 1);
        setOpen(next);
      }}
    >
      <DialogTriggerSlot>
        {trigger ?? (
          <Button variant="outline" className="h-11 md:h-9">
            <Phone className="size-4" aria-hidden />
            Log contact
          </Button>
        )}
      </DialogTriggerSlot>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log contact</DialogTitle>
          <DialogDescription>{customerName}</DialogDescription>
        </DialogHeader>
        <LogContactForm key={instance} opportunityId={opportunityId} customerId={customerId} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function LogContactForm({ opportunityId, customerId, onDone }: { opportunityId: string; customerId: string; onDone: () => void }) {
  const [type, setType] = useState<ContactType>("call");
  const [outcome, setOutcome] = useState<string>("connected");
  const [state, action, pending] = useActionState(logContact, null);
  useActionToast(state, "Contact logged", onDone);

  function chooseType(next: ContactType) {
    setType(next);
    setOutcome(OUTCOMES[next][0].value);
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="opportunity_id" value={opportunityId} />
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="outcome" value={outcome} />

      <Choice label="How" options={TYPES} value={type} onChange={(v) => chooseType(v as ContactType)} />
      <Choice label="Result" options={OUTCOMES[type]} value={outcome} onChange={setOutcome} />

      <div className="space-y-1.5">
        <Label htmlFor="contact-summary">Notes (optional)</Label>
        <Textarea id="contact-summary" name="summary" rows={3} placeholder="What was said, what happens next" />
      </div>
      <Button type="submit" className="h-11 w-full md:h-9" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

function Choice({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-11 rounded-md border px-3 md:h-9",
              value === option.value ? "border-primary bg-primary/10 font-medium text-primary" : "hover:bg-muted",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
