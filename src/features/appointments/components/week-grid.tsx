"use client";

import { useOptimistic, useTransition } from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { toast } from "sonner";
import { moveAppointmentToDay } from "@/features/appointments/actions";
import { AppointmentChip, type AppointmentPermissions } from "@/features/appointments/components/appointment-dialog";
import type { CalendarItem } from "@/features/appointments/queries";
import type { StaffOption } from "@/lib/settings";
import { cn } from "@/lib/utils";

export type DayColumn = { day: string; label: string; isToday: boolean };

/** Desktop week view: one column per day. Staff can drag a scheduled appointment to another day (same time). */
export function WeekGrid({ days, items, permissions, users }: { days: DayColumn[]; items: CalendarItem[]; permissions: AppointmentPermissions; users: StaffOption[] }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [, startTransition] = useTransition();
  const [shown, setOptimistic] = useOptimistic(items, (state, change: { id: string; day: string }) => state.map((i) => (i.id === change.id ? { ...i, day: change.day } : i)));

  function onDragEnd(event: DragEndEvent) {
    const item = items.find((i) => i.id === event.active.id);
    const day = event.over?.id as string | undefined;
    if (!item || !day || day === item.day) return;
    startTransition(async () => {
      setOptimistic({ id: item.id, day });
      const result = await moveAppointmentToDay({ appointmentId: item.id, day, time: item.timeInput, durationMinutes: item.durationMinutes });
      if (result.ok) toast.success("Appointment moved");
      else toast.error(result.error.message);
    });
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid min-h-[60dvh] grid-cols-7 divide-x rounded-md border">
        {days.map((column) => (
          <Day key={column.day} column={column}>
            {shown
              .filter((i) => i.day === column.day)
              .map((item) =>
                permissions.isStaff && item.status === "scheduled" ? (
                  <Draggable key={item.id} id={item.id}>
                    <AppointmentChip item={item} permissions={permissions} users={users} />
                  </Draggable>
                ) : (
                  <AppointmentChip key={item.id} item={item} permissions={permissions} users={users} />
                ),
              )}
          </Day>
        ))}
      </div>
    </DndContext>
  );
}

function Day({ column, children }: { column: DayColumn; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.day });
  return (
    <section ref={setNodeRef} aria-label={column.label} className={cn("flex min-w-0 flex-col", isOver && "bg-primary/5")}>
      <h3 className={cn("border-b px-2 py-1.5 text-xs font-medium", column.isToday ? "bg-primary/10 text-primary" : "bg-muted/50 text-muted-foreground")}>{column.label}</h3>
      <div className="flex-1 space-y-1 p-1">{children}</div>
    </section>
  );
}

function Draggable({ id, children }: { id: string; children: React.ReactNode }) {
  // The chip inside is already a button; the wrapper is a group so the two do not nest as buttons.
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, attributes: { role: "group", roleDescription: "draggable appointment" } });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 20, position: "relative" } : undefined}
      className={cn("touch-none", isDragging && "opacity-80 shadow-lg")}
    >
      {children}
    </div>
  );
}
