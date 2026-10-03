export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted px-4 py-10">
      <div className="w-full max-w-sm rounded-md border bg-background p-6">{children}</div>
    </main>
  );
}
