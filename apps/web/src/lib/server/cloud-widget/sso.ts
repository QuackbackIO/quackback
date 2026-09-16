import { SignJWT } from 'jose'
import { realEmail } from '@/lib/shared/anonymous-email'

const SECRET_ENV = 'WIDGET_SIGNING_SECRET'

export function cloudWidgetSigningSecret(): string | undefined {
  return process.env[SECRET_ENV] || undefined
}

/** Host-app signing secret for the Cloud dogfood widget. Never log this. */
export async function mintCloudWidgetSsoToken(user: {
  id: string
  email: string
  name?: string | null
}): Promise<string | null> {
  const secret = cloudWidgetSigningSecret()
  if (!secret) return null
  const email = realEmail(user.email)
  if (!user.id || !email) return null

  return new SignJWT({
    sub: String(user.id),
    email,
    ...(user.name ? { name: user.name } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret))
}
