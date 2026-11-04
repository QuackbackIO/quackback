/**
 * This workspace's mail provider tenant, as stored: the name, whether it is
 * ready to send under, and its last known sending status.
 *
 * The tenant name is the workspace's own label (`ws-` and 24 hex characters,
 * see `return-path.ts`), never anything a customer chose. A process with no
 * workspace scope has no label and so sends untenanted.
 *
 * The send-path rule lives here ({@link tenantForSend}): a message goes under
 * the tenant only when tenants are on, the tenant is ready, the configuration
 * set the send uses is the one associated, and the From domain is one whose
 * identity is associated. The provider refuses a tenanted send that misses any
 * of those, so a send that cannot meet them goes untenanted, as it would with
 * tenants off. Auth mail never reaches this rule (see `tenant-hooks.ts` in
 * @quackback/email).
 */
import { addressDomain } from '@quackback/email/ses'
import { sesTenantsEnabled, type SesSendingStatus } from '@quackback/email/ses-tenant'
import { db, eq, emailSesTenants, type EmailSesTenant } from '@/lib/server/db'
import { currentWorkspaceLabel } from './return-path'

type EnvLike = Record<string, string | undefined>

/** This workspace's tenant name, or null when tenants are off or no workspace is in scope. */
export function sesTenantName(env: EnvLike = process.env): string | null {
  if (!sesTenantsEnabled(env)) return null
  return currentWorkspaceLabel(env)
}

export async function getSesTenantState(tenantName: string): Promise<EmailSesTenant | null> {
  const [row] = await db
    .select()
    .from(emailSesTenants)
    .where(eq(emailSesTenants.tenantName, tenantName))
    .limit(1)
  return row ?? null
}

/** The row for this tenant, created empty when it is the first time it is seen. */
export async function ensureSesTenantState(tenantName: string): Promise<EmailSesTenant> {
  await db.insert(emailSesTenants).values({ tenantName }).onConflictDoNothing()
  const row = await getSesTenantState(tenantName)
  if (!row) throw new Error('ses tenant state row missing after insert')
  return row
}

/**
 * The tenant a send goes under, or null to send untenanted. Never sends under
 * a tenant the provider would refuse for a missing association.
 */
export async function tenantForSend(
  ctx: { from: string },
  env: EnvLike = process.env
): Promise<string | null> {
  const name = sesTenantName(env)
  if (!name) return null
  const configurationSet = env.EMAIL_SES_CONFIGURATION_SET?.trim()
  if (!configurationSet) return null
  const state = await getSesTenantState(name)
  if (!state?.readyAt || state.configurationSet !== configurationSet) return null
  const domain = addressDomain(ctx.from)?.toLowerCase()
  if (!domain || !state.fromDomains.includes(domain)) return null
  return name
}

/** Whether a stored status means the tenant cannot send. */
export function isPausedStatus(status: string | null | undefined): boolean {
  return (status as SesSendingStatus | null | undefined) === 'DISABLED'
}
