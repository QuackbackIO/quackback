import { createFileRoute, redirect } from '@tanstack/react-router'

// The moderation queue lives in the Feedback area; this path forwards to it.
export const Route = createFileRoute('/admin/moderation')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/feedback/moderation' })
  },
})
