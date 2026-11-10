import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import * as mail from '@quackback/email'

/**
 * Every mail a visitor gets must carry the workspace's brand.
 *
 * A sender that takes `brand` falls back to Quackback gold when the caller
 * leaves it out, and nothing else notices: the mail still sends, the tests that
 * check it sent still pass, and the customer's visitors get a reply in someone
 * else's colours. So this pins it at the call site, the one place the omission
 * is visible.
 *
 *  1. **Every sender is classified.** A new `send*Email` export is a decision
 *     about who reads it, and this fails until someone states it.
 *  2. **Every call of a `visitor` sender passes `brand`.** Including the
 *     indirect hops a conversation reply and a CSAT request take on their way
 *     to the sender, where the brand has to ride along in a context object.
 */
const MAIL_BRAND_CLASS: Record<string, 'visitor' | 'team' | 'plain'> = {
  // Read by visitors (or by the team about a visitor's thread, which shows the
  // same branded template): every call must pass the brand.
  sendConversationMessageEmail: 'visitor',
  sendCsatRequestEmail: 'visitor',
  sendTicketEventEmail: 'visitor',
  sendPortalInviteEmail: 'visitor',
  sendMagicLinkEmail: 'visitor',
  sendSignupNotAllowedEmail: 'visitor',
  sendPasswordResetEmail: 'visitor',
  sendVerifyAddressEmail: 'visitor',
  sendStatusChangeEmail: 'visitor',
  sendNewCommentEmail: 'visitor',
  sendPostMentionEmail: 'visitor',
  sendChangelogPublishedEmail: 'visitor',
  sendStatusIncidentPublishedEmail: 'visitor',
  sendStatusMaintenanceScheduledEmail: 'visitor',

  // Human-looking replies to a visitor: neutral today, but carried in the brand
  // like every other mail in the thread.
  sendConversationClosedEmail: 'visitor',
  sendConversationAutoAckEmail: 'visitor',

  // A prerendered body: nothing for the brand to reach.
  sendRawEmail: 'plain',

  // To a teammate about the workspace itself, never to a visitor.
  sendInvitationEmail: 'team',
  sendNewSignInEmail: 'team',
  sendRecoveryCodeUsedEmail: 'team',
  sendSendingDomainAttentionEmail: 'team',
  sendNoteMentionEmail: 'team',
  sendOnboardingWelcomeEmail: 'team',
  sendOnboardingNudgeEmail: 'team',
  sendMessengerInstallEmail: 'team',
  // Exported with no production caller.
  sendWelcomeEmail: 'team',
  sendFeedbackLinkedEmail: 'team',
}

/**
 * The hops between a domain event and a `visitor` sender, where the brand has
 * to be carried in a context object. Each call of `callee` must name `key`.
 */
const BRAND_HOPS: Array<{ callee: RegExp; key: string; why: string }> = [
  {
    callee: /\bsendVisitorConversationEmail\(/g,
    key: 'emailBrand',
    why: 'the agent reply / agent-started email to the visitor',
  },
  {
    callee: /\.deliverAgentMessage\(/g,
    key: 'emailBrand',
    why: 'the channel hop an agent reply takes before it becomes an email',
  },
  {
    callee: /\.deliverCsatRequest\(/g,
    key: 'brand',
    why: 'the channel hop a CSAT request takes before it becomes an email',
  },
]

/**
 * Call sites that pass the brand without naming it, each with the reason. Keyed
 * `<file relative to src>#<callee>`.
 */
const SPREAD_CARRIES_BRAND: Record<string, string> = {
  // Spreads a TicketEmailConfig, whose `brand` targets.ts fills from the hook
  // context. The type check below keeps that field on the config.
  'lib/server/events/handlers/email.ts#sendTicketEventEmail': 'TicketEmailConfig',
}

const SRC = path.resolve(__dirname, '../../../..')

function productionSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      productionSources(full, out)
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

/** The text between the `(` at `open` and its matching `)`. */
function argsAt(source: string, open: number): string {
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const c = source[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return source.slice(open + 1)
}

interface CallSite {
  file: string
  line: number
  callee: string
  args: string
}

function callsOf(pattern: RegExp, files: string[], calleeName: string): CallSite[] {
  const sites: CallSite[] = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const m of source.matchAll(pattern)) {
      // A declaration, not a call.
      if (/function\s*$/.test(source.slice(Math.max(0, (m.index ?? 0) - 20), m.index))) continue
      const open = (m.index ?? 0) + m[0].lastIndexOf('(')
      sites.push({
        file: path.relative(SRC, file),
        line: source.slice(0, m.index).split('\n').length,
        callee: calleeName,
        args: argsAt(source, open),
      })
    }
  }
  return sites
}

const names = (key: string) => new RegExp(`\\b${key}\\b`)

describe('mail brand coverage', () => {
  const files = productionSources(SRC)

  it('every exported sender has a brand class', () => {
    const exported = Object.keys(mail).filter((k) => /^send\w*Email$/.test(k))
    const unclassified = exported.filter((k) => !(k in MAIL_BRAND_CLASS))
    expect(
      unclassified,
      `New mail sender(s) with no brand class. Decide who reads it and add it to ` +
        `MAIL_BRAND_CLASS:\n${unclassified.join('\n')}`
    ).toEqual([])
    const stale = Object.keys(MAIL_BRAND_CLASS).filter((k) => !(k in mail))
    expect(stale, `Classified but no longer exported:\n${stale.join('\n')}`).toEqual([])
  })

  it('every call of a visitor sender passes the brand', () => {
    const visitor = Object.entries(MAIL_BRAND_CLASS)
      .filter(([, c]) => c === 'visitor')
      .map(([n]) => n)
    const sites = visitor.flatMap((n) => [
      // Direct: sendX({ ... })
      ...callsOf(new RegExp(`\\b${n}\\(`, 'g'), files, n),
      // Through a recipient helper: mailContact(sendX, to, { ... })
      ...callsOf(new RegExp(`\\(\\s*${n}\\s*,`, 'g'), files, n),
    ])
    // The scan must find the senders it guards, or it passes by scanning nothing.
    expect(sites.length).toBeGreaterThanOrEqual(visitor.length)
    expect(sites.some((s) => s.callee === 'sendConversationMessageEmail')).toBe(true)
    expect(sites.some((s) => s.callee === 'sendCsatRequestEmail')).toBe(true)

    const missing = sites
      .filter((s) => !names('brand').test(s.args))
      .filter((s) => !(`${s.file}#${s.callee}` in SPREAD_CARRIES_BRAND))
      .map((s) => `${s.file}:${s.line} ${s.callee}`)
    expect(
      missing,
      `A visitor-facing mail is sent without the workspace brand, so it goes out ` +
        `in Quackback gold. Pass \`brand\` (the hook context's \`emailBrand\`):\n` +
        missing.join('\n')
    ).toEqual([])
  })

  it('every hop on the way to a visitor sender carries the brand', () => {
    for (const hop of BRAND_HOPS) {
      const sites = callsOf(hop.callee, files, hop.callee.source)
      expect(sites.length, `no calls found for ${hop.callee.source}`).toBeGreaterThan(0)
      const missing = sites
        .filter((s) => !names(hop.key).test(s.args))
        .map((s) => `${s.file}:${s.line}`)
      expect(
        missing,
        `${hop.why} drops the brand. Carry \`${hop.key}\` through:\n${missing.join('\n')}`
      ).toEqual([])
    }
  })

  it('a config spread in place of the brand still declares it', () => {
    const hookTypes = readFileSync(path.join(SRC, 'lib/server/events/hook-types.ts'), 'utf8')
    for (const typeName of new Set(Object.values(SPREAD_CARRIES_BRAND))) {
      const start = hookTypes.indexOf(`interface ${typeName} {`)
      expect(start, `${typeName} not found in hook-types.ts`).toBeGreaterThanOrEqual(0)
      const body = hookTypes.slice(start, hookTypes.indexOf('\n}', start))
      expect(body).toMatch(/\bbrand\?:\s*EmailBrand\b/)
    }
  })
})
