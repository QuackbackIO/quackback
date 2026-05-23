/**
 * Widget OTT handoff route — server-side session creation.
 *
 * Flat route, sibling of `_portal.tsx` — intentionally OUTSIDE the portal
 * gate so the session cookie can be set BEFORE the gate runs.
 *
 * Flow:
 *   1. Widget "Go to portal" CTA → opens `{origin}/auth/widget-handoff?ott=<token>`.
 *   2. Loader reads the OTT from the search param.
 *   3. Server-side OTT verify via a POST to BA's /api/auth/one-time-token/verify.
 *      The verify response carries Set-Cookie; we forward it to the user's browser.
 *   4. On success: insert into widget_origin_session, record the consumed audit
 *      event, redirect to / (or a validated returnTo).
 *   5. On invalid / expired / replayed OTT: render an error page, record the
 *      invalid audit event.
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
import { z } from 'zod'
import { isSafeCallbackUrl } from '@/lib/shared/routing'
import type { UserId } from '@quackback/ids'

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
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/auth/widget-handoff')({
  validateSearch: searchSchema.parse,
  loader: async ({ location }): Promise<LoaderData> => {
    const { setResponseHeader, getRequestHeaders } = await import('@tanstack/react-start/server')
    const { config } = await import('@/lib/server/config')
    const { db, widgetOriginSession } = await import('@/lib/server/db')
    const { recordAuditEvent } = await import('@/lib/server/audit/log')

    const params = new URLSearchParams(location.search)
    const ott = params.get('ott')
    const returnToRaw = params.get('returnTo')
    const returnTo = isSafeCallbackUrl(returnToRaw) ? returnToRaw : '/'

    if (!ott) {
      // No token at all — invalid request.
      await recordAuditEvent({
        event: 'portal.widget_handshake.invalid',
        outcome: 'failure',
        actor: {},
        metadata: { reason: 'missing_ott' },
      })
      return { status: 'invalid' }
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
        body: JSON.stringify({ token: ott }),
      })
    } catch (err) {
      console.error('[route:widget-handoff] fetch to OTT verify failed:', err)
      await recordAuditEvent({
        event: 'portal.widget_handshake.invalid',
        outcome: 'failure',
        actor: {},
        metadata: { reason: 'fetch_error' },
      })
      return { status: 'error' }
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
      return { status }
    }

    // Forward all Set-Cookie headers from the BA response to the user's browser.
    // This is what establishes the session cookie server-side before the redirect.
    const setCookieValues = verifyResponse.headers.getSetCookie?.() ?? []
    if (setCookieValues.length === 0) {
      // Fallback for environments where getSetCookie isn't available
      const single = verifyResponse.headers.get('set-cookie')
      if (single) setCookieValues.push(single)
    }
    // Pass the array so h3/Node emits a separate Set-Cookie line per cookie.
    // Calling setResponseHeader in a loop would overwrite (set, not append),
    // losing all but the last. The array form is multi-value-safe at runtime
    // even though the TS signature only types it as string.
    if (setCookieValues.length > 0) {
      ;(setResponseHeader as (name: string, value: string | string[]) => void)(
        'Set-Cookie',
        setCookieValues
      )
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
      // Response body unreadable — still proceed; the cookie is set.
      console.warn('[route:widget-handoff] could not parse verify response body')
    }

    // Insert the widget origin marker — best-effort (non-fatal on failure).
    if (sessionId && userId) {
      try {
        await db.insert(widgetOriginSession).values({ sessionId, userId }).onConflictDoNothing()
      } catch (err) {
        console.error('[route:widget-handoff] failed to insert widget_origin_session marker:', err)
      }
    } else {
      console.warn(
        '[route:widget-handoff] session/user id missing from verify response — marker not inserted'
      )
    }

    // Record the success audit event — best-effort.
    await recordAuditEvent({
      event: 'portal.widget_handshake.consumed',
      outcome: 'success',
      actor: { userId: userId ? (userId as UserId) : undefined },
      target: sessionId ? { type: 'session', id: sessionId } : undefined,
    })

    throw redirect({ to: returnTo })
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
