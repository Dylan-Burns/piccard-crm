import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { JobStatusBadge } from "@/features/jobs/components/job-status-badge";
import { listJobs, type JobRow } from "@/features/jobs/queries";
import { requireRole } from "@/lib/auth";
import { WORK_TYPE_LABELS } from "@/lib/deal-status";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Jobs" };

const FILTERS = [
  { value: "open", label: "Open" },
  { value: "pending_schedule", label: "Pending schedule" },
  { value: "scheduled", label: "Scheduled" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "all", label: "All" },
] as const;

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const me = await requireRole();
  const params = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const status = FILTERS.find((f) => f.value === first(params.status))?.value ?? "open";
  const q = first(params.q)?.slice(0, 100) ?? "";
  const jobs = await listJobs({ status: status === "all" ? undefined : status, q });
  const href = (value: string) => `/jobs?status=${value}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <>
      <PageHeader title="Jobs" description={me.role === "field" ? "Jobs you are assigned to." : "Won deals, from scheduling to completion."} />
      <div className="space-y-3 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Job status" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1">
            {FILTERS.map((filter) => (
              <Link
                key={filter.value}
                href={href(filter.value)}
                aria-current={status === filter.value ? "page" : undefined}
                className={cn(
                  "flex h-11 shrink-0 items-center rounded-md px-3 md:h-8",
                  status === filter.value ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {filter.label}
              </Link>
            ))}
          </nav>
          <form action="/jobs" className="flex w-full gap-2 md:w-auto">
            <input type="hidden" name="status" value={status} />
            <Input name="q" type="search" defaultValue={q} placeholder="Search jobs" aria-label="Search jobs" className="h-11 md:h-9 md:w-56" />
            <Button type="submit" variant="outline" size="icon" aria-label="Search" className="size-11 shrink-0 md:size-9">
              <Search className="size-4" aria-hidden />
            </Button>
          </form>
        </div>

        {jobs.length === 0 ? (
          <EmptyState icon={Briefcase} title="No jobs here" description={q ? "Nothing matches that search." : "A deal marked Won becomes a job."} />
        ) : (
          <>
            {/* Phone: cards */}
            <ul className="space-y-3 md:hidden">
              {jobs.map((job) => (
                <li key={job.id}>
                  <Link href={`/jobs/${job.id}`} className="block space-y-1 rounded-md border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 font-semibold">
                        <span className="tabular">{job.number}</span> · {job.customerName}
                      </p>
                      <JobStatusBadge status={job.status} />
                    </div>
                    {job.address ? <p className="text-muted-foreground">{job.address}</p> : null}
                    <p>
                      {WORK_TYPE_LABELS[job.workType]} · {job.schedule ?? "Not scheduled"}
                    </p>
                    <p className="text-muted-foreground">{crewLabel(job)}</p>
                  </Link>
                </li>
              ))}
            </ul>
            {/* Desktop: table */}
            <div className="hidden overflow-x-auto rounded-md border md:block">
              <table className="w-full text-left">
                <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="h-9 px-3 font-medium">Job</th>
                    <th className="px-3 font-medium">Customer</th>
                    <th className="px-3 font-medium">Address</th>
                    <th className="px-3 font-medium">Type</th>
                    <th className="px-3 font-medium">Status</th>
                    <th className="px-3 font-medium">Scheduled</th>
                    <th className="px-3 font-medium">Crew</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {jobs.map((job) => (
                    <tr key={job.id} className="h-10 hover:bg-muted/50">
                      <td className="px-3">
                        <Link href={`/jobs/${job.id}`} className="font-medium text-primary tabular hover:underline">
                          {job.number}
                        </Link>
                      </td>
                      <td className="px-3">{job.customerName}</td>
                      <td className="px-3 text-muted-foreground">{job.address ?? "—"}</td>
                      <td className="px-3">{WORK_TYPE_LABELS[job.workType]}</td>
                      <td className="px-3">
                        <JobStatusBadge status={job.status} />
                      </td>
                      <td className="px-3 tabular">{job.schedule ?? "—"}</td>
                      <td className="px-3 text-muted-foreground">{crewLabel(job)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function crewLabel(job: JobRow) {
  return job.crew.length > 0 ? job.crew.join(", ") : "No crew yet";
}
