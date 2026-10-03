"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { UserCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/shared/field-error";
import { NativeSelect } from "@/components/shared/native-select";
import { useFormAction } from "@/components/shared/use-form-action";
import { checkDuplicates, createLead, type DuplicateMatch } from "@/features/leads/actions";
import { WORK_TYPE_LABELS } from "@/lib/deal-status";
import { formatPhone } from "@/lib/phone";
import type { StaffOption } from "@/lib/settings";

type Source = { id: string; name: string };
const MATCH_LABEL = { phone: "phone", email: "email", address: "address" } as const;

export function NewLeadForm({ sources, staff, defaultOwnerId }: { sources: Source[]; staff: StaffOption[]; defaultOwnerId: string }) {
  const { state, pending, onSubmit } = useFormAction(createLead);
  const error = state?.ok === false ? state.error : undefined;
  const fields = error?.fields;

  // Fields that drive the duplicate check
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const [chosen, setChosen] = useState<DuplicateMatch | null>(null);
  const request = useRef(0);

  useEffect(() => {
    if (chosen) return;
    const id = ++request.current;
    const timer = setTimeout(async () => {
      const found = await checkDuplicates({ phone, email, address, postalCode });
      if (id === request.current) setMatches(found); // ignore out-of-order responses
    }, 400);
    return () => clearTimeout(timer);
  }, [phone, email, address, postalCode, chosen]);

  return (
    <form onSubmit={onSubmit} className="grid max-w-4xl gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-6">
        {error && !fields ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">
            {error.message}
          </p>
        ) : null}

        {chosen ? (
          <section className="flex items-start justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
            <input type="hidden" name="customer_id" value={chosen.customerId} />
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-medium">
                <UserCheck className="size-4 text-primary" aria-hidden />
                Adding a deal for {chosen.name}
              </p>
              <p className="truncate text-muted-foreground">
                {[formatPhone(chosen.phone), chosen.email].filter(Boolean).join(" · ")}
              </p>
            </div>
            <Button type="button" variant="ghost" size="icon" aria-label="Use a different customer" onClick={() => setChosen(null)}>
              <X className="size-4" aria-hidden />
            </Button>
          </section>
        ) : (
          <fieldset className="grid gap-4 md:grid-cols-2">
            <legend className="mb-3 font-medium">Customer</legend>
            <Field label="First name" name="first_name" error={fields?.first_name} autoComplete="off" />
            <Field label="Last name" name="last_name" error={fields?.last_name} autoComplete="off" />
            <Field label="Phone" name="phone" type="tel" value={phone} onChange={setPhone} error={fields?.phone} autoComplete="off" />
            <Field label="Email" name="email" type="email" value={email} onChange={setEmail} error={fields?.email} autoComplete="off" />
          </fieldset>
        )}

        <fieldset className="grid gap-4 md:grid-cols-2">
          <legend className="mb-3 font-medium">Property</legend>
          <div className="md:col-span-2">
            <Field label="Street address" name="address_line1" value={address} onChange={setAddress} error={fields?.address_line1} autoComplete="off" />
          </div>
          <Field label="City" name="city" autoComplete="off" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="State" name="state" autoComplete="off" />
            <Field label="ZIP" name="postal_code" value={postalCode} onChange={setPostalCode} inputMode="numeric" autoComplete="off" />
          </div>
        </fieldset>

        <fieldset className="grid gap-4 md:grid-cols-2">
          <legend className="mb-3 font-medium">Job</legend>
          <SelectField label="Type of work" name="work_type">
            <option value="">Not sure yet</option>
            {Object.entries(WORK_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <SelectField label="Source" name="source_id">
            <option value="">Unknown</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Owner" name="owner_id" defaultValue={defaultOwnerId}>
            <option value="">Default owner</option>
            {staff.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="message">What do they need?</Label>
            <Textarea id="message" name="message" rows={3} />
          </div>
        </fieldset>

        <div className="flex gap-2">
          <Button type="submit" className="h-11 md:h-9" disabled={pending}>
            {pending ? "Saving…" : "Create lead"}
          </Button>
          <Button asChild variant="ghost" className="h-11 md:h-9">
            <Link href="/leads">Cancel</Link>
          </Button>
        </div>
      </div>

      {/* Duplicate panel: on phones it sits above the submit area via order */}
      {!chosen && matches.length > 0 ? (
        <aside aria-label="Possible existing customers" className="order-first h-fit space-y-3 rounded-md border border-warning/50 bg-warning/5 p-3 lg:order-none">
          <p className="font-medium">Possible existing customer</p>
          <ul className="space-y-3">
            {matches.map((match) => (
              <li key={match.customerId} className="space-y-2 rounded-md border bg-background p-3">
                <div>
                  <p className="font-medium">{match.name}</p>
                  <p className="text-muted-foreground">
                    Same {match.matchedOn.map((m) => MATCH_LABEL[m]).join(" and ")}
                    {match.addresses[0] ? ` · ${match.addresses[0]}` : ""}
                  </p>
                </div>
                {match.openDeals.length > 0 ? (
                  <ul className="space-y-1 text-muted-foreground">
                    {match.openDeals.map((deal) => (
                      <li key={deal.id}>Open deal: {deal.title}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="h-11 md:h-9" onClick={() => setChosen(match)}>
                    Use this customer
                  </Button>
                  <Button asChild variant="ghost" className="h-11 md:h-9">
                    <Link href={`/customers/${match.customerId}`}>Open</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
    </form>
  );
}

function Field({
  label,
  name,
  error,
  value,
  onChange,
  ...props
}: {
  label: string;
  name: string;
  error?: string;
  value?: string;
  onChange?: (value: string) => void;
} & Omit<React.ComponentProps<typeof Input>, "onChange" | "value" | "name">) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        className="h-11 md:h-9"
        {...(onChange ? { value: value ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value) } : {})}
        {...props}
      />
      <FieldError message={error} />
    </div>
  );
}

function SelectField({ label, name, children, defaultValue }: { label: string; name: string; children: React.ReactNode; defaultValue?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <NativeSelect id={name} name={name} defaultValue={defaultValue ?? ""}>
        {children}
      </NativeSelect>
    </div>
  );
}
