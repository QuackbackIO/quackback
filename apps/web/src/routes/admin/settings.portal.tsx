import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * The Portal settings page merged into Branding — everything the visitor
 * sees (welcome card, nav, identity, theme) now lives on one page. Kept as
 * a redirect so bookmarks and old deep links keep working.
 */
export const Route = createFileRoute('/admin/settings/portal')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/branding' })
  },
})
