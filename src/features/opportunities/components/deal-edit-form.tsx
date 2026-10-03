"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/shared/field-error";
import { NativeSelect } from "@/components/shared/native-select";
import { useActionToast } from "@/components/shared/use-action-toast";
import { useFormAction } from "@/components/shared/use-form-action";
import { updateOpportunity } from "@/features/opportunities/actions";
import { WORK_TYPE_LABELS } from "@/lib/deal-status";

export type DealFormValues = {
  id: string;
  title: string;
  work_type: string | null;
  property_id: string | null;
  source_id: string | null;
  estimated_value: string;
  description: string | null;
  is_insurance_claim: boolean;
  insurance_carrier: string | null;
  claim_number: string | null;
  adjuster_name: string | null;
  adjuster_phone: string | null;
  deductible: string;
};

export function DealEditForm({
  deal,
  properties,
  sources,
}: {
  deal: DealFormValues;
  properties: { id: string; label: string }[];
  sources: { id: string; name: string }[];
}) {
  const { state, pending, onSubmit } = useFormAction(updateOpportunity);
  useActionToast(state, "Deal saved");
  const errors = state?.ok === false ? state.error.fields : undefined;
  const [insurance, setInsurance] = useState(deal.is_insurance_claim);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="opportunity_id" value={deal.id} />
      <div className="space-y-1.5">
        <Label htmlFor="deal-title">Title</Label>
        <Input id="deal-title" name="title" defaultValue={deal.title} required className="h-11 md:h-9" />
        <FieldError message={errors?.title} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="deal-work">Type of work</Label>
          <NativeSelect id="deal-work" name="work_type" defaultValue={deal.work_type ?? ""}>
            <option value="">Not set</option>
            {Object.entries(WORK_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal-value">Estimated value ($)</Label>
          <Input id="deal-value" name="estimated_value" defaultValue={deal.estimated_value} inputMode="decimal" className="h-11 md:h-9" />
          <FieldError message={errors?.estimated_value} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal-property">Property</Label>
          <NativeSelect id="deal-property" name="property_id" defaultValue={deal.property_id ?? ""}>
            <option value="">Not set</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal-source">Source</Label>
          <NativeSelect id="deal-source" name="source_id" defaultValue={deal.source_id ?? ""}>
            <option value="">Unknown</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="deal-description">What they need</Label>
        <Textarea id="deal-description" name="description" rows={3} defaultValue={deal.description ?? ""} />
      </div>

      <label className="flex min-h-11 items-center gap-3 md:min-h-9">
        <input type="checkbox" name="is_insurance_claim" checked={insurance} onChange={(e) => setInsurance(e.target.checked)} className="size-5 accent-primary" />
        Insurance claim
      </label>
      {/* Kept mounted but hidden so the values are still submitted and not cleared when unticked by mistake. */}
      <div className={insurance ? "grid gap-4 sm:grid-cols-2" : "hidden"}>
        <Small label="Carrier" name="insurance_carrier" value={deal.insurance_carrier} />
        <Small label="Claim number" name="claim_number" value={deal.claim_number} />
        <Small label="Adjuster" name="adjuster_name" value={deal.adjuster_name} />
        <Small label="Adjuster phone" name="adjuster_phone" value={deal.adjuster_phone} type="tel" />
        <div className="space-y-1.5">
          <Label htmlFor="deal-deductible">Deductible ($)</Label>
          <Input id="deal-deductible" name="deductible" defaultValue={deal.deductible} inputMode="decimal" className="h-11 md:h-9" />
          <FieldError message={errors?.deductible} />
        </div>
      </div>

      <Button type="submit" className="h-11 md:h-9" disabled={pending}>
        {pending ? "Saving…" : "Save deal"}
      </Button>
    </form>
  );
}

function Small({ label, name, value, type }: { label: string; name: string; value: string | null; type?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`deal-${name}`}>{label}</Label>
      <Input id={`deal-${name}`} name={name} type={type} defaultValue={value ?? ""} className="h-11 md:h-9" />
    </div>
  );
}
