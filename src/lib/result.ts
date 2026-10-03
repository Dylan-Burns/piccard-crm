/** Return type of every server action (spec §5.3). Actions never throw for expected failures. */
export type ActionError = {
  code: string;
  message: string;
  fields?: Record<string, string>;
};

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: ActionError };

export function ok(): ActionResult<undefined>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function fail(code: string, message: string, fields?: Record<string, string>): ActionResult<never> {
  return { ok: false, error: fields ? { code, message, fields } : { code, message } };
}

/** Converts zod issues into a field → message map (first message per field). */
export function fieldErrors(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>) {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "_";
    fields[key] ??= issue.message;
  }
  return fields;
}
