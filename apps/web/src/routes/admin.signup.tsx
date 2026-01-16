import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Admin Signup Page
 *
 * Team member invitations now use magic links for one-click authentication.
 * This route redirects to login for any direct navigation attempts.
 */
export const Route = createFileRoute('/admin/signup')({
  loader: () => {
    // Team signup now uses magic links sent via email
    // Direct navigation to this route should go to login
    throw redirect({ to: '/admin/login' })
  },
  component: () => null,
})
