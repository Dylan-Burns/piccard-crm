"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import type { ActionResult } from "@/lib/result";

/**
 * Like useActionState, but submits through onSubmit so React does not reset the form's
 * uncontrolled fields afterwards. Use it on forms where losing typed input on a validation
 * error would hurt (anything longer than a couple of fields).
 */
export function useFormAction<T>(fn: (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>) {
  const [state, dispatch, pending] = useActionState(fn, null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  return { state, pending, onSubmit };
}
