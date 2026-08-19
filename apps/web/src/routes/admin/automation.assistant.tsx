import { createFileRoute, redirect } from '@tanstack/react-router'

/** One-release bookmark redirect. V1 has no route or runtime of its own. */
export const Route = createFileRoute('/admin/automation/assistant')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/automation/agent' })
  },
})
