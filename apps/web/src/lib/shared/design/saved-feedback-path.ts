import { portalFeedbackPath, portalPageGates, type PageGateSettings } from './paths'
import type { PortalDesignView } from './view'

/**
 * The feed's address for a workspace's saved design, for code that runs
 * outside the portal's pages too, such as the post actions the admin shares.
 */
export function savedFeedbackPath(
  settings: (PageGateSettings & { portalDesign?: PortalDesignView }) | null | undefined,
  signedIn: boolean
): '/' | '/feedback' {
  const design = settings?.portalDesign
  return portalFeedbackPath(
    design?.engine === 'v2' ? { engine: 'v2', nav: design.nav } : { engine: 'legacy' },
    portalPageGates(settings, signedIn)
  )
}
