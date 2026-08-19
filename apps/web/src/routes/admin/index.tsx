import { createFileRoute, redirect } from '@tanstack/react-router'
import { fetchOnboardingStatus } from '@/lib/server/functions/admin'
import { resolveAdminHomePath } from '@/lib/shared/admin-home'
import { launchChecklistSummary } from '@/lib/shared/launch-checklist'
import { isAdmin } from '@/lib/shared/roles'

export const Route = createFileRoute('/admin/')({
  beforeLoad: async ({ context }) => {
    const admin = isAdmin(context.userRole)
    let launchResolved = true
    if (admin) {
      const status = await fetchOnboardingStatus()
      launchResolved = launchChecklistSummary(status).resolved
    }
    throw redirect({
      to: resolveAdminHomePath({
        isAdmin: admin,
        launchResolved,
        flags: context.settings?.featureFlags,
      }),
    })
  },
})
