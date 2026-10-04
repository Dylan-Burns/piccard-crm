import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RANGE_PRESETS, type ResolvedRange } from "@/features/reports/ranges";
import { cn } from "@/lib/utils";

/** Preset links plus a from/to form for a custom range. Works without client JavaScript. */
export function RangePicker({ basePath, range }: { basePath: string; range: ResolvedRange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Date range" className="flex max-w-full gap-1 overflow-x-auto">
        {RANGE_PRESETS.filter((p) => p.key !== "custom").map((preset) => (
          <Link
            key={preset.key}
            href={`${basePath}?range=${preset.key}`}
            aria-current={range.key === preset.key ? "page" : undefined}
            className={cn("flex h-11 shrink-0 items-center rounded-md px-3 md:h-8", range.key === preset.key ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-card")}
          >
            {preset.label}
          </Link>
        ))}
      </nav>
      <form action={basePath} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="range" value="custom" />
        <Input type="date" name="from" aria-label="From" required defaultValue={range.from} className="h-11 w-auto bg-card md:h-8" />
        <span className="text-muted-foreground">to</span>
        <Input type="date" name="to" aria-label="To" required defaultValue={range.to} className="h-11 w-auto bg-card md:h-8" />
        <Button type="submit" variant="outline" className="h-11 md:h-8">
          Apply
        </Button>
      </form>
    </div>
  );
}
