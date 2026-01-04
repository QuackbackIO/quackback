import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_portal/settings/')({
  beforeLoad: async () => {
    throw redirect({ to: '/settings/profile' })
  },
})
