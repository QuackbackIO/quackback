import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/contacts/organizations')({
  loader: () => {
    throw redirect({ to: '/admin/customers/organizations' })
  },
})
