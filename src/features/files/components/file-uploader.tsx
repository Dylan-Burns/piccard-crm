"use client";

import { useEffect, useId, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import { Camera, CheckCircle2, CircleAlert, FileText, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { DialogTriggerSlot } from "@/components/shared/dialog-trigger-slot";
import { NativeSelect } from "@/components/shared/native-select";
import { createUploadUrls, registerFiles } from "@/features/files/actions";
import { CATEGORY_LABELS, countLabel, defaultCategory, extensionFor, isImage, MAX_FILE_BYTES, type FileCategory } from "@/features/files/categories";
import type { UploadSlot } from "@/features/files/storage";

/** Where uploads land. The uploader never works without one (spec §9 Phase 7, step 4). */
export type UploadTarget = { opportunityId?: string; customerId?: string; appointmentId?: string };

type Status = "preparing" | "waiting" | "uploading" | "uploaded" | "saved" | "failed";
type Item = {
  key: string;
  name: string;
  file: File;
  target: UploadTarget;
  category: FileCategory;
  status: Status;
  progress: number;
  error?: string;
  /** False when trying again cannot help (wrong type, too large). */
  retryable: boolean;
  slot?: UploadSlot;
};

const CONCURRENT_UPLOADS = 3;
const RETRIES = 3;
const BUSY: Status[] = ["preparing", "waiting", "uploading", "uploaded"];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `worker` over `items`, at most `limit` at a time. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await worker(next);
    }),
  );
}

/** PUTs one file to its signed URL, reporting progress. Resolves when the object is stored. */
function put(slot: UploadSlot, file: File, onProgress: (fraction: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", slot.signedUrl);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      // "Duplicate" means an earlier attempt reached storage but its response was lost.
      const duplicate = xhr.status === 409 || /Duplicate|already exists/i.test(xhr.responseText);
      if ((xhr.status >= 200 && xhr.status < 300) || duplicate) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.ontimeout = () => reject(new Error("Timed out"));
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    xhr.send(body);
  });
}

/**
 * Photo and PDF upload for one record. Images are shrunk in the browser (2000px, quality 0.8),
 * sent straight to storage three at a time with automatic retries, then registered in one call
 * so the timeline gets a single entry. Failed files stay listed with a Retry button.
 */
export function FileUploader({
  target,
  deals,
  categories,
  title = "Add photos",
  description,
  trigger,
}: {
  /** Fixed target. Omit only together with `deals`, which makes the user choose a deal first. */
  target?: UploadTarget;
  deals?: { id: string; label: string }[];
  /** Categories this user may file under. Staff get all; field users a subset. */
  categories: readonly FileCategory[];
  title?: string;
  description?: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [dealId, setDealId] = useState(deals?.length === 1 ? deals[0]!.id : "");
  const [category, setCategory] = useState<FileCategory | "auto">("auto");
  // The queue lives in a ref so the async pipeline always sees current items; `items` mirrors it for rendering.
  const queue = useRef<Item[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const render = () => setItems([...queue.current]);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  const chosenTarget: UploadTarget | null = target ?? (dealId ? { opportunityId: dealId } : null);
  const busy = items.some((item) => BUSY.includes(item.status));
  const failed = items.filter((item) => item.status === "failed");

  // Leaving the page would abandon uploads that are still in flight.
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    // In-app links do not fire beforeunload, so ask before following one.
    const guardLink = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!link || link.getAttribute("target") === "_blank") return;
      if (!window.confirm("Uploads are still in progress. Leave this page?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guardLink, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guardLink, true);
    };
  }, [busy]);

  const update = (item: Item, patch: Partial<Item>) => {
    Object.assign(item, patch);
    render();
  };

  async function prepare(item: Item) {
    let file = item.file;
    if (isImage(file.type)) {
      try {
        // No web worker: the library would load its worker script from a public CDN.
        const compressed = await imageCompression(file, { maxWidthOrHeight: 2000, initialQuality: 0.8, useWebWorker: false });
        // Keep the original name; the library returns a Blob-like File with the same type.
        if (compressed.size < file.size) file = new File([compressed], file.name, { type: compressed.type || file.type });
      } catch {
        // Could not be decoded here (for example HEIC outside Safari): send the original.
      }
    }
    if (!extensionFor(file.type)) return update(item, { status: "failed", retryable: false, error: "Only photos and PDFs can be uploaded" });
    if (file.size > MAX_FILE_BYTES) return update(item, { status: "failed", retryable: false, error: "Larger than 25 MB" });
    update(item, { file, status: "waiting" });
  }

  /** Asks the server for upload URLs for every item that does not have one yet. */
  async function requestSlots(batch: Item[]) {
    const pending = batch.filter((item) => item.status === "waiting" && !item.slot);
    if (pending.length === 0) return;
    const result = await createUploadUrls({ ...pending[0]!.target, files: pending.map((item) => ({ name: item.name, type: item.file.type, size: item.file.size })) }).catch(() => null);
    pending.forEach((item, index) => {
      if (result?.ok) item.slot = result.data.uploads[index];
      else update(item, { status: "failed", error: result ? result.error.message : "Could not reach the server", retryable: !result || result.error.code !== "forbidden" });
    });
    render();
  }

  async function upload(item: Item) {
    if (item.status !== "waiting" || !item.slot) return;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      update(item, { status: "uploading", progress: 0, error: undefined });
      try {
        await put(item.slot, item.file, (progress) => update(item, { progress }));
        return update(item, { status: "uploaded", progress: 1 });
      } catch {
        if (attempt < RETRIES) await wait(1000 * 2 ** attempt);
      }
    }
    update(item, { status: "failed", retryable: true, error: "Upload failed. Check your connection." });
  }

  /** Records every uploaded file of the batch in one call. */
  async function register(batch: Item[]) {
    const uploaded = batch.filter((item) => item.status === "uploaded" && item.slot);
    if (uploaded.length === 0) return;
    const result = await registerFiles({
      ...uploaded[0]!.target,
      files: uploaded.map((item) => ({ id: item.slot!.id, storagePath: item.slot!.storagePath, name: item.name, type: item.file.type, size: item.file.size, category: item.category })),
    }).catch(() => null);
    if (result?.ok) {
      uploaded.forEach((item) => (item.status = "saved"));
      toast.success(`${countLabel(uploaded.length, uploaded.every((item) => isImage(item.file.type)))} uploaded`);
    } else {
      // The objects are stored; only the record is missing, so Retry goes straight to registering.
      uploaded.forEach((item) => Object.assign(item, { status: "failed", retryable: true, error: result ? result.error.message : "Could not save. Check your connection." }));
    }
    render();
  }

  async function run(batch: Item[]) {
    await pool(batch.filter((item) => item.status === "preparing"), 2, prepare);
    await requestSlots(batch);
    await pool(batch.filter((item) => item.status === "waiting"), CONCURRENT_UPLOADS, upload);
    await register(batch);
    if (queue.current.every((item) => item.status === "saved")) {
      queue.current = [];
      setOpen(false);
    }
    render();
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0 || !chosenTarget) return;
    const batch = Array.from(list).map<Item>((file) => ({
      key: crypto.randomUUID(),
      name: file.name,
      file,
      target: chosenTarget,
      category: category === "auto" ? defaultCategory(file.type) : category,
      status: "preparing",
      progress: 0,
      retryable: true,
    }));
    queue.current = [...queue.current, ...batch];
    render();
    void run(batch);
  }

  function retry(batch: Item[]) {
    for (const item of batch) {
      // A file that reached storage only needs registering; anything else is sent again.
      item.status = item.progress === 1 && item.slot ? "uploaded" : "waiting";
      item.error = undefined;
    }
    render();
    // One run per target, because upload URLs and registration are per record.
    const groups = new Map<string, Item[]>();
    for (const item of batch) groups.set(JSON.stringify(item.target), [...(groups.get(JSON.stringify(item.target)) ?? []), item]);
    for (const group of groups.values()) void run(group);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTriggerSlot>{trigger}</DialogTriggerSlot>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? "Photos and PDFs, up to 25 MB each."}</DialogDescription>
        </DialogHeader>

        {deals && !target ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-deal`}>Deal</Label>
            <NativeSelect id={`${id}-deal`} value={dealId} onChange={(event) => setDealId(event.target.value)} disabled={busy}>
              <option value="">Choose a deal…</option>
              {deals.map((deal) => (
                <option key={deal.id} value={deal.id}>
                  {deal.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}

        {categories.length > 1 ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-category`}>File as</Label>
            <NativeSelect id={`${id}-category`} value={category} onChange={(event) => setCategory(event.target.value as FileCategory | "auto")}>
              <option value="auto">Photos (PDFs as Other)</option>
              {categories
                .filter((value) => value !== "photo")
                .map((value) => (
                  <option key={value} value={value}>
                    {CATEGORY_LABELS[value]}
                  </option>
                ))}
            </NativeSelect>
          </div>
        ) : null}

        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          aria-label="Choose photos or PDFs"
          className="sr-only"
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <Button type="button" className="h-12" disabled={!chosenTarget} onClick={() => inputRef.current?.click()}>
          <Camera className="size-4" aria-hidden />
          {items.length > 0 ? "Add more" : "Take or choose photos"}
        </Button>
        {!chosenTarget ? <p className="text-muted-foreground">Choose the deal these files belong to first.</p> : null}

        {items.length > 0 ? (
          <ul aria-label="Uploads" className="max-h-64 divide-y overflow-y-auto rounded-md border">
            {items.map((item) => (
              <li key={item.key} className="flex min-h-11 items-center gap-2 px-3 py-1.5">
                {item.status === "saved" ? (
                  <CheckCircle2 className="size-4 shrink-0 text-green-600" aria-hidden />
                ) : item.status === "failed" ? (
                  <CircleAlert className="size-4 shrink-0 text-red-600" aria-hidden />
                ) : isImage(item.file.type) ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                ) : (
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate">{item.name}</p>
                  {item.status === "failed" ? (
                    <p className="text-xs text-red-600">{item.error}</p>
                  ) : item.status === "saved" ? (
                    <p className="text-xs text-muted-foreground">Uploaded</p>
                  ) : (
                    <progress
                      className="block h-1.5 w-full"
                      max={1}
                      value={item.status === "uploading" || item.status === "uploaded" ? item.progress : 0}
                      aria-label={`${item.name} upload progress`}
                    />
                  )}
                </div>
                {item.status === "failed" && item.retryable ? (
                  <Button type="button" variant="outline" className="h-11 shrink-0 md:h-8" onClick={() => retry([item])}>
                    <RotateCw className="size-4" aria-hidden />
                    Retry
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {failed.length > 1 && failed.some((item) => item.retryable) ? (
          <Button type="button" variant="outline" className="h-11" onClick={() => retry(failed.filter((item) => item.retryable))}>
            Retry {failed.filter((item) => item.retryable).length} failed
          </Button>
        ) : null}
        {busy ? <p className="text-xs text-muted-foreground">Keep this page open until uploads finish.</p> : null}
      </DialogContent>
    </Dialog>
  );
}
