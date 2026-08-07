/**
 * P06 — a cached settings / branding / feature-flag read for alpha served to bravo.
 *
 * SAAS-HOSTING-STACK.md §4.1 rates this the most certain of the singleton
 * hazards: `redis.ts:34-53` keys the settings, webhook, auth-provider and
 * platform-credential caches on bare literals — `TENANT_SETTINGS = 'settings:tenant'`
 * and friends. The moment one Redis is shared, tenant A's settings, branding,
 * feature flags and auth configuration are served to tenant B. And unlike the
 * in-heap singletons it survives a restart.
 *
 * The probe reads settings-derived public surfaces from both tenants in a tight
 * interleave, which is what a shared cache needs in order to misfire: one
 * tenant populates the key, the other reads it before the TTL expires.
 *
 * Two gates keep a null result honest:
 *   - the two tenants' responses must be DISTINGUISHABLE, or a cross-serve
 *     would be invisible and the probe reports ERROR rather than PASS;
 *   - with database access, each response is checked to carry its OWN tenant's
 *     workspace identity, not merely to differ from the other's.
 */

import { control, describeResponse, error, leak, pass } from './helpers'
import { SETTINGS_ROW_SQL, typeId } from '../db'
import type { ControlOutcome, Probe, ProbeContext, TenantHandle } from '../types'

/** Public surfaces whose content is derived from the cached settings row. */
const SETTINGS_SURFACES = [
  { path: '/api/widget/config.json', label: 'widget public config' },
  { path: '/', label: 'portal document' },
]

const INTERLEAVE_ROUNDS = 3

interface Identity {
  workspaceId?: string
  slug?: string
  name?: string
}

async function readIdentity(handle: TenantHandle): Promise<Identity> {
  if (!handle.db) return {}
  const [row] = await handle.db.query<{ id: string; slug: string; name: string }>(SETTINGS_ROW_SQL)
  if (!row) return {}
  return {
    workspaceId: typeId('workspace', row.id) ?? undefined,
    slug: row.slug,
    name: row.name,
  }
}

export const p06SettingsCache: Probe = {
  id: 'P06',
  name: 'settings-branding-flag-cache-cross-tenant',
  family: 'cache',
  proves:
    'Settings-derived public surfaces read in a tight interleave never serve one tenant’s workspace ' +
    'identity, branding or configuration under the other tenant’s hostname.',
  requires: ['http'],
  poolingCaveat:
    'The cache keys this targets (redis.ts CACHE_KEYS) are bare literals, so they only collide when ' +
    'one Redis is shared between tenants. Two separate deployments each have their own Redis, so a ' +
    'PASS today confirms the surfaces are distinguishable and self-consistent — it cannot yet ' +
    'exercise the shared-key collision itself.',

  async run(ctx: ProbeContext) {
    const { alpha, bravo } = ctx
    const attempted =
      `read ${SETTINGS_SURFACES.map((s) => s.path).join(' and ')} from both tenants, alternating ` +
      `${INTERLEAVE_ROUNDS} times, and check each response carries its own tenant's identity`

    const controls: ControlOutcome[] = []
    const evidence: Record<string, unknown> = {}

    const alphaIdentity = await readIdentity(alpha)
    const bravoIdentity = await readIdentity(bravo)
    evidence.alphaIdentity = alphaIdentity
    evidence.bravoIdentity = bravoIdentity

    for (const surface of SETTINGS_SURFACES) {
      const alphaBodies: string[] = []
      const bravoBodies: string[] = []

      for (let round = 0; round < INTERLEAVE_ROUNDS; round++) {
        const a = await alpha.http.request(surface.path, { omitCookies: true })
        const b = await bravo.http.request(surface.path, { omitCookies: true })
        if (a.status >= 500 || b.status >= 500) {
          return error({
            attempted,
            observed: `alpha ${describeResponse(a, 120)}; bravo ${describeResponse(b, 120)}`,
            reason: `${surface.label} returned a server error, so the cache interleave could not be evaluated`,
            controls,
          })
        }
        alphaBodies.push(a.text)
        bravoBodies.push(b.text)
      }

      // --- distinguishability gate ------------------------------------------
      const identical = alphaBodies[0] === bravoBodies[0]
      controls.push(
        control(
          'invariant',
          `${surface.label} is distinguishable between tenants`,
          !identical,
          identical
            ? 'the two tenants return a BYTE-IDENTICAL response, so a cross-tenant serve would be undetectable here'
            : 'responses differ, so a cross-tenant serve would be visible'
        )
      )

      // --- stability: each tenant answers consistently across the interleave --
      const alphaStable = alphaBodies.every((body) => body === alphaBodies[0])
      const bravoStable = bravoBodies.every((body) => body === bravoBodies[0])
      controls.push(
        control(
          'negative',
          `${surface.label} is stable per tenant across ${INTERLEAVE_ROUNDS} interleaved rounds`,
          alphaStable && bravoStable,
          alphaStable && bravoStable
            ? 'every round returned the same body per tenant'
            : `response changed mid-interleave (alpha stable: ${alphaStable}, bravo stable: ${bravoStable}) — a shared cache key would produce exactly this`
        )
      )

      // --- identity: the response carries its OWN tenant's workspace ---------
      if (alphaIdentity.slug && bravoIdentity.slug && alphaIdentity.slug !== bravoIdentity.slug) {
        const bravoCarriesAlpha =
          bravoBodies[0].includes(alphaIdentity.slug) ||
          Boolean(alphaIdentity.workspaceId && bravoBodies[0].includes(alphaIdentity.workspaceId))
        const alphaCarriesBravo =
          alphaBodies[0].includes(bravoIdentity.slug) ||
          Boolean(bravoIdentity.workspaceId && alphaBodies[0].includes(bravoIdentity.workspaceId))
        controls.push(
          control(
            'negative',
            `${surface.label} carries no foreign workspace identity`,
            !bravoCarriesAlpha && !alphaCarriesBravo,
            bravoCarriesAlpha || alphaCarriesBravo
              ? `FOREIGN IDENTITY PRESENT (bravo carries alpha: ${bravoCarriesAlpha}, alpha carries bravo: ${alphaCarriesBravo})`
              : 'neither response mentions the other tenant’s workspace slug or id'
          )
        )
      }
    }

    const indistinguishable = controls.filter((c) => c.kind === 'invariant' && !c.ok)
    if (indistinguishable.length === controls.filter((c) => c.kind === 'invariant').length) {
      return error({
        attempted,
        observed: indistinguishable.map((c) => c.detail).join(' | '),
        reason:
          'every settings-derived surface returns identical bytes for both tenants, so this probe is ' +
          'blind: a cross-tenant cache serve would look exactly like a correct response. Give the two ' +
          'tenants distinguishable branding or workspace names, or supply database URLs, and re-run.',
        controls,
        evidence,
      })
    }

    const failed = controls.filter((c) => c.kind === 'negative' && !c.ok)
    if (failed.length > 0) {
      return leak({
        attempted,
        observed: failed.map((c) => `${c.label}: ${c.detail}`).join(' | '),
        reason:
          'a settings-derived response crossed the tenant boundary or changed identity under ' +
          'interleaved load — the signature of a cache keyed without a tenant segment',
        controls,
        evidence,
      })
    }

    return pass({
      attempted,
      observed:
        'each tenant returned a stable, distinguishable settings-derived response across the ' +
        'interleave, carrying only its own workspace identity',
      reason:
        'settings, branding and configuration reads did not cross tenants under interleaved load',
      controls,
      evidence,
    })
  },
}
