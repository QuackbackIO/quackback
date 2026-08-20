import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as mail from '@quackback/email'

/**
 * Every mail template must be classified by where its FROM comes from.
 *
 * This is `mail-class-coverage.test.ts`'s twin, on the other end of the
 * envelope, and it exists for the same reason. On a fleet, one mail provider
 * account signs for every workspace, so the From is a claim about which
 * workspace is speaking that the provider will carry out without checking. The
 * only thing that checks it is the sending-identity guard, and a new sender
 * that accepts a From typed as a plain string is the moment that guard becomes
 * optional — copy an adjacent caller, pass the address a row happened to hold,
 * done, and the impersonation ships green.
 *
 * Two things are pinned, because neither implies the other:
 *
 *  1. **Every sender is classified.** A new `send*Email` export is a decision
 *     about whether it may leave as anything other than the platform's own
 *     address, and this fails CI until someone states it.
 *  2. **Every `from` in the sender module is the branded type.** The class list
 *     records an intention; this checks the declaration that enforces it.
 *     `SendingIdentity` is minted in exactly one module — the guard — so a
 *     sender that demands one cannot be handed an unchecked address by any
 *     caller, in any file, through any import style. A `from?: string` would
 *     silently reopen that.
 *
 * `platform` is the safe default and needs no guard: omitting `from` means the
 * install's own configured sender, which every install is entitled to use.
 */
const MAIL_FROM_CLASS: Record<string, 'platform' | 'workspace-identity'> = {
  // The platform's own address, always. Nothing here is part of a customer's
  // thread, so nothing here has a reason to claim a customer's domain.
  sendPasswordResetEmail: 'platform',
  sendNewSignInEmail: 'platform',
  sendRecoveryCodeUsedEmail: 'platform',
  sendMagicLinkEmail: 'platform',
  // The other half of the sign-in request, and it must speak as the same
  // sender: it is the answer to a sign-in attempt, not part of any thread a
  // customer is having with the workspace.
  sendSignupNotAllowedEmail: 'platform',
  sendInvitationEmail: 'platform',
  sendPortalInviteEmail: 'platform',
  sendVerifyAddressEmail: 'platform',
  sendStatusChangeEmail: 'platform',
  sendNewCommentEmail: 'platform',
  sendPostMentionEmail: 'platform',
  sendNoteMentionEmail: 'platform',
  sendStatusIncidentPublishedEmail: 'platform',
  sendStatusMaintenanceScheduledEmail: 'platform',

  // May leave as an address the workspace proved it owns, so the From is
  // guard-minted or absent. These are the mails that sit inside a thread a
  // customer is already having with the workspace, where the platform's address
  // would visibly change who is speaking.
  sendConversationMessageEmail: 'workspace-identity',
  sendConversationClosedEmail: 'workspace-identity',
  sendConversationAutoAckEmail: 'workspace-identity',
  sendCsatRequestEmail: 'workspace-identity',
  sendTicketEventEmail: 'workspace-identity',
  sendChangelogPublishedEmail: 'workspace-identity',
  sendRawEmail: 'workspace-identity',

  // Exported with no production caller. Classified rather than deleted so the
  // decision to remove them is a separate, deliberate change.
  sendWelcomeEmail: 'platform',
  sendFeedbackLinkedEmail: 'platform',
}

const SENDER_MODULE = path.resolve(__dirname, '../../../../../../../packages/email/src/index.ts')

describe('mail sender identity coverage', () => {
  it('every exported sender has a From class', () => {
    const exported = Object.keys(mail).filter((k) => /^send\w*Email$/.test(k))
    const unclassified = exported.filter((k) => !(k in MAIL_FROM_CLASS))
    expect(
      unclassified,
      `New mail template(s) with no From class. Decide whether this mail may ever ` +
        `leave as a workspace's own domain, and add it to MAIL_FROM_CLASS:\n${unclassified.join('\n')}`
    ).toEqual([])
  })

  it('every class entry still corresponds to a real export', () => {
    const exported = new Set(Object.keys(mail))
    const stale = Object.keys(MAIL_FROM_CLASS).filter((k) => !exported.has(k))
    expect(stale, `Classified but no longer exported:\n${stale.join('\n')}`).toEqual([])
  })

  it('at least one sender is classified workspace-identity', () => {
    // Without this the declaration scan below could pass by scanning nothing —
    // a list that drifted to all-platform would make the guard vacuous and
    // still be green.
    const identity = Object.values(MAIL_FROM_CLASS).filter((v) => v === 'workspace-identity')
    expect(identity.length).toBeGreaterThanOrEqual(4)
  })

  it('every `from` declared in the sender module is the branded type', () => {
    const source = readFileSync(SENDER_MODULE, 'utf8')
    // Type declarations only: `from?: X` / `from: X` in a params shape. A
    // pass-through in an object literal (`from: params.from,`) reads the same
    // to a regex, and is told apart by the one thing a type reference in this
    // module never contains: a dot or a call.
    const declarations = [...source.matchAll(/^\s*from\??:\s*([^\n]+?)$/gm)]
      .map((m) => m[1].replace(/[,;]\s*$/, '').trim())
      .filter((t) => !t.includes('.') && !t.includes('('))
    expect(
      declarations.length,
      'no `from` declarations found in the sender module — the scan has drifted from the source'
    ).toBeGreaterThanOrEqual(5)
    const unbranded = declarations.filter((t) => t !== 'SendingIdentity')
    expect(
      unbranded,
      `A sender declares its From as something other than SendingIdentity:\n` +
        `${unbranded.join('\n')}\n\n` +
        `On a shared provider account the From is a claim the provider will carry ` +
        `out unchecked. Typing it as the brand is what forces the address through ` +
        `the sending-identity guard, which is the only thing that checks it.`
    ).toEqual([])
  })
})
