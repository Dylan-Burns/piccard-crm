"use client";

import { use } from "react";
import { DialogTrigger } from "@/components/ui/dialog";

const REACT_LAZY = Symbol.for("react.lazy");
type LazyNode = { $$typeof: symbol; _payload: PromiseLike<React.ReactNode> };

function isLazy(node: unknown): node is LazyNode {
  if (typeof node !== "object" || node === null) return false;
  const { $$typeof, _payload } = node as Partial<LazyNode>;
  return $$typeof === REACT_LAZY && typeof _payload === "object" && _payload !== null && "then" in _payload;
}

/**
 * `<DialogTrigger asChild>` for a trigger element that may have been created in a Server Component.
 * Such an element can reach the client as a lazy reference, sometimes one lazy inside another;
 * Radix's Slot unwraps a single level and throws on the second, so unwrap fully before slotting.
 */
export function DialogTriggerSlot({ children }: { children: React.ReactNode }) {
  let node = children;
  while (isLazy(node)) node = use(node._payload);
  return <DialogTrigger asChild>{node}</DialogTrigger>;
}
