/**
 * P02 — alpha's magic-link token and sign-in OTP redeemed on bravo's hostname.
 *
 * This is the probe SAAS-HOSTING-STACK.md §4.1 names first: `auth/index.ts:29-51`
 * keeps `magicLinkStash` and `otpStash` in module scope, keyed by nothing but a
 * lowercased email address. Two workspaces sharing `admin@example.com` — which this
 * fixture guarantees — overwrite each other's live credentials the moment the
 * process is shared. The document calls it "account-takeover adjacent".
 *
 * The construction that makes this probe sensitive: BOTH workspaces are made to
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
import { blocked, control, dirFrom, decide, halt } from './helpers'
import type { ControlOutcome, Probe, ProbeContext, ProbeOutcome, WorkspaceHandle } from '../types'

function expectedUserId(handle: WorkspaceHandle): string | undefined {
  return handle.markers.ids.adminUserId
}

const LEAK_REASON =
  'a sign-in credential minted by one workspace established a session on the other. With the ' +
  'colliding admin address this produces a session that looks entirely legitimate.'

export const p02MagicLinkOtp: Probe = {
  id: 'P02',
  name: 'magic-link-and-otp-cross-host',
  family: 'session',
  proves:
    'A magic-link token or sign-in OTP minted by one workspace cannot establish a session on the ' +
    'other, even while the other workspace holds its own live credential for the identical address — ' +
    'and each workspace’s own credential still resolves to its own user, not the colliding one.',
  requires: ['http', 'db', 'admin'],
  poolingCaveat:
    'The email-keyed stashes this probe was written against no longer exist as such: ' +
    '`magicLinkStash` and `otpStash` (auth/index.ts:73-74) are WorkspaceKeyedCache instances, so two ' +
    'workspaces sharing an address no longer share a key — and this probe never reaches them in any ' +
    'case, because it reads each workspace’s credential out of that workspace’s own `verification` table, ' +
    'the path a real recipient’s link travels. So a pass here is evidence about the ' +
    'database-backed redemption path and the workspace-keyed auth instance serving it: both refuse a ' +
    'credential the other workspace minted, in both directions, while both workspaces hold a live ' +
    'credential for the identical address. What it cannot separate is a correct refusal from a ' +
    'wrong-pool lookup that happened to miss: `verification` rows are per-workspace, so a token ' +
    'resolved against the wrong database finds no row and refuses exactly as it should have.',

  async run(ctx: ProbeContext): Promise<ProbeOutcome> {
    const { alpha, bravo, config } = ctx
    const email = config.adminEmail
    const attempted =
      `mint a live magic link and sign-in OTP for ${email} on BOTH workspaces, then redeem each ` +
      `workspace's credential against the other workspace's hostname`

    if (!alpha.db || !bravo.db) {
      return blocked({
        attempted,
        reason:
          'both workspace database URLs are required: the magic-link token and OTP leave the server by ' +
          'email and can only be read from the `verification` table. Pass --alpha-db and --bravo-db.',
      })
    }

    const controls: ControlOutcome[] = []
    const evidence: Record<string, unknown> = {}

    // ---- magic link --------------------------------------------------------
    const mintedA = await mintAndReadMagicLinkOn(alpha.http, alpha.db, email)
    const mintedB = await mintAndReadMagicLinkOn(bravo.http, bravo.db, email)

    if (mintedA.sendStatus === 429 || mintedB.sendStatus === 429) {
      return halt({
        attempted,
        controls,
        stopped: {
          label: 'a magic link could be minted on both workspaces',
          detail: `magic-link send rate-limited (alpha ${mintedA.sendStatus}, bravo ${mintedB.sendStatus})`,
        },
        reason:
          'the sign-in rate limiter refused to mint a credential, so the cross-workspace redemption was ' +
          'never attempted. This is not a pass. Clear the sign-in rate limit and re-run.',
        leakReason: LEAK_REASON,
        evidence,
      })
    }
    if (!mintedA.token || !mintedB.token) {
      return halt({
        attempted,
        controls,
        stopped: {
          label: 'a live magic-link row exists on both workspaces',
          detail: `alpha: ${mintedA.detail}; bravo: ${mintedB.detail}`,
        },
        reason:
          'could not obtain a live magic-link token on both workspaces, so the probe cannot execute',
        leakReason: LEAK_REASON,
        evidence,
      })
    }
    evidence.bothWorkspacesHeldLiveMagicLinkRows = true

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
          : `refused: ${crossAtoB.detail}`,
        'a-to-b',
        'magic-link-cross-redemption'
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
          : `refused: ${crossBtoA.detail}`,
        'b-to-a',
        'magic-link-cross-redemption'
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
    //
    // BOTH directions, deliberately. An earlier version attempted only
    // alpha's-OTP-on-bravo, and the in-process stash it targets
    // (`auth/index.ts:29-51`) is a Map keyed by lowercased email — so whichever
    // workspace minted LAST is the entry that survives, and the only redemption
    // that could succeed was the one never attempted. A shared stash produced a
    // fully green run. Which workspace survives is a property of the stash's write
    // order, not something this suite gets to assume, so both are tried.
    const otpA = await mintAndReadOtpOn(alpha.http, alpha.db, email)
    const otpB = await mintAndReadOtpOn(bravo.http, bravo.db, email)

    if (otpA.token && otpB.token) {
      evidence.bothWorkspacesHeldLiveOtpRows = true
      // Two identical six-digit codes would make a cross-redemption
      // indistinguishable from a correct one. Report it rather than emitting an
      // unreadable verdict.
      const codesCollided = otpA.token === otpB.token
      evidence.otpCodesCollided = codesCollided

      for (const [fromSlot, toSlot, to, code] of [
        ['alpha', 'bravo', bravo, otpA.token],
        ['bravo', 'alpha', alpha, otpB.token],
      ] as const) {
        const cross = await verifyOtpOn(ctx.newClient(to), email, code, {
          expectsForeignMarkers: true,
        })
        controls.push(
          control(
            'negative',
            `${fromSlot}'s sign-in OTP → ${toSlot} /api/auth/sign-in/email-otp`,
            !cross.sessionEstablished || codesCollided,
            cross.sessionEstablished
              ? codesCollided
                ? 'session established, but both workspaces minted the SAME six-digit code, so this is inconclusive — re-run'
                : `SESSION ESTABLISHED for user ${cross.userId}`
              : `refused: ${cross.detail}`,
            dirFrom(fromSlot),
            'otp-cross-redemption'
          )
        )
      }

      if (codesCollided) {
        controls.push(
          control(
            'visibility',
            'the two workspaces minted different six-digit OTPs',
            false,
            'both workspaces minted the same code, so a cross-workspace redemption is indistinguishable ' +
              'from a correct one. Re-run; a repeat suggests the codes are not independently generated.'
          )
        )
      }

      // Positive controls last, so a cross attempt cannot have consumed the row
      // first and "it still works at home" is proven rather than assumed.
      for (const [slot, handle, code, want] of [
        ['alpha', alpha, otpA.token, wantA],
        ['bravo', bravo, otpB.token, wantB],
      ] as const) {
        const own = await verifyOtpOn(ctx.newClient(handle), email, code)
        controls.push(
          control(
            'positive',
            `${slot}'s sign-in OTP → ${slot}`,
            own.sessionEstablished && (!want || own.userId === want),
            own.sessionEstablished
              ? own.userId === want || !want
                ? `session for user ${own.userId}`
                : `session established but for user ${own.userId}, expected ${slot}'s admin ${want}`
              : `no session: ${own.detail}`
          )
        )
      }
    } else {
      controls.push(
        control(
          'positive',
          'sign-in OTP minted on both workspaces',
          false,
          `alpha: ${otpA.detail}; bravo: ${otpB.detail}`
        )
      )
    }

    return decide({
      attempted,
      controls,
      leakReason: LEAK_REASON,
      onPass: {
        observed:
          'each workspace held a live magic-link row and OTP for the identical address; cross-workspace ' +
          'redemption was refused in BOTH directions for both credential types, and each workspace\u2019s own ' +
          'credential resolved to its own admin user',
        reason:
          'sign-in credentials are bound to the workspace that minted them, even under a full address collision',
      },
      evidence,
    })
  },
}
