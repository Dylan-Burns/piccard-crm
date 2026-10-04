"use client";

import { useActionState, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/shared/field-error";
import { useActionToast } from "@/components/shared/use-action-toast";
import { addPriceBookItem, updatePriceBookItem } from "@/features/estimates/actions";
import type { PriceBookItem } from "@/features/estimates/queries";

const dollars = (cents: number) => (cents / 100).toFixed(2);

/** Admin CRUD for the price book. Estimates copy these values, so edits never change an existing estimate. */
export function PriceBookManager({ items }: { items: PriceBookItem[] }) {
  return (
    <div className="space-y-6">
      {items.length === 0 ? (
        <p className="text-muted-foreground">No items yet. Add the things you quote most often.</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}
      <AddItemForm />
    </div>
  );
}

function Fields({ item, errors, idPrefix }: { item?: PriceBookItem; errors?: Record<string, string>; idPrefix: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_5rem_7rem_auto]">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input id={`${idPrefix}-name`} name="name" required defaultValue={item?.name} className="h-11 md:h-9" />
        <FieldError message={errors?.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-unit`}>Unit</Label>
        <Input id={`${idPrefix}-unit`} name="unit" required defaultValue={item?.unit ?? "sq"} list="price-book-units" className="h-11 md:h-9" />
        <FieldError message={errors?.unit} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-price`}>Price ($)</Label>
        <Input id={`${idPrefix}-price`} name="price" required inputMode="decimal" defaultValue={item ? dollars(item.unit_price_cents) : ""} className="h-11 tabular md:h-9" />
        <FieldError message={errors?.price} />
      </div>
      <label className="flex min-h-11 items-center gap-2 self-end md:min-h-9">
        <input type="checkbox" name="is_taxable" defaultChecked={item?.is_taxable ?? true} className="size-4 accent-primary" />
        Taxable
      </label>
      <div className="space-y-1.5 md:col-span-4">
        <Label htmlFor={`${idPrefix}-description`}>Description (optional)</Label>
        <Input id={`${idPrefix}-description`} name="description" defaultValue={item?.description ?? ""} className="h-11 md:h-9" />
      </div>
      <datalist id="price-book-units">
        <option value="sq" />
        <option value="lf" />
        <option value="ea" />
        <option value="hr" />
      </datalist>
    </div>
  );
}

function ItemRow({ item }: { item: PriceBookItem }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [state, action, pending] = useActionState(updatePriceBookItem, null);
  useActionToast(state, "Saved", () => setEditing(false));
  const errors = state?.ok === false ? state.error.fields : undefined;

  return (
    <li className="p-3">
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={item.id} />
        {editing ? (
          <>
            <Fields item={item} errors={errors} idPrefix={item.id} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="h-11 md:h-9" disabled={pending}>
                Save
              </Button>
              <Button type="button" variant="ghost" className="h-11 md:h-9" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              {confirmDelete ? (
                <Button type="submit" name="intent" value="delete" variant="destructive" className="ml-auto h-11 md:h-9" disabled={pending} formNoValidate>
                  Delete permanently
                </Button>
              ) : (
                <Button type="button" variant="ghost" className="ml-auto h-11 text-red-600 md:h-9" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium">
                {item.name}
                {item.is_active ? null : (
                  <Badge variant="secondary" className="ml-2">
                    Inactive
                  </Badge>
                )}
              </p>
              <p className="text-muted-foreground">
                <span className="tabular">${dollars(item.unit_price_cents)}</span> per {item.unit}
                {item.is_taxable ? "" : " · not taxable"}
                {item.description ? ` · ${item.description}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="h-11 md:h-8" aria-label={`Edit ${item.name}`} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button type="submit" name="intent" value={item.is_active ? "deactivate" : "activate"} variant="ghost" className="h-11 md:h-8" disabled={pending}>
                {item.is_active ? "Deactivate" : "Activate"}
              </Button>
            </div>
          </div>
        )}
      </form>
    </li>
  );
}

function AddItemForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(addPriceBookItem, null);
  useActionToast(state, "Item added", () => formRef.current?.reset());
  const errors = state?.ok === false ? state.error.fields : undefined;
  return (
    <form ref={formRef} action={action} className="space-y-3 rounded-md border bg-card p-3">
      <h3 className="font-medium">Add an item</h3>
      <Fields errors={errors} idPrefix="new" />
      <Button type="submit" className="h-11 md:h-9" disabled={pending}>
        Add item
      </Button>
    </form>
  );
}
