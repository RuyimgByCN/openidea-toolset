export function isZhLocale(locale: string): boolean {
  return locale.trim().toLowerCase().startsWith("zh");
}

export function tx(locale: string, en: string, zh: string): string {
  return isZhLocale(locale) ? zh : en;
}
