import { createFileRoute, redirect } from '@tanstack/react-router'
import { adminPageHead } from '@/lib/client/admin-head'

/** Retired route: Teams merged into Members & Teams at /admin/settings/members. */
export const Route = createFileRoute('/admin/settings/teams')({
  head: adminPageHead('Teams settings'),
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/members', search: { tab: 'teams' }, replace: true })
  },
})
