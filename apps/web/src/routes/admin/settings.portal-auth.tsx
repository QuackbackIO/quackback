import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Legacy route — preserved for muscle memory + bookmarks. The portal
 * auth surface lives inside the unified Authentication page now,
 * accessible via `?tab=portal`. Sidebar link from "End Users" still
 * points here so admins arriving from there land on the Portal tab
 * without having to know the new URL shape.
 */
export const Route = createFileRoute('/admin/settings/portal-auth')({
  beforeLoad: () => {
    throw redirect({
      to: '/admin/settings/security/authentication',
      search: { tab: 'portal' },
    })
  },
})
