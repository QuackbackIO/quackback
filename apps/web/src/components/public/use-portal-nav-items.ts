import { resolvePortalNavItems, type PortalNavItem } from './portal-header-nav'
import { usePreviewNav } from './preview-draft-context'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { isStatusPagePublished } from '@/lib/shared/status-settings'
import { isPortalSupportSurfaceEnabled } from '@/lib/shared/support-surfaces'
import { useSessionContext, useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'

/**
 * The portal's top-level pages this viewer can open, in nav order: the
 * header's tabs, and the places an empty page can point visitors to.
 */
export function usePortalNavItems(): PortalNavItem[] {
  const session = useSessionContext()
  const settings = useWorkspaceSettings()
  // The unsaved navigation from the admin branding preview (undefined outside
  // preview mode). Only that draft: a stylesheet or welcome-card edit leaves the
  // header alone.
  const previewNav = usePreviewNav()

  const flags = settings?.featureFlags
  const feedbackEnabled = isProductEnabled(flags, 'feedback')
  // Status tab: product flag + published. A non-public audience still needs
  // a signed-in viewer to bother showing the tab; the route enforces the
  // real per-viewer segment gate (settings here are workspace-global, not
  // per-viewer). Hide or reorder the tab in Portal → Navigation.
  const statusAudience = settings?.statusConfig?.audience ?? 'public'
  const statusLoggedIn = !!session?.user && session.user.principalType !== 'anonymous'
  const statusEnabled =
    isStatusPagePublished(flags, settings?.statusConfig) &&
    (statusAudience === 'public' || statusLoggedIn)
  return resolvePortalNavItems(
    {
      feedback: feedbackEnabled,
      roadmap: feedbackEnabled,
      changelog: isProductEnabled(flags, 'changelog'),
      help: isProductEnabled(flags, 'helpCenter'),
      support: isPortalSupportSurfaceEnabled(flags, settings?.portalConfig),
      status: statusEnabled,
    },
    previewNav ?? settings?.portalConfig?.nav
  )
}
