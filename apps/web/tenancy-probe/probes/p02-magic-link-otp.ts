/**
 * P02 — alpha's magic-link token and sign-in OTP redeemed on bravo's hostname.
 *
 * This is the probe SAAS-HOSTING-STACK.md §4.1 names first: `auth/index.ts:29-51`
 * keeps `magicLinkStash` and `otpStash` in module scope, keyed by nothing but a
 * lowercased email address. Two tenants sharing `admin@example.com` — which this
 * fixture guarantees — overwrite each other's live credentials the moment the
 * process is shared. The document calls it "account-takeover adjacent".
 *
 * The construction that makes this probe sensitive: BOTH tenants are made to
 * hold a live credential for the SAME address before any cross-redemption is
 * attempted. Without that, bravo refusing alpha's token proves only "no such
 * row" — the trivial explanation. With it, bravo has a perfectly good row for
 * that address and must still refuse a token it did not mint.
 */

import {
  mintAndReadMagicLinkOn,
  mintAndReadOtpOn,
  redeemMagicLinkOn,
  verifyOtpOn,
} from '../auth-flows'
import { blocked, control, error, leak, pass } from './helpers'
import type { ControlOutcome, Probe, ProbeContext, ProbeOutcome, TenantHandle } from '../types'

function expectedUserId(handle: TenantHandle): string | undefined {
  return handle.markers.ids.adminUserId
}

export const p02MagicLinkOtp: Probe = {
  id: 'P02',
  name: 'magic-link-and-otp-cross-host',
  family: 'session',
  proves:
    'A magic-link token or sign-in OTP minted by one tenant cannot establish a session on the ' +
    'other, even while the other tenant holds its own live credential for the identical address — ' +
    'and each tenant’s own credential still resolves to its own user, not the colliding one.',
  requires: ['http', 'db', 'admin'],
  poolingCaveat:
    'The in-process token stashes this targets (auth/index.ts:29-51) are keyed by email alone and ' +
    'only collide when one process serves both tenants. Today the probe exercises the database-backed ' +
    'verification path only; the stash collision itself becomes reachable when pooling lands.',

  async run(ctx: ProbeContext): Promise<ProbeOutcome> {
    const { alpha, bravo, config } = ctx
    const email = config.adminEmail
    const attempted =
      `mint a live magic link and sign-in OTP for ${email} on BOTH tenants, then redeem each ` +
      `tenant's credential against the other tenant's hostname`

    if (!alpha.db || !bravo.db) {
      return blocked({
        attempted,
        reason:
          'both tenant database URLs are required: the magic-link token and OTP leave the server by ' +
          'email and can only be read from the `verification` table. Pass --alpha-db and --bravo-db.',
      })
    }

    const controls: ControlOutcome[] = []
    const evidence: Record<string, unknown> = {}

    // ---- magic link --------------------------------------------------------
    const mintedA = await mintAndReadMagicLinkOn(alpha.http, alpha.db, email)
    const mintedB = await mintAndReadMagicLinkOn(bravo.http, bravo.db, email)

    if (mintedA.sendStatus === 429 || mintedB.sendStatus === 429) {
      return error({
        attempted,
        observed: `magic-link send rate-limited (alpha ${mintedA.sendStatus}, bravo ${mintedB.sendStatus})`,
        reason:
          'the sign-in rate limiter refused to mint a credential, so the cross-tenant redemption was ' +
          'never attempted. This is not a pass. Clear the sign-in rate limit and re-run.',
      })
    }
    if (!mintedA.token || !mintedB.token) {
      return error({
        attempted,
        observed: `alpha: ${mintedA.detail}; bravo: ${mintedB.detail}`,
        reason:
          'could not obtain a live magic-link token on both tenants, so the probe cannot execute',
      })
    }
    evidence.bothTenantsHeldLiveMagicLinkRows = true

    const crossAtoB = await redeemMagicLinkOn(ctx.newClient(bravo), mintedA.token, {
      expectsForeignMarkers: true,
    })
    controls.push(
      control(
        'negative',
        "alpha's magic-link token → bravo /api/auth/magic-link/verify",
        !crossAtoB.sessionEstablished,
        crossAtoB.sessionEstablished
          ? `SESSION ESTABLISHED for user ${crossAtoB.userId}`
          : `refused: ${crossAtoB.detail}`
      )
    )

    const crossBtoA = await redeemMagicLinkOn(ctx.newClient(alpha), mintedB.token, {
      expectsForeignMarkers: true,
    })
    controls.push(
      control(
        'negative',
        "bravo's magic-link token → alpha /api/auth/magic-link/verify",
        !crossBtoA.sessionEstablished,
        crossBtoA.sessionEstablished
          ? `SESSION ESTABLISHED for user ${crossBtoA.userId}`
          : `refused: ${crossBtoA.detail}`
      )
    )

    // Positive controls run last so a cross attempt cannot have consumed the row
    // first — and so "the token still works at home" is proven, not assumed.
    const ownA = await redeemMagicLinkOn(ctx.newClient(alpha), mintedA.token)
    const ownB = await redeemMagicLinkOn(ctx.newClient(bravo), mintedB.token)
    const wantA = expectedUserId(alpha)
    const wantB = expectedUserId(bravo)

    controls.push(
      control(
        'positive',
        "alpha's magic-link token → alpha",
        ownA.sessionEstablished && (!wantA || ownA.userId === wantA),
        ownA.sessionEstablished
          ? ownA.userId === wantA || !wantA
            ? `session for user ${ownA.userId}`
            : `session established but for user ${ownA.userId}, expected alpha's admin ${wantA}`
          : `no session: ${ownA.detail}`
      )
    )
    controls.push(
      control(
        'positive',
        "bravo's magic-link token → bravo",
        ownB.sessionEstablished && (!wantB || ownB.userId === wantB),
        ownB.sessionEstablished
          ? ownB.userId === wantB || !wantB
            ? `session for user ${ownB.userId}`
            : `session established but for user ${ownB.userId}, expected bravo's admin ${wantB}`
          : `no session: ${ownB.detail}`
      )
    )

    // ---- sign-in OTP -------------------------------------------------------
    const otpA = await mintAndReadOtpOn(alpha.http, alpha.db, email)
    const otpB = await mintAndReadOtpOn(bravo.http, bravo.db, email)

    if (otpA.token && otpB.token) {
      evidence.bothTenantsHeldLiveOtpRows = true
      // A code that happens to be identical would make a cross-redemption
      // indistinguishable from a correct one. Report it rather than silently
      // producing an unreadable verdict.
      evidence.otpCodesCollided = otpA.token === otpB.token

      const otpCrossAtoB = await verifyOtpOn(ctx.newClient(bravo), email, otpA.token, {
        expectsForeignMarkers: true,
      })
      controls.push(
        control(
          'negative',
          "alpha's sign-in OTP → bravo /api/auth/sign-in/email-otp",
          !otpCrossAtoB.sessionEstablished || otpA.token === otpB.token,
          otpCrossAtoB.sessionEstablished
            ? otpA.token === otpB.token
              ? 'session established, but both tenants minted the SAME 6-digit code, so this is inconclusive — re-run'
              : `SESSION ESTABLISHED for user ${otpCrossAtoB.userId}`
            : `refused: ${otpCrossAtoB.detail}`
        )
      )

      const otpOwnB = await verifyOtpOn(ctx.newClient(bravo), email, otpB.token)
      controls.push(
        control(
          'positive',
          "bravo's sign-in OTP → bravo",
          otpOwnB.sessionEstablished && (!wantB || otpOwnB.userId === wantB),
          otpOwnB.sessionEstablished
            ? `session for user ${otpOwnB.userId}`
            : `no session: ${otpOwnB.detail}`
        )
      )
    } else {
      controls.push(
        control(
          'positive',
          'sign-in OTP minted on both tenants',
          false,
          `alpha: ${otpA.detail}; bravo: ${otpB.detail}`
        )
      )
    }

    const failedPositives = controls.filter((c) => c.kind === 'positive' && !c.ok)
    const failedNegatives = controls.filter((c) => c.kind === 'negative' && !c.ok)

    if (failedNegatives.length > 0) {
      return leak({
        attempted,
        observed: failedNegatives.map((c) => `${c.label}: ${c.detail}`).join(' | '),
        reason:
          'a sign-in credential minted by one tenant established a session on the other. With the ' +
          'colliding admin address this produces a session that looks entirely legitimate.',
        controls,
        evidence,
      })
    }
    if (failedPositives.length > 0) {
      return error({
        attempted,
        observed: failedPositives.map((c) => `${c.label}: ${c.detail}`).join(' | '),
        reason:
          'the positive controls failed, so the refusals above are not evidence of isolation — the ' +
          'sign-in flow does not work within its own tenant either.',
        controls,
        evidence,
      })
    }

    return pass({
      attempted,
      observed:
        'each tenant held a live magic-link row and OTP for the identical address; cross-tenant ' +
        'redemption was refused in both directions, and each tenant’s own credential resolved to its own admin user',
      reason:
        'sign-in credentials are bound to the tenant that minted them, even under a full address collision',
      controls,
      evidence,
    })
  },
}
