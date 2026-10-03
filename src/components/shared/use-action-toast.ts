"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/result";

/** Shows a toast each time a server action returns a new result. Field errors stay inline. */
export function useActionToast(state: ActionResult<unknown> | null, successMessage: string, onSuccess?: () => void) {
  const last = useRef(state);
  useEffect(() => {
    if (!state || state === last.current) return;
    last.current = state;
    if (state.ok) {
      toast.success(successMessage);
      onSuccess?.();
    } else if (!state.error.fields) {
      toast.error(state.error.message);
    }
  }, [state, successMessage, onSuccess]);
}
