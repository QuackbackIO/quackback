import {
  portalFeedbackPath,
  portalPageGates,
  type PortalPageGates,
} from '@/lib/shared/design/paths'
import { useSessionContext, useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { usePreviewDesignNav } from './preview-draft-context'

/** Which portal pages this viewer can open. */
export function usePortalPageGates(): PortalPageGates {
  const session = useSessionContext()
  const settings = useWorkspaceSettings()
  const signedIn = !!session?.user && session.user.principalType !== 'anonymous'
  return portalPageGates(settings, signedIn)
}

/** The feed's address: `/` while it is the landing page, else `/feedback`. */
export function useFeedbackPath(): '/' | '/feedback' {
  const gates = usePortalPageGates()
  const nav = useDesignNav()
  return portalFeedbackPath(nav ? { engine: 'v2', nav } : { engine: 'legacy' }, gates)
}

/** The design's menu: the draft's while previewing, else the saved one; none on the legacy theme. */
export function useDesignNav() {
  const settings = useWorkspaceSettings()
  const draftNav = usePreviewDesignNav()
  const design = settings?.portalDesign
  return design?.engine === 'v2' ? (draftNav ?? design.nav) : undefined
}
