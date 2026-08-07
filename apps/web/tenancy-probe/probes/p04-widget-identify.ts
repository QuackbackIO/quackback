/**
 * P04 — alpha's widget identify token against bravo.
 *
 * `POST /api/widget/identify` accepts an HS256 JWT signed with the workspace's
 * own `settings.widget_secret`, and mints a widget session for the identity in
 * `sub`/`email`. The claim set is caller-supplied, so if the secret ever spans
 * tenants — or if tenant resolution hands the verifier the wrong workspace's
 * secret — a token minted for one tenant creates a real, logged-in end-user
 * session in the other.
 *
 * The synthetic visitor identity is identical on both tenants, which is what
 * makes a wrong-tenant session indistinguishable from a correct one on every
 * field except the ids in the response.
 */

import { mintWidgetIdentityToken } from '../crypto'
import { blocked, control, describeResponse, error, leak, pass } from './helpers'
import type { ControlOutcome, Probe, ProbeContext, ProbeResponse } from '../types'

/** Colliding end-user identity. Not the admin: identify refuses team principals. */
const VISITOR_SUB = 'tenancy-probe-visitor'
const VISITOR_EMAIL = 'probe-visitor@example.com'

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
  name: 'widget-identify-token-cross-tenant',
  family: 'widget',
  proves:
    'A widget SSO token signed with one tenant’s widget secret mints no session in the other tenant, ' +
    'and a widget session token issued by one tenant resolves to no user in the other.',
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
          'both tenants’ widget signing secrets are required. Supply --alpha-widget-secret and ' +
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
          : 'IDENTICAL — a token minted for either tenant is valid in both, so widget identity is forgeable across the boundary'
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
      return error({
        attempted,
        observed: describeResponse(ownRes, 300),
        reason:
          code === 'WIDGET_DISABLED'
            ? 'the widget is disabled on alpha, so the identify path cannot be exercised at all. ' +
              'Enable the widget on both tenants and re-run. This is not a pass.'
            : 'the positive control failed: alpha did not accept a token signed with the secret ' +
              'supplied for alpha, so a refusal from bravo proves nothing.',
        controls,
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
          : `refused: ${describeResponse(crossAtoB, 160)}`
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
          : `refused: ${describeResponse(crossBtoA, 160)}`
      )
    )

    // --- negative: replay the issued widget session token --------------------
    // A distinct code path: the widget session token is an opaque uuid looked up
    // in `session`, not a signed credential, so it exercises the row lookup
    // rather than the signature check.
    const replay = await ctx.newClient(bravo).request('/api/widget/session', {
      headers: { authorization: `Bearer ${ownBody.sessionToken}` },
      expectsForeignMarkers: true,
    })
    const replayedUser = replay.json<{ data?: { user?: { id?: string } | null } }>()?.data?.user
    controls.push(
      control(
        'negative',
        "alpha's widget session token → bravo /api/widget/session",
        !replayedUser,
        replayedUser
          ? `RESOLVED to user ${replayedUser.id} on bravo`
          : `refused: ${describeResponse(replay, 160)}`
      )
    )

    const failed = controls.filter((c) => c.kind !== 'positive' && !c.ok)
    if (failed.length > 0) {
      return leak({
        attempted,
        observed: failed.map((c) => `${c.label}: ${c.detail}`).join(' | '),
        reason:
          'widget identity crossed the tenant boundary. Anyone able to mint a token for one tenant ' +
          'can impersonate the identically-addressed end user in the other.',
        controls,
      })
    }

    return pass({
      attempted,
      observed:
        'each tenant minted a session only for a token signed with its own secret, and neither ' +
        'resolved the other’s widget session token',
      reason:
        'widget identity is bound to the per-workspace widget secret and its own session rows',
      controls,
      evidence: { visitor: VISITOR_EMAIL, alphaWidgetUserId: ownBody.user?.id },
    })
  },
}
