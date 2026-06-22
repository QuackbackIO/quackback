import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { safeSigninRedirect } from '@/lib/shared/auth-prompt'

const searchSchema = z.object({ callbackUrl: z.string().optional() })

export function authSignupRedirectTarget(d: { callbackUrl?: string }) {
  return safeSigninRedirect(d, '/', { mode: 'signup' })
}

export const Route = createFileRoute('/auth/signup')({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    throw redirect(authSignupRedirectTarget(search))
  },
})
