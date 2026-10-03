"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/shared/field-error";
import { NativeSelect } from "@/components/shared/native-select";
import { useActionToast } from "@/components/shared/use-action-toast";
import { updateCompany } from "@/features/settings/actions";
import type { Database } from "@/types/database";

type Settings = Database["public"]["Tables"]["company_settings"]["Row"] & { default_tax_rate_percent: number };

export function CompanyForm({
  settings,
  owners,
  timeZones,
}: {
  settings: Settings;
  owners: { id: string; name: string }[];
  timeZones: string[];
}) {
  const [state, action, pending] = useActionState(updateCompany, null);
  useActionToast(state, "Company settings saved");
  const errors = state?.ok === false ? state.error.fields : undefined;

  const text = (name: keyof Settings, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={String(settings[name] ?? "")} className="h-11 md:h-9" {...props} />
      <FieldError message={errors?.[name]} />
    </div>
  );

  return (
    <form action={action} className="space-y-8">
      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="mb-3 font-medium">Business</legend>
        <div className="md:col-span-2">{text("company_name", "Company name", { required: true })}</div>
        <div className="md:col-span-2">{text("address_line1", "Address")}</div>
        {text("city", "City")}
        <div className="grid grid-cols-2 gap-4">
          {text("state", "State")}
          {text("postal_code", "ZIP")}
        </div>
        {text("phone", "Phone", { type: "tel" })}
        {text("email", "Email", { type: "email" })}
        {text("license_number", "License number")}
        <div className="space-y-1.5">
          <Label htmlFor="timezone">Time zone</Label>
          <NativeSelect id="timezone" name="timezone" defaultValue={settings.timezone}>
            {timeZones.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replaceAll("_", " ")}
              </option>
            ))}
          </NativeSelect>
          <FieldError message={errors?.timezone} />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="mb-3 font-medium">Estimate defaults</legend>
        {text("default_tax_rate_percent", "Sales tax rate (%)", { inputMode: "decimal" })}
        {text("default_deposit_percent", "Deposit (%)", { inputMode: "numeric" })}
        {text("estimate_valid_days", "Estimate valid for (days)", { inputMode: "numeric" })}
        {text("default_warranty_years", "Warranty (years)", { inputMode: "numeric" })}
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="estimate_terms">Estimate terms</Label>
          <Textarea id="estimate_terms" name="estimate_terms" rows={6} defaultValue={settings.estimate_terms} />
          <FieldError message={errors?.estimate_terms} />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="mb-3 font-medium">Leads and appointments</legend>
        <div className="space-y-1.5">
          <Label htmlFor="default_lead_owner_id">Default owner for new leads</Label>
          <NativeSelect
            id="default_lead_owner_id"
            name="default_lead_owner_id"
            defaultValue={settings.default_lead_owner_id ?? ""}
          >
            <option value="">Unassigned</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
          <FieldError message={errors?.default_lead_owner_id} />
        </div>
        <label className="flex min-h-11 items-center gap-3 md:col-span-2">
          <input
            type="checkbox"
            name="send_inspection_confirmation"
            defaultChecked={settings.send_inspection_confirmation}
            className="size-5 accent-primary"
          />
          Email customers a confirmation when an inspection is scheduled
        </label>
      </fieldset>

      <Button type="submit" className="h-11 md:h-9" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
