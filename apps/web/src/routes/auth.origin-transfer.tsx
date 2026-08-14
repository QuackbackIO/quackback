import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { isSafeCallbackUrl } from '@/lib/shared/routing'

const searchSchema = z.object({
  ott: z.string().optional(),
  returnTo: z.string().optional(),
})

type TransferResult =
  | { kind: 'redirect'; to: string }
  | { kind: 'error'; status: 'invalid' | 'error' }

function responseCookies(response: Response): string[] {
  const values = response.headers.getSetCookie?.() ?? []
  if (values.length > 0) return values
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() === 'set-cookie') values.push(value)
  }
  return values
}

export function isCanonicalIdentityHost(host: string | null, canonicalOrigin: string): boolean {
  if (!host) return false
  const requested = host.trim().toLowerCase().replace(/:\d+$/, '')
  return requested === new URL(canonicalOrigin).hostname
}

const consumeOriginTransferFn = createServerFn({ method: 'POST' })
  .validator(searchSchema)
  .handler(async ({ data }): Promise<TransferResult> => {
    const returnTo = isSafeCallbackUrl(data.returnTo) ? data.returnTo! : '/admin/settings/general'
    if (!data.ott) return { kind: 'error', status: 'invalid' }

    const { db, settings } = await import('@/lib/server/db')
    const { parseIdentityProjection } =
      await import('@/lib/server/domains/settings/cloud/identity-projection')
    const [row] = await db.select({ identity: settings.cloudIdentity }).from(settings).limit(1)
    const identity = parseIdentityProjection(row?.identity)
    const headers = getRequestHeaders()
    if (!identity || !isCanonicalIdentityHost(headers.get('host'), identity.canonicalOrigin)) {
      return { kind: 'error', status: 'invalid' }
    }

    try {
      const { auth } = await import('@/lib/server/auth')
      const response = await auth.api.verifyOneTimeToken({
        body: { token: data.ott },
        headers,
        asResponse: true,
      })
      if (!response.ok) return { kind: 'error', status: 'invalid' }
      const cookies = responseCookies(response)
      if (cookies.length === 0) return { kind: 'error', status: 'error' }
      ;(setResponseHeader as (name: string, value: string | string[]) => void)(
        'Set-Cookie',
        cookies
      )
      return { kind: 'redirect', to: returnTo }
    } catch {
      return { kind: 'error', status: 'invalid' }
    }
  })

export const Route = createFileRoute('/auth/origin-transfer')({
  validateSearch: searchSchema.parse,
  loader: async ({ location }) => {
    const search = location.search as z.infer<typeof searchSchema>
    const result = await consumeOriginTransferFn({ data: search })
    if (result.kind === 'redirect') throw redirect({ to: result.to })
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
