import { createFileRoute, redirect } from '@tanstack/react-router'
import { adminPageHead } from '@/lib/client/admin-head'

/**
 * Messenger settings moved to Channels. Bookmarks keep working.
 */
export const Route = createFileRoute('/admin/settings/conversations')({
  head: adminPageHead('Conversations settings'),
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/channels/messenger' })
  },
})
