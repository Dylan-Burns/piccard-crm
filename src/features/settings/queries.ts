import "server-only";
import { createClient } from "@/lib/supabase/server";

export async function listProfiles() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, role, is_active, created_at")
    .order("is_active", { ascending: false })
    .order("full_name");
  if (error) throw error;
  return data;
}

export async function getCompanySettings() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("company_settings").select("*").eq("id", true).single();
  if (error) throw error;
  return data;
}
