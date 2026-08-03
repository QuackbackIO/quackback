import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/customers/')({
  loader: () => {
    throw redirect({ to: '/admin/customers/people' })
  },
})
