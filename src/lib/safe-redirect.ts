const BASE = "http://app.invalid";

/**
 * Validates a user-supplied redirect target and returns a same-site path
 * (path + query + hash), or null if it could leave the site.
 * Browsers treat `\` as `/`, so `/\evil.com` would otherwise resolve to `//evil.com`.
 */
export function safeRedirectPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/")) return null;
  // Backslashes and control characters (including tab/newline, which URL parsers strip).
  if (/[\\\u0000-\u001f\u007f]/.test(next)) return null;
  try {
    const url = new URL(next, BASE);
    if (url.origin !== BASE) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}
