import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { createServerOnlyFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import type { OriginTransferResult } from '@/lib/server/functions/origin-transfer'

const searchSchema = z.object({
  ott: z.string().optional(),
  returnTo: z.string().optional(),
})

/**
 * Consume on this request. An RPC server fn would drop the workspace Host;
 * a `*.server.ts` import is denied in the client-bundled route.
 */
const consumeOriginTransferOnRequest = createServerOnlyFn(
  async (search: z.infer<typeof searchSchema>): Promise<OriginTransferResult> => {
    const { consumeOriginTransfer } = await import('@/lib/server/functions/origin-transfer')
    const headers = getRequestHeaders()
    const result = await consumeOriginTransfer({
      ...search,
      host: headers.get('host'),
      headers,
    })
    if (result.kind === 'redirect') {
      ;(setResponseHeader as (name: string, value: string | string[]) => void)(
        'Set-Cookie',
        result.cookies
      )
    }
    return result
  }
)

export const Route = createFileRoute('/auth/origin-transfer')({
  validateSearch: searchSchema.parse,
  loader: async ({ location }) => {
    const search = location.search as z.infer<typeof searchSchema>
    const result = await consumeOriginTransferOnRequest(search)
    if (result.kind === 'redirect') throw redirect({ href: result.to })
    return result
  },
  component: OriginTransferError,
})

function OriginTransferError() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold">Session transfer expired</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in at this workspace address to continue. The old address cannot restore this
          session.
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
