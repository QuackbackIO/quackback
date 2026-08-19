// ============================================================================
// Update Banner Dismissal Cookie Helpers
// ============================================================================
//
// Mirrors the theme cookie pattern (src/lib/shared/theme/index.ts): the
// dismissal is read from the request's `Cookie` header during SSR so the
// admin update banner renders in its final expanded/collapsed state on first
// paint, instead of always rendering expanded and collapsing after client JS
// reads localStorage (a ~60px layout shift / CLS regression).

export const UPDATE_BANNER_DISMISSED_COOKIE_NAME = 'update_banner_dismissed_version'

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const cookie of cookieHeader.split(';')) {
    const [key, value] = cookie.trim().split('=')
    if (key && value) cookies[key] = value
  }
  return cookies
}

/** Read the dismissed version from the request's `Cookie` header (server-side). */
export function getUpdateBannerDismissedVersionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  return parseCookies(cookieHeader)[UPDATE_BANNER_DISMISSED_COOKIE_NAME] ?? null
}

/** Persist the dismissed version so subsequent SSR renders respect it (client-side). */
export function setUpdateBannerDismissedVersionCookie(version: string): void {
  if (typeof document === 'undefined') return
  document.cookie = `${UPDATE_BANNER_DISMISSED_COOKIE_NAME}=${version};path=/;max-age=31536000;samesite=lax`
}
