"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/shared/native-select";
import { useActionToast } from "@/components/shared/use-action-toast";
import { disconnectQuickBooks, retryInvoiceSync, saveQuickBooksConfig } from "@/features/settings/integration-actions";

type Option = { id: string; name: string };

/** Connect, pick the income item (and tax code, if tax is charged), and disconnect. */
export function QuickBooksControls({ connected, options, itemId, taxCodeId }: { connected: boolean; options: { items: Option[]; taxCodes: Option[] } | null; itemId: string; taxCodeId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [disconnectState, disconnect, disconnecting] = useActionState(disconnectQuickBooks, null);
  const [configState, saveConfig, saving] = useActionState(saveQuickBooksConfig, null);
  useActionToast(disconnectState, "QuickBooks disconnected", () => setConfirming(false));
  useActionToast(configState, "QuickBooks settings saved");

  return (
    <div className="space-y-3">
      {connected && options ? (
        <form action={saveConfig} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="qbo-item">Income item for invoice lines</Label>
            <NativeSelect id="qbo-item" name="item_id" defaultValue={itemId} required>
              <option value="">Choose an item…</option>
              {options.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qbo-tax">Tax code (only if you charge sales tax)</Label>
            <NativeSelect id="qbo-tax" name="tax_code_id" defaultValue={taxCodeId}>
              <option value="">No sales tax</option>
              {options.taxCodes.map((code) => (
                <option key={code.id} value={code.id}>
                  {code.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" variant="outline" className="h-11 md:h-9" disabled={saving}>
              Save QuickBooks settings
            </Button>
          </div>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button asChild className="h-11 md:h-9">
          {/* A full navigation: the route redirects to Intuit. */}
          <a href="/api/integrations/quickbooks/connect">{connected ? "Reconnect" : "Connect QuickBooks"}</a>
        </Button>
        {connected ? (
          <form action={disconnect}>
            {confirming ? (
              <Button key="confirm" type="submit" variant="destructive" className="h-11 md:h-9" disabled={disconnecting}>
                Confirm disconnect
              </Button>
            ) : (
              // A distinct key, so the first click cannot submit the form (see mailbox-card.tsx).
              <Button key="ask" type="button" variant="ghost" className="h-11 text-red-600 md:h-9" onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            )}
          </form>
        ) : null}
      </div>
    </div>
  );
}

export function RetryInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState(retryInvoiceSync, null);
  useActionToast(state, "Retried");
  return (
    <form action={action}>
      <input type="hidden" name="invoice_id" value={invoiceId} />
      <Button type="submit" variant="outline" className="h-11 md:h-8" disabled={pending}>
        Retry
      </Button>
    </form>
  );
}
