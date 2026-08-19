import { createFileRoute, redirect } from '@tanstack/react-router'
import { getFirstEnabledAdminProductPath } from '@/lib/shared/types/settings'

export const Route = createFileRoute('/admin/')({
  beforeLoad: ({ context }) => {
    throw redirect({ to: getFirstEnabledAdminProductPath(context.settings?.featureFlags) })
  },
})
