import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { NotificationMatrixForm } from '@/components/settings/notification-matrix-form'

export const Route = createFileRoute('/admin/settings/notifications')({
  // Per-member page (each team member manages their own notification
  // preferences) with no extra permission gate — the parent `/admin` guard's
  // admin/member wall is the only requirement, so no per-route RPC guard.
  // The viewer's preferences load with the page so the matrix is in the
  // document; on a miss the form fetches them itself.
  loader: async () => {
    const { getNotificationPreferencesFn } = await import('@/lib/server/functions/user')
    return { preferences: await getNotificationPreferencesFn().catch(() => null) }
  },
  component: NotificationsPage,
})

function NotificationsPage() {
  const { preferences } = Route.useLoaderData()
  return (
    <SettingsPage page="/admin/settings/notifications">
      <NotificationMatrixForm surface="admin" initialPreferences={preferences} />
    </SettingsPage>
  )
}
