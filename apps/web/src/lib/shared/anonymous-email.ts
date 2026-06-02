/**
 * Anonymous users are created by the Better Auth anonymous plugin, which
 * requires a unique non-null email per user and so mints a synthetic
 * placeholder ("temp-<id>@anon.quackback.io"). That address is never real — it
 * must never be displayed, emailed, returned via the API, or counted as the
 * user "having an email". Treat it as null everywhere it surfaces.
 *
 * Keep ANON_EMAIL_DOMAIN as the single source of truth: the anonymous plugin is
 * configured with it, and this module recognizes it.
 */
export const ANON_EMAIL_DOMAIN = 'anon.quackback.io'

const ANON_EMAIL_SUFFIX = `@${ANON_EMAIL_DOMAIN}`

/** Whether an email is the synthetic anonymous placeholder (not a real address). */
export function isSyntheticAnonEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(ANON_EMAIL_SUFFIX)
}

/** The email if it's a real (deliverable) address, otherwise null. */
export function realEmail(email: string | null | undefined): string | null {
  return !email || isSyntheticAnonEmail(email) ? null : email
}
