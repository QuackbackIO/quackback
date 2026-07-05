import { createFileRoute, redirect } from '@tanstack/react-router'

/** Retired route: AI & Automation elevated to its own main-nav area. */
export const Route = createFileRoute('/admin/settings/workflows')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/automation/workflows', replace: true })
  },
})
