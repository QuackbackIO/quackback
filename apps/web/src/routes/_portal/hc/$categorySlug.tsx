import { createFileRoute, Outlet } from '@tanstack/react-router'

// Transparent layout — child routes handle their own redirects to the new URL structure.
export const Route = createFileRoute('/_portal/hc/$categorySlug')({
  component: () => <Outlet />,
})
