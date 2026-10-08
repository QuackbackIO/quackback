import { createFileRoute, redirect } from '@tanstack/react-router'
import { adminPageHead } from '@/lib/client/admin-head'

/** The module has no page of its own: it opens on the first page the viewer can open. */
export const Route = createFileRoute('/admin/settings/support')({
  head: adminPageHead('Support settings'),
  beforeLoad: async ({ context }) => {
    // Loaded here so the settings page registry stays out of the entry chunk.
    const { settingsModuleRedirectPath } =
      await import('@/components/admin/settings/settings-modules')
    const to = settingsModuleRedirectPath(
      'support',
      context.settings?.featureFlags,
      new Set(context.permissions ?? [])
    )
    throw redirect({ to: to as '/admin/settings/boards' })
  },
})
