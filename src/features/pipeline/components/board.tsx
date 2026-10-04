"use client";

import Link from "next/link";
import { useOptimistic, useRef, useState } from "react";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { AlertTriangle, CalendarDays, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useDealMoves, type MoveTarget, type OpenStage } from "@/features/pipeline/components/deal-dialogs";
import type { BoardDeal } from "@/features/pipeline/queries";
import { OPEN_STAGES, STAGE_LABELS } from "@/lib/deal-status";
import { formatCents } from "@/lib/money";
import type { StaffOption } from "@/lib/settings";
import { cn } from "@/lib/utils";

export function PipelineBoard({ deals, staff, users, today }: { deals: BoardDeal[]; staff: StaffOption[]; users: StaffOption[]; today: string }) {
  // The card shows in its new column while the request runs; when it finishes, React falls back to
  // the server's data (refreshed on success, unchanged on failure, which is the "revert").
  const [shown, setOptimistic] = useOptimistic(deals, (state, change: { id: string; stage: OpenStage }) =>
    state.map((d) => (d.id === change.id ? { ...d, stage: change.stage } : d)),
  );
  const { move, dialogs } = useDealMoves({
    staff,
    users,
    today,
    onOptimistic: (id, stage) => {
      if (stage !== "won" && stage !== "lost") setOptimistic({ id, stage });
    },
  });

  const byStage = (stage: string) => shown.filter((d) => d.stage === stage);
  const wonCount = byStage("won").length;
  const lostCount = byStage("lost").length;

  return (
    <>
      <DesktopBoard byStage={byStage} wonCount={wonCount} lostCount={lostCount} deals={shown} onMove={move} />
      <MobileBoard byStage={byStage} onMove={move} />
      {dialogs}
    </>
  );
}

type MoveFn = (deal: BoardDeal, target: MoveTarget) => void;

// ---------------------------------------------------------------------------
// Desktop: columns with drag and drop
// ---------------------------------------------------------------------------

function DesktopBoard({ byStage, wonCount, lostCount, deals, onMove }: { byStage: (s: string) => BoardDeal[]; wonCount: number; lostCount: number; deals: BoardDeal[]; onMove: MoveFn }) {
  // 8px before a drag starts, so a plain click still opens the deal.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = deals.find((d) => d.id === activeId) ?? null;

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const deal = deals.find((d) => d.id === event.active.id);
    const target = event.over?.id as MoveTarget | undefined;
    if (deal && target && target !== deal.stage) onMove(deal, target);
  }

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="hidden h-[calc(100dvh-8.5rem)] gap-3 overflow-x-auto p-4 md:flex md:p-6">
        {OPEN_STAGES.map((stage) => {
          const items = byStage(stage);
          return (
            <Column key={stage} id={stage} title={STAGE_LABELS[stage]} count={items.length} total={items.reduce((sum, d) => sum + d.valueCents, 0)}>
              {items.map((deal) => (
                <DraggableCard key={deal.id} deal={deal} dimmed={deal.id === activeId} />
              ))}
            </Column>
          );
        })}
        <div className="flex w-28 shrink-0 flex-col gap-3">
          <DropZone id="won" label="Won" count={wonCount} tone="success" />
          <DropZone id="lost" label="Lost" count={lostCount} tone="destructive" />
        </div>
      </div>
      <DragOverlay>{active ? <DealCardBody deal={active} className="cursor-grabbing shadow-lg" /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ id, title, count, total, children }: { id: string; title: string; count: number; total: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section aria-label={title} className="flex w-64 shrink-0 flex-col overflow-hidden rounded-md border bg-card">
      <header className="flex items-baseline justify-between gap-2 border-b bg-secondary px-3 py-2">
        <h2 className="truncate font-semibold">
          {title} <span className="font-normal text-muted-foreground">{count}</span>
        </h2>
        <span className="shrink-0 text-xs text-muted-foreground tabular">{total ? formatCents(total) : ""}</span>
      </header>
      <div ref={setNodeRef} className={cn("flex-1 space-y-2 overflow-y-auto bg-muted/50 p-2", isOver && "bg-primary/10 outline-2 -outline-offset-2 outline-primary/40")}>
        {children}
      </div>
    </section>
  );
}

function DropZone({ id, label, count, tone }: { id: "won" | "lost"; label: string; count: number; tone: "success" | "destructive" }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed bg-card text-center",
        tone === "success" ? "border-success/40 text-success" : "border-destructive/40 text-destructive",
        isOver && (tone === "success" ? "bg-success/10" : "bg-destructive/10"),
      )}
    >
      <span className="font-semibold">{label}</span>
      <span className="text-xs text-muted-foreground">{count} in 30 days</span>
      <span className="text-xs text-muted-foreground">Drop here</span>
    </section>
  );
}

function DraggableCard({ deal, dimmed }: { deal: BoardDeal; dimmed: boolean }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: deal.id });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={cn("cursor-grab touch-none", dimmed && "opacity-40")} aria-label={`${deal.name}, drag to move`}>
      <DealCardBody deal={deal} />
    </div>
  );
}

function NextStepChip({ next }: { next: BoardDeal["next"] }) {
  if (next.kind === "none") {
    return (
      <span className="flex items-center gap-1 text-warning">
        <AlertTriangle className="size-3" aria-hidden />
        {next.label}
      </span>
    );
  }
  if (next.kind === "appointment") {
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <CalendarDays className="size-3" aria-hidden />
        {next.label}
      </span>
    );
  }
  return (
    <span className={cn("flex items-center gap-1", next.kind === "overdue" ? "font-medium text-destructive" : next.kind === "today" ? "text-warning" : "text-muted-foreground")}>
      <Circle className="size-2 fill-current" aria-hidden />
      {next.label}
    </span>
  );
}

function DealCardBody({ deal, className, footer }: { deal: BoardDeal; className?: string; footer?: React.ReactNode }) {
  return (
    <article className={cn("relative rounded-md border bg-background p-2.5 hover:border-primary/50", className)}>
      <div className="flex items-start justify-between gap-2">
        {/* The link's ::after covers the card, so a click anywhere opens the deal; a drag still moves it. */}
        <Link href={`/opportunities/${deal.id}`} className="min-w-0 truncate font-semibold after:absolute after:inset-0 hover:underline" draggable={false}>
          {deal.name}
        </Link>
        <span className="shrink-0 tabular">{deal.value ?? ""}</span>
      </div>
      <p className="truncate text-muted-foreground">
        {deal.subtitle}
        {deal.insurance ? <span className="ml-1.5 rounded bg-muted px-1 text-[10px] font-semibold tracking-wide">INS</span> : null}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-foreground" title={deal.ownerInitials ? "Owner" : "Unassigned"}>
            {deal.ownerInitials ?? "?"}
          </span>
          {deal.inStage}
        </span>
        <NextStepChip next={deal.next} />
      </div>
      {footer}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Phone: one stage at a time, no dragging (spec §5.5)
// ---------------------------------------------------------------------------

function MobileBoard({ byStage, onMove }: { byStage: (s: string) => BoardDeal[]; onMove: MoveFn }) {
  const [stage, setStage] = useState<OpenStage>("new");
  const [moving, setMoving] = useState<BoardDeal | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const items = byStage(stage);

  function step(direction: 1 | -1) {
    const next = OPEN_STAGES[OPEN_STAGES.indexOf(stage) + direction];
    if (next) setStage(next);
  }

  return (
    <div className="md:hidden">
      <div role="tablist" aria-label="Stages" className="flex gap-2 overflow-x-auto border-b px-4 py-2">
        {OPEN_STAGES.map((s) => (
          <button
            key={s}
            role="tab"
            type="button"
            aria-selected={s === stage}
            onClick={() => setStage(s)}
            className={cn("flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3", s === stage ? "border-primary bg-primary/10 font-medium text-primary" : "text-muted-foreground")}
          >
            {STAGE_LABELS[s]}
            <span className="tabular">{byStage(s).length}</span>
          </button>
        ))}
      </div>
      <div
        className="min-h-[60dvh] space-y-2 p-4"
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (t) touchStart.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const start = touchStart.current;
          const t = e.changedTouches[0];
          touchStart.current = null;
          if (!start || !t) return;
          const dx = t.clientX - start.x;
          // A mostly-horizontal swipe changes stage; vertical movement is scrolling.
          if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(t.clientY - start.y)) step(dx < 0 ? 1 : -1);
        }}
      >
        <p className="text-xs text-muted-foreground">
          {items.length} {items.length === 1 ? "deal" : "deals"}
          {items.length ? ` · ${formatCents(items.reduce((sum, d) => sum + d.valueCents, 0))}` : ""} · swipe to change stage
        </p>
        {items.length === 0 ? <p className="py-8 text-center text-muted-foreground">No deals in this stage.</p> : null}
        {items.map((deal) => (
          <DealCardBody
            key={deal.id}
            deal={deal}
            footer={
              <Button variant="outline" className="relative z-10 mt-2 h-11 w-full" onClick={() => setMoving(deal)}>
                Move
              </Button>
            }
          />
        ))}
      </div>

      <Sheet open={moving !== null} onOpenChange={(open) => !open && setMoving(null)}>
        <SheetContent side="bottom" className="pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle>Move deal</SheetTitle>
            <SheetDescription>{moving?.name}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-1 px-4 pb-4">
            {OPEN_STAGES.filter((s) => s !== moving?.stage).map((s) => (
              <MoveOption key={s} label={STAGE_LABELS[s]} onClick={() => choose(s)} />
            ))}
            <MoveOption label="Won" className="text-success" onClick={() => choose("won")} />
            <MoveOption label="Lost" className="text-destructive" onClick={() => choose("lost")} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );

  function choose(target: MoveTarget) {
    const deal = moving;
    setMoving(null);
    if (deal) onMove(deal, target);
  }
}

function MoveOption({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex h-12 items-center rounded-md px-3 text-left font-medium hover:bg-muted", className)}>
      {label}
    </button>
  );
}
