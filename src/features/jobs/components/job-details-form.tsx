"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/shared/field-error";
import { NativeSelect } from "@/components/shared/native-select";
import { useActionToast } from "@/components/shared/use-action-toast";
import { useFormAction } from "@/components/shared/use-form-action";
import { updateJob } from "@/features/jobs/actions";
import { PERMIT_STATUSES, PERMIT_STATUS_LABELS } from "@/features/jobs/schemas";

type Values = { id: string; title: string; scope_summary: string | null; permit_status: (typeof PERMIT_STATUSES)[number]; permit_number: string | null; warranty_years: number | null };

/** Staff edit of the job's descriptive fields: title, crew-facing scope, permit, and warranty. */
export function JobDetailsForm({ job }: { job: Values }) {
  const { state, pending, onSubmit } = useFormAction(updateJob);
  useActionToast(state, "Job saved");
  const errors = state?.ok === false ? state.error.fields : undefined;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="id" value={job.id} />
      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required defaultValue={job.title} className="h-11 md:h-9" />
        <FieldError message={errors?.title} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="scope_summary">Scope for the crew (no prices)</Label>
        <Textarea id="scope_summary" name="scope_summary" rows={5} defaultValue={job.scope_summary ?? ""} />
        <FieldError message={errors?.scope_summary} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="permit_status">Permit</Label>
          <NativeSelect id="permit_status" name="permit_status" defaultValue={job.permit_status}>
            {PERMIT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {PERMIT_STATUS_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="permit_number">Permit number</Label>
          <Input id="permit_number" name="permit_number" defaultValue={job.permit_number ?? ""} className="h-11 md:h-9" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="warranty_years">Warranty (years)</Label>
          <Input id="warranty_years" name="warranty_years" inputMode="numeric" defaultValue={job.warranty_years ?? ""} className="h-11 md:h-9" />
          <FieldError message={errors?.warranty_years} />
        </div>
      </div>
      <Button type="submit" className="h-11 md:h-9" disabled={pending}>
        Save job
      </Button>
    </form>
  );
}
