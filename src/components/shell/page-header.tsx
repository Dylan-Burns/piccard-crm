export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-background px-4 py-4 md:px-6">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description ? <p className="mt-0.5 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
