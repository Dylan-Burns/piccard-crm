import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** Company timezone, read once per request. Dates are displayed and bucketed in it (CLAUDE.md rule 8). */
export const getTimeZone = cache(async (): Promise<string> => {
  const supabase = await createClient();
  const { data } = await supabase.from("company_settings").select("timezone").maybeSingle();
  return data?.timezone ?? "America/New_York";
});

export type StaffOption = { id: string; name: string };

/** Active admin and sales users, for owner and assignee pickers. */
export const listStaffOptions = cache(async (): Promise<StaffOption[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("role", ["admin", "sales"])
    .eq("is_active", true)
    .order("full_name");
  return (data ?? []).map((p) => ({ id: p.id, name: p.full_name }));
});

/** Every active user, for task assignment. */
export const listUserOptions = cache(async (): Promise<StaffOption[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name");
  return (data ?? []).map((p) => ({ id: p.id, name: p.full_name }));
});
