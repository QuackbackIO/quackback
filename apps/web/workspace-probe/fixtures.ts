/**
 * The deliberately colliding two-workspace fixture.
 *
 * Every human-readable field is IDENTICAL across alpha and bravo: the same
 * admin address, the same board name, the same post title. That is the whole
 * design. A wrong-workspace answer under pooled multi-tenancy is self-consistent
 * and passes every permission check, so a suite that asserts "bravo returned a
 * board called Feature Requests" would score a total isolation failure as a
 * pass. Only the per-workspace canary strings and the TypeIDs — which cannot
 * collide, being UUIDv7-derived — distinguish one workspace's row from the other's.
 *
 * Provisioning is idempotent: it finds the fixture by its stable slug/title and
 * creates it only when absent, so a second run observes exactly the state the
 * first run left and returns the same verdict.
 */

import type {
  Capability,
  ProbeConfig,
  WorkspaceFixture,
  WorkspaceHandle,
  WorkspaceMarkers,
  WorkspaceSlot,
} from './types'
import { ASSISTANT_PRINCIPAL_SQL, SETTINGS_ROW_SQL, typeId, type SettingsRow } from './db'

/** Stable, colliding fixture identity. Do not make these unique per workspace. */
export const FIXTURE = {
  /** Slug is stable so provisioning is find-or-create rather than create-always. */
  boardSlug: 'workspace-probe',
  /** Colliding on purpose. */
  boardName: 'Feature Requests',
  /** Colliding on purpose. */
  postTitle: 'Dark mode',
} as const

/**
 * Per-workspace canary tokens.
 *
 * Single lowercase alphanumeric words, so they survive Postgres full-text
 * tokenisation intact and can be searched for verbatim. A hyphenated marker
 * would be split by the FTS parser and the search-based probes would go blind.
 */
export const CANARY: Record<WorkspaceSlot, string> = {
  alpha: 'qbprobecanaryalpha',
  bravo: 'qbprobecanarybravo',
}

export function fixtureBoardDescription(slot: WorkspaceSlot): string {
  return `Workspace isolation probe fixture. Canary ${CANARY[slot]}. Safe to delete.`
}

export function fixturePostBody(slot: WorkspaceSlot): string {
  return `Workspace isolation probe fixture. Canary ${CANARY[slot]}. This text must never be visible from the other workspace.`
}

/**
 * The suite-owned per-workspace identity tokens.
 *
 * P06 does not infer what makes a workspace distinguishable — the suite PLANTS it.
 * One of these strings is stamped into a settings-derived field that a public
 * surface renders (the workspace name, or the portal welcome-card headline in
 * `portal_config`), so each host provably serves its own token and provably
 * never serves the other's. A partial identity leak — one field crossing while
 * the host keeps rendering its own — then fails by construction, because the
 * leaking surface carries the foreign planted token while missing the host's
 * own. No genericity filter is applied to these tokens: they are probe-owned,
 * like the canaries, and appear in no UI chrome anywhere.
 *
 * There is deliberately no auto-stamp: the app exposes no writable settings
 * endpoint (settings mutations are TanStack server functions behind the admin
 * UI, not addressable URLs), so the operator plants the token and the suite
 * verifies observability rather than assuming it. Pass
 * `--alpha-identity-token` / `--bravo-identity-token` when a custom token was
 * planted instead of these defaults.
 */
export const IDENTITY_TOKEN: Record<WorkspaceSlot, string> = {
  alpha: 'qbprobeidentityalpha',
  bravo: 'qbprobeidentitybravo',
}

/** The planted identity token in force for a workspace: operator's if given, else the default. */
export function identityTokenFor(slot: WorkspaceSlot, config: ProbeConfig): string {
  return slot === 'alpha'
    ? (config.alphaIdentityToken ?? IDENTITY_TOKEN.alpha)
    : (config.bravoIdentityToken ?? IDENTITY_TOKEN.bravo)
}

/** Thrown when the fixture could not be established. Always a run failure. */
export class ProvisioningError extends Error {
  constructor(
    readonly workspace: WorkspaceSlot,
    message: string
  ) {
    super(`[${workspace}] ${message}`)
    this.name = 'ProvisioningError'
  }
}

interface ApiEnvelope<T> {
  data?: T
  error?: { code?: string; message?: string }
}

interface ApiBoard {
  id: string
  name: string
  slug: string
  description?: string | null
}

interface ApiPost {
  id: string
  title: string
  content?: string
  boardId?: string
}

function apiKeyFor(slot: WorkspaceSlot, config: ProbeConfig): string | undefined {
  return slot === 'alpha' ? config.alphaApiKey : config.bravoApiKey
}

/**
 * Find-or-create the colliding board and post in one workspace, over the REST API.
 *
 * The REST API is used rather than direct SQL so the suite can provision a
 * deployment it has no database credentials for — "two hostnames in, verdict
 * out" only holds if the fixture can be established from outside.
 */
export async function provisionFixture(
  handle: WorkspaceHandle,
  config: ProbeConfig
): Promise<WorkspaceFixture> {
  const key = apiKeyFor(handle.slot, config)
  if (!key) {
    throw new ProvisioningError(
      handle.slot,
      `no REST API key supplied, so the colliding fixture cannot be provisioned. ` +
        `Pass --${handle.slot}-api-key (or ${handle.slot.toUpperCase()}_API_KEY).`
    )
  }
  const auth = { authorization: `Bearer ${key}` }
  const slot = handle.slot

  const boardsRes = await handle.http.request('/api/v1/boards', { headers: auth })
  if (boardsRes.status === 401) {
    throw new ProvisioningError(slot, 'REST API key was rejected (401) while listing boards')
  }
  if (!boardsRes.ok) {
    throw new ProvisioningError(
      slot,
      `GET /api/v1/boards returned ${boardsRes.status}: ${boardsRes.text.slice(0, 300)}`
    )
  }

  const boards = boardsRes.json<ApiEnvelope<ApiBoard[]>>()?.data ?? []
  let board = boards.find((b) => b.slug === FIXTURE.boardSlug)

  if (!board) {
    const createRes = await handle.http.request('/api/v1/boards', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        name: FIXTURE.boardName,
        slug: FIXTURE.boardSlug,
        description: fixtureBoardDescription(slot),
      }),
    })
    if (createRes.status !== 201 && createRes.status !== 200) {
      throw new ProvisioningError(
        slot,
        `could not create the probe board: POST /api/v1/boards returned ${createRes.status}: ${createRes.text.slice(0, 300)}`
      )
    }
    board = createRes.json<ApiEnvelope<ApiBoard>>()?.data
    if (!board?.id) {
      throw new ProvisioningError(slot, 'board creation returned no id')
    }
  }

  const searchRes = await handle.http.request(
    `/api/v1/posts?boardId=${encodeURIComponent(board.id)}&search=${encodeURIComponent(FIXTURE.postTitle)}&limit=50`,
    { headers: auth }
  )
  if (!searchRes.ok) {
    throw new ProvisioningError(
      slot,
      `GET /api/v1/posts returned ${searchRes.status}: ${searchRes.text.slice(0, 300)}. ` +
        'The API key needs the post view-private permission.'
    )
  }
  const existing = (searchRes.json<ApiEnvelope<ApiPost[]>>()?.data ?? []).find(
    (p) => p.title === FIXTURE.postTitle
  )

  let post = existing
  if (!post) {
    const createRes = await handle.http.request('/api/v1/posts', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        boardId: board.id,
        title: FIXTURE.postTitle,
        content: fixturePostBody(slot),
      }),
    })
    if (createRes.status !== 201 && createRes.status !== 200) {
      throw new ProvisioningError(
        slot,
        `could not create the probe post: POST /api/v1/posts returned ${createRes.status}: ${createRes.text.slice(0, 300)}`
      )
    }
    post = createRes.json<ApiEnvelope<ApiPost>>()?.data
    if (!post?.id) {
      throw new ProvisioningError(slot, 'post creation returned no id')
    }
  }

  // Read the fixture back from the server rather than reporting the constants
  // we asked for. The collision gate downstream compares these two workspaces'
  // values against each other; if they are filled in from `FIXTURE`, the gate
  // compares a constant to itself and reports a perfect collision no matter
  // what the servers actually stored. Two workspaces holding "Dark mode (alpha)"
  // and "Dark mode (bravo)" must fail the gate, not pass it.
  const readBack = await handle.http.request(`/api/v1/posts/${post.id}`, { headers: auth })
  const stored = readBack.json<ApiEnvelope<ApiPost>>()?.data
  if (!readBack.ok || !stored?.title) {
    throw new ProvisioningError(
      slot,
      `could not read the probe post back from the server (GET /api/v1/posts/${post.id} returned ` +
        `${readBack.status}), so the fixture's real stored values are unknown and the collision gate ` +
        `would be comparing this harness's own constants to themselves`
    )
  }

  const boards2 = await handle.http.request('/api/v1/boards', { headers: auth })
  const storedBoard = (boards2.json<ApiEnvelope<ApiBoard[]>>()?.data ?? []).find(
    (b) => b.id === board.id
  )

  return {
    workspaceName: '',
    adminEmail: config.adminEmail,
    adminUserId: '',
    adminPrincipalId: '',
    boardId: board.id,
    boardSlug: storedBoard?.slug ?? board.slug,
    boardTitle: storedBoard?.name ?? board.name,
    postId: stored.id,
    postTitle: stored.title,
    postBody: fixturePostBody(slot),
  }
}

/** Best-effort fixture removal, for `--teardown`. */
export async function teardownFixture(
  handle: WorkspaceHandle,
  config: ProbeConfig
): Promise<{ removed: string[]; failed: string[] }> {
  const key = apiKeyFor(handle.slot, config)
  const removed: string[] = []
  const failed: string[] = []
  if (!key) {
    failed.push('no API key supplied')
    return { removed, failed }
  }
  const auth = { authorization: `Bearer ${key}` }
  const fixture = handle.fixture
  if (fixture?.postId) {
    const res = await handle.http.request(`/api/v1/posts/${fixture.postId}`, {
      method: 'DELETE',
      headers: auth,
    })
    ;(res.status < 300 ? removed : failed).push(`post ${fixture.postId} (${res.status})`)
  }
  if (fixture?.boardId) {
    const res = await handle.http.request(`/api/v1/boards/${fixture.boardId}`, {
      method: 'DELETE',
      headers: auth,
    })
    ;(res.status < 300 ? removed : failed).push(`board ${fixture.boardId} (${res.status})`)
  }
  return { removed, failed }
}

/**
 * Assemble the tripwire marker vocabulary for one workspace.
 *
 * Every id here is unique to its workspace by construction (UUIDv7 under a TypeID
 * prefix), so any one of them appearing in a response served by the other
 * workspace is a cross-workspace observation with no benign explanation.
 */
export async function discoverMarkers(handle: WorkspaceHandle): Promise<WorkspaceMarkers> {
  const ids: Record<string, string> = {}
  const sensitive: Record<string, string> = {}

  if (handle.fixture?.boardId) ids.boardId = handle.fixture.boardId
  if (handle.fixture?.postId) ids.postId = handle.fixture.postId
  if (handle.fixture?.adminUserId) ids.adminUserId = handle.fixture.adminUserId
  if (handle.fixture?.adminPrincipalId) ids.adminPrincipalId = handle.fixture.adminPrincipalId

  if (handle.db) {
    const [settings] = await handle.db.query<SettingsRow>(SETTINGS_ROW_SQL)
    if (settings) {
      const workspaceId = typeId('workspace', settings.id)
      if (workspaceId) ids.workspaceId = workspaceId
      // The name and slug are what a leaked settings blob actually carries —
      // `/api/widget/config.json` has no identifier in it at all and the portal
      // document carries the name. They are admitted as CANDIDATES only:
      // preflight drops any that are generic (a workspace called `Support`
      // appears in the other workspace's own navigation) or shared between the
      // workspaces. `vocabulary.ts` reads this module's fixture constants, so the
      // filter deliberately lives there and not here.
      if (settings.name) ids.workspaceName = settings.name
      if (settings.slug) ids.workspaceSlug = settings.slug
      // Scanned like any other marker — a signing secret in a response body is
      // among the worst findings available — but held in `sensitive` so it is
      // redacted in hits and never serialized into the report.
      if (settings.widget_secret) sensitive.widgetSecret = settings.widget_secret
    }
    const [assistant] = await handle.db.query<{ id: string }>(ASSISTANT_PRINCIPAL_SQL)
    if (assistant) {
      const principalId = typeId('principal', assistant.id)
      if (principalId) ids.assistantPrincipalId = principalId
    }
  }

  return { slot: handle.slot, canary: CANARY[handle.slot], ids, sensitive }
}

export interface CollisionCheck {
  ok: boolean
  colliding: string[]
  problems: string[]
}

/**
 * Verify the fixture is actually adversarial before trusting any verdict.
 *
 * If the two workspaces do not collide on their human-readable fields, the probes
 * become trivial — a wrong-workspace answer would be obvious rather than plausible,
 * and a PASS would prove nothing. If they collide on an id or a canary, the
 * tripwire vocabulary is degenerate and cannot attribute a leak. Both are hard
 * failures, not warnings.
 */
export function verifyCollisions(alpha: WorkspaceHandle, bravo: WorkspaceHandle): CollisionCheck {
  const colliding: string[] = []
  const problems: string[] = []

  const a = alpha.fixture
  const b = bravo.fixture
  if (!a || !b) {
    return { ok: false, colliding, problems: ['fixture missing on one or both workspaces'] }
  }

  const mustCollide: Array<[string, string, string]> = [
    ['admin email', a.adminEmail, b.adminEmail],
    ['board title', a.boardTitle, b.boardTitle],
    ['board slug', a.boardSlug, b.boardSlug],
    ['post title', a.postTitle, b.postTitle],
  ]
  for (const [label, left, right] of mustCollide) {
    if (left && left === right) colliding.push(`${label} = "${left}"`)
    else problems.push(`${label} does not collide (alpha="${left}" bravo="${right}")`)
  }

  const mustDiffer: Array<[string, string, string]> = [
    ['board id', a.boardId, b.boardId],
    ['post id', a.postId, b.postId],
  ]
  for (const [label, left, right] of mustDiffer) {
    if (left && left === right) {
      problems.push(
        `${label} is identical across workspaces ("${left}") — the two targets are the same database`
      )
    }
  }

  if (alpha.markers.canary === bravo.markers.canary) {
    problems.push('canary strings are identical; a leak could not be attributed to a workspace')
  }

  // Deliberately NOT a blanket "every marker must differ" check.
  //
  // The fixture ids above are the setup contract: if those match, the two URLs
  // are one database and nothing downstream means anything. But `markers.ids`
  // also carries values DISCOVERED from the running workspaces — the assistant
  // service principal id, the workspace name — and those being identical is a
  // FINDING, not a setup error. Failing preflight on them turned a genuine
  // cross-workspace condition (one assistant principal serving both workspaces, the
  // §4.1 hazard P09 exists for) into "preflight failed", which reports as
  // ERROR/exit 1 instead of LEAK/exit 2 and buries the probe that would have
  // named it. Shared discovered markers are pruned from the tripwire vocabulary
  // in preflight instead, and left for their owning probe to adjudicate.

  return { ok: problems.length === 0, colliding, problems }
}

/** Capabilities a fixture provisioning run needs. */
export const PROVISIONING_CAPABILITIES: Capability[] = ['http', 'api-key']
