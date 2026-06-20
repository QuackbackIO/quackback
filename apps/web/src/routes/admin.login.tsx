import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'
import { isSafeCallbackUrl } from '@/lib/shared/routing'

const searchSchema = z.object({ callbackUrl: z.string().optional(), error: z.string().optional() })

export function adminLoginRedirectTarget(d: { callbackUrl?: string; error?: string }) {
  const callbackUrl = isSafeCallbackUrl(d.callbackUrl) ? (d.callbackUrl as string) : '/admin'
  const search: { callbackUrl: string; error?: string } = { callbackUrl }
  if (d.error) search.error = d.error
  return { to: '/auth/login' as const, search }
}

export const Route = createFileRoute('/admin/login')({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => { throw redirect(adminLoginRedirectTarget(search)) },
})
