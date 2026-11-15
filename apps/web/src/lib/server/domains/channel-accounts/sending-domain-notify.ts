/**
 * Telling the people who manage email settings when a sending domain changes
 * what customers receive: it went live, or it stopped verifying and replies
 * fell back to the default address.
 *
 * Recipients are every teammate holding `channel_account.manage`, the same
 * permission the settings page is gated on. The bell respects each person's
 * in-app preference for the type; the attention email respects their email
 * preference. A failure here is logged and never undoes the status change it
 * reports; the ownership warning also says whether it was delivered, so its
 * caller can try again.
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
import { EMAIL_SENDING_PERMISSION } from '@/lib/shared/email-sending-permissions'
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

/** Every teammate who may manage how the workspace sends email, and so is told about its domains. */
export async function sendingDomainManagers(): Promise<Manager[]> {
  const people = await db
    .select({ id: principal.id, role: principal.role, userId: principal.userId })
    .from(principal)
    .where(and(eq(principal.type, 'user'), inArray(principal.role, ['admin', 'member'])))
  const managers: Manager[] = []
  for (const person of people) {
    const held = await permissionsForPrincipal(person.id, person.role as 'admin' | 'member')
    if (held.has(EMAIL_SENDING_PERMISSION)) {
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
      title: `${await addressOn(domain)} is ready to send`,
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

/**
 * The record that proves this row's ownership, as the warning names it: the
 * ownership TXT, or on a row with a key of its own, that key's TXT. Carries the
 * value, since the warning asks for the record to be added back.
 */
export function ownershipProblem(domain: EmailSendingDomain): SendingDomainAttentionProblem {
  const records = domain.dnsRecords ?? []
  const proof =
    records.find((r) => r.purpose === 'ownership') ??
    (domain.dkimMode === 'easy' ? undefined : records.find(isKeyRecord))
  if (!proof) return 'signing-key'
  const state = proof.check?.state
  return {
    purpose: 'ownership',
    type: proof.type,
    name: recordName(domain.domain, proof.host),
    state: state === 'mismatch' || state === 'proxied' ? state : 'missing',
    ...(proof.check?.seen ? { seen: proof.check.seen } : {}),
    value: proof.value,
  }
}

/** A date as the warning gives it, in UTC so every reader sees the same day. */
export function formatDeadline(at: Date): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(at)
}

/**
 * A verified domain's ownership record went missing: a bell per manager and an
 * email naming the record and the date it has to be back by. The domain keeps
 * sending as itself until then. Resolves true once the bell rang and at least
 * one email went out (or none was due), so one recipient whose address keeps
 * failing does not have every manager warned again on each check; false when
 * the bell failed or every email did.
 */
export async function notifySendingDomainOwnershipMissing(
  domain: EmailSendingDomain,
  deadline: Date
): Promise<boolean> {
  try {
    const managers = await sendingDomainManagers()
    if (managers.length === 0) return true
    const record = ownershipProblem(domain)
    const by = formatDeadline(deadline)
    const { sendingDomainProblem, sendingDomainDeadline } = await import('@quackback/email')
    await ringManagers(managers, 'sending_domain_needs_attention', {
      title: `Sending from ${domain.domain} needs attention`,
      body: `${sendingDomainProblem(domain.domain, record)} ${sendingDomainDeadline(domain.domain, by)}`,
      metadata: { sendingDomainId: domain.id, domain: domain.domain, audience: 'admin' },
    })
    return await emailManagers(managers, domain, record, by)
  } catch (err) {
    log.warn(
      { err, sending_domain_id: domain.id },
      'sending domain ownership warning notification failed'
    )
    return false
  }
}

/**
 * Email every manager whose preference allows it. False only when emails were
 * due and every one failed; a recipient whose send failed is logged at warn.
 */
async function emailManagers(
  managers: Manager[],
  domain: EmailSendingDomain,
  record: SendingDomainAttentionProblem,
  deadline?: string
): Promise<boolean> {
  const { sendSendingDomainAttentionEmail, isEmailConfigured } = await import('@quackback/email')
  if (!isEmailConfigured()) return true
  const prefs = await batchGetNotificationPreferences(managers.map((m) => m.principalId))
  const { resolveAccountRecipient } = await import('@/lib/server/email/recipient')
  const { getWorkspaceSettings } = await import('@/lib/server/domains/settings/settings.service')
  const { getBaseUrl } = await import('@/lib/server/config')
  const workspace = await getWorkspaceSettings()
  const base = getBaseUrl().replace(/\/$/, '')
  let due = 0
  let sent = 0
  for (const manager of managers) {
    const p = prefs.get(manager.principalId)
    if (p && !shouldNotify(p, 'sending_domain_needs_attention', 'email')) continue
    if (!manager.userId) continue
    const to = await resolveAccountRecipient(manager.userId)
    if (!to) continue
    due += 1
    try {
      await sendSendingDomainAttentionEmail({
        to,
        domain: domain.domain,
        record,
        deadline,
        settingsUrl: base ? `${base}/admin/settings/email` : null,
        workspaceName: workspace?.settings?.name,
      })
      sent += 1
    } catch (err) {
      log.warn(
        { err, sending_domain_id: domain.id, principal_id: manager.principalId },
        'sending domain attention email failed'
      )
    }
  }
  return due === 0 || sent > 0
}
