/**
 * P06 — a cached settings / branding / feature-flag read for alpha served to bravo.
 *
 * SAAS-HOSTING-STACK.md §4.1 rated this the most certain of the singleton
 * hazards: the settings, webhook, auth-provider and platform-credential caches
 * were keyed on bare literals — `WORKSPACE_SETTINGS = 'settings:workspace'` and
 * friends — in one shared Redis, so workspace A's settings, branding, feature flags
 * and auth configuration could be served to workspace B, and unlike the in-heap
 * singletons it survived a restart.
 *
 * That mechanism is gone rather than merely dormant: the cache is `kv_store` in
 * the workspace's own database, and the discriminator is `workspace_key`, the leading
 * column of the primary key (`cache.ts`, `kv/pg-kv.ts`, `kv/KV.md`). A key
 * column cannot be bypassed by concatenation the way a string prefix could.
 * What this probe still earns is the other half: that each host serves its own
 * identity, and holds it under interleaved reads.
 *
 * ## Identity is planted, not derived
 *
 * The suite does not infer what makes a workspace distinguishable — it PLANTS it,
 * exactly as it plants a per-workspace canary in post content. Each workspace's
 * settings carry a probe-owned identity token (fixtures.ts `IDENTITY_TOKEN`,
 * or the operator's own via --alpha-identity-token) stamped into a field a
 * public surface renders, and preflight installs it as a tripwire marker.
 * Three things follow by construction rather than by filtering:
 *
 *  - Admissibility is a property the suite CONTROLS. The token is distinctive,
 *    appears in no UI chrome, and is never swallowed by a genericity filter —
 *    a workspace named `Help Center` or `Acme` is as judgeable as any other.
 *  - A foreign planted token on the wrong host needs no corroboration: it has
 *    no innocent explanation, so its presence is a LEAK on its own.
 *  - A PARTIAL identity leak fails by construction. One field crossing while
 *    the host keeps rendering its own (bravo paints its own colour but renders
 *    alpha's name) leaves the leaking surface carrying the foreign planted
 *    token — the shape that defeated every derived-vocabulary defence, because
 *    the leaked value was generic, the tripwire had dropped it, and the host
 *    still showed an identity of its own.
 *
 * ## The visibility gate counts only what is observable
 *
 * The gate this probe enforces before it may PASS is: each host must be caught
 * serving its OWN planted token on at least one judged surface. An earlier
 * version gated on the number of stored tokens exclusive to each workspace — but
 * those two tokens were the workspace TypeID, which appears in no public
 * surface ever, and the brand colour, the one field that had not leaked. It
 * certified the workspaces distinguishable on a surface where they were not. Any
 * admissibility rule built on stored values has that shape; this one is built
 * on observed responses.
 *
 * ## The derived vocabulary is retained as a secondary layer
 *
 * Name, slug, workspace id and theme colours — reduced to exclusive,
 * non-generic tokens — are still checked with own-identity corroboration, and
 * still catch leaks on surfaces the planted token does not reach (the widget
 * public config carries colours and no text). A leak observed here is evidence
 * regardless of the planted layer; a PASS is not.
 *
 * ## Why stability is measured on tokens rather than bytes
 *
 * Asserting byte-identical responses across interleaved rounds made any
 * per-request-varying byte — a CSP nonce, a timestamp — report LEAK on a
 * perfectly isolated fleet. Stability is measured on the set of identity
 * tokens present, which a nonce cannot perturb and a swapped cache entry
 * cannot survive.
 */

import { control, crossOriginRedirectControl, describeResponse, blocked, decide } from './helpers'
import { SETTINGS_ROW_SQL, typeId, type SettingsRow } from '../db'
import { admissibleTokens, colourTokens } from '../vocabulary'
import type { ControlOutcome, Probe, ProbeContext, ProbeResponse, WorkspaceHandle } from '../types'

/**
 * Public surfaces whose content is derived from the cached settings row.
 *
 * `follow` is set where the surface answers a canonicalising redirect rather
 * than a document. `GET /` on this app answers `307 → /?sort=trending` with a
 * ZERO-BYTE body, so with redirects unfollowed this probe judged an empty
 * string: the planted identity token, the workspace name and the branding are
 * all one hop away. The whole planted-identity layer — the suite's own answer
 * to three rounds of false greens — contributed nothing to a run, and the only
 * thing that noticed was the admissibility gate below refusing to certify a
 * host it had never caught serving its own token.
 *
 * Redirects are followed same-origin only (`http.ts`). A probe that chased
 * alpha's redirect onto bravo's host and then reported "no foreign markers"
 * would be judging bravo's page and calling it alpha's.
 */
const SETTINGS_SURFACES = [
  { path: '/api/widget/config.json', label: 'widget public config', follow: false },
  { path: '/', label: 'portal document', follow: true },
]

const INTERLEAVE_ROUNDS = 3

/**
 * One LEAK reason for every exit from this probe.
 *
 * Each early return used to carry its own — including one that was the empty
 * string — so a leak already recorded when the probe stopped would have been
 * reported with no explanation of what it was.
 */
const LEAK_REASON =
  'a settings-derived response carried the other workspace’s planted identity token or stored ' +
  'identity, or a workspace’s own identity moved between interleaved reads — the signature of a ' +
  'cache keyed without a workspace segment'

/**
 * Every string that could identify this workspace in a served response — the
 * DERIVED (secondary) vocabulary. See the file header: the planted token is
 * the primary identity and passes through no filter; everything here is
 * heuristic and goes through `admissibleTokens`, so greys, near-universal
 * colours, short strings, all-common-word names and anything this suite's own
 * fixture writes are dropped before they can accuse.
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

/** Tokens that belong to `owner` and not to the other workspace. */
function exclusive(owner: Set<string>, other: Set<string>): string[] {
  const lowerOther = new Set([...other].map((t) => t.toLowerCase()))
  return [...owner].filter((t) => !lowerOther.has(t.toLowerCase()))
}

function present(body: string, tokens: string[]): string[] {
  const haystack = body.toLowerCase()
  return tokens.filter((t) => haystack.includes(t.toLowerCase()))
}

function hasToken(body: string, token: string): boolean {
  return body.toLowerCase().includes(token.toLowerCase())
}

async function readSettings(handle: WorkspaceHandle): Promise<SettingsRow | null> {
  const [row] = await handle.db!.query<SettingsRow>(SETTINGS_ROW_SQL)
  return row ?? null
}

export const p06SettingsCache: Probe = {
  id: 'P06',
  name: 'settings-branding-flag-cache-cross-workspace',
  family: 'cache',
  proves:
    'No settings-derived public surface serves one workspace’s planted identity token — or its stored ' +
    'name, slug, workspace id, branding or theme colours — under the other workspace’s hostname, each ' +
    'host provably serves its own planted token on at least one judged surface, and each workspace’s ' +
    'identity stays put across interleaved reads.',
  requires: ['http', 'db'],
  poolingCaveat:
    'The shared-key collision this was designed around no longer has a mechanism: the cache is ' +
    'kv_store in the workspace own database, discriminated by the workspace_key column rather than by a ' +
    'string prefix. A PASS confirms the surfaces carry the right identity and hold it under ' +
    'interleaved load; it does not exercise a cross-workspace cache read, because there is no longer ' +
    'a shared namespace for one to occur in.',

  async run(ctx: ProbeContext) {
    const { alpha, bravo } = ctx
    const attempted =
      `read ${SETTINGS_SURFACES.map((s) => s.path).join(' and ')} from both workspaces ` +
      `${INTERLEAVE_ROUNDS} times alternating, checking that neither host ever serves the other's ` +
      `planted identity token or stored identity, and that each host serves its own planted token`

    if (!alpha.db || !bravo.db) {
      return blocked({
        attempted,
        reason:
          'both workspace database URLs are required. What leaks here is the CONTENT of a settings row, ' +
          'and only the stored rows say which workspace a served blob belongs to — the public surfaces ' +
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
          'both workspaces have a settings row',
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
        leakReason: LEAK_REASON,
        onPass: {
          observed: 'the probe returned before it could compare both workspaces',
          reason: 'no settings-derived surface was compared',
        },
        evidence,
      })
    }

    // --- the planted identity vocabulary -------------------------------------
    //
    // Installed by preflight from --alpha-identity-token / the suite defaults.
    // These are the tokens this probe judges on; they pass through no filter.
    const planted = {
      alpha: alpha.markers.ids.identityToken,
      bravo: bravo.markers.ids.identityToken,
    }
    if (!planted.alpha || !planted.bravo) {
      controls.push(
        control(
          'visibility',
          'both workspaces hold a planted identity token',
          false,
          `alpha: ${planted.alpha ? 'present' : 'MISSING'}, bravo: ${planted.bravo ? 'present' : 'MISSING'} — ` +
            'preflight installs these from --alpha-identity-token / --bravo-identity-token or the suite ' +
            'defaults; without them this probe would be back to inferring identity from stored values, ' +
            'which can certify distinguishability it cannot observe'
        )
      )
      return decide({
        attempted,
        controls,
        leakReason: LEAK_REASON,
        onPass: {
          observed: 'the probe returned before it could compare both workspaces',
          reason: 'no settings-derived surface was compared',
        },
        evidence,
      })
    }
    const plantedAlpha = planted.alpha
    const plantedBravo = planted.bravo

    // --- the derived (secondary) vocabulary -----------------------------------
    const alphaTokens = identityTokens(alphaRow)
    const bravoTokens = identityTokens(bravoRow)
    const alphaOnly = exclusive(alphaTokens, bravoTokens)
    const bravoOnly = exclusive(bravoTokens, alphaTokens)
    // Recorded for transparency only. An earlier version GATED on these counts,
    // which certified the workspaces distinguishable on tokens (the workspace
    // TypeID, an unleaked colour) that no judged surface necessarily carries.
    // The gate below counts observed responses instead.
    evidence.exclusiveTokenCounts = { alpha: alphaOnly.length, bravo: bravoOnly.length }

    let discriminatingSurfaces = 0
    const plantedSurfaces: { alpha: string[]; bravo: string[] } = { alpha: [], bravo: [] }

    for (const surface of SETTINGS_SURFACES) {
      const rounds: Array<{ alphaBody: string; bravoBody: string }> = []
      const reads: Array<{ slot: string; res: ProbeResponse; otherBaseUrl: string }> = []

      for (let round = 0; round < INTERLEAVE_ROUNDS; round++) {
        const read = { omitCookies: true, followRedirects: surface.follow }
        const a = await alpha.http.request(surface.path, read)
        const b = await bravo.http.request(surface.path, read)
        reads.push(
          { slot: 'alpha', res: a, otherBaseUrl: bravo.baseUrl },
          { slot: 'bravo', res: b, otherBaseUrl: alpha.baseUrl }
        )
        if (a.status >= 500 || b.status >= 500) {
          controls.push(
            control(
              'visibility',
              `${surface.label} is readable on both workspaces`,
              false,
              `alpha ${describeResponse(a, 100)}; bravo ${describeResponse(b, 100)}`
            )
          )
          return decide({
            attempted,
            controls,
            leakReason: LEAK_REASON,
            blindReason:
              'a judged surface answered 5xx, so its content could not be compared. A crash is ' +
              'not a refusal and is never a pass.',
            onPass: {
              observed: 'the probe returned before it could compare both workspaces',
              reason: 'no settings-derived surface was compared',
            },
            evidence,
          })
        }
        rounds.push({ alphaBody: a.text, bravoBody: b.text })
      }

      // A host that answered by sending the client to another origin did not
      // serve this surface, and the body being judged is not its own. Fails
      // closed as `visibility` (ERROR), or as `negative` (LEAK) when the origin
      // it pointed at is the other workspace under test.
      const redirectControl = crossOriginRedirectControl(surface.label, reads)
      if (redirectControl) {
        controls.push(redirectControl)
        return decide({
          attempted,
          controls,
          leakReason: LEAK_REASON,
          blindReason:
            'a judged surface was answered with a redirect to another origin, which was not ' +
            'followed. The probe therefore never read the surface it was going to judge.',
          onPass: {
            observed: 'the probe returned before it could compare both workspaces',
            reason: 'no settings-derived surface was compared',
          },
          evidence,
        })
      }

      // Own identity = derived own tokens + the planted token. The union is
      // what stability is measured on, and what corroboration asks after: a
      // host showing ANY of its own identity is rendering itself, so foreign
      // derived tokens alongside it are incidental overlap.
      const ownOnAlpha = rounds.map((r) =>
        [
          ...present(r.alphaBody, alphaOnly),
          ...(hasToken(r.alphaBody, plantedAlpha) ? ['<planted>'] : []),
        ].join(',')
      )
      const ownOnBravo = rounds.map((r) =>
        [
          ...present(r.bravoBody, bravoOnly),
          ...(hasToken(r.bravoBody, plantedBravo) ? ['<planted>'] : []),
        ].join(',')
      )
      // Foreign presence is checked across EVERY round, not just the first: a
      // cache entry swapped mid-interleave must not escape by leaking late.
      const foreignOnAlpha = [...new Set(rounds.flatMap((r) => present(r.alphaBody, bravoOnly)))]
      const foreignOnBravo = [...new Set(rounds.flatMap((r) => present(r.bravoBody, alphaOnly)))]

      const foreignPlantedOnAlpha = rounds.some((r) => hasToken(r.alphaBody, plantedBravo))
      const foreignPlantedOnBravo = rounds.some((r) => hasToken(r.bravoBody, plantedAlpha))
      if (rounds.some((r) => hasToken(r.alphaBody, plantedAlpha))) {
        plantedSurfaces.alpha.push(surface.path)
      }
      if (rounds.some((r) => hasToken(r.bravoBody, plantedBravo))) {
        plantedSurfaces.bravo.push(surface.path)
      }

      const discriminating = ownOnAlpha[0].length > 0 || ownOnBravo[0].length > 0
      if (discriminating) discriminatingSurfaces++

      // --- the planted-token leak check, one control per direction -----------
      //
      // A planted token on the wrong host has no innocent explanation — it is
      // probe-owned, appears in no chrome, and passes through no filter — so
      // its presence accuses on its own, with no corroboration requirement.
      // This is the control a partial identity leak cannot escape: the leaking
      // surface carries the foreign planted token while missing the host's own.
      controls.push(
        control(
          'negative',
          `alpha's planted identity token → bravo (${surface.label})`,
          !foreignPlantedOnBravo,
          foreignPlantedOnBravo
            ? `BRAVO SERVED ALPHA'S PLANTED TOKEN "${plantedAlpha}" — alpha's settings blob crossed ` +
                'the workspace boundary on this surface'
            : 'never served',
          'a-to-b',
          `planted-identity:${surface.path}`
        )
      )
      controls.push(
        control(
          'negative',
          `bravo's planted identity token → alpha (${surface.label})`,
          !foreignPlantedOnAlpha,
          foreignPlantedOnAlpha
            ? `ALPHA SERVED BRAVO'S PLANTED TOKEN "${plantedBravo}" — bravo's settings blob crossed ` +
                'the workspace boundary on this surface'
            : 'never served',
          'b-to-a',
          `planted-identity:${surface.path}`
        )
      )

      // --- the derived-vocabulary leak check -----------------------------------
      //
      // A foreign derived token only accuses when the host serving it shows
      // NONE of its own identity on this surface. That is the difference
      // between "bravo is serving alpha's cached blob" and "bravo rendered its
      // own page, which happens to contain a word that is also in alpha's
      // settings". Byte comparison cannot make this distinction: a per-request
      // nonce makes a leaking response differ from the original, and an
      // incidental overlap makes a correct response contain a foreign token.
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
          `${surface.label} presents each workspace's own identity, not the other's`,
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
              : 'this surface carries no stored identity for either workspace',
          // One control, both directions: it evaluates whether EITHER host is
          // presenting the other's identity instead of its own.
          'both'
        )
      )

      // --- the cache-swap check: identity must not move between rounds -------
      // Measured on identity tokens (planted included), never on bytes, so a
      // nonce or timestamp cannot manufacture a failure.
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
                  `bravo rounds: ${JSON.stringify(ownOnBravo)}) — the signature of a cache key with no workspace segment`,
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
        foreignPlantedOnAlpha,
        foreignPlantedOnBravo,
      }
    }

    evidence.plantedSurfaces = plantedSurfaces
    evidence.discriminatingSurfaces = discriminatingSurfaces

    // --- visibility gate: each host must be caught serving its OWN token -----
    //
    // This is the only admissibility rule the probe enforces, and it counts
    // observed responses, not stored values. Until a host provably serves its
    // own planted token on a judged surface, a PASS would certify
    // distinguishability the suite cannot observe — the exact failure the
    // planted-token mechanism exists to remove.
    const alphaPlantedVisible = plantedSurfaces.alpha.length > 0
    const bravoPlantedVisible = plantedSurfaces.bravo.length > 0
    controls.push(
      control(
        'visibility',
        'each host serves its own planted identity token on at least one judged surface',
        alphaPlantedVisible && bravoPlantedVisible,
        alphaPlantedVisible && bravoPlantedVisible
          ? `alpha's token observed on ${plantedSurfaces.alpha.join(', ')}; bravo's on ${plantedSurfaces.bravo.join(', ')}`
          : (!alphaPlantedVisible
              ? `alpha never served its own token "${plantedAlpha}" on any judged surface. `
              : '') +
              (!bravoPlantedVisible
                ? `bravo never served its own token "${plantedBravo}" on any judged surface. `
                : '') +
              'Plant the token into a settings-derived field a public surface renders (the workspace ' +
              'name, or the portal welcome-card headline), or pass --alpha-identity-token / ' +
              '--bravo-identity-token with the token that was planted, and re-run.'
      )
    )

    return decide({
      attempted,
      controls,
      leakReason: LEAK_REASON,
      onPass: {
        observed:
          `each host served its own planted identity token (${plantedSurfaces.alpha.length + plantedSurfaces.bravo.length} ` +
          `token-bearing surface reading(s)) and only its own stored identity, held across ` +
          `${INTERLEAVE_ROUNDS} interleaved rounds`,
        reason:
          'settings, branding and configuration reads did not cross workspaces under interleaved load',
      },
      evidence,
    })
  },
}
