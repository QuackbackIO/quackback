/**
 * The portal gate for the public help center endpoints (`/api/widget/kb-*`),
 * which the portal's help center and the widget both call. A private portal
 * serves them nothing for a caller it turns away, as its pages do.
 */
import { resolvePortalAccessForRequest } from '@/lib/server/functions/portal-access'

export async function isPortalOpenToRequest(): Promise<boolean> {
  return (await resolvePortalAccessForRequest()).granted
}
