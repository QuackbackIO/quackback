import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { SettingsNav } from '@/components/settings/settings-nav'

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
  component: SettingsLayout,
})

function SettingsLayout() {
  return (
    <div className="flex gap-8 px-6 py-8 w-full flex-1 animate-in fade-in duration-200">
      <SettingsNav />
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
