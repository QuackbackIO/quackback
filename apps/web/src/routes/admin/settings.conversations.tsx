import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Messenger settings moved to Channels. Bookmarks keep working.
 */
export const Route = createFileRoute('/admin/settings/conversations')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/channels/messenger' })
  },
})
