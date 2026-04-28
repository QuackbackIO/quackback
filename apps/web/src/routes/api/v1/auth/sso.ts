import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { config } from '@/lib/server/config'
import { identifyPortalUser } from '@/lib/server/domains/users/user.identify'
import { getAuth } from '@/lib/server/auth/index'

const ssoBootstrapSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200).optional(),
  image: z.string().url().optional(),
  externalId: z.string().max(255).optional(),
  returnTo: z.string().optional(),
})

function normalizeReturnTo(returnTo?: string): string {
  if (!returnTo) return '/'

  const trimmed = returnTo.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/'

  return trimmed
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

async function signSessionCookieValue(sessionToken: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sessionToken))
  return `${sessionToken}.${arrayBufferToBase64(signature)}`
}

export const Route = createFileRoute('/api/v1/auth/sso')({
  server: {
    handlers: {
      /**
       * POST /api/v1/auth/sso
       * Bootstrap a Quackback portal login from a trusted external auth source.
       */
      POST: async ({ request }: { request: Request }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          const body = await request.json()
          const parsed = ssoBootstrapSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const user = await identifyPortalUser({
            email: parsed.data.email,
            name: parsed.data.name,
            image: parsed.data.image,
            emailVerified: true,
            externalId: parsed.data.externalId,
          })

          const auth = await getAuth()
          const authContext = await auth.$context
          const session = await authContext.internalAdapter.createSession(user.userId)

          if (!session) {
            return badRequestResponse('Unable to create Quackback session')
          }

          const sessionCookieValue = await signSessionCookieValue(session.token, authContext.secret)
          const headers = new Headers()
          headers.set(
            'cookie',
            `${authContext.authCookies.sessionToken.name}=${sessionCookieValue}`
          )

          const { token } = await auth.api.generateOneTimeToken({ headers })

          const targetUrl = new URL(normalizeReturnTo(parsed.data.returnTo), config.baseUrl)
          targetUrl.searchParams.set('ott', token)

          return createdResponse({
            redirectUrl: targetUrl.toString(),
            principalId: user.principalId,
            userId: user.userId,
            created: user.created,
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
