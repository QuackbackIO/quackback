import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { isSafeCallbackUrl } from '@/lib/shared/routing'
import { buildSigninRedirect } from '@/lib/shared/auth-prompt'

const searchSchema = z.object({ callbackUrl: z.string().optional(), error: z.string().optional() })

export function adminLoginRedirectTarget(d: { callbackUrl?: string; error?: string }) {
  const callbackUrl = isSafeCallbackUrl(d.callbackUrl) ? (d.callbackUrl as string) : '/admin'
  return buildSigninRedirect(callbackUrl, { error: d.error })
}

export const Route = createFileRoute('/admin/login')({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => { throw redirect(adminLoginRedirectTarget(search)) },
})
