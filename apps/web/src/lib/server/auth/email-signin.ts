import { getAuth, getOTP } from './index'
import { mintMagicLinkUrl } from './magic-link-mint'
import { config } from '@/lib/server/config'

/**
 * Sends a passwordless sign-in email containing both a magic-link button
 * and a 6-digit code. Either path consumes a verification record on the
 * server, so the user picks whichever fits their context (desktop click,
 * cross-device code entry, link-eaten-by-Outlook fallback).
 */
export async function requestEmailSignin(opts: {
  email: string
  /** Path the user lands on after a successful magic-link click. */
  callbackURL: string
}): Promise<void> {
  const auth = await getAuth()
  const headers = new Headers({
    Origin: config.baseUrl,
    Host: new URL(config.baseUrl).host,
  })

  const { db } = await import('@/lib/server/db')
  const { isEmailConfigured, sendMagicLinkEmail } = await import('@quackback/email')
  const { getEmailSafeUrl } = await import('@/lib/server/storage/s3')

  // Failed verifies (token consumed by an email scanner, expired, etc.)
  // need to land on the right login page. Admin callbacks (`/admin/...`)
  // bounce to /admin/login — that page is configured for team auth and
  // can immediately request a replacement link. Portal callbacks fall
  // back to /auth/login (the public signup/login screen).
  const errorCallbackPath = opts.callbackURL.startsWith('/admin') ? '/admin/login' : '/auth/login'

  const [signInUrl, , settings] = await Promise.all([
    mintMagicLinkUrl({
      email: opts.email,
      callbackPath: opts.callbackURL,
      errorCallbackPath,
      portalUrl: config.baseUrl,
    }),
    auth.api.sendVerificationOTP({
      body: { email: opts.email, type: 'sign-in' },
      headers,
    }),
    db.query.settings.findFirst({ columns: { logoKey: true } }),
  ])

  const otp = getOTP(opts.email)
  if (!otp) throw new Error('OTP was not captured')

  if (!isEmailConfigured()) {
    console.warn(
      `[auth] Sign-in email requested for ${opts.email} but email is not configured. Email will not be delivered.`
    )
    return
  }

  await sendMagicLinkEmail({
    to: opts.email,
    signInUrl,
    code: otp,
    logoUrl: getEmailSafeUrl(settings?.logoKey) ?? undefined,
  })
}
