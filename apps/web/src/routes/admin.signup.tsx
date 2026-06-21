import { createFileRoute, redirect } from '@tanstack/react-router'
import { buildSigninRedirect } from '@/lib/shared/auth-prompt'

/**
 * Admin Signup Page
 *
 * Team member invitations now use magic links for one-click authentication.
 * This route redirects to the sign-in dialog for any direct navigation attempts.
 */
export const Route = createFileRoute('/admin/signup')({
  loader: () => {
    // Team signup now uses magic links sent via email
    // Direct navigation to this route should open the sign-in dialog
    throw redirect(buildSigninRedirect('/admin', { mode: 'signup' }))
  },
  component: () => null,
})
