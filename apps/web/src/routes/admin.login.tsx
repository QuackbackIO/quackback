import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { safeSigninRedirect } from '@/lib/shared/auth-prompt'

const searchSchema = z.object({ callbackUrl: z.string().optional(), error: z.string().optional() })

export function adminLoginRedirectTarget(d: { callbackUrl?: string; error?: string }) {
  return safeSigninRedirect(d, '/admin')
}

export const Route = createFileRoute('/admin/login')({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    throw redirect(adminLoginRedirectTarget(search))
  },
})
