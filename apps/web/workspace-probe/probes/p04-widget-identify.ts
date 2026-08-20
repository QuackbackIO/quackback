/**
 * P04 — alpha's widget identify token against bravo.
 *
 * `POST /api/widget/identify` accepts an HS256 JWT signed with the workspace's
 * own `settings.widget_secret`, and mints a widget session for the identity in
 * `sub`/`email`. The claim set is caller-supplied, so if the secret ever spans
 * workspaces — or if workspace resolution hands the verifier the wrong workspace's
 * secret — a token minted for one workspace creates a real, logged-in end-user
 * session in the other.
 *
 * The synthetic visitor identity is identical on both workspaces, which is what
 * makes a wrong-workspace session indistinguishable from a correct one on every
 * field except the ids in the response.
 */

import { mintWidgetIdentityToken } from '../crypto'
import { blocked, control, decide, dirFrom, describeResponse, halt } from './helpers'
import type { ControlOutcome, Probe, ProbeContext, ProbeResponse } from '../types'

/** Colliding end-user identity. Not the admin: identify refuses team principals. */
const VISITOR_SUB = 'workspace-probe-visitor'
const VISITOR_EMAIL = 'probe-visitor@example.com'

const WIDGET_LEAK_REASON =
  'widget identity crossed the workspace boundary. Anyone able to mint a token for one workspace ' +
  'can impersonate the identically-addressed end user in the other.'

interface IdentifyBody {
  sessionToken?: string
  user?: { id?: string; email?: string }
  error?: { code?: string; message?: string }
}

function identified(res: ProbeResponse): IdentifyBody | null {
  const body = res.json<IdentifyBody>()
  return res.status === 200 && body?.sessionToken ? body : null
}

export const p04WidgetIdentify: Probe = {
  id: 'P04',
  name: 'widget-identify-token-cross-workspace',
  family: 'widget',
  proves:
    'A widget SSO token signed with one workspace’s widget secret mints no session in the other workspace, ' +
    'and a widget session token issued by one workspace resolves to no user in the other.',
  requires: ['http', 'widget-secret'],

  async run(ctx: ProbeContext) {
    const { alpha, bravo, config } = ctx
    const attempted =
      `sign a widget identify token for the colliding visitor ${VISITOR_EMAIL} with alpha's widget ` +
      `secret and present it to bravo (and the reverse), then replay alpha's resulting widget session token against bravo`

    const alphaSecret = config.alphaWidgetSecret
    const bravoSecret = config.bravoWidgetSecret
    if (!alphaSecret || !bravoSecret) {
      return blocked({
        attempted,
        reason:
          'both workspaces’ widget signing secrets are required. Supply --alpha-widget-secret and ' +
          '--bravo-widget-secret, or pass --alpha-db/--bravo-db and the suite reads them from settings.widget_secret.',
      })
    }

    const controls: ControlOutcome[] = []
    const claims = { sub: VISITOR_SUB, email: VISITOR_EMAIL, name: 'Isolation Probe Visitor' }
    const alphaToken = mintWidgetIdentityToken(alphaSecret, claims)
    const bravoToken = mintWidgetIdentityToken(bravoSecret, claims)

    controls.push(
      control(
        'invariant',
        'alpha and bravo hold different widget secrets',
        alphaSecret !== bravoSecret,
        alphaSecret !== bravoSecret
          ? 'distinct'
          : 'IDENTICAL — a token minted for either workspace is valid in both, so widget identity is forgeable across the boundary'
      )
    )

    const identify = (
      client: ReturnType<ProbeContext['newClient']>,
      token: string,
      foreign: boolean
    ) =>
      client.request('/api/widget/identify', {
        method: 'POST',
        body: JSON.stringify({ ssoToken: token }),
        expectsForeignMarkers: foreign,
      })

    // --- positive control ---------------------------------------------------
    const ownRes = await identify(ctx.newClient(alpha), alphaToken, false)
    const ownBody = identified(ownRes)
    controls.push(
      control(
        'positive',
        "alpha's identify token → alpha",
        Boolean(ownBody),
        ownBody
          ? `identified as ${ownBody.user?.id} with a widget session token`
          : `no session: ${describeResponse(ownRes, 200)}`
      )
    )
    if (!ownBody) {
      const code = ownRes.json<IdentifyBody>()?.error?.code
      // Routed through `decide()` rather than returned as a bare ERROR: the
      // shared-widget-secret invariant above may already have failed, and a
      // shared signing secret is a cross-workspace capability whether or not the
      // identify endpoint is reachable today.
      return halt({
        attempted,
        controls,
        stopped: {
          label: "alpha accepted a token signed with alpha's own widget secret",
          detail: describeResponse(ownRes, 300),
        },
        reason:
          code === 'WIDGET_DISABLED'
            ? 'the widget is disabled on alpha, so the identify path cannot be exercised at all. ' +
              'Enable the widget on both workspaces and re-run. This is not a pass.'
            : 'the positive control failed: alpha did not accept a token signed with the secret ' +
              'supplied for alpha, so a refusal from bravo proves nothing.',
        leakReason: WIDGET_LEAK_REASON,
      })
    }

    // --- negatives ----------------------------------------------------------
    const crossAtoB = await identify(ctx.newClient(bravo), alphaToken, true)
    const crossAtoBBody = identified(crossAtoB)
    controls.push(
      control(
        'negative',
        "alpha's identify token → bravo",
        crossAtoBBody === null,
        crossAtoBBody
          ? `SESSION MINTED for user ${crossAtoBBody.user?.id} — bravo accepted a token alpha signed`
          : `refused: ${describeResponse(crossAtoB, 160)}`,
        'a-to-b',
        'widget-identify-token'
      )
    )

    const crossBtoA = await identify(ctx.newClient(alpha), bravoToken, true)
    const crossBtoABody = identified(crossBtoA)
    controls.push(
      control(
        'negative',
        "bravo's identify token → alpha",
        crossBtoABody === null,
        crossBtoABody
          ? `SESSION MINTED for user ${crossBtoABody.user?.id} — alpha accepted a token bravo signed`
          : `refused: ${describeResponse(crossBtoA, 160)}`,
        'b-to-a',
        'widget-identify-token'
      )
    )

    // --- negative: replay each issued widget session token at the other host --
    //
    // A distinct code path from the signature check: the widget session token is
    // an opaque row lookup, not a signed credential. Run in both directions —
    // with a shared session store the surviving row decides which direction
    // succeeds, and a single-direction test leaves that to chance.
    const ownBravo = identified(await identify(ctx.newClient(bravo), bravoToken, false))
    for (const [fromSlot, toSlot, to, token] of [
      ['alpha', 'bravo', bravo, ownBody.sessionToken],
      ['bravo', 'alpha', alpha, ownBravo?.sessionToken],
    ] as const) {
      if (!token) {
        controls.push(
          control(
            'positive',
            `${fromSlot} minted a widget session token`,
            false,
            `${fromSlot} did not return a session token to replay`
          )
        )
        continue
      }
      const replay = await ctx.newClient(to).request('/api/widget/session', {
        headers: { authorization: `Bearer ${token}` },
        expectsForeignMarkers: true,
      })
      const replayedUser = replay.json<{ data?: { user?: { id?: string } | null } }>()?.data?.user
      controls.push(
        control(
          'negative',
          `${fromSlot}'s widget session token → ${toSlot} /api/widget/session`,
          !replayedUser,
          replayedUser
            ? `RESOLVED to user ${replayedUser.id} on ${toSlot}`
            : `refused: ${describeResponse(replay, 160)}`,
          dirFrom(fromSlot),
          'widget-session-replay'
        )
      )
    }

    return decide({
      attempted,
      controls,
      leakReason: WIDGET_LEAK_REASON,
      onPass: {
        observed:
          'each workspace minted a session only for a token signed with its own secret, and neither ' +
          'resolved the other’s widget session token',
        reason:
          'widget identity is bound to the per-workspace widget secret and its own session rows',
      },
      evidence: { visitor: VISITOR_EMAIL, alphaWidgetUserId: ownBody.user?.id },
    })
  },
}
