import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/settings/widget')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/portal-widget' })
  },
})
