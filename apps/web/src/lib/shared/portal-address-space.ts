/**
 * Which unknown addresses the portal answers with its own not-found page,
 * inside its header and footer. The admin, the API, sign-in, the widget and
 * the other apps that share the host keep the plain not-found page.
 */
const NOT_PORTAL = new Set([
  'admin',
  'api',
  'apps',
  'auth',
  'complete-signup',
  'csat',
  'design',
  'device',
  'e2e',
  'help',
  'oauth',
  'onboarding',
  'portal-invite',
  'unsubscribe',
  'verify-magic-link',
  'widget',
  '.well-known',
])

export function isPortalAddress(pathname: string): boolean {
  const first = pathname.split('/')[1] ?? ''
  return !NOT_PORTAL.has(first.toLowerCase())
}
