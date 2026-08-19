/**
 * The assistant's workspace identity (Quinn).
 *
 * Quinn is a single workspace-scoped service principal (`principalType='service'`,
 * userId null) that authors its replies as ordinary conversation messages, so
 * attribution, CSAT-by-last-handler, and webhooks fall out for free. The display
 * identity (name/avatar) lives in messenger settings and is layered on at render
 * time; this row only needs a stable service identity.
 *
 * Find-or-create keys off a `serviceMetadata` discriminator, mirroring how API
 * keys locate their service principal. There is exactly one per workspace.
 */
import { db, principal, and, eq, sql, type Principal } from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import { createServicePrincipal } from '@/lib/server/domains/principals/principal.service'

/** Default display name; the messenger settings identity overrides it in the UI. */
export const ASSISTANT_DEFAULT_NAME = 'Quinn'

// The service-metadata discriminator. Reuses the existing `integration` kind
// (the metadata union is closed) with an `assistant`-only integration type, so
// the find-or-create lookup is unambiguous and needs no schema change.
const ASSISTANT_SERVICE_KIND = 'integration'
const ASSISTANT_INTEGRATION_TYPE = 'assistant'

/** The assistant's service principal, or null when it has not been provisioned. */
export async function getAssistantPrincipal(exec: Executor = db): Promise<Principal | null> {
  const [row] = await exec
    .select()
    .from(principal)
    .where(
      and(
        eq(principal.type, 'service'),
        sql`${principal.serviceMetadata}->>'kind' = ${ASSISTANT_SERVICE_KIND}`,
        sql`${principal.serviceMetadata}->>'integrationType' = ${ASSISTANT_INTEGRATION_TYPE}`
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * Find-or-create the assistant's service principal.
 *
 * Read-first; provisioned lazily once per workspace (single writer in practice,
 * so a duplicate is harmless — `getAssistantPrincipal` returns the first).
 * Role `member`: Quinn operates as a team actor and, per RBAC, service principals
 * resolve permissions workspace-wide.
 */
export async function ensureAssistantPrincipal(exec: Executor = db): Promise<Principal> {
  const existing = await getAssistantPrincipal(exec)
  if (existing) return existing

  let identity = { name: ASSISTANT_DEFAULT_NAME, avatarUrl: null as string | null }
  try {
    const { getAssistantConfig } = await import('@/lib/server/domains/settings/settings.assistant')
    const current = await getAssistantConfig()
    identity = current.config.identity
  } catch {
    // Provisioning must still work before workspace settings are available.
  }

  const created = await createServicePrincipal(
    {
      role: 'member',
      displayName: identity.name,
      serviceMetadata: {
        kind: ASSISTANT_SERVICE_KIND,
        integrationType: ASSISTANT_INTEGRATION_TYPE,
      },
    },
    exec
  )
  if (!identity.avatarUrl) return created
  const [withAvatar] = await exec
    .update(principal)
    .set({ avatarUrl: identity.avatarUrl })
    .where(eq(principal.id, created.id))
    .returning()
  return withAvatar ?? created
}
