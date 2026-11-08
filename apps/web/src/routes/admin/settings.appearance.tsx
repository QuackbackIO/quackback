import { createFileRoute, redirect } from '@tanstack/react-router'
import { adminPageHead } from '@/lib/client/admin-head'

/**
 * Appearance is part of Settings > Portal, which summarises the design and
 * leads into the builder. Kept as a redirect so old links and the name people
 * guess keep working, as /admin/settings/branding does.
 */
export const Route = createFileRoute('/admin/settings/appearance')({
  head: adminPageHead('Appearance settings'),
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/portal' })
  },
})
