"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Read-only link with a copy button. Selecting the field also selects the whole link. */
export function CopyLink({ link, label }: { link: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the field stays selectable for a manual copy.
    }
  }

  return (
    <div className="flex gap-2">
      <Input readOnly value={link} aria-label={label} onFocus={(e) => e.currentTarget.select()} className="h-11 md:h-9" />
      <Button type="button" variant="outline" onClick={copy} className="h-11 shrink-0 md:h-9">
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
