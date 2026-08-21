/**
 * An in-process two-workspace fleet, with leaks that can be switched on.
 *
 * The suite's own claim is that it detects cross-workspace leaks. That claim has to
 * be tested against something that actually leaks — a probe suite validated only
 * against a correct system is validated against the one case where every
 * possible implementation passes.
 *
 * So this file implements just enough of the Quackback HTTP surface for the
 * probes to run, with a `leaks` switchboard that reproduces each hazard named in
 * SAAS-HOSTING-STACK.md §4: a shared session store, a shared storage secret, a
 * shared API-key table, a shared search index.
 */

import { createHmac } from 'node:crypto'
import { createWorkspaceHttp, type FetchLike } from '../http'
import { createTripwire } from '../tripwire'
import type {
  Capability,
  ProbeConfig,
  ProbeContext,
  ProbeLogger,
  WorkspaceDb,
  WorkspaceHandle,
  WorkspaceSlot,
  TripwireRecorder,
} from '../types'
import { CANARY, FIXTURE, IDENTITY_TOKEN, fixturePostBody } from '../fixtures'
import { SCAN_TABLES } from '../db-scan'
import { fixtureBoardDescription } from '../fixtures'
import { toUuid } from '@quackback/ids'

export interface FleetLeaks {
  /** Either workspace honours the other's session cookie / bearer token. */
  sharedSessionStore?: boolean
  /** Both workspaces HMAC storage read tokens with the same secret. */
  sharedStorageSecret?: boolean
  /** Either workspace accepts the other's API key. */
  sharedApiKeys?: boolean
  /** Search on one workspace returns the other workspace's post. */
  sharedSearchIndex?: boolean
  /** Both workspaces verify widget identify tokens with the same secret. */
  sharedWidgetSecret?: boolean
  /** Both workspaces serve the same cached settings blob. */
  sharedSettingsCache?: boolean
  /**
   * A PARTIAL identity leak: the portal document serves alpha's cached name and
   * planted headline, while the widget config keeps serving each workspace's own
   * theme colour. The round-4 plant — every derived-vocabulary defence missed
   * it, because the leaked name was generic, the tripwire had dropped the same
   * generic name, and the host still rendered an identity of its own.
   */
  partialIdentityLeak?: boolean
  /**
   * Not a leak — a MISCONFIGURATION: the operator never planted the identity
   * token into anything the portal renders. P06 must report ERROR (it cannot
   * certify distinguishability it cannot observe), never PASS.
   */
  omitPlantedToken?: boolean
  /** Nothing responds at all. */
  offline?: boolean
  /**
   * Not a leak — a ROUTING failure: alpha's portal root redirects onto bravo's
   * origin. A probe that followed it would read bravo's document and report on
   * it as though it were alpha's, which is strictly worse than reading nothing.
   * The client refuses to cross origins, and being sent across is the finding.
   */
  crossHostRedirect?: boolean
  /** The portal document carries a fresh nonce on every request. */
  perRequestNonce?: boolean
  /** Background processing is switched off: a write produces no derived rows. */
  noBackgroundProcessing?: boolean
  /**
   * The drive write is ACCEPTED but inert: it returns < 400 and writes nothing.
   *
   * This is the live fleet's own behaviour, and reproducing it is the point.
   * P07 used to drive its background work by re-sending content the fixture post
   * already had; the request was accepted and changed nothing, while a derived
   * row left by an earlier run went on satisfying the positive control. The fake
   * fleet could not express "accepted, but nothing happened" at all — its only
   * negative shape was `noBackgroundProcessing`, which removes the stale rows too
   * — so the one arrangement that produced a false green was the one arrangement
   * the harness could not build.
   */
  inertDrive?: boolean
  /**
   * The judged board document does not render.
   *
   * Faithful to the real app: there is no `/b/$slug` index route — only
   * `/b/$slug/posts/$postId` — so a bare board URL answers 404 on every
   * deployment. This switch extends that to the post document as well, so a
   * probe judging a surface that rendered nothing can be held to reporting a
   * failed visibility control rather than "no foreign marker found".
   */
  portalDocumentNotFound?: boolean
  /** Both workspaces' assistant work is attributed to one shared principal id. */
  sharedAssistantPrincipal?: boolean
  /**
   * A shared, email-keyed credential stash (§4.1 `magicLinkStash` / `otpStash`).
   *
   * The policy decides WHICH workspace's value survives the collision, and therefore
   * which direction of cross-redemption can succeed. It is a genuine coin flip in
   * production — a `Map.set` is last-writer-wins, but mint ordering is not
   * something a probe suite gets to assume — so both polarities are tested.
   */
  sharedStash?: 'first-writer-wins' | 'last-writer-wins'
}

/** Per-workspace identity overrides, for building precision (non-leaking) fleets. */
export interface FleetIdentity {
  name?: string
  theme?: string
  customCss?: string | null
  /**
   * Control-plane workspace id. When set, this workspace signs storage read
   * capabilities over the POOLED message (`t:<id>|read|<key>`), reproducing
   * `workspaceBind` in `storage/s3.ts`. That binding is what makes a plain
   * cross-workspace replay refusable by arithmetic rather than by isolation, so a
   * fleet without it cannot exercise the case P03's interchange attempt exists
   * for.
   */
  workspaceKey?: string
}

export interface FakeSettings {
  id: string
  slug: string
  name: string
  widget_secret: string | null
  feature_flags: string | null
  branding_config: string | null
  custom_css: string | null
  portal_config: string | null
  widget_config: string | null
  auth_config_version: number
}

export interface FakeWorkspace {
  slot: WorkspaceSlot
  origin: string
  workspaceSlug: string
  workspaceName: string
  themeColor: string
  customCss: string | null
  /**
   * The planted per-workspace identity token, standing in for one the operator
   * stamped into a settings-derived field (here: the portal welcome-card
   * headline in `portal_config`, rendered by the portal document).
   */
  identityToken: string
  settingsUuid: string
  assistantPrincipalUuid: string
  canary: string
  boardId: string
  postId: string
  adminUserId: string
  sessionToken: string
  apiKey: string
  storageSecret: string
  widgetSecret: string
  assistantPrincipalId: string
  /** Set to sign storage capabilities over the pooled, workspace-bound message. */
  workspaceKey?: string
}

/**
 * Real, valid TypeIDs — not hand-typed lookalikes. `markerSearchForms` expands a
 * TypeID into its uuid form for database scanning, and a malformed id silently
 * skips that expansion, so a fixture that only looked like a TypeID would test
 * the harness against a case it never meets in production.
 */
const WORKSPACE_IDS: Record<
  WorkspaceSlot,
  Pick<FakeWorkspace, 'boardId' | 'postId' | 'adminUserId' | 'assistantPrincipalId'>
> = {
  alpha: {
    boardId: 'board_01kzf9qptsfez9r7tzffnppcw7',
    postId: 'post_01kzf9qptsfez9r7v4a96xm8fs',
    adminUserId: 'user_01kzf9qptsfez9r7vfr4anj508',
    assistantPrincipalId: 'principal_01kzf9qptsfez9r7vgxzydqhsb',
  },
  bravo: {
    boardId: 'board_01kzf9qptsfez9r7vs1cy0r0eb',
    postId: 'post_01kzf9qptsfez9r7w6rtffezwn',
    adminUserId: 'user_01kzf9qptsfez9r7wc5h4pxt0q',
    assistantPrincipalId: 'principal_01kzf9qptsfez9r7wqz0qta9zy',
  },
}

const WORKSPACE_IDENTITY: Record<
  WorkspaceSlot,
  { name: string; theme: string; uuid: string; principalUuid: string }
> = {
  alpha: {
    name: 'Alpha Workspace',
    theme: '#aa1122',
    uuid: '018f0000-0000-7000-8000-0000000000a1',
    principalUuid: '018f0000-0000-7000-8000-0000000000c1',
  },
  bravo: {
    name: 'Bravo Workspace',
    theme: '#22bb44',
    uuid: '018f0000-0000-7000-8000-0000000000b2',
    principalUuid: '018f0000-0000-7000-8000-0000000000d2',
  },
}

function makeWorkspace(slot: WorkspaceSlot): FakeWorkspace {
  return {
    slot,
    origin: `https://${slot}.probe.test`,
    workspaceSlug: `${slot}-workspace`,
    workspaceName: WORKSPACE_IDENTITY[slot].name,
    themeColor: WORKSPACE_IDENTITY[slot].theme,
    customCss: null,
    identityToken: IDENTITY_TOKEN[slot],
    settingsUuid: WORKSPACE_IDENTITY[slot].uuid,
    assistantPrincipalUuid: WORKSPACE_IDENTITY[slot].principalUuid,
    canary: CANARY[slot],
    ...WORKSPACE_IDS[slot],
    sessionToken: `sess-${slot}-token`,
    apiKey: `qb_${slot.padEnd(48, '0')}`,
    storageSecret: `s3-secret-${slot}`,
    widgetSecret: `wgt_${slot.padEnd(64, '0')}`,
  }
}

/**
 * The stored settings row for a workspace.
 *
 * Deliberately shaped like the critic's leak: the identity lives in `name`,
 * `slug` and the branding colour. `/api/widget/config.json` publishes only the
 * colour, and the portal document publishes only the name — neither carries the
 * workspace id or slug, which is precisely why a probe that searched for those
 * two strings could not see this leak at all.
 */
export function fakeSettings(t: FakeWorkspace): FakeSettings {
  return {
    id: t.settingsUuid,
    slug: t.workspaceSlug,
    name: t.workspaceName,
    widget_secret: t.widgetSecret,
    feature_flags: '{}',
    branding_config: JSON.stringify({ light: { primary: t.themeColor } }),
    custom_css: t.customCss ?? `:root { --primary: ${t.themeColor}; }`,
    // The planted token lives here, mirroring the operator stamping it into the
    // portal welcome-card headline — a settings-derived field the portal
    // document renders.
    portal_config: JSON.stringify({ welcomeCard: { title: t.identityToken } }),
    widget_config: '{}',
    auth_config_version: 0,
  }
}

/** Colliding on purpose: both workspaces' admin uses this address. */
export const ADMIN_EMAIL = 'admin@example.com'

const SHARED_STORAGE_SECRET = 's3-secret-shared-bucket'
const SHARED_WIDGET_SECRET = `wgt_${'shared'.padEnd(64, '0')}`

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

/**
 * Mirrors `storageReadSig` + `workspaceBind`: the signed message carries the
 * workspace when the deployment is pooled, and is the historical message byte for
 * byte when it is not.
 */
function storageSig(secret: string, key: string, workspaceKey?: string): string {
  const message = workspaceKey ? `t:${workspaceKey}|read|${key}` : `read|${key}`
  return createHmac('sha256', secret).update(message).digest('hex').slice(0, 32)
}

function verifyJwt(secret: string, token: string): Record<string, unknown> | null {
  const [header, payload, signature] = token.split('.')
  if (!header || !payload || !signature) return null
  const expected = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  if (expected !== signature) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export class FakeFleet {
  readonly alpha = makeWorkspace('alpha')
  readonly bravo = makeWorkspace('bravo')

  /** Live magic-link tokens and sign-in OTPs, per workspace, as the DB would hold them. */
  readonly liveMagicLinks = new Map<WorkspaceSlot, string>()
  readonly liveOtps = new Map<WorkspaceSlot, string>()
  private mintCounter = 1

  /**
   * `post_comments` rows written by drive writes during the run, per workspace.
   *
   * Held on the fleet rather than baked into the fixture rows because the drive
   * happens AFTER the fake database is built: `defaultDbRows` hands the scan this
   * very array, so a row appended here mid-probe is visible to a later scan. A
   * snapshot taken at construction time could only ever show rows that predate
   * the run, which is the exact blindness this probe was repaired for.
   */
  readonly driveRows: Record<WorkspaceSlot, Record<string, Array<Record<string, string>>>> = {
    alpha: { post_comments: [], events: [] },
    bravo: { post_comments: [], events: [] },
  }

  /** The value that survived a shared-stash collision, per credential type. */
  private stashSurvivor: { magic?: string; otp?: string } = {}

  constructor(
    readonly leaks: FleetLeaks = {},
    readonly identity: Partial<Record<WorkspaceSlot, FleetIdentity>> = {}
  ) {
    for (const slot of ['alpha', 'bravo'] as WorkspaceSlot[]) {
      const over = identity[slot]
      if (!over) continue
      const workspace = slot === 'alpha' ? this.alpha : this.bravo
      if (over.name !== undefined) workspace.workspaceName = over.name
      if (over.theme !== undefined) workspace.themeColor = over.theme
      if (over.customCss !== undefined) workspace.customCss = over.customCss
      if (over.workspaceKey !== undefined) workspace.workspaceKey = over.workspaceKey
    }
  }

  /** Record a freshly minted credential, honouring the shared-stash policy. */
  private mint(kind: 'magic' | 'otp', slot: WorkspaceSlot, value: string): void {
    const store = kind === 'magic' ? this.liveMagicLinks : this.liveOtps
    store.set(slot, value)
    if (!this.leaks.sharedStash) return
    const existing = this.stashSurvivor[kind]
    if (existing && this.leaks.sharedStash === 'first-writer-wins') return
    this.stashSurvivor[kind] = value
  }

  /**
   * Whether `value` is redeemable at `host`.
   *
   * Its own freshly minted value always is. Under a shared stash the surviving
   * value is redeemable EVERYWHERE, which is the account-takeover shape: the
   * code that reached one workspace's inbox opens the other workspace's account.
   */
  private redeemableAt(
    kind: 'magic' | 'otp',
    host: WorkspaceSlot,
    value: string
  ): { ok: boolean; owner: WorkspaceSlot | null } {
    const store = kind === 'magic' ? this.liveMagicLinks : this.liveOtps
    const owner = this.credentialOwner(store, value)
    if (owner === host) return { ok: true, owner }
    if (this.leaks.sharedStash && this.stashSurvivor[kind] === value) return { ok: true, owner }
    if (this.leaks.sharedSessionStore && owner) return { ok: true, owner }
    return { ok: false, owner }
  }

  private credentialOwner(store: Map<WorkspaceSlot, string>, value: string): WorkspaceSlot | null {
    if (!value) return null
    for (const [slot, held] of store) if (held === value) return slot
    return null
  }

  private workspaceFor(origin: string): FakeWorkspace | null {
    if (origin === this.alpha.origin) return this.alpha
    if (origin === this.bravo.origin) return this.bravo
    return null
  }

  private other(workspace: FakeWorkspace): FakeWorkspace {
    return workspace.slot === 'alpha' ? this.bravo : this.alpha
  }

  private storageSecretFor(workspace: FakeWorkspace): string {
    return this.leaks.sharedStorageSecret ? SHARED_STORAGE_SECRET : workspace.storageSecret
  }

  private widgetSecretFor(workspace: FakeWorkspace): string {
    return this.leaks.sharedWidgetSecret ? SHARED_WIDGET_SECRET : workspace.widgetSecret
  }

  /** The `storageSecret` an operator would hand the probe for this workspace. */
  publicStorageSecret(slot: WorkspaceSlot): string {
    return this.storageSecretFor(slot === 'alpha' ? this.alpha : this.bravo)
  }

  publicWidgetSecret(slot: WorkspaceSlot): string {
    return this.widgetSecretFor(slot === 'alpha' ? this.alpha : this.bravo)
  }

  readonly fetch: FetchLike = async (input, init) => {
    if (this.leaks.offline) throw new TypeError('fetch failed: connection refused')

    const url = new URL(typeof input === 'string' ? input : String(input))
    const workspace = this.workspaceFor(url.origin)
    if (!workspace) return new Response('unknown host', { status: 502 })

    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers as HeadersInit)
    const cookie = headers.get('cookie') ?? ''
    const auth = headers.get('authorization') ?? ''
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const path = url.pathname

    // ---- health ----------------------------------------------------------
    if (path === '/api/health/live') return json({ status: 'ok' })

    // ---- auth ------------------------------------------------------------
    if (path === '/api/auth/sign-in/email' && method === 'POST') {
      return json({ user: { id: workspace.adminUserId } }, 200, {
        'set-cookie': `better-auth.session_token=${workspace.sessionToken}.sig; Path=/; HttpOnly`,
      })
    }

    // ---- magic link and sign-in OTP ---------------------------------------
    // Both credentials are minted per workspace and recorded so `createFakeDb` can
    // serve them back out of the `verification` table, exactly as the real flow
    // requires the probe to read them.
    if (path === '/api/auth/sign-in/magic-link' && method === 'POST') {
      this.mint('magic', workspace.slot, `magic-${workspace.slot}-${this.mintCounter++}`)
      return json({ status: true })
    }

    if (path === '/api/auth/magic-link/verify') {
      const token = url.searchParams.get('token') ?? ''
      const { ok: accepted, owner } = this.redeemableAt('magic', workspace.slot, token)
      if (!accepted || !owner) {
        return new Response(null, {
          status: 302,
          headers: { location: '/auth/error?error=INVALID_TOKEN' },
        })
      }
      this.liveMagicLinks.delete(owner)
      const resolved =
        this.leaks.sharedSessionStore && owner !== workspace.slot
          ? this.other(workspace)
          : workspace
      return new Response(null, {
        status: 302,
        headers: {
          location: '/',
          'set-cookie': `better-auth.session_token=${resolved.sessionToken}.sig; Path=/; HttpOnly`,
        },
      })
    }

    if (path === '/api/auth/email-otp/send-verification-otp' && method === 'POST') {
      this.mint('otp', workspace.slot, String(100000 + this.mintCounter++))
      return json({ status: true })
    }

    if (path === '/api/auth/sign-in/email-otp' && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { otp?: string }
      const owner = this.credentialOwner(this.liveOtps, body.otp ?? '')
      const accepted = owner && (owner === workspace.slot || Boolean(this.leaks.sharedSessionStore))
      if (!accepted) return json({ error: { code: 'INVALID_OTP' } }, 400)
      this.liveOtps.delete(owner)
      const resolved =
        this.leaks.sharedSessionStore && owner !== workspace.slot
          ? this.other(workspace)
          : workspace
      return json({ user: { id: resolved.adminUserId } }, 200, {
        'set-cookie': `better-auth.session_token=${resolved.sessionToken}.sig; Path=/; HttpOnly`,
      })
    }

    if (path === '/api/auth/get-session') {
      const presented =
        /better-auth\.session_token=([^;]+)/.exec(cookie)?.[1]?.split('.')[0] ?? bearer
      const owner = this.sessionOwner(presented)
      if (!owner) return json(null)
      // A leaking fleet resolves the foreign session against THIS host's data,
      // which is exactly what a wrong-pool checkout looks like: a valid session
      // for the local identically-addressed admin.
      if (owner.slot !== workspace.slot && !this.leaks.sharedSessionStore) return json(null)
      const resolved = this.leaks.sharedSessionStore ? owner : workspace
      return json({
        session: { userId: resolved.adminUserId },
        user: { id: resolved.adminUserId, email: ADMIN_EMAIL },
      })
    }

    if (path === '/admin') {
      const presented = /better-auth\.session_token=([^;]+)/.exec(cookie)?.[1]?.split('.')[0] ?? ''
      const owner = this.sessionOwner(presented)
      const leaking = this.leaks.sharedSessionStore && owner && owner.slot !== workspace.slot
      // Mirrors the real app: a request the admin shell will not serve answers
      // `307 → /?auth=signin…` with a ZERO-BYTE body. A probe reading the
      // unfollowed response scans an empty string for foreign markers and finds
      // none — every time, on every fleet, leaking or not.
      if (!owner || (owner.slot !== workspace.slot && !leaking)) {
        return new Response(null, {
          status: 307,
          headers: { location: '/?auth=signin&callbackUrl=%2Fadmin' },
        })
      }
      return new Response(
        `<html><body>admin shell ${leaking ? owner.canary : workspace.canary}</body></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } }
      )
    }

    // ---- REST API --------------------------------------------------------
    if (path.startsWith('/api/v1/')) {
      const keyOwner = this.apiKeyOwner(bearer)
      const accepted =
        keyOwner && (keyOwner.slot === workspace.slot || Boolean(this.leaks.sharedApiKeys))
      if (!accepted) {
        return json(
          {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Invalid or missing API key.',
            },
          },
          401,
          { 'www-authenticate': 'Bearer realm="Quackback API"' }
        )
      }
      // Under `sharedApiKeys` the request is served by the LOCAL workspace, which
      // is the plausible-looking wrong answer.
      if (path === '/api/v1/boards' && method === 'GET') {
        return json({
          data: [{ id: workspace.boardId, slug: FIXTURE.boardSlug, name: FIXTURE.boardName }],
        })
      }
      if (path === '/api/v1/boards' && method === 'POST') {
        return json(
          { data: { id: workspace.boardId, slug: FIXTURE.boardSlug, name: FIXTURE.boardName } },
          201
        )
      }
      if (path === '/api/v1/posts' && method === 'GET') {
        const q = url.searchParams.get('search') ?? ''
        const matches = this.searchPosts(workspace, q)
        return json({ data: matches, meta: { pagination: { cursor: null, hasMore: false } } })
      }
      if (path === '/api/v1/posts' && method === 'POST') {
        return json({ data: { id: workspace.postId, title: FIXTURE.postTitle } }, 201)
      }
      if (path.startsWith('/api/v1/posts/') && method === 'PATCH') {
        return json({ data: { id: workspace.postId, title: FIXTURE.postTitle } })
      }
      // The drive write: a comment on the fixture post. Mirrors the real
      // endpoint's effects — a `post_comments` row plus a `comment.created`
      // outbox row whose payload carries the comment content — collapsed into
      // the one row shape the scan reads. Under `inertDrive` the request is
      // still accepted and still returns 201; it simply writes nothing, which is
      // what the live fleet's accepted-but-no-op drive looked like from outside.
      if (path.endsWith('/comments') && path.startsWith('/api/v1/posts/') && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { content?: string }
        const content = String(body.content ?? '')
        if (!this.leaks.inertDrive) {
          const postUuid = toUuid(workspace.postId)
          // The write's OWN row, inserted in the request's transaction. It lands
          // even where nothing processes it afterwards, which is why P07 does
          // not count it as evidence that work was driven.
          this.driveRows[workspace.slot].post_comments!.push({ post_id: postUuid, content })
          if (!this.leaks.noBackgroundProcessing) {
            // The outbox row the shared worker relay drains. Its payload carries
            // the post reference and the comment content, so this run's drive
            // token is findable in `events` as well as in `post_comments`.
            this.driveRows[workspace.slot].events!.push({
              entity_id: postUuid,
              payload: JSON.stringify({ comment: { content }, post: { id: postUuid } }),
            })
          }
        }
        return json({ data: { id: `post_comment_${workspace.slot}`, content } }, 201)
      }
      if (path.startsWith('/api/v1/posts/') && method === 'GET') {
        // The read-back the fixture uses so the collision gate compares stored
        // values rather than this harness's own constants.
        return json({
          data: {
            id: workspace.postId,
            title: FIXTURE.postTitle,
            content: fixturePostBody(workspace.slot),
            boardId: workspace.boardId,
          },
        })
      }
      return json({ error: { code: 'NOT_FOUND', message: 'no such endpoint' } }, 404)
    }

    // ---- storage ---------------------------------------------------------
    if (path.startsWith('/api/storage/')) {
      const key = decodeURIComponent(path.slice('/api/storage/'.length))
      const sig = url.searchParams.get('read')
      if (sig !== storageSig(this.storageSecretFor(workspace), key, workspace.workspaceKey)) {
        return json({ error: 'Invalid storage read token' }, 403)
      }
      // Signature accepted; the object does not exist, so this falls through to
      // the object path exactly as the real handler does.
      return new Response(null, {
        status: 302,
        headers: { location: 'https://storage.test/object' },
      })
    }

    // ---- widget ----------------------------------------------------------
    if (path === '/api/widget/identify' && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { ssoToken?: string }
      const claims = body.ssoToken
        ? verifyJwt(this.widgetSecretFor(workspace), body.ssoToken)
        : null
      if (!claims) return json({ error: { code: 'TOKEN_INVALID', message: 'bad token' } }, 400)
      return json({
        sessionToken: `widget-${workspace.slot}-session`,
        user: { id: `principal_widget_${workspace.slot}`, email: String(claims.email ?? '') },
        votedPostIds: [],
      })
    }

    if (path === '/api/widget/session') {
      const owner = bearer.startsWith('widget-alpha')
        ? this.alpha
        : bearer.startsWith('widget-bravo')
          ? this.bravo
          : null
      if (!owner) return json({ error: { code: 'AUTH_REQUIRED' } }, 401)
      if (owner.slot !== workspace.slot && !this.leaks.sharedSessionStore) {
        return json({ error: { code: 'AUTH_REQUIRED' } }, 401)
      }
      return json({ data: { user: { id: `principal_widget_${owner.slot}` } } })
    }

    if (path === '/api/widget/search') {
      const q = url.searchParams.get('q') ?? ''
      const posts = this.searchPosts(workspace, q).map((p) => ({
        id: p.id,
        title: p.title,
        board: { id: p.boardId, slug: FIXTURE.boardSlug },
      }))
      return json({ data: { posts } })
    }

    if (path === '/api/widget/config.json') {
      // Mirrors `lib/server/widget/public-config.ts`: theme, tabs and flags.
      // No workspace id, no slug, no name — the exact shape that defeated an
      // earlier version of P06, which searched only for the slug and the id.
      const source = this.leaks.sharedSettingsCache ? this.alpha : workspace
      return json({
        enabled: true,
        theme: { lightPrimary: source.themeColor, themeMode: 'user', radius: '0.5rem' },
        tabs: { feedback: true, changelog: true, help: true },
        hmacRequired: false,
      })
    }

    // ---- portal ----------------------------------------------------------
    //
    // The portal root CANONICALISES before it renders: the search schema
    // defaults `sort` to `trending`, so `GET /` answers `307 → /?sort=trending`
    // with a zero-byte body and the document lives one hop further on. This is
    // reproduced here because its absence is what let the probes go blind — the
    // fake fleet was more forgiving than the fleet it stands in for, so the
    // planted identity token rendered in every test and in no real run.
    if (path === '/' && !url.searchParams.has('sort')) {
      const target =
        this.leaks.crossHostRedirect && workspace.slot === 'alpha'
          ? `${this.other(workspace).origin}/?sort=trending`
          : '/?sort=trending'
      return new Response(null, { status: 307, headers: { location: target } })
    }

    // There is no board INDEX route in the app: the route tree carries
    // `/b/$slug/posts/$postId` and nothing at `/b/$slug`, so a bare board URL
    // answers 404 on every deployment. The fake fleet used to render a document
    // for any path under `/b/`, which is how P08 came to judge a surface that
    // 404s in production — two of its ten controls were passing against an empty
    // page. Reproduced here so the harness cannot be more forgiving than the
    // fleet it stands in for.
    const isPostDocument = /^\/b\/[^/]+\/posts\/[^/]+$/.test(path)
    if (path.startsWith('/b/') && !isPostDocument) {
      return new Response('not found', { status: 404 })
    }

    if (path === '/' || isPostDocument) {
      if (this.leaks.portalDocumentNotFound) {
        return new Response('not found', { status: 404 })
      }
      // The portal document carries the workspace NAME and the planted portal
      // headline — matching the real app, which renders the name and the
      // welcome-card title from portal_config and no other workspace identifier.
      // A full shared cache serves alpha's whole blob; a PARTIAL leak serves
      // alpha's name and headline while the widget config keeps each workspace's
      // own colour.
      const source =
        this.leaks.sharedSettingsCache || this.leaks.partialIdentityLeak ? this.alpha : workspace
      const headline = this.leaks.omitPlantedToken ? '' : ` ${source.identityToken}`
      const extra = this.leaks.sharedSearchIndex ? ` ${this.other(workspace).canary}` : ''
      // A per-request nonce, so the suite is held to the precision bar too: a
      // varying byte must never on its own produce a LEAK.
      const nonce = this.leaks.perRequestNonce
        ? `<meta name="csp-nonce" content="${Math.random()}">`
        : ''
      // The post document additionally renders the post itself, so it carries
      // the host's own canary the way the real page carries the post body. That
      // is what makes it a surface capable of testifying about workspace identity
      // at all — a document rendering none is one no "contains no foreign
      // marker" assertion can be read from.
      const body = isPostDocument ? ` ${fixturePostBody(source.slot)}` : ''
      return new Response(
        `<html><head>${nonce}<title>${source.workspaceName}</title></head>` +
          `<body>${source.workspaceName}${headline}${extra}${body}</body></html>`,
        { status: 200, headers: { 'content-type': 'text/html' } }
      )
    }

    return new Response('not found', { status: 404 })
  }

  private sessionOwner(token: string): FakeWorkspace | null {
    if (!token) return null
    if (token === this.alpha.sessionToken) return this.alpha
    if (token === this.bravo.sessionToken) return this.bravo
    return null
  }

  private apiKeyOwner(key: string): FakeWorkspace | null {
    if (!key) return null
    if (key === this.alpha.apiKey) return this.alpha
    if (key === this.bravo.apiKey) return this.bravo
    return null
  }

  private searchPosts(
    workspace: FakeWorkspace,
    q: string
  ): Array<{ id: string; title: string; content: string; boardId: string }> {
    const candidates = this.leaks.sharedSearchIndex ? [this.alpha, this.bravo] : [workspace]
    const results: Array<{ id: string; title: string; content: string; boardId: string }> = []
    for (const owner of candidates) {
      const content = fixturePostBody(owner.slot)
      const haystack = `${FIXTURE.postTitle} ${content}`.toLowerCase()
      if (q && !haystack.includes(q.toLowerCase())) continue
      results.push({ id: owner.postId, title: FIXTURE.postTitle, content, boardId: owner.boardId })
    }
    return results
  }
}

/**
 * A `WorkspaceDb` that answers the four query shapes the suite actually issues:
 * the settings row, the assistant principal, the `information_schema` column
 * listing, and the per-column `LIKE` scan.
 *
 * It reports every table in `SCAN_TABLES` as present, because a fake that
 * silently omitted them would make `scanCoverage` fail and mask whatever the
 * test was really about — the same class of narrowing that put `notifications`
 * (really `in_app_notifications`) in the scan list unnoticed.
 */
export interface FakeDbOptions {
  settings?: FakeSettings | null
  assistantPrincipalUuid?: string | null
  /** table -> rows, each row a column/value map, searched by the LIKE scan. */
  rows?: Record<string, Array<Record<string, string>>>
  /** Tables to omit from `information_schema`, for coverage tests. */
  omitTables?: string[]
  /** The live magic-link token this workspace most recently minted, if any. */
  liveMagicLinkToken?: () => string | undefined
  /** The live sign-in OTP this workspace most recently minted, if any. */
  liveOtpCode?: () => string | undefined
}

export function createFakeDb(slot: WorkspaceSlot, opts: FakeDbOptions = {}): WorkspaceDb {
  const rows = opts.rows ?? {}

  return {
    slot,
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      if (sql.includes('information_schema.columns')) {
        const omit = new Set(opts.omitTables ?? [])
        const out: Array<{ table_name: string; column_name: string }> = []
        for (const table of SCAN_TABLES) {
          if (omit.has(table)) continue
          const columns = new Set<string>(['id'])
          for (const row of rows[table] ?? []) for (const c of Object.keys(row)) columns.add(c)
          for (const column of columns) out.push({ table_name: table, column_name: column })
        }
        return out as T[]
      }

      // The `verification` table, which is the only place a magic-link token or
      // sign-in OTP can be read from — they leave the real server by email.
      if (sql.includes('FROM verification')) {
        if (sql.includes('identifier NOT LIKE')) {
          const token = opts.liveMagicLinkToken?.()
          return (token ? [{ identifier: token, value: '{}' }] : []) as T[]
        }
        const code = opts.liveOtpCode?.()
        return (code ? [{ value: `${code}:0` }] : []) as T[]
      }

      if (sql.includes('FROM settings')) {
        return (opts.settings ? [opts.settings] : []) as T[]
      }

      if (sql.includes("type = 'service'")) {
        return (opts.assistantPrincipalUuid ? [{ id: opts.assistantPrincipalUuid }] : []) as T[]
      }

      const scan = /FROM "([^"]+)"\s+WHERE "([^"]+)"::text LIKE/.exec(sql)
      if (scan) {
        const [, table, column] = scan
        const needle = String(params[0] ?? '').replace(/^%|%$/g, '')
        const hit = (rows[table] ?? []).find((r) => (r[column] ?? '').includes(needle))
        return (hit ? [{ sample: hit[column] }] : []) as T[]
      }

      return [] as T[]
    },
    async close() {},
  }
}

/** Legacy shim used by a couple of older cases: matches on a SQL substring. */
export function fakeDb(
  slot: WorkspaceSlot,
  rows: Record<string, Record<string, unknown>[]>
): WorkspaceDb {
  return {
    slot,
    async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
      for (const [needle, result] of Object.entries(rows)) {
        if (sql.includes(needle)) return result as T[]
      }
      return [] as T[]
    },
    async close() {},
  }
}

export const silentLogger: ProbeLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

export function baseConfig(fleet: FakeFleet, overrides: Partial<ProbeConfig> = {}): ProbeConfig {
  return {
    alphaUrl: fleet.alpha.origin,
    bravoUrl: fleet.bravo.origin,
    adminEmail: 'admin@example.com',
    adminPassword: 'password',
    alphaApiKey: fleet.alpha.apiKey,
    bravoApiKey: fleet.bravo.apiKey,
    alphaStorageSecret: fleet.publicStorageSecret('alpha'),
    bravoStorageSecret: fleet.publicStorageSecret('bravo'),
    alphaWidgetSecret: fleet.publicWidgetSecret('alpha'),
    bravoWidgetSecret: fleet.publicWidgetSecret('bravo'),
    allowBlocked: false,
    requestTimeoutMs: 5000,
    teardown: false,
    ...overrides,
  }
}

export interface TestContext extends ProbeContext {
  tripwire: TripwireRecorder
}

/**
 * The rows a healthy workspace would hold: its own fixture, the derived
 * `post_activity` row an EARLIER run left behind, and live references to the
 * rows this run's drive writes.
 *
 * The `post_activity` row is deliberately stale — it stands for the two-day-old
 * `post.created` row that satisfied P07's positive control on the live fleet
 * while nothing at all had happened. It is present on a healthy fleet AND on an
 * `inertDrive` fleet, because that is the arrangement that produced the false
 * green: real derived rows, from a run that is over.
 *
 * `post_comments` and `events` are handed out by REFERENCE, so rows the drive
 * appends mid-probe are visible to a scan that runs afterwards.
 */
export function defaultDbRows(
  fleet: FakeFleet,
  t: FakeWorkspace
): NonNullable<FakeDbOptions['rows']> {
  const postUuid = toUuid(t.postId)
  const rows: NonNullable<FakeDbOptions['rows']> = {
    posts: [{ id: postUuid, content: fixturePostBody(t.slot) }],
    boards: [{ description: fixtureBoardDescription(t.slot) }],
    post_comments: fleet.driveRows[t.slot].post_comments!,
    events: fleet.driveRows[t.slot].events!,
  }
  if (!fleet.leaks.noBackgroundProcessing) {
    rows.post_activity = [{ post_id: postUuid }]
  }
  return rows
}

/**
 * Build a `ProbeContext` wired to the fake fleet, with the fixture pre-populated.
 *
 * `withDb` attaches a fake database per workspace, populated from the same
 * `FakeFleet`, so the database-backed probes can run without a real Postgres.
 */
export function makeContext(
  fleet: FakeFleet,
  config = baseConfig(fleet),
  opts: { withDb?: boolean; dbRows?: Partial<Record<WorkspaceSlot, FakeDbOptions['rows']>> } = {}
): TestContext {
  const markers = (t: FakeWorkspace) => ({
    slot: t.slot,
    canary: t.canary,
    ids: {
      boardId: t.boardId,
      postId: t.postId,
      adminUserId: t.adminUserId,
      workspaceName: t.workspaceName,
      workspaceSlug: t.workspaceSlug,
      // Preflight installs this from the config (operator's token) falling back
      // to the suite default; mirror that here so probe-level tests see the
      // same marker vocabulary as an end-to-end run.
      identityToken:
        (t.slot === 'alpha' ? config.alphaIdentityToken : config.bravoIdentityToken) ??
        t.identityToken,
    },
  })

  const tripwire = createTripwire(markers(fleet.alpha), markers(fleet.bravo))

  const build = (t: FakeWorkspace): WorkspaceHandle => ({
    slot: t.slot,
    baseUrl: t.origin,
    markers: markers(t),
    http: createWorkspaceHttp({
      slot: t.slot,
      baseUrl: t.origin,
      tripwire,
      defaultTimeoutMs: config.requestTimeoutMs,
      fetchImpl: fleet.fetch,
    }),
    adminCookies: `better-auth.session_token=${t.sessionToken}.sig`,
    db: opts.withDb
      ? createFakeDb(t.slot, {
          settings: fakeSettings(t),
          assistantPrincipalUuid: fleet.leaks.sharedAssistantPrincipal
            ? fleet.alpha.assistantPrincipalUuid
            : t.assistantPrincipalUuid,
          rows: opts.dbRows?.[t.slot] ?? defaultDbRows(fleet, t),
        })
      : undefined,
    fixture: {
      workspaceName: t.workspaceSlug,
      adminEmail: config.adminEmail,
      adminUserId: t.adminUserId,
      adminPrincipalId: '',
      boardId: t.boardId,
      boardSlug: FIXTURE.boardSlug,
      boardTitle: FIXTURE.boardName,
      postId: t.postId,
      postTitle: FIXTURE.postTitle,
      postBody: fixturePostBody(t.slot),
    },
  })

  const alpha = build(fleet.alpha)
  const bravo = build(fleet.bravo)

  return {
    config,
    alpha,
    bravo,
    tripwire,
    capabilities: new Set<Capability>([
      'http',
      'admin',
      'api-key',
      'storage-secret',
      'widget-secret',
      ...(opts.withDb ? (['db'] as Capability[]) : []),
    ]),
    log: silentLogger,
    newClient(handle: WorkspaceHandle) {
      return createWorkspaceHttp({
        slot: handle.slot,
        baseUrl: handle.baseUrl,
        tripwire,
        defaultTimeoutMs: config.requestTimeoutMs,
        fetchImpl: fleet.fetch,
      })
    },
  }
}
