import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { getTenantSettings } from '@/lib/server/domains/settings/settings.service'
import { auth } from '@/lib/server/auth/index'
import { db, principal, eq } from '@/lib/server/db'
import { config } from '@/lib/server/config'
import type { Session } from './auth'
import type { TenantSettings } from '@/lib/server/domains/settings'
import type { SessionId, UserId } from '@quackback/ids'

export interface BootstrapData {
  baseUrl: string
  session: Session | null
  settings: TenantSettings | null
  userRole: 'admin' | 'member' | 'user' | null
}

async function getSessionInternal(): Promise<Session | null> {
  try {
    const session = await auth.api.getSession({
      headers: getRequestHeaders(),
    })

    if (!session?.user) {
      return null
    }

    return {
      session: {
        id: session.session.id as SessionId,
        expiresAt: session.session.expiresAt.toISOString(),
        token: session.session.token,
        createdAt: session.session.createdAt.toISOString(),
        updatedAt: session.session.updatedAt.toISOString(),
        userId: session.session.userId as UserId,
      },
      user: {
        id: session.user.id as UserId,
        name: session.user.name,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
        image: session.user.image ?? null,
        createdAt: session.user.createdAt.toISOString(),
        updatedAt: session.user.updatedAt.toISOString(),
      },
    }
  } catch (error) {
    // During SSR, auth might fail due to env var issues
    // Return null session and let the client retry
    console.error('[bootstrap] getSession error:', error)
    return null
  }
}

let _initialized = false

export const getBootstrapData = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BootstrapData> => {
    // Fetch session and settings in parallel
    const [session, settings] = await Promise.all([getSessionInternal(), getTenantSettings()])

    // Get user role
    const userRole = session
      ? await db.query.principal
          .findFirst({
            where: eq(principal.userId, session.user.id as UserId),
            columns: { role: true },
          })
          .then((m) => (m?.role as 'admin' | 'member' | 'user' | null) ?? null)
      : null

    // One-time initialization on first request
    if (!_initialized) {
      _initialized = true

      // Delay telemetry to let the DB connection initialize
      setTimeout(async () => {
        try {
          const { startTelemetry } = await import('@/lib/server/telemetry')
          await startTelemetry()
        } catch {
          // Silent failure -- telemetry must never affect the application
        }
      }, 10_000)
    }

    return { baseUrl: config.baseUrl, session, settings, userRole }
  }
)
