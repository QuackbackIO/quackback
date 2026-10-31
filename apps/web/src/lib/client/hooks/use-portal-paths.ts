import {
  portalFeedbackPath,
  portalPageGates,
  type PortalPageGates,
} from '@/lib/shared/design/paths'
import { useSessionContext, useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'

/** Which portal pages this viewer can open. */
export function usePortalPageGates(): PortalPageGates {
  const session = useSessionContext()
  const settings = useWorkspaceSettings()
  const signedIn = !!session?.user && session.user.principalType !== 'anonymous'
  return portalPageGates(settings, signedIn)
}

/** The feed's address: `/` while it is the landing page, else `/feedback`. */
export function useFeedbackPath(): '/' | '/feedback' {
  const settings = useWorkspaceSettings()
  const gates = usePortalPageGates()
  const design = settings?.portalDesign
  return portalFeedbackPath(
    design?.engine === 'v2' ? { engine: 'v2', nav: design.nav } : { engine: 'legacy' },
    gates
  )
}
