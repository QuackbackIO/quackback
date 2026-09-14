import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/getting-started')({
  beforeLoad: () => {
    throw redirect({ to: '/admin' })
  },
  component: () => null,
})
