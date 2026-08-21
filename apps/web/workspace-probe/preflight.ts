/**
 * Preflight: establish that the suite is capable of detecting a leak before it
 * claims not to have found one.
 *
 * A probe suite that cannot reach its targets, cannot sign in, or is pointed at
 * the same deployment twice will report a clean run. That is the failure mode
 * this file exists to prevent. Everything here is a hard gate: if preflight
 * fails, every downstream probe is reported as ERROR with the preflight reason
 * attached — never skipped, never passed.
 */

import { createWorkspaceHttp, type FetchLike } from './http'
import { createWorkspaceDb, typeId, SETTINGS_ROW_SQL } from './db'
import {
  discoverMarkers,
  identityTokenFor,
  provisionFixture,
  verifyCollisions,
  CANARY,
} from './fixtures'
import { isGenericToken } from './vocabulary'
import { MIN_MARKER_LENGTH } from './tripwire'
import type {
  Capability,
  ProbeConfig,
  ProbeLogger,
  WorkspaceHandle,
  WorkspaceSlot,
  TripwireRecorder,
} from './types'

/** A preflight step that did or did not hold. */
export interface PreflightStep {
  name: string
  ok: boolean
  detail: string
}

export interface PreflightResult {
  ok: boolean
  steps: PreflightStep[]
  capabilities: Set<Capability>
  missing: Capability[]
  /** Set when preflight failed; every probe inherits it as its ERROR reason. */
  failureReason?: string
}

export const SESSION_COOKIE_NAMES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
]

interface SessionEnvelope {
  session?: { id?: string; token?: string; userId?: string } | null
  user?: { id?: string; email?: string; name?: string } | null
}

/** Read the current session as the given client sees it. */
export async function getSession(
  handle: WorkspaceHandle,
  opts: { expectsForeignMarkers?: boolean } = {}
): Promise<{ status: number; body: SessionEnvelope | null; raw: string }> {
  const res = await handle.http.request('/api/auth/get-session', {
    expectsForeignMarkers: opts.expectsForeignMarkers,
  })
  return { status: res.status, body: res.json<SessionEnvelope>(), raw: res.text }
}

/**
 * Sign the admin in with email + password, falling back to the magic-link flow
 * when password sign-in is disabled and a database connection is available to
 * read the minted token.
 */
async function establishAdminSession(
  handle: WorkspaceHandle,
  config: ProbeConfig
): Promise<{ ok: boolean; detail: string; userId?: string; email?: string }> {
  handle.http.clearCookies()

  const pw = await handle.http.request('/api/auth/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email: config.adminEmail, password: config.adminPassword }),
  })

  if (pw.ok) {
    const session = await getSession(handle)
    const userId = session.body?.user?.id
    if (userId) {
      return {
        ok: true,
        detail: `password sign-in as ${config.adminEmail}`,
        userId,
        email: session.body?.user?.email,
      }
    }
    return {
      ok: false,
      detail: `password sign-in returned 200 but /api/auth/get-session had no user`,
    }
  }

  if (!handle.db) {
    return {
      ok: false,
      detail:
        `password sign-in failed (${pw.status}: ${pw.text.slice(0, 200)}) and no database URL was ` +
        `supplied to fall back to the magic-link flow`,
    }
  }

  const { mintAndReadMagicLink, redeemMagicLink } = await import('./auth-flows')
  const minted = await mintAndReadMagicLink(handle, config.adminEmail)
  if (!minted.token) {
    return { ok: false, detail: `magic-link fallback could not obtain a token: ${minted.detail}` }
  }
  const redeemed = await redeemMagicLink(handle, minted.token)
  if (!redeemed.sessionEstablished) {
    return {
      ok: false,
      detail: `magic-link fallback did not establish a session: ${redeemed.detail}`,
    }
  }
  const session = await getSession(handle)
  const userId = session.body?.user?.id
  if (!userId) return { ok: false, detail: 'magic-link fallback produced no user in get-session' }
  return {
    ok: true,
    detail: `magic-link sign-in as ${config.adminEmail}`,
    userId,
    email: session.body?.user?.email,
  }
}

function secretFor(slot: WorkspaceSlot, config: ProbeConfig, kind: 'storage' | 'widget' | 'api') {
  if (kind === 'storage')
    return slot === 'alpha' ? config.alphaStorageSecret : config.bravoStorageSecret
  if (kind === 'widget')
    return slot === 'alpha' ? config.alphaWidgetSecret : config.bravoWidgetSecret
  return slot === 'alpha' ? config.alphaApiKey : config.bravoApiKey
}

export interface PreflightOutput extends PreflightResult {
  alpha: WorkspaceHandle
  bravo: WorkspaceHandle
}

export async function runPreflight(
  config: ProbeConfig,
  tripwire: TripwireRecorder,
  log: ProbeLogger,
  deps: { fetchImpl?: FetchLike; createDb?: typeof createWorkspaceDb } = {}
): Promise<PreflightOutput> {
  const steps: PreflightStep[] = []
  const capabilities = new Set<Capability>()

  const makeHandle = (slot: WorkspaceSlot, baseUrl: string): WorkspaceHandle => ({
    slot,
    baseUrl,
    markers: { slot, canary: CANARY[slot], ids: {} },
    http: createWorkspaceHttp({
      slot,
      baseUrl,
      tripwire,
      defaultTimeoutMs: config.requestTimeoutMs,
      fetchImpl: deps.fetchImpl,
    }),
  })

  const alpha = makeHandle('alpha', config.alphaUrl)
  const bravo = makeHandle('bravo', config.bravoUrl)
  const both: WorkspaceHandle[] = [alpha, bravo]

  // ---- 1. Reachability -----------------------------------------------------
  let reachable = true
  for (const handle of both) {
    try {
      const res = await handle.http.request('/api/health/live', {
        timeoutMs: config.requestTimeoutMs,
      })
      const ok = res.status < 500
      steps.push({
        name: `reachable:${handle.slot}`,
        ok,
        detail: `GET ${handle.baseUrl}/api/health/live → ${res.status}`,
      })
      if (!ok) reachable = false
    } catch (err) {
      reachable = false
      steps.push({
        name: `reachable:${handle.slot}`,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }
  if (!reachable) {
    return finish(steps, capabilities, alpha, bravo, 'one or both targets are unreachable')
  }
  capabilities.add('http')

  // ---- 2. Optional database handles ---------------------------------------
  const dbUrls: Record<WorkspaceSlot, string | undefined> = {
    alpha: config.alphaDatabaseUrl,
    bravo: config.bravoDatabaseUrl,
  }
  let dbOk = Boolean(dbUrls.alpha && dbUrls.bravo)
  if (dbOk) {
    for (const handle of both) {
      const url = dbUrls[handle.slot]
      if (!url) continue
      try {
        const db = (deps.createDb ?? createWorkspaceDb)(handle.slot, url)
        await db.query('SELECT 1')
        handle.db = db
        steps.push({ name: `database:${handle.slot}`, ok: true, detail: 'connected' })
      } catch (err) {
        dbOk = false
        steps.push({
          name: `database:${handle.slot}`,
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
        })
      }
    }
  } else {
    steps.push({
      name: 'database',
      ok: true,
      detail: 'no database URLs supplied; database-dependent probes will report BLOCKED',
    })
  }
  if (dbOk && alpha.db && bravo.db) capabilities.add('db')

  // ---- 3. Distinctness -----------------------------------------------------
  // The single most dangerous misconfiguration: both slots pointed at one
  // deployment. Everything downstream would agree with itself and the suite
  // would report perfect isolation.
  const identity: Record<WorkspaceSlot, { workspaceId?: string; slug?: string }> = {
    alpha: {},
    bravo: {},
  }
  for (const handle of both) {
    if (!handle.db) continue
    const [row] = await handle.db.query<{ id: string; slug: string }>(SETTINGS_ROW_SQL)
    identity[handle.slot] = {
      workspaceId: typeId('workspace', row?.id) ?? undefined,
      slug: row?.slug,
    }
  }
  if (identity.alpha.workspaceId && identity.bravo.workspaceId) {
    const distinct = identity.alpha.workspaceId !== identity.bravo.workspaceId
    steps.push({
      name: 'targets-are-distinct',
      ok: distinct,
      detail: distinct
        ? `workspace ids differ (${identity.alpha.workspaceId} vs ${identity.bravo.workspaceId})`
        : `BOTH TARGETS SHARE workspace id ${identity.alpha.workspaceId} — this is one workspace, not two`,
    })
    if (!distinct) {
      return finish(
        steps,
        capabilities,
        alpha,
        bravo,
        'alpha and bravo resolve to the same workspace; a single workspace cannot leak to itself and every verdict would be meaningless'
      )
    }
  } else {
    steps.push({
      name: 'targets-are-distinct',
      ok: true,
      detail:
        'origins differ; workspace-id comparison needs database URLs, and fixture ids are compared instead',
    })
  }

  // ---- 4. Admin sessions ---------------------------------------------------
  const adminEmails: Partial<Record<WorkspaceSlot, string>> = {}
  let adminOk = true
  for (const handle of both) {
    const result = await establishAdminSession(handle, config)
    steps.push({ name: `admin-session:${handle.slot}`, ok: result.ok, detail: result.detail })
    if (!result.ok) {
      adminOk = false
      continue
    }
    handle.adminCookies = handle.http.cookieHeader()
    if (result.userId) {
      handle.markers.ids.adminUserId = result.userId
    }
    // The address the SERVER holds for this account, not the one we asked with.
    // The collision gate compares the two workspaces' values, and filling them in
    // from our own flag would make it compare a constant to itself.
    adminEmails[handle.slot] = result.email
  }
  if (adminOk) capabilities.add('admin')

  // ---- 5. Credentials ------------------------------------------------------
  for (const [capability, kind] of [
    ['api-key', 'api'],
    ['storage-secret', 'storage'],
    ['widget-secret', 'widget'],
  ] as const) {
    const a = secretFor('alpha', config, kind)
    const b = secretFor('bravo', config, kind)
    if (a && b) {
      capabilities.add(capability)
      // Two workspaces sharing a secret is itself the §4 hazard. Record it here so
      // the affected probes can report an invariant failure rather than a pass.
      steps.push({
        name: `credential:${capability}`,
        ok: a !== b,
        detail:
          a !== b
            ? 'supplied for both workspaces and distinct'
            : 'SUPPLIED BUT IDENTICAL for both workspaces — a shared secret is a cross-workspace capability',
      })
    } else {
      steps.push({
        name: `credential:${capability}`,
        ok: true,
        detail: 'not supplied; dependent probes will report BLOCKED',
      })
    }
  }

  // Widget secrets can be read straight out of the settings row when the
  // database is reachable, so the operator does not have to plumb them by hand.
  if (!capabilities.has('widget-secret') && capabilities.has('db')) {
    const secrets: Partial<Record<WorkspaceSlot, string>> = {}
    for (const handle of both) {
      const [row] = await handle.db!.query<{ widget_secret: string | null }>(SETTINGS_ROW_SQL)
      if (row?.widget_secret) secrets[handle.slot] = row.widget_secret
    }
    if (secrets.alpha && secrets.bravo) {
      config.alphaWidgetSecret = secrets.alpha
      config.bravoWidgetSecret = secrets.bravo
      capabilities.add('widget-secret')
      steps.push({
        name: 'credential:widget-secret',
        ok: secrets.alpha !== secrets.bravo,
        detail:
          secrets.alpha !== secrets.bravo
            ? 'read from settings.widget_secret on both workspaces'
            : 'read from the database and IDENTICAL across workspaces — a shared widget secret forges identities in both',
      })
    }
  }

  // ---- 6. Planted identity tokens ------------------------------------------
  //
  // P06 judges workspace identity on tokens the suite controls, not on values it
  // infers from stored settings — any admissibility rule built on stored values
  // can certify the workspaces distinguishable on a surface where they are not
  // (the workspace TypeID appears in no public surface, ever). The tokens are
  // planted by the operator into a settings-derived field a public surface
  // renders; the suite validates the vocabulary here and verifies observability
  // in P06. A bad vocabulary makes every downstream identity verdict
  // meaningless, so this is a hard gate, in the same class as same-origin.
  const identityTokens: Record<WorkspaceSlot, string> = {
    alpha: identityTokenFor('alpha', config),
    bravo: identityTokenFor('bravo', config),
  }
  const tokenProblems: string[] = []
  for (const slot of ['alpha', 'bravo'] as WorkspaceSlot[]) {
    const token = identityTokens[slot]
    if (token.length < MIN_MARKER_LENGTH) {
      tokenProblems.push(
        `${slot} token "${token}" is shorter than ${MIN_MARKER_LENGTH} characters — the tripwire ` +
          'would ignore it and attribution would silently degrade'
      )
    }
    if (isGenericToken(token)) {
      tokenProblems.push(
        `${slot} token "${token}" is generic — it can appear in the other workspace's own output, ` +
          'so it cannot accuse. Use the suite default or another distinctive string.'
      )
    }
  }
  if (identityTokens.alpha === identityTokens.bravo) {
    tokenProblems.push(
      `both workspaces were given the SAME token ("${identityTokens.alpha}") — a leak could not be ` +
        'attributed to a workspace'
    )
  } else if (
    identityTokens.alpha.toLowerCase().includes(identityTokens.bravo.toLowerCase()) ||
    identityTokens.bravo.toLowerCase().includes(identityTokens.alpha.toLowerCase())
  ) {
    tokenProblems.push(
      'one token is a substring of the other — substring matching would misattribute'
    )
  }
  steps.push({
    name: 'identity-tokens',
    ok: tokenProblems.length === 0,
    detail:
      tokenProblems.length === 0
        ? `alpha "${identityTokens.alpha}", bravo "${identityTokens.bravo}" — distinct, ` +
          'non-generic, long enough to accuse'
        : tokenProblems.join('; '),
  })
  if (tokenProblems.length > 0) {
    return finish(
      steps,
      capabilities,
      alpha,
      bravo,
      `the planted identity token vocabulary is unusable: ${tokenProblems.join('; ')}`
    )
  }

  // ---- 7. Fixture ----------------------------------------------------------
  if (!capabilities.has('api-key')) {
    steps.push({
      name: 'fixture',
      ok: false,
      detail: 'cannot provision the colliding fixture without REST API keys for both workspaces',
    })
    return finish(
      steps,
      capabilities,
      alpha,
      bravo,
      'the colliding two-workspace fixture could not be provisioned (no REST API keys). ' +
        'Without it, probes would compare non-colliding data and a PASS would prove nothing.'
    )
  }

  for (const handle of both) {
    try {
      const fixture = await provisionFixture(handle, config)
      fixture.adminUserId = handle.markers.ids.adminUserId ?? ''
      if (adminEmails[handle.slot]) fixture.adminEmail = adminEmails[handle.slot]!
      handle.fixture = fixture
      steps.push({
        name: `fixture:${handle.slot}`,
        ok: true,
        detail: `board ${fixture.boardId} "${fixture.boardTitle}", post ${fixture.postId} "${fixture.postTitle}"`,
      })
    } catch (err) {
      steps.push({
        name: `fixture:${handle.slot}`,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      })
      return finish(
        steps,
        capabilities,
        alpha,
        bravo,
        `fixture provisioning failed on ${handle.slot}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  // ---- 8. Markers and the collision gate -----------------------------------
  for (const handle of both) {
    const discovered = await discoverMarkers(handle)
    // Preserve ids learned earlier (the admin user id from sign-in).
    handle.markers.ids = { ...handle.markers.ids, ...discovered.ids }
    handle.markers.sensitive = { ...handle.markers.sensitive, ...discovered.sensitive }
  }

  // Workspace name, slug and the assistant principal id are genuine identity
  // markers — a leaked settings blob carries the name, not the id — but unlike
  // a fixture TypeID they can be identical across two workspaces. A shared value
  // cannot attribute anything and would fire the tripwire against each workspace's
  // own correct response, so non-exclusive markers are dropped from both. The
  // fixture ids are exempt: `verifyCollisions` has already established those
  // differ, because if they did not, the two URLs would be one database.
  // Generic candidates first. A workspace named `Support` or `Feature Requests`
  // is rendered by the OTHER workspace's own navigation, so admitting it as a
  // marker made the global tripwire and P08 accuse correctly isolated fleets.
  const generic: string[] = []
  for (const handle of both) {
    for (const key of ['workspaceName', 'workspaceSlug']) {
      const value = handle.markers.ids[key]
      if (value && isGenericToken(value)) {
        delete handle.markers.ids[key]
        generic.push(`${handle.slot}.${key}="${value}"`)
      }
    }
  }
  if (generic.length > 0) {
    steps.push({
      name: 'marker:generic-values-dropped',
      ok: true,
      detail:
        `${generic.join(', ')} — too generic to accuse. A value the other workspace's own UI would ` +
        "render anyway cannot be evidence that it served this workspace's data.",
    })
  }

  const shared: string[] = []
  for (const [key, value] of Object.entries(alpha.markers.ids)) {
    if (bravo.markers.ids[key] !== value) continue
    delete alpha.markers.ids[key]
    delete bravo.markers.ids[key]
    shared.push(`${key}="${value}"`)
  }
  if (shared.length > 0) {
    steps.push({
      name: 'marker:shared-values-pruned',
      ok: true,
      detail:
        `${shared.join(', ')} — identical across workspaces, so dropped from the tripwire vocabulary. ` +
        'A shared value cannot attribute a leak, and would otherwise fire against each workspace’s own ' +
        'correct response. Whether sharing it is itself a finding is decided by the owning probe.',
    })
  }

  // The planted identity tokens are installed AFTER both prunings above: the
  // `identity-tokens` gate has already proven them distinct, non-generic and
  // non-substring, so they can never be dropped — and they must never be,
  // because they are the vocabulary P06 judges on and the tripwire's strongest
  // marker. The operator planted each into a settings-derived field its host
  // renders publicly; P06 verifies that observability rather than assuming it.
  for (const handle of both) {
    handle.markers.ids.identityToken = identityTokens[handle.slot]
  }

  const collision = verifyCollisions(alpha, bravo)
  steps.push({
    name: 'fixture-is-adversarial',
    ok: collision.ok,
    detail: collision.ok
      ? `colliding on: ${collision.colliding.join('; ')}`
      : collision.problems.join('; '),
  })
  if (!collision.ok) {
    return finish(
      steps,
      capabilities,
      alpha,
      bravo,
      `the fixture is not adversarial: ${collision.problems.join('; ')}`
    )
  }

  log.info(
    { alpha: alpha.markers.ids, bravo: bravo.markers.ids },
    'preflight complete; marker vocabulary established'
  )

  return finish(steps, capabilities, alpha, bravo)
}

function finish(
  steps: PreflightStep[],
  capabilities: Set<Capability>,
  alpha: WorkspaceHandle,
  bravo: WorkspaceHandle,
  failureReason?: string
): PreflightOutput {
  const all: Capability[] = ['http', 'admin', 'db', 'storage-secret', 'api-key', 'widget-secret']
  return {
    ok: !failureReason,
    steps,
    capabilities,
    missing: all.filter((c) => !capabilities.has(c)),
    failureReason,
    alpha,
    bravo,
  }
}
