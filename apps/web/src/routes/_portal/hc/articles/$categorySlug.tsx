import { createFileRoute, Outlet } from '@tanstack/react-router'

/** Layout for legacy `/hc/articles/{categorySlug}/...` shims. */
export const Route = createFileRoute('/_portal/hc/articles/$categorySlug')({
  component: () => <Outlet />,
})
