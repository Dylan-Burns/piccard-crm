import { cn } from "@/lib/utils";

/** Native <select>: best one-handed behavior on phones; styled to match shadcn inputs. */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 md:h-9",
        className,
      )}
      {...props}
    />
  );
}
