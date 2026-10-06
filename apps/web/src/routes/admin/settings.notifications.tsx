import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { NotificationMatrixForm } from '@/components/settings/notification-matrix-form'
import { AreaMessages } from '@/components/shared/area-messages'
import { DEFAULT_LOCALE, loadAreaMessages } from '@/lib/shared/i18n'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/notifications')({
  head: adminPageHead('Notifications settings'),
  // Per-member page (each team member manages their own notification
  // preferences) with no extra permission gate — the parent `/admin` guard's
  // admin/member wall is the only requirement, so no per-route RPC guard.
  // The viewer's preferences load with the page so the matrix is in the
  // document; on a miss the form fetches them itself.
  // The matrix's strings stay out of the catalog every admin page seeds; this
  // page reads them with the page.
  loader: async ({ context }) => {
    const { getNotificationPreferencesFn } = await import('@/lib/server/functions/user')
    const [preferences, messages] = await Promise.all([
      getNotificationPreferencesFn().catch(() => null),
      loadAreaMessages(context.acceptLanguageLocale ?? DEFAULT_LOCALE, 'notificationPreferences'),
    ])
    return { preferences, messages }
  },
  component: NotificationsPage,
})

function NotificationsPage() {
  const { preferences, messages } = Route.useLoaderData()
  return (
    <SettingsPage page="/admin/settings/notifications">
      <AreaMessages messages={messages}>
        <NotificationMatrixForm surface="admin" initialPreferences={preferences} />
      </AreaMessages>
    </SettingsPage>
  )
}
