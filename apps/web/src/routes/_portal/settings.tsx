import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { SettingsNav } from '@/components/settings/settings-nav'
import { AreaMessages } from '@/components/shared/area-messages'
import { DEFAULT_LOCALE, loadAreaMessages } from '@/lib/shared/i18n'

/**
 * Settings layout for authenticated users.
 * Provides sidebar navigation for profile and preferences.
 * Requires authentication - redirects to login if not authenticated.
 */
export const Route = createFileRoute('/_portal/settings')({
  beforeLoad: ({ context }) => {
    // Require authentication for settings pages
    if (!context.session?.user) {
      throw redirect({ to: '/' })
    }
  },
  // Settings strings stay out of the catalog every other page seeds; these
  // pages read them with the page.
  loader: async ({ context }) => ({
    messages: await loadAreaMessages(
      context.acceptLanguageLocale ?? DEFAULT_LOCALE,
      'settings',
      'notificationPreferences'
    ),
  }),
  component: SettingsLayout,
})

function SettingsLayout() {
  const { messages } = Route.useLoaderData()
  return (
    <AreaMessages area="settings" messages={messages}>
      <div className="mx-auto max-w-6xl w-full flex flex-col md:flex-row gap-4 md:gap-8 px-4 sm:px-6 py-6 md:py-8 flex-1 animate-in fade-in duration-200">
        <SettingsNav />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </AreaMessages>
  )
}
