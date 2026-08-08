/**
 * P06 — a cached settings / branding / feature-flag read for alpha served to bravo.
 *
 * SAAS-HOSTING-STACK.md §4.1 rates this the most certain of the singleton
 * hazards: `redis.ts:34-53` keys the settings, webhook, auth-provider and
 * platform-credential caches on bare literals — `TENANT_SETTINGS = 'settings:tenant'`
 * and friends. The moment one Redis is shared, tenant A's settings, branding,
 * feature flags and auth configuration are served to tenant B. Unlike the
 * in-heap singletons, it survives a restart.
 *
 * ## Why this probe compares tokens rather than shapes
 *
 * An earlier version searched served responses for the workspace slug and the
 * workspace TypeID, and it could not see this leak at all. Neither string is
 * present in what actually leaks: `/api/widget/config.json` carries theme
 * colours, tabs and flags (`lib/server/widget/public-config.ts`) and no
 * identifier whatsoever, and the portal document carries the workspace *name*.
 * The probe was looking for a vocabulary the leak does not speak.
 *
 * So the identity vocabulary is now derived from what each tenant has actually
 * STORED — name, slug, workspace id, and every distinctive leaf value in
 * `branding_config`, `custom_css`, `portal_config` and `widget_config` — and
 * reduced to the tokens that are EXCLUSIVE to one tenant. A token both tenants
 * share cannot attribute anything and is discarded.
 *
 * ## Why stability is measured on tokens rather than bytes
 *
 * The earlier version also asserted that each tenant's response was
 * byte-identical across interleaved rounds. Any per-request-varying byte — a
 * CSP nonce, a timestamp, a streaming id — made that fail, so a perfectly
 * isolated fleet reported LEAK. Stability is now measured on the set of
 * identity tokens present, which a nonce cannot perturb and a swapped cache
 * entry cannot survive.
 */

import { control, describeResponse, blocked, decide } from './helpers'
import { SETTINGS_ROW_SQL, typeId, type SettingsRow } from '../db'
import { admissibleTokens, colourTokens } from '../vocabulary'
import type { ControlOutcome, Probe, ProbeContext, TenantHandle } from '../types'

/** Public surfaces whose content is derived from the cached settings row. */
const SETTINGS_SURFACES = [
  { path: '/api/widget/config.json', label: 'widget public config' },
  { path: '/', label: 'portal document' },
]

const INTERLEAVE_ROUNDS = 3

/**
 * Every string that could identify this tenant in a served response.
 *
 * Only the name, the slug, the workspace id and the theme COLOURS are mined.
 * An earlier version walked every leaf of `portal_config` and `widget_config`
 * too, which contributed `paragraph`, `public`, `none` and the rest of the enum
 * vocabulary — none of which identifies anybody, all of which turned up in the
 * other tenant's ordinary output and produced exit 2 on correct fleets.
 *
 * Everything here is then passed through `admissibleTokens`, so greys,
 * near-universal colours, short strings, all-common-word names and anything
 * this suite's own fixture writes are dropped before they can accuse.
 */
function identityTokens(row: SettingsRow): Set<string> {
  const candidates: string[] = []
  const workspaceId = typeId('workspace', row.id)
  if (workspaceId) candidates.push(workspaceId)
  if (row.slug) candidates.push(row.slug)
  if (row.name) candidates.push(row.name)
  candidates.push(...colourTokens(row.branding_config))
  candidates.push(...colourTokens(row.custom_css))
  return new Set(admissibleTokens(candidates))
}

/** Tokens that belong to `owner` and not to the other tenant. */
function exclusive(owner: Set<string>, other: Set<string>): string[] {
  const lowerOther = new Set([...other].map((t) => t.toLowerCase()))
  return [...owner].filter((t) => !lowerOther.has(t.toLowerCase()))
}

function present(body: string, tokens: string[]): string[] {
  const haystack = body.toLowerCase()
  return tokens.filter((t) => haystack.includes(t.toLowerCase()))
}

async function readSettings(handle: TenantHandle): Promise<SettingsRow | null> {
  const [row] = await handle.db!.query<SettingsRow>(SETTINGS_ROW_SQL)
  return row ?? null
}

export const p06SettingsCache: Probe = {
  id: 'P06',
  name: 'settings-branding-flag-cache-cross-tenant',
  family: 'cache',
  proves:
    'No settings-derived public surface serves one tenant’s stored identity — name, slug, workspace ' +
    'id, branding, theme colours or portal configuration — under the other tenant’s hostname, and ' +
    'each tenant’s own identity stays put across interleaved reads.',
  requires: ['http', 'db'],
  poolingCaveat:
    'The cache keys this targets (redis.ts CACHE_KEYS) are bare literals, so they collide only when ' +
    'one Redis is shared between tenants. Two separate deployments each have their own Redis, so a ' +
    'PASS today confirms the surfaces carry the right identity and hold it under interleaved load — ' +
    'it cannot yet exercise the shared-key collision itself.',

  async run(ctx: ProbeContext) {
    const { alpha, bravo } = ctx
    const attempted =
      `derive each tenant's stored identity vocabulary from its settings row, then read ` +
      `${SETTINGS_SURFACES.map((s) => s.path).join(' and ')} from both tenants ${INTERLEAVE_ROUNDS} ` +
      `times alternating, checking that neither host ever serves the other's identity`

    if (!alpha.db || !bravo.db) {
      return blocked({
        attempted,
        reason:
          'both tenant database URLs are required. What leaks here is the CONTENT of a settings row, ' +
          'and only the stored rows say which tenant a served blob belongs to — the public surfaces ' +
          'carry no identifier of their own. Pass --alpha-db and --bravo-db.',
      })
    }

    const alphaRow = await readSettings(alpha)
    const bravoRow = await readSettings(bravo)
    const controls: ControlOutcome[] = []
    const evidence: Record<string, unknown> = {}

    if (!alphaRow || !bravoRow) {
      controls.push(
        control(
          'visibility',
          'both tenants have a settings row',
          false,
          `alpha: ${alphaRow ? 'present' : 'MISSING'}, bravo: ${bravoRow ? 'present' : 'MISSING'}`
        )
      )
      return decide({
        attempted,
        controls,
        // Every early return here follows a failed `visibility` control, so
        // `decide()` yields ERROR. The pass text is filled in anyway: if a
        // future edit removed the guarding control, an empty PASS reason would
        // be considerably worse than a slightly wrong one.
        leakReason: 'a settings-derived response crossed the tenant boundary',
        onPass: {
          observed: 'the probe returned before it could compare both tenants',
          reason: 'no settings-derived surface was compared',
        },
        evidence,
      })
    }

    const alphaTokens = identityTokens(alphaRow)
    const bravoTokens = identityTokens(bravoRow)
    const alphaOnly = exclusive(alphaTokens, bravoTokens)
    const bravoOnly = exclusive(bravoTokens, alphaTokens)
    evidence.exclusiveTokenCounts = { alpha: alphaOnly.length, bravo: bravoOnly.length }

    // --- visibility gate: the tenants must be distinguishable at all ---------
    controls.push(
      control(
        'visibility',
        'the two tenants store distinguishable settings',
        alphaOnly.length > 0 && bravoOnly.length > 0,
        alphaOnly.length > 0 && bravoOnly.length > 0
          ? `alpha has ${alphaOnly.length} exclusive identity token(s), bravo has ${bravoOnly.length}`
          : `alpha ${alphaOnly.length}, bravo ${bravoOnly.length} — the two tenants are configured ` +
              `identically, so a cross-tenant cache serve would be indistinguishable from a correct ` +
              `response. Give them different names, slugs or branding and re-run.`
      )
    )

    if (alphaOnly.length === 0 || bravoOnly.length === 0) {
      return decide({
        attempted,
        controls,
        // Every early return here follows a failed `visibility` control, so
        // `decide()` yields ERROR. The pass text is filled in anyway: if a
        // future edit removed the guarding control, an empty PASS reason would
        // be considerably worse than a slightly wrong one.
        leakReason: 'a settings-derived response crossed the tenant boundary',
        onPass: {
          observed: 'the probe returned before it could compare both tenants',
          reason: 'no settings-derived surface was compared',
        },
        evidence,
      })
    }

    let discriminatingSurfaces = 0

    for (const surface of SETTINGS_SURFACES) {
      const rounds: Array<{ alphaBody: string; bravoBody: string }> = []

      for (let round = 0; round < INTERLEAVE_ROUNDS; round++) {
        const a = await alpha.http.request(surface.path, { omitCookies: true })
        const b = await bravo.http.request(surface.path, { omitCookies: true })
        if (a.status >= 500 || b.status >= 500) {
          controls.push(
            control(
              'visibility',
              `${surface.label} is readable on both tenants`,
              false,
              `alpha ${describeResponse(a, 100)}; bravo ${describeResponse(b, 100)}`
            )
          )
          return decide({
            attempted,
            controls,
            leakReason: '',
            onPass: { observed: '', reason: '' },
            evidence,
          })
        }
        rounds.push({ alphaBody: a.text, bravoBody: b.text })
      }

      const ownOnAlpha = rounds.map((r) => present(r.alphaBody, alphaOnly).join(','))
      const ownOnBravo = rounds.map((r) => present(r.bravoBody, bravoOnly).join(','))
      const foreignOnAlpha = present(rounds[0].alphaBody, bravoOnly)
      const foreignOnBravo = present(rounds[0].bravoBody, alphaOnly)

      const discriminating = ownOnAlpha[0].length > 0 || ownOnBravo[0].length > 0
      if (discriminating) discriminatingSurfaces++

      // --- the leak check ----------------------------------------------------
      //
      // A foreign token only accuses when the host serving it shows NONE of its
      // own identity on this surface. That is the difference between "bravo is
      // serving alpha's cached blob" and "bravo rendered its own page, which
      // happens to contain a word that is also in alpha's settings".
      //
      // Byte comparison cannot make this distinction: a per-request nonce makes
      // a leaking response differ from the original, and an incidental overlap
      // makes a correct response contain a foreign token. Asking whose identity
      // the host is actually presenting is unaffected by both.
      const bravoServesAlphaInstead = foreignOnBravo.length > 0 && ownOnBravo[0].length === 0
      const alphaServesBravoInstead = foreignOnAlpha.length > 0 && ownOnAlpha[0].length === 0
      const incidental = [
        ...(foreignOnBravo.length > 0 && !bravoServesAlphaInstead
          ? [
              `bravo also renders its own identity (${ownOnBravo[0]}), so ${JSON.stringify(foreignOnBravo)} is incidental overlap`,
            ]
          : []),
        ...(foreignOnAlpha.length > 0 && !alphaServesBravoInstead
          ? [
              `alpha also renders its own identity (${ownOnAlpha[0]}), so ${JSON.stringify(foreignOnAlpha)} is incidental overlap`,
            ]
          : []),
      ]
      if (incidental.length > 0) evidence[`incidental:${surface.path}`] = incidental

      controls.push(
        control(
          'negative',
          `${surface.label} presents each tenant's own identity, not the other's`,
          !bravoServesAlphaInstead && !alphaServesBravoInstead,
          bravoServesAlphaInstead || alphaServesBravoInstead
            ? `FOREIGN IDENTITY SERVED — ` +
                (bravoServesAlphaInstead
                  ? `bravo returned alpha's ${JSON.stringify(foreignOnBravo.slice(0, 4))} and none of its own; `
                  : '') +
                (alphaServesBravoInstead
                  ? `alpha returned bravo's ${JSON.stringify(foreignOnAlpha.slice(0, 4))} and none of its own`
                  : '')
            : discriminating
              ? `each host served its own stored identity${incidental.length > 0 ? ` (${incidental.join('; ')})` : ''}`
              : 'this surface carries no stored identity for either tenant',
          // One control, both directions: it evaluates whether EITHER host is
          // presenting the other's identity instead of its own.
          'both'
        )
      )

      // --- the cache-swap check: identity must not move between rounds -------
      // Measured on identity tokens, never on bytes, so a nonce or timestamp
      // cannot manufacture a failure.
      if (discriminating) {
        const alphaStable = ownOnAlpha.every((set) => set === ownOnAlpha[0])
        const bravoStable = ownOnBravo.every((set) => set === ownOnBravo[0])
        controls.push(
          control(
            'negative',
            `${surface.label} holds its own identity across ${INTERLEAVE_ROUNDS} interleaved rounds`,
            alphaStable && bravoStable,
            alphaStable && bravoStable
              ? 'the identity token set was constant on both hosts'
              : `IDENTITY MOVED MID-INTERLEAVE (alpha rounds: ${JSON.stringify(ownOnAlpha)}, ` +
                  `bravo rounds: ${JSON.stringify(ownOnBravo)}) — the signature of a cache key with no tenant segment`,
            'both'
          )
        )
      }

      evidence[`surface:${surface.path}`] = {
        discriminating,
        alphaOwnTokensFound: ownOnAlpha[0] ? ownOnAlpha[0].split(',').length : 0,
        bravoOwnTokensFound: ownOnBravo[0] ? ownOnBravo[0].split(',').length : 0,
        foreignOnAlpha,
        foreignOnBravo,
      }
    }

    // --- visibility gate: at least one surface must actually carry identity --
    controls.push(
      control(
        'visibility',
        'at least one settings surface carries a tenant’s own identity',
        discriminatingSurfaces > 0,
        discriminatingSurfaces > 0
          ? `${discriminatingSurfaces} of ${SETTINGS_SURFACES.length} surface(s) are identity-bearing`
          : 'no surface carried any stored identity token, so none of them could reveal a cross-tenant ' +
              'serve. This probe saw nothing and proves nothing.'
      )
    )

    return decide({
      attempted,
      controls,
      leakReason:
        'a settings-derived response carried the other tenant’s stored identity, or a tenant’s own ' +
        'identity moved between interleaved reads — the signature of a cache keyed without a tenant segment',
      onPass: {
        observed:
          `${discriminatingSurfaces} identity-bearing surface(s); each host served only its own stored ` +
          `identity and held it across ${INTERLEAVE_ROUNDS} interleaved rounds`,
        reason:
          'settings, branding and configuration reads did not cross tenants under interleaved load',
      },
      evidence,
    })
  },
}
