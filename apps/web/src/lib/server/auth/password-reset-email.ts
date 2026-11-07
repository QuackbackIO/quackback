import type { UserId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'auth-config' })

/**
 * The reset-link email, for Better Auth's `sendResetPassword` callback.
 *
 * Account mail: it always leaves from the platform address, so it still arrives
 * when the workspace's own sending domain is broken, and the workspace name is
 * passed so that address goes out under the workspace's name.
 */
export async function sendPasswordResetLink(user: { id: string }, url: string): Promise<void> {
  const { sendPasswordResetEmail, isEmailConfigured } = await import('@quackback/email')
  if (!isEmailConfigured()) {
    log.warn(
      { user_id: user.id },
      'password reset requested but email is not configured; link not delivered'
    )
    return
  }
  // Account class: the reset link is a capability over THIS account, so
  // the recipient is looked up by id and can never be a contact address
  // somebody else supplied.
  const { resolveAccountRecipient } = await import('@/lib/server/email/recipient')
  const to = await resolveAccountRecipient(user.id as UserId)
  if (!to) {
    log.warn(
      { user_id: user.id },
      'password reset requested but the account has no deliverable address'
    )
    return
  }
  const { getEmailSafeUrl } = await import('@/lib/server/storage/s3')
  const { db } = await import('@/lib/server/db')
  const settings = await db.query.settings.findFirst({ columns: { name: true, logoKey: true } })
  const logoUrl = getEmailSafeUrl(settings?.logoKey) ?? undefined
  await sendPasswordResetEmail({
    to,
    resetLink: url,
    logoUrl,
    workspaceName: settings?.name ?? undefined,
  })
}
