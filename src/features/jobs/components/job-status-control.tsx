"use client";

import { useState, useTransition } from "react";
import { Camera, Check, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { FileCategory } from "@/features/files/categories";
import { FileUploader } from "@/features/files/components/file-uploader";
import { setJobStatus } from "@/features/jobs/actions";
import { addNote } from "@/features/notes/actions";
import type { Database } from "@/types/database";

type Status = Database["public"]["Enums"]["job_status"];

/**
 * Status actions for a job. Field users get Start and Complete only; staff also get hold, resume,
 * and cancel. Completing asks for photos and a note first (spec §9 Phase 8, step 6).
 */
export function JobStatusControl({
  job,
  isStaff,
  categories,
}: {
  job: { id: string; label: string; status: Status; hasDates: boolean; started: boolean };
  isStaff: boolean;
  categories: readonly FileCategory[];
}) {
  const [pending, startTransition] = useTransition();
  const [completing, setCompleting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [note, setNote] = useState("");

  // Toasts are raised here rather than from an effect: the buttons change with the status.
  const change = (status: Status, done: string, before?: () => Promise<boolean>) =>
    startTransition(async () => {
      if (before && !(await before())) return;
      const result = await setJobStatus({ jobId: job.id, status });
      if (result.ok) {
        toast.success(done);
        setCompleting(false);
        setConfirmCancel(false);
      } else {
        toast.error(result.error.message);
      }
    });

  async function saveNote() {
    if (!note.trim()) return true;
    const form = new FormData();
    form.set("job_id", job.id);
    form.set("body", note);
    form.set("revalidate", `/jobs/${job.id}`);
    const result = await addNote(null, form);
    if (!result.ok) toast.error(result.error.message);
    return result.ok;
  }

  const { status } = job;
  const final = status === "completed" || status === "cancelled";
  if (final) return null;
  const resumeTo: Status = job.started ? "in_progress" : job.hasDates ? "scheduled" : "pending_schedule";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "scheduled" || status === "pending_schedule" ? (
        <Button className="h-12 md:h-9" disabled={pending} onClick={() => change("in_progress", "Job started")}>
          <Play className="size-4" aria-hidden />
          Start job
        </Button>
      ) : null}
      {status === "in_progress" ? (
        <Button className="h-12 md:h-9" disabled={pending} onClick={() => setCompleting(true)}>
          <Check className="size-4" aria-hidden />
          Complete job
        </Button>
      ) : null}
      {isStaff && status === "on_hold" ? (
        <Button className="h-11 md:h-9" disabled={pending} onClick={() => change(resumeTo, "Job resumed")}>
          Resume
        </Button>
      ) : null}
      {isStaff && status !== "on_hold" ? (
        <Button variant="outline" className="h-11 md:h-9" disabled={pending} onClick={() => change("on_hold", "Job put on hold")}>
          Put on hold
        </Button>
      ) : null}
      {isStaff ? (
        confirmCancel ? (
          <Button variant="destructive" className="h-11 md:h-9" disabled={pending} onClick={() => change("cancelled", "Job cancelled")}>
            Confirm cancel
          </Button>
        ) : (
          <Button variant="ghost" className="h-11 text-red-600 md:h-9" disabled={pending} onClick={() => setConfirmCancel(true)}>
            Cancel job
          </Button>
        )
      ) : null}

      <Dialog open={completing} onOpenChange={setCompleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete job</DialogTitle>
            <DialogDescription>{job.label}</DialogDescription>
          </DialogHeader>
          <FileUploader
            target={{ jobId: job.id }}
            categories={categories}
            title="Completion photos"
            description={job.label}
            trigger={
              <Button type="button" variant="outline" className="h-12">
                <Camera className="size-4" aria-hidden />
                Add completion photos
              </Button>
            }
          />
          <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} aria-label="Completion note" placeholder="Anything the office should know? (optional)" />
          <Button className="h-12" disabled={pending} onClick={() => change("completed", "Job completed", saveNote)}>
            <Check className="size-4" aria-hidden />
            Mark completed
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
