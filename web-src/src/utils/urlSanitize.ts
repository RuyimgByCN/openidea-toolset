/**
 * Strip URL userinfo passwords while retaining username and keeping full credentials in memory.
 */
export function stripUrlPassword(raw: string): string {
  try {
    const u = new URL(raw.trim());
    if (u.password) {
      u.password = "";
      return u.toString();
    }
    return raw;
  } catch {
    return raw.replace(
      /^(\s*[a-zA-Z][a-zA-Z\d+.-]*:\/\/)([^:/?#\s@]*):[^/?#@\s]*@/,
      (_m, scheme: string, user: string) => (user ? `${scheme}${user}@` : scheme),
    );
  }
}
