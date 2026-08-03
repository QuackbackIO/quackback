import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/settings/security/audit-log')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/audit', replace: true })
  },
})
