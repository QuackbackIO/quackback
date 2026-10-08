import { createFileRoute, redirect } from '@tanstack/react-router'
import { adminPageHead } from '@/lib/client/admin-head'

// The moderation queue lives in the Feedback area; this path forwards to it.
export const Route = createFileRoute('/admin/moderation')({
  head: adminPageHead('Moderation'),
  beforeLoad: () => {
    throw redirect({ to: '/admin/feedback/moderation' })
  },
})
