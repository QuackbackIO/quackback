import { createFileRoute } from '@tanstack/react-router'
import type { StatusId } from '@quackback/ids'
import { generateId } from '@quackback/ids'
import { db, settings, principal, postStatuses, eq, DEFAULT_STATUSES } from '@/lib/server/db'
import type { SetupState } from '@/lib/server/db'
import { getAuth } from '@/lib/server/auth'
import { mintMagicLinkUrl } from '@/lib/server/auth/magic-link-mint'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { slugify } from '@/lib/shared/utils'

/**
 * Cloud control-plane → workspace bootstrap.
 *
 * Called by Quackback Cloud right after a tenant's pod becomes
 * healthy. CP holds a per-tenant token (written to OpenBao at
 * provision time, mounted into this pod as `CLOUD_BOOTSTRAP_TOKEN`)
 * and POSTs here with the org's billing email + workspace name.
 *
 * Effect: creates the admin principal, marks setup-state as
 * complete (so the customer skips /onboarding/account|workspace),
 * seeds the default post statuses, and mints a magic-link URL
 * pointing at /verify-magic-link. CP threads that URL into the
 * Cloud welcome email — the customer's first click lands them
 * directly in /admin/feedback as admin, no second signup.
 *
 * Self-hosted instances never set CLOUD_BOOTSTRAP_TOKEN, so the
 * endpoint 404s for them — zero affordance, zero attack surface.
 *
 * Idempotent on `email` match (returns a fresh magic-link URL for
 * the existing admin); 409s if a different admin already exists.
 */
export async function handleCloudBootstrap({ request }: { request: Request }): Promise<Response> {
  const expected = process.env.CLOUD_BOOTSTRAP_TOKEN
  if (!expected) return new Response('Not Found', { status: 404 })

  const provided = request.headers.get('authorization')
  if (provided !== `Bearer ${expected}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = parseBody(body)
  if (!parsed) {
    return Response.json(
      { error: 'Missing required fields: email, workspaceName' },
      { status: 400 }
    )
  }
  const { email, workspaceName } = parsed

  // Cloud customers always provide a real workspace name (CP gates
  // on org.name, which is non-empty), but a defensive check beats a
  // collision-prone `'workspace'` fallback.
  const slug = slugify(workspaceName)
  if (slug.length < 2) {
    return Response.json(
      {
        error: 'workspaceName must produce a slug of at least 2 characters',
      },
      { status: 400 }
    )
  }

  const auth = await getAuth()
  const adminUserId = await ensureAdminUser({ auth, email, workspaceName, request })
  if (adminUserId === 'CONFLICT') {
    return Response.json({ error: 'A different admin is already configured' }, { status: 409 })
  }

  // Settings + statuses inserts are independent of each other and
  // of the user creation we just gated on — fire them in parallel.
  await Promise.all([ensureCompleteSettings(workspaceName, slug), ensureDefaultStatuses()])
  await invalidateSettingsCache()

  const portalUrl = workspacePortalUrl(request)
  const claimUrl = await mintMagicLinkUrl({
    email,
    portalUrl,
    callbackPath: '/admin/feedback',
    // Failed verifications (consumed by an email scanner, expired,
    // double-clicked) land on the login screen so the customer can
    // request a fresh link in one click instead of bouncing through
    // the deep admin route guard.
    errorCallbackPath: '/admin/login',
    // 7 days for the new-tenant claim window. The default plugin
    // expiry of 10 min is sized for portal/admin sign-in safety.
    expiresInSeconds: 60 * 60 * 24 * 7,
  })

  return Response.json({
    claimUrl,
    expiresInDays: 7,
    userId: adminUserId,
  })
}

interface ParsedBody {
  email: string
  workspaceName: string
}

function parseBody(b: unknown): ParsedBody | null {
  if (!b || typeof b !== 'object') return null
  const o = b as Record<string, unknown>
  const email = typeof o.email === 'string' ? o.email.trim().toLowerCase() : ''
  const workspaceName = typeof o.workspaceName === 'string' ? o.workspaceName.trim() : ''
  if (!email || !workspaceName) return null
  return { email, workspaceName }
}

async function ensureAdminUser({
  auth,
  email,
  workspaceName,
  request,
}: {
  auth: Awaited<ReturnType<typeof getAuth>>
  email: string
  workspaceName: string
  request: Request
}): Promise<string | 'CONFLICT'> {
  const existingAdmin = await db.query.principal.findFirst({
    where: eq(principal.role, 'admin'),
    with: { user: { columns: { email: true, id: true } } },
  })
  if (existingAdmin) {
    if (existingAdmin.user?.email?.toLowerCase() === email) {
      return existingAdmin.user.id
    }
    return 'CONFLICT'
  }

  // No admin yet — sign up the user via better-auth (handles
  // password hashing + the principal-creation hook). The password
  // is a throwaway random string; the customer arrives via the
  // magic link, never via password. Display name defaults to the
  // workspace name if the caller didn't pass one explicitly.
  const throwawayPassword = `${crypto.randomUUID()}${crypto.randomUUID()}`
  const signedUp = await auth.api.signUpEmail({
    body: { email, name: workspaceName, password: throwawayPassword },
    headers: request.headers,
  })

  // The user-create hook inserts a `principal` row with role='user';
  // promote to admin.
  await db
    .update(principal)
    .set({ role: 'admin' })
    .where(eq(principal.userId, signedUp.user.id as never))

  return signedUp.user.id
}

async function ensureCompleteSettings(workspaceName: string, slug: string): Promise<void> {
  const existing = await db.query.settings.findFirst()
  const completeSetup: SetupState = {
    version: 1,
    steps: { core: true, workspace: true, boards: true },
    source: 'cloud',
    completedAt: new Date().toISOString(),
  }
  // Cloud-tenant defaults — opinionated, differ from self-hosted:
  //   * portal allows password + magic-link sign-in for end-users so
  //     the feedback portal stays accessible without OAuth wiring;
  //   * admin authConfig closes openSignup since random visitors
  //     should never become admins on a hosted tenant — admin access
  //     is invitation-only (and the bootstrap call we just ran).
  const portalConfigDefault = JSON.stringify({
    oauth: { password: true, magicLink: true, google: true, github: true },
    features: { publicView: true, submissions: true, comments: true, voting: true },
  })
  const authConfigDefault = JSON.stringify({
    oauth: { google: true, github: true },
    openSignup: false,
  })

  if (existing) {
    await db
      .update(settings)
      .set({
        name: workspaceName,
        slug,
        setupState: JSON.stringify(completeSetup),
        portalConfig: existing.portalConfig ?? portalConfigDefault,
        authConfig: existing.authConfig ?? authConfigDefault,
      })
      .where(eq(settings.id, existing.id))
    return
  }

  await db.insert(settings).values({
    id: generateId('workspace'),
    name: workspaceName,
    slug,
    createdAt: new Date(),
    setupState: JSON.stringify(completeSetup),
    portalConfig: portalConfigDefault,
    authConfig: authConfigDefault,
  })
}

async function ensureDefaultStatuses(): Promise<void> {
  const any = await db.query.postStatuses.findFirst()
  if (any) return
  await db.insert(postStatuses).values(
    DEFAULT_STATUSES.map((s) => ({
      id: generateId('status') as StatusId,
      ...s,
      createdAt: new Date(),
    }))
  )
}

/** Cloud customers always reach the workspace over TLS via the
 * public gateway, but the inbound request to *this* endpoint may
 * come over plain HTTP (in-cluster routing strips TLS at the edge).
 * Force https so the magic-link URL we mint is always usable. */
function workspacePortalUrl(request: Request): string {
  const url = new URL(request.url)
  return `https://${url.host}`
}

export const Route = createFileRoute('/api/cloud/bootstrap')({
  server: {
    handlers: {
      POST: handleCloudBootstrap,
    },
  },
})
