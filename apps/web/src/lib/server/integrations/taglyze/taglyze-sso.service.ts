import { createHmac } from 'node:crypto'
import { generateId, type UserId } from '@quackback/ids'
import { auth } from '@/lib/server/auth/index'
import { db, user as userTable, eq } from '@/lib/server/db'
import {
  getTaglyzeDisplayName,
  normalizeTaglyzeEmail,
  verifyTaglyzeJwt,
  type TaglyzeJwtUserPayload,
} from './taglyze-jwt'

export interface TaglyzeSsoResult {
  response: Response
  createdUser: boolean
  email: string
  taglyzeUserId: string
}

export interface TaglyzeSsoOptions {
  token: string
  redirectTo: string
}

function getProvisioningPassword(payload: TaglyzeJwtUserPayload): string {
  const secret = process.env.TAGLYZE_JWT_SECRET
  if (!secret) {
    throw new Error('TAGLYZE_JWT_SECRET_MISSING')
  }

  const digest = createHmac('sha256', secret)
    .update(`taglyze-sso:${payload.sub}:${normalizeTaglyzeEmail(payload.email)}`)
    .digest('hex')

  return `Taglyze-${digest.slice(0, 64)}`
}

function copySetCookieHeaders(from: Response, to: Response): void {
  const headers = from.headers as Headers & { getSetCookie?: () => string[] }
  const cookies = headers.getSetCookie?.()

  if (cookies?.length) {
    for (const cookie of cookies) {
      to.headers.append('set-cookie', cookie)
    }
    return
  }

  const cookie = from.headers.get('set-cookie')
  if (cookie) {
    to.headers.append('set-cookie', cookie)
  }
}

async function findUserByEmail(email: string): Promise<{ id: UserId; email: string } | null> {
  const existingUser = await db.query.user.findFirst({
    where: eq(userTable.email, email),
    columns: { id: true, email: true },
  })

  if (!existingUser) return null

  return {
    id: existingUser.id as UserId,
    email: existingUser.email,
  }
}

async function ensureTaglyzeUser(payload: TaglyzeJwtUserPayload): Promise<{
  createdUser: boolean
  email: string
}> {
  const email = normalizeTaglyzeEmail(payload.email)
  const existingUser = await findUserByEmail(email)

  if (existingUser) {
    return { createdUser: false, email }
  }

  const password = getProvisioningPassword(payload)
  const name = getTaglyzeDisplayName(payload)

  await auth.api.signUpEmail({
    body: {
      email,
      name,
      password,
    },
  })

  return { createdUser: true, email }
}

function buildRedirectResponse(redirectTo: string, signInResponse: Response): Response {
  const response = Response.redirect(redirectTo, 302)
  copySetCookieHeaders(signInResponse, response)
  return response
}

export async function signInWithTaglyzeJwt({
  token,
  redirectTo,
}: TaglyzeSsoOptions): Promise<TaglyzeSsoResult> {
  const payload = await verifyTaglyzeJwt(token)
  const { createdUser, email } = await ensureTaglyzeUser(payload)
  const password = getProvisioningPassword(payload)

  const signInResponse = await auth.api.signInEmail({
    body: {
      email,
      password,
    },
    asResponse: true,
  })

  if (!signInResponse.ok) {
    throw new Error('TAGLYZE_SSO_SIGN_IN_FAILED')
  }

  return {
    response: buildRedirectResponse(redirectTo, signInResponse),
    createdUser,
    email,
    taglyzeUserId: payload.sub,
  }
}
