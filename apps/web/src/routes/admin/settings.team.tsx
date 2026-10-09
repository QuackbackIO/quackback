import { createFileRoute, redirect } from '@tanstack/react-router'
import { adminPageHead } from '@/lib/client/admin-head'

/** Retired route: Members merged into Members & Teams at /admin/settings/members. */
export const Route = createFileRoute('/admin/settings/team')({
  head: adminPageHead('Team settings'),
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/members', replace: true })
  },
})
