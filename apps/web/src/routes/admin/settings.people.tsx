import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/settings/people')({
  loader: () => {
    throw redirect({ to: '/admin/customers/segments' })
  },
})
