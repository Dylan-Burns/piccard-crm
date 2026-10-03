"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogTriggerSlot } from "@/components/shared/dialog-trigger-slot";
import { FieldError } from "@/components/shared/field-error";
import { NativeSelect } from "@/components/shared/native-select";
import { useActionToast } from "@/components/shared/use-action-toast";
import { useFormAction } from "@/components/shared/use-form-action";
import { saveProperty, updateCustomer } from "@/features/customers/actions";

type CustomerValues = {
  id: string;
  first_name: string;
  last_name: string;
  company_name: string | null;
  phone: string | null;
  secondary_phone: string | null;
  email: string | null;
  preferred_contact: string | null;
};

export function EditCustomerDialog({ customer, trigger }: { customer: CustomerValues; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTriggerSlot>{trigger}</DialogTriggerSlot>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit contact details</DialogTitle>
        </DialogHeader>
        {open ? <CustomerForm customer={customer} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CustomerForm({ customer, onDone }: { customer: CustomerValues; onDone: () => void }) {
  const { state, pending, onSubmit } = useFormAction(updateCustomer);
  useActionToast(state, "Customer saved", onDone);
  const errors = state?.ok === false ? state.error.fields : undefined;
  const field = (name: keyof CustomerValues, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`c-${name}`}>{label}</Label>
      <Input id={`c-${name}`} name={name} defaultValue={customer[name] ?? ""} className="h-11 md:h-9" {...props} />
      <FieldError message={errors?.[name]} />
    </div>
  );
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="customer_id" value={customer.id} />
      <div className="grid grid-cols-2 gap-4">
        {field("first_name", "First name", { required: true })}
        {field("last_name", "Last name")}
      </div>
      {field("company_name", "Company")}
      <div className="grid grid-cols-2 gap-4">
        {field("phone", "Phone", { type: "tel" })}
        {field("secondary_phone", "Other phone", { type: "tel" })}
      </div>
      {field("email", "Email", { type: "email" })}
      <div className="space-y-1.5">
        <Label htmlFor="c-preferred">Prefers</Label>
        <NativeSelect id="c-preferred" name="preferred_contact" defaultValue={customer.preferred_contact ?? ""}>
          <option value="">No preference</option>
          <option value="call">Call</option>
          <option value="text">Text</option>
          <option value="email">Email</option>
        </NativeSelect>
      </div>
      <Button type="submit" className="h-11 w-full md:h-9" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

type PropertyValues = {
  id?: string;
  label: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  access_notes: string | null;
};

export function PropertyDialog({ customerId, property, trigger }: { customerId: string; property?: PropertyValues; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTriggerSlot>{trigger}</DialogTriggerSlot>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{property ? "Edit property" : "Add property"}</DialogTitle>
        </DialogHeader>
        {open ? <PropertyForm customerId={customerId} property={property} onDone={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PropertyForm({ customerId, property, onDone }: { customerId: string; property?: PropertyValues; onDone: () => void }) {
  const { state, pending, onSubmit } = useFormAction(saveProperty);
  useActionToast(state, "Property saved", onDone);
  const errors = state?.ok === false ? state.error.fields : undefined;
  const field = (name: keyof PropertyValues, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`p-${name}`}>{label}</Label>
      <Input id={`p-${name}`} name={name} defaultValue={property?.[name] ?? ""} className="h-11 md:h-9" {...props} />
      <FieldError message={errors?.[name]} />
    </div>
  );
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="customer_id" value={customerId} />
      {property?.id ? <input type="hidden" name="property_id" value={property.id} /> : null}
      {field("label", "Label (optional)", { placeholder: "Home, Rental on Oak St" })}
      {field("address_line1", "Street address", { required: true })}
      {field("address_line2", "Unit / suite")}
      <div className="grid grid-cols-[minmax(0,1fr)_5rem_6rem] gap-3">
        {field("city", "City")}
        {field("state", "State")}
        {field("postal_code", "ZIP")}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="p-access">Access notes</Label>
        <Textarea id="p-access" name="access_notes" rows={2} defaultValue={property?.access_notes ?? ""} placeholder="Gate code, dog, parking" />
      </div>
      <Button type="submit" className="h-11 w-full md:h-9" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
