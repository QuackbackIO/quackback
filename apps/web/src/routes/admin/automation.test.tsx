import { createFileRoute, redirect } from '@tanstack/react-router'

/** Retired: try the live widget (or inbox Copilot) instead of a sandbox. */
export const Route = createFileRoute('/admin/automation/test')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/automation', replace: true })
  },
})
