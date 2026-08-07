const APP_ORIGIN = "http://family-frame.local";

export function safeReturnTo(value?: string): string {
  if (!value?.startsWith("/")) return "/families";
  try {
    const url = new URL(value, APP_ORIGIN);
    return url.origin === APP_ORIGIN
      ? `${url.pathname}${url.search}${url.hash}`
      : "/families";
  } catch {
    return "/families";
  }
}
