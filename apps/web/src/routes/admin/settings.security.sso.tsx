import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * /sso is retired — identity providers and recovery codes both live on
 * the Sign-in tab of the unified authentication page. Redirect any
 * stale bookmarks or inbound links so they land on the right place.
 */
export const Route = createFileRoute('/admin/settings/security/sso')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/settings/security/authentication', search: { tab: 'sign-in' } })
  },
})
