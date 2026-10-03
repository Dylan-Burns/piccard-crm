import { parsePhoneNumberFromString } from "libphonenumber-js";

/** E.164 form for dedupe and tel: links, or null when the input is not a valid number. Default region US. */
export function toE164(input: string | null | undefined): string | null {
  if (!input) return null;
  const parsed = parsePhoneNumberFromString(input, "US");
  return parsed?.isValid() ? parsed.number : null;
}

/** "(415) 555-0101" for US numbers; international format otherwise; the raw input if unparseable. */
export function formatPhone(input: string | null | undefined): string {
  if (!input) return "";
  const parsed = parsePhoneNumberFromString(input, "US");
  if (!parsed?.isValid()) return input;
  return parsed.country === "US" ? parsed.formatNational() : parsed.formatInternational();
}

/** href for a tel: link; prefers the normalized number. */
export function telHref(phone: string | null | undefined, e164?: string | null): string | null {
  const target = e164 ?? toE164(phone) ?? phone?.replace(/[^\d+]/g, "");
  return target ? `tel:${target}` : null;
}
