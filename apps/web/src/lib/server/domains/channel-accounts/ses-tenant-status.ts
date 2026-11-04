/**
 * Recording the tenant's sending status, and telling the workspace's email
 * managers once when the provider pauses it.
 *
 * Two writers: the reconcile job, which reads the status from the provider,
 * and the send path, when the provider refuses a send because the tenant is
 * paused. Either can be first to see a pause, so the bell is claimed with a
 * conditional write and rings for whichever wins. It re-arms when a later read
 * says the tenant sends again, so the next pause rings again.
 *
 * Best effort throughout: a failure here is logged and never fails the send or
 * the job that reported the status.
 */
import { and, db, eq, isNull, emailSesTenants } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import {
  ensureSesTenantState,
  getSesTenantState,
  isPausedStatus,
  sesTenantName,
} from './ses-tenant-state'
import { ringManagers, sendingDomainManagers } from './sending-domain-notify'

const log = logger.child({ component: 'ses-tenant-status' })

/** Longest provider cause shown on the settings page; longer ones are left off. */
export const SHORT_CAUSE_CHARS = 160

/** Store what the provider says about the tenant, and ring or re-arm the bell. */
export async function recordSesTenantStatus(
  tenantName: string,
  status: { status: string | null; cause: string | null },
  now: Date = new Date()
): Promise<void> {
  await ensureSesTenantState(tenantName)
  const paused = isPausedStatus(status.status)
  await db
    .update(emailSesTenants)
    .set({
      sendingStatus: status.status,
      statusCause: paused ? status.cause : null,
      statusCheckedAt: now,
      // Sending again: the next pause is a new one and rings again.
      ...(paused ? {} : { pausedNotifiedAt: null }),
      updatedAt: now,
    })
    .where(eq(emailSesTenants.tenantName, tenantName))
  if (paused) await notifyPausedOnce(tenantName, status.cause, now)
}

/**
 * The send path's report: the provider refused a send because the tenant is
 * paused. Never throws.
 */
export async function recordSesTenantPaused(tenantName: string, detail: string): Promise<void> {
  try {
    await recordSesTenantStatus(tenantName, { status: 'DISABLED', cause: detail || null })
  } catch (err) {
    log.warn({ err, tenant: tenantName }, 'recording a paused ses tenant failed')
  }
}

async function notifyPausedOnce(
  tenantName: string,
  cause: string | null,
  now: Date
): Promise<void> {
  const [won] = await db
    .update(emailSesTenants)
    .set({ pausedNotifiedAt: now })
    .where(and(eq(emailSesTenants.tenantName, tenantName), isNull(emailSesTenants.pausedNotifiedAt)))
    .returning({ tenantName: emailSesTenants.tenantName })
  if (!won) return
  log.warn({ tenant: tenantName, cause }, 'ses tenant paused; managers notified')
  try {
    const managers = await sendingDomainManagers()
    if (managers.length === 0) return
    const shortCause = cause && cause.length <= SHORT_CAUSE_CHARS ? cause : null
    await ringManagers(managers, 'sending_domain_needs_attention', {
      title: 'Email sending is paused',
      body:
        'The email provider paused sending because of bounces or complaints.' +
        (shortCause ? ` ${shortCause}` : ''),
      metadata: { reason: 'sending_paused', audience: 'admin' },
    })
  } catch (err) {
    log.warn({ err, tenant: tenantName }, 'ses tenant paused notification failed')
  }
}

/**
 * What the email settings say about a pause: null while the workspace sends,
 * or the provider's cause (only when short enough to read in one line).
 */
export async function sesTenantPausedNotice(): Promise<{ cause: string | null } | null> {
  const name = sesTenantName()
  if (!name) return null
  const state = await getSesTenantState(name)
  if (!state || !isPausedStatus(state.sendingStatus)) return null
  const cause = state.statusCause?.trim() || null
  return { cause: cause && cause.length <= SHORT_CAUSE_CHARS ? cause : null }
}
