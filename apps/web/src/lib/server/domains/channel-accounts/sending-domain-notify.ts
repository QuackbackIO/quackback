/**
 * Telling the people who manage email channels when a sending domain changes
 * what customers receive: it went live, or it stopped verifying and replies
 * fell back to the default address.
 *
 * Recipients are every teammate holding `channel_account.manage`, the same
 * permission the settings page is gated on. The bell respects each person's
 * in-app preference for the type; the attention email respects their email
 * preference. Both are best effort: a failure here is logged and never undoes
 * the status change it reports.
 */
import type { PrincipalId, UserId } from '@quackback/ids'
import type { SendingDomainAttentionProblem } from '@quackback/email'
import {
  db,
  and,
  eq,
  inArray,
  isNull,
  channelAccounts,
  principal,
  type EmailSendingDomain,
  type SendingDomainDnsRecord,
} from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import { createNotificationsBatch } from '@/lib/server/domains/notifications/notification.service'
import type { NotificationType } from '@/lib/server/domains/notifications/notification.types'
import { batchGetNotificationPreferences } from '@/lib/server/domains/subscriptions/subscription.service'
import { shouldNotify } from '@/lib/server/domains/subscriptions/notification-matrix'
import { recordName } from './record-check'
import { isKeyRecord } from './dkim-key'

const log = logger.child({ component: 'sending-domain-notify' })

interface Manager {
  principalId: PrincipalId
  userId: UserId | null
}

/** Every teammate who may manage email channels, and so is told about their domains. */
export async function sendingDomainManagers(): Promise<Manager[]> {
  const people = await db
    .select({ id: principal.id, role: principal.role, userId: principal.userId })
    .from(principal)
    .where(and(eq(principal.type, 'user'), inArray(principal.role, ['admin', 'member'])))
  const managers: Manager[] = []
  for (const person of people) {
    const held = await permissionsForPrincipal(person.id, person.role as 'admin' | 'member')
    if (held.has(PERMISSIONS.CHANNEL_ACCOUNT_MANAGE)) {
      managers.push({ principalId: person.id, userId: person.userId as UserId | null })
    }
  }
  return managers
}

/** The first record whose own check says it is wrong, in the order they are published. */
export function failingRecord(domain: EmailSendingDomain): SendingDomainAttentionProblem {
  const failing = (domain.dnsRecords ?? []).find(
    (r: SendingDomainDnsRecord) => r.check && r.check.state !== 'found'
  )
  // Every listed record looks right (or the key signing the mail is not one of
  // them), yet the domain stopped verifying: the signing key is what failed.
  if (!failing?.check || failing.check.state === 'found') return 'signing-key'
  // On a row whose identity already had a key, the row's own key TXT proves
  // ownership and signs nothing, so it is named as the ownership record.
  const purpose =
    domain.dkimMode === 'shared' && isKeyRecord(failing) ? 'ownership' : failing.purpose
  return {
    purpose,
    type: failing.type,
    name: recordName(domain.domain, failing.host),
    state: failing.check.state,
    ...(failing.check.seen ? { seen: failing.check.seen } : {}),
    ...(failing.check.reason === 'truncated' || failing.check.reason === 'quoted'
      ? { reason: failing.check.reason }
      : {}),
  }
}

/** A sending address on the domain, to name in the bell; the domain itself when there is none. */
async function addressOn(domain: EmailSendingDomain): Promise<string> {
  const rows = await db
    .select({ address: channelAccounts.address, sendingDomainId: channelAccounts.sendingDomainId })
    .from(channelAccounts)
    .where(and(eq(channelAccounts.role, 'sending'), isNull(channelAccounts.deletedAt)))
  const suffix = `@${domain.domain}`
  const match = rows.find(
    (r) => r.sendingDomainId === domain.id || r.address?.toLowerCase().endsWith(suffix)
  )
  return match?.address ?? domain.domain
}

/** Ring the bell for every manager whose in-app preference allows this type. */
export async function ringManagers(
  managers: Manager[],
  type: NotificationType,
  bell: { title: string; body?: string; metadata: Record<string, unknown> }
): Promise<void> {
  const prefs = await batchGetNotificationPreferences(managers.map((m) => m.principalId))
  const recipients = managers.filter((m) => {
    const p = prefs.get(m.principalId)
    return !p || shouldNotify(p, type, 'inApp')
  })
  await createNotificationsBatch(
    recipients.map((m) => ({ principalId: m.principalId, type, ...bell }))
  )
}

/** A domain went live: one bell per manager. */
export async function notifySendingDomainLive(domain: EmailSendingDomain): Promise<void> {
  try {
    const managers = await sendingDomainManagers()
    if (managers.length === 0) return
    await ringManagers(managers, 'sending_domain_live', {
      title: `${await addressOn(domain)} is live`,
      metadata: { sendingDomainId: domain.id, domain: domain.domain, audience: 'admin' },
    })
  } catch (err) {
    log.warn({ err, sending_domain_id: domain.id }, 'sending domain live notification failed')
  }
}

/**
 * A verified domain stopped verifying: a bell per manager, and an email naming
 * the record that failed, since this is the change customers notice.
 */
export async function notifySendingDomainNeedsAttention(domain: EmailSendingDomain): Promise<void> {
  try {
    const managers = await sendingDomainManagers()
    if (managers.length === 0) return
    const record = failingRecord(domain)
    const { sendingDomainProblem } = await import('@quackback/email')
    await ringManagers(managers, 'sending_domain_needs_attention', {
      title: `Sending from ${domain.domain} needs attention`,
      body: sendingDomainProblem(domain.domain, record),
      metadata: { sendingDomainId: domain.id, domain: domain.domain, audience: 'admin' },
    })
    await emailManagers(managers, domain, record)
  } catch (err) {
    log.warn({ err, sending_domain_id: domain.id }, 'sending domain attention notification failed')
  }
}

async function emailManagers(
  managers: Manager[],
  domain: EmailSendingDomain,
  record: SendingDomainAttentionProblem
): Promise<void> {
  const { sendSendingDomainAttentionEmail, isEmailConfigured } = await import('@quackback/email')
  if (!isEmailConfigured()) return
  const prefs = await batchGetNotificationPreferences(managers.map((m) => m.principalId))
  const { resolveAccountRecipient } = await import('@/lib/server/email/recipient')
  const { getWorkspaceSettings } = await import('@/lib/server/domains/settings/settings.service')
  const { getBaseUrl } = await import('@/lib/server/config')
  const workspace = await getWorkspaceSettings()
  const base = getBaseUrl().replace(/\/$/, '')
  for (const manager of managers) {
    const p = prefs.get(manager.principalId)
    if (p && !shouldNotify(p, 'sending_domain_needs_attention', 'email')) continue
    if (!manager.userId) continue
    const to = await resolveAccountRecipient(manager.userId)
    if (!to) continue
    try {
      await sendSendingDomainAttentionEmail({
        to,
        domain: domain.domain,
        record,
        settingsUrl: base ? `${base}/admin/settings/channels/email` : null,
        workspaceName: workspace?.settings?.name,
      })
    } catch (err) {
      log.warn(
        { err, sending_domain_id: domain.id, principal_id: manager.principalId },
        'sending domain attention email failed'
      )
    }
  }
}
