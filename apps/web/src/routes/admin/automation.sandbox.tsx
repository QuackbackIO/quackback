import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/automation/sandbox')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/automation/test', replace: true })
  },
})
