import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/contacts/people')({
  loader: () => {
    throw redirect({ to: '/admin/customers/people' })
  },
})
