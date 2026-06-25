import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { safeSigninRedirect } from '@/lib/shared/auth-prompt'

const searchSchema = z.object({ callbackUrl: z.string().optional(), error: z.string().optional() })

export function authLoginRedirectTarget(d: { callbackUrl?: string; error?: string }) {
  return safeSigninRedirect(d, '/')
}

export const Route = createFileRoute('/auth/login')({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    throw redirect(authLoginRedirectTarget(search))
  },
})
