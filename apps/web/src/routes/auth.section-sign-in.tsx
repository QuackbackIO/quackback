/**
 * Provider sign-in (OAuth, OIDC) for a visitor on a section host, run on the
 * primary domain. See components/auth/section-sign-in.tsx.
 */
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SectionSignIn } from '@/components/auth/section-sign-in'

const searchSchema = z.object({
  provider: z.string().optional(),
  to: z.string().optional(),
  returnTo: z.string().optional(),
  errorReturnTo: z.string().optional(),
  loginHint: z.string().optional(),
})

export const Route = createFileRoute('/auth/section-sign-in')({
  validateSearch: searchSchema.parse,
  component: SectionSignInPage,
})

function SectionSignInPage() {
  return <SectionSignIn search={Route.useSearch()} />
}
