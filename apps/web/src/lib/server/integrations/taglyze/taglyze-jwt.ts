import { jwtVerify, type JWTPayload } from 'jose'

export interface TaglyzeJwtUserPayload extends JWTPayload {
  sub: string
  email: string
  name?: string
  picture?: string
  avatar_url?: string
  workspace_id?: string
}

export interface TaglyzeJwtConfig {
  enabled: boolean
  secret: string
  issuer: string
  audience: string
}

export function getTaglyzeJwtConfig(): TaglyzeJwtConfig {
  return {
    enabled: process.env.TAGLYZE_SSO_ENABLED === 'true',
    secret: process.env.TAGLYZE_JWT_SECRET ?? '',
    issuer: process.env.TAGLYZE_JWT_ISSUER ?? 'taglyze',
    audience: process.env.TAGLYZE_JWT_AUDIENCE ?? 'quackback',
  }
}

export function normalizeTaglyzeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function getTaglyzeDisplayName(payload: TaglyzeJwtUserPayload): string {
  return payload.name?.trim() || normalizeTaglyzeEmail(payload.email)
}

export function getTaglyzeAvatarUrl(payload: TaglyzeJwtUserPayload): string | null {
  return payload.picture ?? payload.avatar_url ?? null
}

export async function verifyTaglyzeJwt(token: string): Promise<TaglyzeJwtUserPayload> {
  const config = getTaglyzeJwtConfig()

  if (!config.enabled) {
    throw new Error('TAGLYZE_SSO_DISABLED')
  }

  if (!config.secret) {
    throw new Error('TAGLYZE_JWT_SECRET_MISSING')
  }

  const secret = new TextEncoder().encode(config.secret)
  const { payload } = await jwtVerify(token, secret, {
    issuer: config.issuer,
    audience: config.audience,
  })

  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('TAGLYZE_JWT_SUB_MISSING')
  }

  if (!payload.email || typeof payload.email !== 'string') {
    throw new Error('TAGLYZE_JWT_EMAIL_MISSING')
  }

  return payload as TaglyzeJwtUserPayload
}
