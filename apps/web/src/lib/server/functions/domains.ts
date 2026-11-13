/**
 * Domains added by name on Settings > Domains.
 *
 * Only `settings.manage` adds, checks or removes a domain. Every holder of a
 * Domains page permission reads them, so the page shows each viewer the
 * domain's ownership whichever of its uses they manage.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { DOMAINS_PAGE_PERMISSIONS } from '@/lib/shared/domains-permissions'
import { shownProofSource, type ShownProofSource } from '@/lib/shared/domain-proof'
import { assertAnyPermission, requireAuth } from './auth-helpers'
import type {
  AddedDomainSummary,
  DomainDetail,
} from '@/lib/server/domains/domain-proof/domains-overview'

export type { AddedDomainSummary, DomainDetail }

export type DomainOwnershipResult =
  | { ok: true; via: 'dns' | ShownProofSource }
  | { ok: false; reason: 'no-record' | 'lookup-failed' | 'mismatch' }

const nameInput = z.object({ name: z.string().max(253) })

/** Add a domain by its name. Idempotent: an added name returns as it was. */
export const addDomainFn = createServerFn({ method: 'POST' })
  .validator(nameInput)
  .handler(async ({ data }): Promise<{ name: string }> => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { addDomain } = await import('@/lib/server/domains/domain-proof/domains.service')
    const row = await addDomain(data.name)
    return { name: row.name }
  })

/** Look for an added domain's ownership record now. */
export const checkDomainOwnershipFn = createServerFn({ method: 'POST' })
  .validator(nameInput)
  .handler(async ({ data }): Promise<DomainOwnershipResult> => {
    const auth = await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { checkDomainOwnership } =
      await import('@/lib/server/domains/domain-proof/domains.service')
    const result = await checkDomainOwnership(data.name)
    if (!result.ok || result.via === 'dns') return result
    return { ok: true, via: shownProofSource(result.via, auth.permissions) }
  })

/** Remove an added domain. Refused while any use still holds its name. */
export const removeDomainFn = createServerFn({ method: 'POST' })
  .validator(nameInput)
  .handler(async ({ data }): Promise<{ name: string }> => {
    await requireAuth({ permission: PERMISSIONS.SETTINGS_MANAGE })
    const { removeDomain } = await import('@/lib/server/domains/domain-proof/domains.service')
    await removeDomain(data.name)
    return { name: data.name }
  })

/** One domain as its own page shows it. */
export const getDomainFn = createServerFn({ method: 'GET' })
  .validator(nameInput)
  .handler(async ({ data }): Promise<DomainDetail> => {
    const auth = await requireAuth()
    assertAnyPermission(auth, DOMAINS_PAGE_PERMISSIONS)
    const { getDomainDetail } = await import('@/lib/server/domains/domain-proof/domains-overview')
    return getDomainDetail(data.name, auth.permissions)
  })

/** The domains added by name, for the Domains list. */
export const listDomainsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AddedDomainSummary[]> => {
    assertAnyPermission(await requireAuth(), DOMAINS_PAGE_PERMISSIONS)
    const { listAddedDomainSummaries } =
      await import('@/lib/server/domains/domain-proof/domains-overview')
    return listAddedDomainSummaries()
  }
)
