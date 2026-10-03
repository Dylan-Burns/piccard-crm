"use client";

import { useRef, useState, useTransition } from "react";
import { ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createLogoUploadUrl, setCompanyLogo } from "@/features/files/actions";

/** Company logo (shown on estimates). Uploads straight to storage, then saves the path. */
export function LogoUpload({ logoUrl }: { logoUrl: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [confirmRemove, setConfirmRemove] = useState(false);

  function upload(file: File | undefined) {
    if (!file) return;
    startTransition(async () => {
      const slot = await createLogoUploadUrl({ type: file.type, size: file.size });
      if (!slot.ok) return void toast.error(slot.error.message);
      const body = new FormData();
      body.append("cacheControl", "3600");
      body.append("", file);
      const response = await fetch(slot.data.signedUrl, { method: "PUT", body }).catch(() => null);
      if (!response?.ok) return void toast.error("The logo could not be uploaded. Try again.");
      const saved = await setCompanyLogo(slot.data.storagePath);
      if (saved.ok) toast.success("Logo saved");
      else toast.error(saved.error.message);
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await setCompanyLogo(null);
      setConfirmRemove(false);
      if (result.ok) toast.success("Logo removed");
      else toast.error(result.error.message);
    });
  }

  return (
    <section aria-label="Logo" className="space-y-3">
      <h3 className="font-medium">Logo</h3>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-16 w-40 items-center justify-center overflow-hidden rounded-md border bg-muted">
          {logoUrl ? (
            // Signed, expiring URL from private storage.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Company logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Choose a logo image"
          className="sr-only"
          onChange={(event) => {
            upload(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Button type="button" variant="outline" className="h-11 md:h-9" disabled={pending} onClick={() => inputRef.current?.click()}>
          {logoUrl ? "Replace logo" : "Upload logo"}
        </Button>
        {logoUrl ? (
          confirmRemove ? (
            <Button type="button" variant="destructive" className="h-11 md:h-9" disabled={pending} onClick={remove}>
              Remove logo
            </Button>
          ) : (
            <Button type="button" variant="ghost" className="h-11 md:h-9" disabled={pending} onClick={() => setConfirmRemove(true)}>
              Remove
            </Button>
          )
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">PNG, JPG, or WebP up to 2 MB. Appears on estimates.</p>
    </section>
  );
}
