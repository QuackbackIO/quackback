/**
 * Widget OTT handoff route — server-side session creation.
 *
 * Flat route, sibling of `_portal.tsx` — intentionally OUTSIDE the portal
 * gate so the session cookie can be set BEFORE the gate runs.
 *
 * Flow:
 *   1. Widget "Go to portal" CTA → opens `{origin}/auth/widget-handoff?ott=<token>`.
 *   2. Loader extracts the OTT from the search param.
 *   3. Loader calls `consumeWidgetHandoffFn` (a server fn) which does the
 *      server-side OTT verify via a POST to BA's /api/auth/one-time-token/verify.
 *      The verify response carries Set-Cookie; the server fn forwards it to
 *      the user's browser via `setResponseHeader`.
 *   4. On success: insert into widget_origin_session, record the consumed audit
 *      event, return a redirect target. The loader then throws redirect().
 *   5. On invalid / expired / replayed OTT: record the invalid audit event,
 *      return an error status. The loader returns it and the error component
 *      renders.
 *
 * Why the server fn wrapper?
 *   The actual OTT consumption logic needs `setResponseHeader` and
 *   `getRequestHeaders` from `@tanstack/react-start/server`. Vite's
 *   import-protection plugin denies that specifier in client-bundled code,
 *   and route files end up in the client bundle via `routeTree.gen.ts`.
 *   Wrapping the logic in a `createServerFn` confines the server-only
 *   imports to the server bundle — same pattern used by `widget.tsx`'s
 *   `setIframeHeaders`.
 *
 * Security properties:
 *   - The OTT is consumed (deleted from the verification table) on the first
 *     successful call — one-time-use is enforced by the BA plugin.
 *   - The widget_origin_session marker is required by evaluatePortalAccess to
 *     grant the `widget` reason — self-registered portal users who never go
 *     through this route cannot gain the widget grant.
 *   - identifyVerificationEnabled is also checked by the evaluator: email-capture
 *     widget sessions (HMAC not required) never reach the portal via this path.
 */
import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod'
import { isSafeCallbackUrl } from '@/lib/shared/routing'
import type { UserId } from '@quackback/ids'

/**
 * Look up the widget identification provenance for a session.
 *
 * Returns true only when the session has a `widget_identified_session`
 * row with `hmac_verified=true` — i.e. the session was created by
 * `/api/widget/identify` on the HMAC-verified path. Returns false when
 * the row is missing (session minted elsewhere — e.g. a portal email
 * signup that produced a generic BA OTT) OR when the row says the
 * identify happened on the email-capture path.
 *
 * The handoff route uses this to gate insertion of the
 * `widget_origin_session` marker — without it, any BA OTT could earn
 * the marker, breaking the chain of trust the portal-access widget
 * branch depends on.
 *
 * Exported for unit-test reach. Fails closed on DB errors — a query
 * hiccup must never be interpreted as "verified". Imports db lazily
 * so this file stays client-bundle-safe (the route file ends up in
 * the client bundle via routeTree.gen.ts).
 */
export const isWidgetSessionHmacVerified = createServerOnlyFn(
  async (sessionId: string): Promise<boolean> => {
    try {
      const { db, widgetIdentifiedSession, eq } = await import('@/lib/server/db')
      const row = await db.query.widgetIdentifiedSession.findFirst({
        where: eq(widgetIdentifiedSession.sessionId, sessionId),
        columns: { hmacVerified: true },
      })
      return row?.hmacVerified === true
    } catch (err) {
      const { logger } = await import('@/lib/server/logger')
      logger.child({ component: 'widget-handoff' }).error({ err }, 'provenance lookup failed')
      return false
    }
  }
)

// ---------------------------------------------------------------------------
// Search schema
// ---------------------------------------------------------------------------

const searchSchema = z.object({
  ott: z.string().optional(),
  returnTo: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Loader data type
// ---------------------------------------------------------------------------

type LoaderData = { status: 'invalid' | 'expired' | 'error' }

// ---------------------------------------------------------------------------
// Server fn: server-side OTT consumption
// ---------------------------------------------------------------------------

type HandoffResult =
  | { kind: 'redirect'; to: string }
  | { kind: 'error'; status: 'invalid' | 'expired' | 'error' }

/**
 * Verify the OTT against BA, forward Set-Cookie to the browser, insert the
 * widget_origin_session marker, and record the audit event. Returns a
 * discriminated union so the route loader can decide whether to throw
 * `redirect()` or return the error data.
 *
 * Runs in the same h3 request scope as the route loader when called
 * server-side, so `setResponseHeader('Set-Cookie', ...)` here applies to
 * the OUTER request's response — the redirect carries the session cookie.
 */
const consumeWidgetHandoffFn = createServerFn({ method: 'POST' })
  .validator(searchSchema)
  .handler(async ({ data }): Promise<HandoffResult> => {
    const { config } = await import('@/lib/server/config')
    const { recordAuditEvent } = await import('@/lib/server/audit/log')
    const { logger } = await import('@/lib/server/logger')
    const log = logger.child({ component: 'widget-handoff' })

    const returnTo = isSafeCallbackUrl(data.returnTo) ? (data.returnTo as string) : '/'

    if (!data.ott) {
      // No token at all — invalid request.
      await recordAuditEvent({
        event: 'portal.widget_handshake.invalid',
        outcome: 'failure',
        actor: {},
        metadata: { reason: 'missing_ott' },
      })
      return { kind: 'error', status: 'invalid' }
    }

    // Server-side OTT verify: POST to BA's verify endpoint.
    // This is the canonical path: the BA handler itself sets the session cookie
    // via `setSessionCookie` internals. Forwarding the Set-Cookie header from
    // the response to the user's browser establishes the session before the
    // redirect fires.
    let verifyResponse: Response
    try {
      verifyResponse = await fetch(`${config.baseUrl}/api/auth/one-time-token/verify`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Forward the caller's cookie header so BA can resolve any
          // existing session context if needed.
          ...(getRequestHeaders().get('cookie')
            ? { cookie: getRequestHeaders().get('cookie')! }
            : {}),
        },
        body: JSON.stringify({ token: data.ott }),
      })
    } catch (err) {
      log.error({ err }, 'ott verify fetch failed')
      await recordAuditEvent({
        event: 'portal.widget_handshake.invalid',
        outcome: 'failure',
        actor: {},
        metadata: { reason: 'fetch_error' },
      })
      return { kind: 'error', status: 'error' }
    }

    if (!verifyResponse.ok) {
      // 400 = invalid/expired/replayed token.
      await recordAuditEvent({
        event: 'portal.widget_handshake.invalid',
        outcome: 'failure',
        actor: {},
        metadata: { reason: `ba_status_${verifyResponse.status}` },
      })
      const status = verifyResponse.status === 400 ? 'invalid' : 'error'
      return { kind: 'error', status }
    }

    // Collect Set-Cookie payload from the BA verify response, but DO NOT
    // forward it to the browser yet. A generic BA OTT minted by any other
    // flow (portal email signup, email-capture widget identify, etc.)
    // would pass the verify step here; if we forwarded the cookie eagerly
    // the visitor would end up signed in as that account even though the
    // handoff's provenance check below rejects the upgrade. Deferring the
    // header until after provenance closes that session-poisoning vector.
    const setCookieValues = verifyResponse.headers.getSetCookie?.() ?? []
    if (setCookieValues.length === 0) {
      // Fallback for environments without getSetCookie. Iterate the Headers
      // entries (which yield one entry per Set-Cookie) instead of
      // .get('set-cookie'), which folds multiple Set-Cookie values into a
      // single comma-separated string — browsers parse that as ONE
      // malformed cookie, breaking session installation.
      for (const [name, value] of verifyResponse.headers) {
        if (name.toLowerCase() === 'set-cookie') {
          setCookieValues.push(value)
        }
      }
    }

    // Parse the session info from the BA response body.
    let sessionId: string | null = null
    let userId: string | null = null
    try {
      const body = (await verifyResponse.json()) as {
        session?: { id?: string; userId?: string }
        user?: { id?: string }
      }
      sessionId = body?.session?.id ?? null
      userId = body?.user?.id ?? body?.session?.userId ?? null
    } catch {
      // Response body unreadable — refuse safely.
      log.warn('could not parse verify response body')
    }

    // Provenance gate: only sessions whose identity claim was
    // HMAC-verified at identify time can earn the marker. Without
    // this, any BA one-time-token from any session source (portal
    // email signup, email-capture widget identify, etc.) would
    // unlock the portal widget grant. See widget_identified_session.
    if (!sessionId || !userId) {
      log.warn('session/user id missing from verify response, handoff rejected')
      await recordAuditEvent({
        event: 'portal.widget_handshake.invalid',
        outcome: 'failure',
        actor: {},
        metadata: { reason: 'missing_session_info' },
      })
      return { kind: 'error', status: 'invalid' }
    }

    const provenanceOk = await isWidgetSessionHmacVerified(sessionId)
    if (!provenanceOk) {
      // The OTT was valid, but the session was not produced by an
      // HMAC-verified widget identify. Refuse the upgrade and audit.
      // Critically: we have NOT forwarded the Set-Cookie header yet, so
      // the visitor's browser ends up with no new session — they're
      // either still anonymous or still on whatever session they had
      // before. Anything else would constitute a login-confusion bug.
      await recordAuditEvent({
        event: 'portal.widget_handshake.invalid',
        outcome: 'failure',
        actor: { userId: userId as UserId },
        target: { type: 'session', id: sessionId },
        metadata: { reason: 'unverified_provenance' },
      })
      return { kind: 'error', status: 'invalid' }
    }

    // Provenance passed — safe to install the BA session cookie now.
    // Pass the array so h3/Node emits a separate Set-Cookie line per
    // cookie. Calling setResponseHeader in a loop would overwrite (set,
    // not append), losing all but the last. The array form is
    // multi-value-safe at runtime even though the TS signature only
    // types it as string.
    if (setCookieValues.length > 0) {
      ;(setResponseHeader as (name: string, value: string | string[]) => void)(
        'Set-Cookie',
        setCookieValues
      )
    }

    // Insert the widget origin marker — best-effort (non-fatal on failure).
    try {
      const { db, widgetOriginSession } = await import('@/lib/server/db')
      await db.insert(widgetOriginSession).values({ sessionId, userId }).onConflictDoNothing()
    } catch (err) {
      log.error({ err }, 'failed to insert widget_origin_session marker')
    }

    // Record the success audit event — best-effort.
    await recordAuditEvent({
      event: 'portal.widget_handshake.consumed',
      outcome: 'success',
      actor: { userId: userId as UserId },
      target: { type: 'session', id: sessionId },
    })

    return { kind: 'redirect', to: returnTo }
  })

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/auth/widget-handoff')({
  validateSearch: searchSchema.parse,
  loader: async ({ location }): Promise<LoaderData> => {
    // The search schema is shared between validateSearch and the server fn's
    // validator, so location.search is shape-compatible with the fn's
    // expected input.
    const search = location.search as z.infer<typeof searchSchema>
    const result = await consumeWidgetHandoffFn({
      data: { ott: search.ott, returnTo: search.returnTo },
    })
    if (result.kind === 'redirect') {
      throw redirect({ to: result.to })
    }
    return { status: result.status }
  },
  component: WidgetHandoffErrorPage,
})

// ---------------------------------------------------------------------------
// Error component — rendered on invalid/expired/replayed token
// ---------------------------------------------------------------------------

function WidgetHandoffErrorPage() {
  const data = Route.useLoaderData()

  return (
    <PageShell>
      <Card>
        <h1 className="text-xl font-semibold tracking-tight">Sign-in link expired</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {data.status === 'error'
            ? 'Something went wrong while processing your sign-in link. Please reopen the widget and try again.'
            : 'This sign-in link has expired or has already been used. Please reopen the widget to get a new link.'}
        </p>
      </Card>
    </PageShell>
  )
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background overflow-hidden px-4">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04] dark:opacity-[0.07]"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 80% 50% at 25% 15%, var(--primary), transparent),
            radial-gradient(ellipse 50% 80% at 80% 85%, var(--primary), transparent)
          `,
        }}
      />
      <div className="relative w-full max-w-md py-12">
        <div className="mb-8 flex items-center justify-center gap-2">
          <img src="/logo.png" alt="" className="h-6 w-6 rounded" />
          <span className="text-sm font-medium text-muted-foreground">Quackback</span>
        </div>
        {children}
      </div>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-b from-card to-card/80 p-8 text-center backdrop-blur-sm"
      style={{
        boxShadow:
          '0 0 80px -20px oklch(0.886 0.176 86 / 0.12), 0 20px 40px -12px rgb(0 0 0 / 0.08)',
      }}
    >
      {children}
    </div>
  )
}
