import { toE164 } from "@/lib/phone";

/** The normalized shape every lead source is converted to before `create_lead` (spec §6.5). */
export type LeadInput = {
  channel: "website" | "google_ads" | "manual" | "import";
  first_name: string;
  last_name: string;
  phone: string;
  phone_e164: string | null;
  email: string;
  address_line1: string;
  city: string;
  state: string;
  postal_code: string;
  work_type: string;
  message: string;
  source_name: string;
  source_detail: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  gclid: string;
};

export type Normalized = { ok: true; lead: LeadInput } | { ok: false; reason: string };

const WORK_TYPES = ["roof_replacement", "roof_repair", "renovation", "gutters", "siding", "other"];

const str = (value: unknown, max = 500): string => (typeof value === "string" || typeof value === "number" ? String(value).trim().slice(0, max) : "");

function splitName(full: string): [string, string] {
  const parts = full.trim().split(/\s+/);
  return [parts[0] ?? "", parts.slice(1).join(" ")];
}

/** Maps free text from a form ("Roof repair", "New roof") to a work type, or "" when unsure. */
export function guessWorkType(text: string): string {
  const t = text.toLowerCase().trim();
  if (!t) return "";
  if (WORK_TYPES.includes(t)) return t;
  if (/gutter/.test(t)) return "gutters";
  if (/siding/.test(t)) return "siding";
  if (/renovat|remodel|addition/.test(t)) return "renovation";
  if (/repair|leak|patch|fix/.test(t)) return "roof_repair";
  if (/replac|new roof|re-?roof|install/.test(t)) return "roof_replacement";
  return "";
}

function finish(lead: LeadInput): Normalized {
  if (!lead.first_name) return { ok: false, reason: "No name" };
  if (!lead.phone && !lead.email) return { ok: false, reason: "No phone or email" };
  return { ok: true, lead };
}

/** Website form payload → LeadInput. Rejects honeypot hits and submissions with no way to reach the person. */
export function normalizeWebsiteLead(body: Record<string, unknown>): Normalized {
  if (str(body.website)) return { ok: false, reason: "Honeypot filled" };

  let first = str(body.first_name, 80);
  let last = str(body.last_name, 80);
  if (!first && str(body.name)) [first, last] = splitName(str(body.name, 160));
  const phone = str(body.phone, 40);
  const email = str(body.email, 200).toLowerCase();
  const gclid = str(body.gclid, 200);
  const medium = str(body.utm_medium, 100).toLowerCase();

  return finish({
    channel: "website",
    first_name: first,
    last_name: last,
    phone,
    phone_e164: toE164(phone),
    email: /^\S+@\S+\.\S+$/.test(email) ? email : "",
    address_line1: str(body.address_line1, 200) || str(body.address, 200),
    city: str(body.city, 100),
    state: str(body.state, 50),
    postal_code: str(body.postal_code, 20) || str(body.zip, 20),
    work_type: guessWorkType(str(body.work_type) || str(body.service)),
    message: str(body.message, 4000),
    // A paid click is credited to Google Ads even though it arrived through the website form.
    source_name: gclid || medium === "cpc" || medium === "ppc" ? "Google Ads" : "Website",
    source_detail: str(body.form_name, 200) || str(body.page_url, 200),
    utm_source: str(body.utm_source, 100),
    utm_medium: str(body.utm_medium, 100),
    utm_campaign: str(body.utm_campaign, 200),
    gclid,
  });
}

/** Google Ads lead form webhook payload → LeadInput. */
export function normalizeGoogleAdsLead(body: Record<string, unknown>): Normalized {
  if (body.is_test === true) return { ok: false, reason: "Google Ads test lead" };
  const columns = Array.isArray(body.user_column_data) ? (body.user_column_data as Record<string, unknown>[]) : [];
  const get = (id: string) => str(columns.find((c) => c.column_id === id)?.string_value);

  let first = get("FIRST_NAME");
  let last = get("LAST_NAME");
  if (!first && get("FULL_NAME")) [first, last] = splitName(get("FULL_NAME"));
  const phone = get("PHONE_NUMBER");
  const email = get("EMAIL").toLowerCase();

  return finish({
    channel: "google_ads",
    first_name: first.slice(0, 80),
    last_name: last.slice(0, 80),
    phone: phone.slice(0, 40),
    phone_e164: toE164(phone),
    email: /^\S+@\S+\.\S+$/.test(email) ? email : "",
    address_line1: get("STREET_ADDRESS").slice(0, 200),
    city: get("CITY").slice(0, 100),
    state: get("REGION").slice(0, 50),
    postal_code: get("POSTAL_CODE").slice(0, 20),
    work_type: guessWorkType(get("SERVICE") || get("JOB_TYPE")),
    message: "",
    source_name: "Google Ads",
    source_detail: `form ${str(body.form_id)} / campaign ${str(body.campaign_id)}`,
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: str(body.campaign_id, 200),
    gclid: str(body.gcl_id, 200),
  });
}
