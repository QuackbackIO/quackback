import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { isSafeCallbackUrl } from '@/lib/shared/routing'
import { buildSigninRedirect } from '@/lib/shared/auth-prompt'

const searchSchema = z.object({ callbackUrl: z.string().optional() })

export function authSignupRedirectTarget(d: { callbackUrl?: string }) {
  const callbackUrl = isSafeCallbackUrl(d.callbackUrl) ? (d.callbackUrl as string) : '/'
  return buildSigninRedirect(callbackUrl, { mode: 'signup' })
}

export const Route = createFileRoute('/auth/signup')({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    throw redirect(authSignupRedirectTarget(search))
  },
})
