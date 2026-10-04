import { ChevronRight } from "lucide-react";

/**
 * A titled section that folds. Uses <details>, so it works without client JavaScript and keeps
 * its content (including half-filled forms) in the page while closed.
 */
export function CollapsibleSection({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="border-b pb-2 last:border-b-0">
      <details open={defaultOpen} className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 font-semibold md:min-h-9 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
          {title}
        </summary>
        <div className="space-y-2 pt-1 pb-2">{children}</div>
      </details>
    </section>
  );
}
