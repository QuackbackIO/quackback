import { createHmac, timingSafeEqual } from 'crypto'

const DEFAULT_WIDGET_TOKEN_TTL_SECONDS = 5 * 60

export interface WidgetIdentityTokenClaims {
  id?: string
  sub?: string
  email: string
  name?: string
  avatarURL?: string
  avatarUrl?: string
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString('base64url')
}

function signHS256JWT(payload: Record<string, unknown>, secret: string): string {
  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = encodeBase64Url(JSON.stringify(payload))
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${signature}`
}

export function createWidgetIdentityToken(
  claims: WidgetIdentityTokenClaims,
  secret: string,
  expiresInSeconds = DEFAULT_WIDGET_TOKEN_TTL_SECONDS
): string {
  const now = Math.floor(Date.now() / 1000)
  const subject = claims.sub ?? claims.id ?? claims.email

  return signHS256JWT(
    {
      sub: subject,
      id: claims.id ?? subject,
      email: claims.email,
      ...(claims.name ? { name: claims.name } : {}),
      ...(claims.avatarURL
        ? { avatarURL: claims.avatarURL }
        : claims.avatarUrl
          ? { avatarURL: claims.avatarUrl }
          : {}),
      iat: now,
      exp: now + expiresInSeconds,
    },
    secret
  )
}

export function verifyHS256JWT(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [headerB64, payloadB64, signatureB64] = parts

  try {
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString())
    if (header.alg !== 'HS256') return null
  } catch {
    return null
  }

  const expected = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url')

  const sigBuf = Buffer.from(signatureB64, 'base64url')
  const expBuf = Buffer.from(expected, 'base64url')
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
    if (payload.exp && typeof payload.exp === 'number') {
      if (Math.floor(Date.now() / 1000) > payload.exp) return null
    }
    return payload
  } catch {
    return null
  }
}
