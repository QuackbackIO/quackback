import { createFileRoute, redirect } from '@tanstack/react-router'

/** Retired route: Members merged into Members & Teams at /admin/settings/members. */
export const Route = createFileRoute('/admin/settings/team')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/members', replace: true })
  },
})
