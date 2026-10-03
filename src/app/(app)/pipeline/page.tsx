import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/shared/native-select";
import { PageHeader } from "@/components/shell/page-header";
import { listLeadSources } from "@/features/leads/queries";
import { PipelineBoard } from "@/features/pipeline/components/board";
import { getBoard } from "@/features/pipeline/queries";
import { requireRole } from "@/lib/auth";
import { WORK_TYPE_LABELS } from "@/lib/deal-status";
import { todayRange } from "@/features/appointments/queries";
import { getTimeZone, listStaffOptions, listUserOptions } from "@/lib/settings";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage({ searchParams }: PageProps<"/pipeline">) {
  const me = await requireRole("admin", "sales");
  const params = await searchParams;
  const pick = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
  // Sales reps start on their own deals; admins on everyone's (spec §5.5). "all" clears the default.
  const ownerParam = pick("owner") || (me.role === "sales" ? me.id : "all");
  const filters = {
    owner: ownerParam === "all" ? undefined : ownerParam,
    workType: pick("work") || undefined,
    source: pick("source") || undefined,
    q: pick("q") || undefined,
  };

  const timeZone = await getTimeZone();
  const [deals, staff, users, sources] = await Promise.all([getBoard(filters, timeZone), listStaffOptions(), listUserOptions(), listLeadSources()]);

  return (
    <>
      <PageHeader
        title="Pipeline"
        actions={
          <Button asChild className="h-11 md:h-9">
            <Link href="/leads/new">
              <Plus className="size-4" aria-hidden />
              New lead
            </Link>
          </Button>
        }
      />
      {/* Filters live in the URL, so they survive reloads and can be shared. */}
      <form action="/pipeline" className="flex flex-wrap gap-2 border-b px-4 py-2 md:px-6">
        <NativeSelect name="owner" aria-label="Owner" defaultValue={ownerParam} className="w-auto min-w-36 flex-1 md:flex-none">
          <option value="all">All owners</option>
          <option value="unassigned">Unassigned</option>
          {staff.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === me.id ? `Mine (${p.name})` : p.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="work" aria-label="Type of work" defaultValue={pick("work")} className="w-auto min-w-36 flex-1 md:flex-none">
          <option value="">All work types</option>
          {Object.entries(WORK_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="source" aria-label="Source" defaultValue={pick("source")} className="w-auto min-w-36 flex-1 md:flex-none">
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </NativeSelect>
        <Input name="q" type="search" defaultValue={pick("q")} aria-label="Search deals" placeholder="Search name or address" className="h-11 min-w-40 flex-1 md:h-9 md:max-w-64" />
        <Button type="submit" variant="outline" className="h-11 md:h-9">
          Apply
        </Button>
      </form>
      <PipelineBoard deals={deals} staff={staff} users={users} today={todayRange(timeZone).today} />
    </>
  );
}
