import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Branding settings moved to Portal — everything the visitor sees (theme,
 * navigation, welcome message) now lives on one page. Kept as a redirect so
 * bookmarks and old deep links keep working.
 */
export const Route = createFileRoute('/admin/settings/branding')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/portal' })
  },
})
