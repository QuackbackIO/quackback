import { createFileRoute, redirect } from '@tanstack/react-router'

/** Retired path: AI & Automation lives at /admin/automation. */
export const Route = createFileRoute('/admin/settings/ai')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/automation/agent', replace: true })
  },
})
