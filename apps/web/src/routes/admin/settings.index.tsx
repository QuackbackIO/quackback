import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/settings/')({
  beforeLoad: async () => {
    // Redirect to team settings
    throw redirect({ to: '/admin/settings/team' })
  },
})
