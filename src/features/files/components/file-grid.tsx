"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, FileText, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/shared/native-select";
import { deleteFile, getSignedUrls, updateFile } from "@/features/files/actions";
import { CATEGORY_LABELS, CATEGORY_ORDER, type FileCategory } from "@/features/files/categories";
import type { FileItem } from "@/features/files/storage";

export type FilePermissions = { canEdit: boolean; canDelete: boolean };

/**
 * Files grouped by category in the spec's order (§5.4). Photos are a thumbnail grid that opens a
 * swipeable lightbox; everything else is a list that opens in a new tab.
 */
export function FileGrid({
  files: initial,
  permissions,
  photoLimit,
  emptyText = "No files yet.",
}: {
  files: FileItem[];
  permissions: FilePermissions;
  /** Show this many photos, with "View all" for the rest. */
  photoLimit?: number;
  emptyText?: string;
}) {
  const [files, setFiles] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    // New data from the server (after an upload or edit) replaces any locally refreshed URLs.
    setSeen(initial);
    setFiles(initial);
  }
  const [showAll, setShowAll] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [editing, setEditing] = useState<FileItem | null>(null);
  const refreshed = useRef(false);

  // Signed links last an hour. If one has expired, fetch fresh ones once.
  function refreshUrls() {
    if (refreshed.current) return;
    refreshed.current = true;
    void getSignedUrls(files.map((f) => f.id)).then((result) => {
      if (!result.ok) return;
      const fresh = new Map(result.data.files.map((f) => [f.id, f]));
      setFiles((current) => current.map((f) => fresh.get(f.id) ?? f));
    });
  }

  if (files.length === 0) return <p className="text-muted-foreground">{emptyText}</p>;

  const photos = files.filter((f) => f.category === "photo" && f.isImage);
  const shownPhotos = photoLimit && !showAll ? photos.slice(0, photoLimit) : photos;
  const isGridPhoto = (f: FileItem) => f.category === "photo" && f.isImage;

  return (
    <div className="space-y-4">
      {CATEGORY_ORDER.map((category) => {
        const group = files.filter((f) => f.category === category);
        if (group.length === 0) return null;
        const listed = group.filter((f) => !isGridPhoto(f));
        return (
          <section key={category} aria-label={CATEGORY_LABELS[category]} className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              {CATEGORY_LABELS[category]} <span className="tabular">({group.length})</span>
            </h3>
            {category === "photo" && photos.length > 0 ? (
              <>
                <ul className="grid grid-cols-3 gap-1.5">
                  {shownPhotos.map((photo) => (
                    <li key={photo.id}>
                      <button
                        type="button"
                        onClick={() => setLightbox(photos.indexOf(photo))}
                        aria-label={`Open ${photo.caption ?? photo.name}`}
                        className="block aspect-square w-full overflow-hidden rounded-md border bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                      >
                        {/* Signed, expiring URLs from private storage: next/image cannot cache or optimize these. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.thumbUrl} alt={photo.caption ?? photo.name} loading="lazy" onError={refreshUrls} className="size-full object-cover" />
                      </button>
                    </li>
                  ))}
                </ul>
                {photoLimit && photos.length > photoLimit ? (
                  <Button type="button" variant="ghost" className="h-11 md:h-8" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Show fewer" : `View all ${photos.length}`}
                  </Button>
                ) : null}
              </>
            ) : null}
            {listed.length > 0 ? (
              <ul className="divide-y rounded-md border bg-card">
                {listed.map((file) => (
                  <li key={file.id} className="flex min-h-11 items-center gap-2 px-3 py-1.5">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <a href={file.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 py-1.5 hover:underline">
                      <span className="block truncate font-medium">{file.name}</span>
                      {file.caption ? <span className="block truncate text-xs text-muted-foreground">{file.caption}</span> : null}
                    </a>
                    {permissions.canEdit ? (
                      <Button type="button" variant="ghost" size="icon" aria-label={`Edit ${file.name}`} className="size-11 shrink-0 md:size-8" onClick={() => setEditing(file)}>
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}

      <Lightbox
        photos={photos}
        index={lightbox}
        onIndex={setLightbox}
        onError={refreshUrls}
        onEdit={permissions.canEdit ? (photo) => { setLightbox(null); setEditing(photo); } : undefined}
      />
      <EditFileDialog key={editing?.id} file={editing} canDelete={permissions.canDelete} onClose={() => setEditing(null)} />
    </div>
  );
}

function Lightbox({
  photos,
  index,
  onIndex,
  onError,
  onEdit,
}: {
  photos: FileItem[];
  index: number | null;
  onIndex: (index: number | null) => void;
  onError: () => void;
  onEdit?: (photo: FileItem) => void;
}) {
  const touchStart = useRef<number | null>(null);
  const photo = index === null ? null : photos[index];
  const move = (delta: number) => {
    if (index === null || photos.length === 0) return;
    onIndex((index + delta + photos.length) % photos.length);
  };

  useEffect(() => {
    if (index === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") onIndex((index - 1 + photos.length) % photos.length);
      if (event.key === "ArrowRight") onIndex((index + 1) % photos.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, photos.length, onIndex]);

  return (
    <Dialog open={Boolean(photo)} onOpenChange={(open) => !open && onIndex(null)}>
      <DialogContent
        showCloseButton={false}
        className="top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-black p-0 text-white ring-0 sm:max-w-none"
      >
        {photo ? (
          <>
            <DialogHeader className="flex-row items-center justify-between gap-2 p-2">
              <div className="min-w-0 pl-2 text-left">
                <DialogTitle className="truncate text-sm font-medium text-white">{photo.caption ?? photo.name}</DialogTitle>
                <DialogDescription className="text-xs text-white/70 tabular">
                  {index! + 1} of {photos.length}
                </DialogDescription>
              </div>
              <div className="flex shrink-0 gap-1">
                {onEdit ? (
                  <Button type="button" variant="ghost" size="icon" aria-label="Edit photo details" className="size-11 text-white hover:bg-white/10 hover:text-white" onClick={() => onEdit(photo)}>
                    <Pencil className="size-5" aria-hidden />
                  </Button>
                ) : null}
                <DialogClose asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label="Close" className="size-11 text-white hover:bg-white/10 hover:text-white">
                    <X className="size-5" aria-hidden />
                  </Button>
                </DialogClose>
              </div>
            </DialogHeader>
            <div
              className="relative flex min-h-0 flex-1 items-center justify-center"
              onTouchStart={(event) => (touchStart.current = event.touches[0]?.clientX ?? null)}
              onTouchEnd={(event) => {
                const start = touchStart.current;
                const end = event.changedTouches[0]?.clientX;
                touchStart.current = null;
                if (start === null || end === undefined || Math.abs(end - start) < 50) return;
                move(end < start ? 1 : -1);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={photo.id} src={photo.url} alt={photo.caption ?? photo.name} onError={onError} className="max-h-full max-w-full object-contain" />
              {photos.length > 1 ? (
                <>
                  <Button type="button" variant="ghost" size="icon" aria-label="Previous photo" className="absolute left-1 size-11 bg-black/40 text-white hover:bg-black/60 hover:text-white" onClick={() => move(-1)}>
                    <ChevronLeft className="size-6" aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" aria-label="Next photo" className="absolute right-1 size-11 bg-black/40 text-white hover:bg-black/60 hover:text-white" onClick={() => move(1)}>
                    <ChevronRight className="size-6" aria-hidden />
                  </Button>
                </>
              ) : null}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Staff recategorize or caption a file; admins can delete it (asked twice, no browser prompt). */
function EditFileDialog({ file, canDelete, onClose }: { file: FileItem | null; canDelete: boolean; onClose: () => void }) {
  const [category, setCategory] = useState<FileCategory>(file?.category ?? "photo");
  const [caption, setCaption] = useState(file?.caption ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (work: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>, done: string) =>
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        toast.success(done);
        onClose();
      } else {
        toast.error(result.error.message);
      }
    });

  return (
    <Dialog open={Boolean(file)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {file ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit(() => updateFile({ id: file.id, category, caption }), "File saved");
            }}
          >
            <DialogHeader>
              <DialogTitle>File details</DialogTitle>
              <DialogDescription className="truncate">{file.name}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="file-category">Category</Label>
              <NativeSelect id="file-category" value={category} onChange={(event) => setCategory(event.target.value as FileCategory)}>
                {CATEGORY_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {CATEGORY_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="file-caption">Caption (optional)</Label>
              <Input id="file-caption" value={caption} maxLength={200} onChange={(event) => setCaption(event.target.value)} className="h-11 md:h-9" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {canDelete ? (
                confirmDelete ? (
                  <Button type="button" variant="destructive" className="h-11 md:h-9" disabled={pending} onClick={() => submit(() => deleteFile(file.id), "File deleted")}>
                    Delete permanently
                  </Button>
                ) : (
                  <Button type="button" variant="ghost" className="h-11 text-red-600 md:h-9" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="size-4" aria-hidden />
                    Delete
                  </Button>
                )
              ) : (
                <span />
              )}
              <Button type="submit" className="h-11 md:h-9" disabled={pending}>
                Save
              </Button>
            </div>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
