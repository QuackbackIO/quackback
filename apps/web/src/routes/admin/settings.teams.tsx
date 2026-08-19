import { createFileRoute, redirect } from '@tanstack/react-router'

/** Retired route: Teams merged into Members & Teams at /admin/settings/members. */
export const Route = createFileRoute('/admin/settings/teams')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/members', search: { tab: 'teams' }, replace: true })
  },
})
