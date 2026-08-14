import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { z } from 'zod'

const searchSchema = z.object({
  ott: z.string().optional(),
  returnTo: z.string().optional(),
})

export const Route = createFileRoute('/auth/open-handoff')({
  validateSearch: searchSchema.parse,
  loader: async ({ location }) => {
    const search = location.search as z.infer<typeof searchSchema>
    const { consumeOpenHandoffOnRequest } =
      await import('@/lib/server/functions/handoff-cookies.server')
    const result = await consumeOpenHandoffOnRequest(search)
    if (result.kind === 'redirect') throw redirect({ href: result.to })
    return result
  },
  component: OpenHandoffError,
})

function OpenHandoffError() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold">This sign-in link is no longer valid</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been used already or expired. Open the workspace again from the control plane.
        </p>
        <Link
          to="/auth/login"
          className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Sign in
        </Link>
      </section>
    </main>
  )
}
