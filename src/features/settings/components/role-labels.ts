export const ROLE_DESCRIPTIONS = {
  admin: { label: "Admin", description: "everything, including settings and reports" },
  sales: { label: "Sales", description: "leads, pipeline, customers, estimates, jobs" },
  field: { label: "Field", description: "assigned jobs and appointments only, no prices" },
} as const;
