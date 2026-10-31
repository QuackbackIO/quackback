import { designNavConfig, resolvePortalNavItems, type PortalNavItem } from './portal-header-nav'
import { usePreviewNav } from './preview-draft-context'
import { useWorkspaceSettings } from '@/lib/client/hooks/use-root-context'
import { useDesignNav, useFeedbackPath, usePortalPageGates } from './use-portal-paths'

/**
 * The portal's top-level pages this viewer can open, in menu order: the
 * header's tabs, and the places an empty page can point visitors to. The
 * design engine's menu comes from the design; the legacy theme's from the
 * saved navigation.
 */
export function usePortalNavItems(): PortalNavItem[] {
  const settings = useWorkspaceSettings()
  const gates = usePortalPageGates()
  const feedbackPath = useFeedbackPath()
  // The unsaved navigation from the admin branding preview (undefined outside
  // preview mode). Only that draft: a stylesheet or welcome-card edit leaves the
  // header alone.
  const previewNav = usePreviewNav()
  const nav = useDesignNav()
  if (nav && !previewNav) {
    return resolvePortalNavItems(gates, designNavConfig(nav), {
      feedbackTo: feedbackPath,
      feedbackHideable: true,
      homeTab: nav.home.on && nav.home.tab ? { label: nav.home.label } : null,
    })
  }
  return resolvePortalNavItems(gates, previewNav ?? settings?.portalConfig?.nav)
}
