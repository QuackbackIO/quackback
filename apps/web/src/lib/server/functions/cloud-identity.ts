import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { db, settings } from '@/lib/server/db'
import { requireAuth } from './auth-helpers'
import { parseIdentityProjection } from '@/lib/server/domains/settings/cloud/identity-projection'
import { verifyIdentityProjectionToken } from '@/lib/server/domains/settings/cloud/identity-projection.signature'
import { writeIdentityProjection } from '@/lib/server/domains/settings/cloud/identity-projection.write'
import { mutateSetupStateAtomic } from '@/lib/server/setup-state'
import { friendlyPlatformLabel, platformLabelFromHostname } from '@/lib/shared/platform-label'

export { platformLabelFromHostname }

const cloudIdentityInputSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    platformLabel: z.string().trim().min(1).max(63).optional(),
  })
  .strict()
  .refine((input) => input.displayName !== undefined || input.platformLabel !== undefined, {
    message: 'At least one workspace detail is required',
  })

async function currentCloudIdentity() {
  const [row] = await db.select({ cloudIdentity: settings.cloudIdentity }).from(settings).limit(1)
  return parseIdentityProjection(row?.cloudIdentity)
}

export const getCloudIdentityFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
  return currentCloudIdentity()
})

export const markCloudWorkspaceDetailsSeenFn = createServerFn({ method: 'POST' }).handler(
  async () => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const identity = await currentCloudIdentity()
    if (!identity) throw new Error('Cloud workspace identity is not enabled')
    if (!friendlyPlatformLabel(identity.platformHostname)) {
      throw new Error('Choose a Workspace URL before continuing')
    }
    const { state } = await mutateSetupStateAtomic((current) => ({
      state: current.workspaceDetailsSeenAt
        ? current
        : { ...current, workspaceDetailsSeenAt: new Date().toISOString() },
      value: undefined,
    }))
    return { workspaceDetailsSeenAt: state.workspaceDetailsSeenAt! }
  }
)

const customDomainInputSchema = z
  .object({
    action: z.enum(['add', 'refresh', 'makePrimary', 'remove']),
    hostname: z.string().trim().min(1).max(253),
  })
  .strict()

export const getCloudCustomDomainsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN })
  const identity = await currentCloudIdentity()
  if (!identity) throw new Error('Cloud workspace identity is not enabled')
  const { fetchWorkspaceCustomDomains } = await import('@/lib/server/control-plane/client')
  return fetchWorkspaceCustomDomains()
})

export const hasCustomDomainEntitlementFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN })
  const { hasEntitlement } = await import('@/lib/server/domains/settings/cloud/entitlements')
  return hasEntitlement('customDomain')
})

export const mutateCloudCustomDomainFn = createServerFn({ method: 'POST' })
  .validator(customDomainInputSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN })
    const current = await currentCloudIdentity()
    if (!current) throw new Error('Cloud workspace identity is not enabled')
    const { requireEntitlement } = await import('@/lib/server/domains/settings/cloud/entitlements')
    if (data.action === 'add') await requireEntitlement('customDomain')

    const mightChangeOrigin = data.action === 'makePrimary' || data.action === 'remove'
    let transferToken: string | null = null
    if (mightChangeOrigin) {
      const { auth } = await import('@/lib/server/auth')
      const generated = await auth.api.generateOneTimeToken({ headers: getRequestHeaders() })
      transferToken = generated.token
      if (!transferToken) throw new Error('Could not prepare a secure session transfer')
    }

    const { requestWorkspaceIdentityMutation } = await import('@/lib/server/control-plane/client')
    const response = await requestWorkspaceIdentityMutation({ customDomain: data })
    const verified = await verifyIdentityProjectionToken(response.projectionToken)
    await writeIdentityProjection(verified.workspaceKey, verified.projection)

    const originChanged = verified.projection.canonicalOrigin !== current.canonicalOrigin
    if (originChanged && !transferToken) {
      throw new Error('Workspace URL changed concurrently. Reload and try again.')
    }
    return {
      projection: verified.projection,
      transferToken: originChanged ? transferToken : null,
    }
  })

export const updateCloudIdentityFn = createServerFn({ method: 'POST' })
  .validator(cloudIdentityInputSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const current = await currentCloudIdentity()
    if (!current) throw new Error('Cloud workspace identity is not enabled')

    const requestedLabel = data.platformLabel?.trim().toLowerCase()
    const mightChangeOrigin =
      requestedLabel !== undefined &&
      requestedLabel !==
        (current.platformHostname ? platformLabelFromHostname(current.platformHostname) : null)

    // Mint before the control plane changes routing: after a second friendly
    // rename, this request's host becomes redirect-only immediately.
    let transferToken: string | null = null
    if (mightChangeOrigin) {
      const { auth } = await import('@/lib/server/auth')
      const generated = await auth.api.generateOneTimeToken({ headers: getRequestHeaders() })
      transferToken = generated.token
      if (!transferToken) throw new Error('Could not prepare a secure session transfer')
    }

    const { requestWorkspaceIdentityMutation } = await import('@/lib/server/control-plane/client')
    const response = await requestWorkspaceIdentityMutation(data)
    const verified = await verifyIdentityProjectionToken(response.projectionToken)
    await writeIdentityProjection(verified.workspaceKey, verified.projection)

    const originChanged = verified.projection.canonicalOrigin !== current.canonicalOrigin
    if (originChanged && !transferToken) {
      // This can only happen if another writer moved the origin between our
      // read and mutation. Refuse to strand the browser without a session.
      throw new Error('Workspace URL changed concurrently. Reload and try again.')
    }
    return {
      projection: verified.projection,
      transferToken: originChanged ? transferToken : null,
    }
  })
