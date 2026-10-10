import { createFileRoute } from '@tanstack/react-router'
import { NotificationsPage } from '@/components/notifications/notifications-page'
import { adminPageHead } from '@/lib/client/admin-head'

interface NotificationsSearch {
  filter?: 'unread'
}

export const Route = createFileRoute('/admin/notifications')({
  head: adminPageHead('Notifications'),
  // Only the literal 'unread' is accepted; anything else falls back to the
  // default All tab rather than surfacing a broken filter state.
  validateSearch: (search: Record<string, unknown>): NotificationsSearch => ({
    filter: search.filter === 'unread' ? 'unread' : undefined,
  }),
  component: NotificationsPage,
})
