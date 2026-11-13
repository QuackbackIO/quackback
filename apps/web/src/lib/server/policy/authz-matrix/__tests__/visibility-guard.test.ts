/**
 * The visibility guard: a by-id read or write that skips the per-item
 * visibility check is a cross-team leak, so the loaders that skip it are
 * banned outside a short allowlist of system callers.
 *
 * Banned, by source scan of every server function, MCP tool, route and domain
 * module:
 *   - the unfiltered ticket loaders `getTicket(` and `loadTicketOr404(` (use
 *     `getTicketForActor` / `assertTicketVisible`),
 *   - the unfiltered conversation loader `loadConversationOr404(` and direct
 *     `canViewConversation(` calls (use `assertConversationVisible`),
 *   - in server functions and routes, a read of `tickets` that does not carry
 *     `ticketFilter` (`db.query.tickets`, `from(tickets)`),
 *   - `systemCascade: true` anywhere but the tracker status cascade, since it
 *     skips the per-ticket check.
 *
 * The allowlist names each caller by file and enclosing function. An entry
 * that no longer matches a call fails the test, so the list only shrinks. The
 * conversation entries are the paths that move to `assertConversationVisible`
 * with the conversation-side checks.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { walkSourceFiles } from '../../source-files'

const SRC_ROOT = join(__dirname, '../../../../..') // apps/web/src

/** The directories the guard scans, relative to SRC_ROOT. */
const SCANNED_DIRS = [
  'lib/server/functions',
  'lib/server/mcp',
  'lib/server/domains',
  'lib/server/integrations',
  'integrations',
  'routes',
]

/** Where an unfiltered `tickets` read is banned (agent request entry points). */
const ENTRY_POINT_DIRS = ['lib/server/functions/', 'routes/']

type Rule = 'getTicket' | 'loadTicketOr404' | 'loadConversationOr404' | 'canViewConversation'
type Violation = { file: string; fn: string; rule: Rule | 'unscopedTicketRead' | 'systemCascade' }

const CALL_RULES: { rule: Rule; pattern: RegExp }[] = [
  // A bare call: not a method call (`deps.getTicket(`), not a declaration.
  { rule: 'getTicket', pattern: /(?<![\w.$])getTicket\(/g },
  { rule: 'loadTicketOr404', pattern: /(?<![\w.$])loadTicketOr404\(/g },
  { rule: 'loadConversationOr404', pattern: /(?<![\w.$])loadConversationOr404\(/g },
  { rule: 'canViewConversation', pattern: /(?<![\w.$])canViewConversation\(/g },
]

/**
 * Callers that may skip the per-item check, keyed `file::function::rule`.
 * Each says why.
 */
const ALLOWLIST: Record<string, string> = {
  // The loaders themselves.
  'lib/server/domains/tickets/ticket.service.ts::getTicket::loadTicketOr404':
    'the unfiltered DTO read for system callers',
  // System callers with no teammate behind them.
  'lib/server/domains/tickets/ticket.service.ts::setTicketStatus::loadTicketOr404':
    'only under systemCascade: the tracker was checked once, the linked tickets are a system effect',
  'lib/server/domains/tickets/ticket.service.ts::autoReopenOnRequesterReply::loadTicketOr404':
    'the requester-reply reopen, a system effect of the requester writing',
  'lib/server/domains/tickets/ticket-message.service.ts::insertTicketMessage::loadTicketOr404':
    'shared by the requester reply and intake; agent callers check visibility first',
  'lib/server/domains/tickets/ticket-external-links.service.ts::buildTicketIssueData::loadTicketOr404':
    'the integration sync worker builds the issue body after the write was checked',
  'lib/server/domains/tickets/requester.service.ts::loadOwnedTicketOr404::loadTicketOr404':
    'the requester path checks ownership instead of team scope',
  'lib/server/domains/conversation/conversation.email-inbound.service.ts::ingestTicketReply::loadTicketOr404':
    'an inbound email reply, matched to the ticket by its reply token',
  'lib/server/domains/assistant/assistant.runtime.ts::loadTicketGroundingContext::getTicket':
    'the copilot gate has already asserted the ticket for the actor',
  // Conversation paths that move to assertConversationVisible with the
  // conversation-side checks.
  'lib/server/domains/conversation/conversation.service.ts::assertConversationViewable::loadConversationOr404':
    'conversation side: moves to assertConversationVisible',
  'lib/server/domains/conversation/conversation.service.ts::assertConversationViewable::canViewConversation':
    'conversation side: moves to assertConversationVisible',
  'lib/server/domains/conversation/conversation.service.ts::*::loadConversationOr404':
    'conversation side: the agent write sites move to assertConversationVisible',
  'lib/server/domains/conversation/conversation.service.ts::*::canViewConversation':
    'conversation side: moves to assertConversationVisible',
  'lib/server/domains/conversation/conversation-translation.service.ts::*::loadConversationOr404':
    'conversation side: translation moves to assertConversationVisible',
  'lib/server/domains/conversation/conversation.edit.ts::*::canViewConversation':
    'conversation side: moves to assertConversationVisible',
  'routes/api/chat/stream.ts::*::canViewConversation':
    'conversation side: the per-conversation stream moves to assertConversationVisible',
}

/** Callers that may pass `systemCascade: true`, keyed `file::function`. */
const SYSTEM_CASCADE_ALLOWLIST = new Set([
  'lib/server/domains/tickets/ticket.service.ts::cascadeTrackerStatus',
])

/** Blank out comments and string bodies, keeping offsets and line breaks. */
function stripCommentsAndStrings(source: string): string {
  return source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g,
    (match) => match.replace(/[^\n]/g, ' ')
  )
}

const DECLARATION =
  /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)|^(?:export\s+)?(?:const|let)\s+(\w+)\s*[=:]/

/** The top-level declaration a source offset sits in. */
function enclosingFunction(lines: string[], lineIndex: number): string {
  for (let i = lineIndex; i >= 0; i--) {
    const match = DECLARATION.exec(lines[i])
    if (match) return match[1] ?? match[2]
  }
  return '<module>'
}

/** Every banned use in one file's source. */
function scanForUnscopedLoads(file: string, source: string): Violation[] {
  const code = stripCommentsAndStrings(source)
  const lines = code.split('\n')
  const lineOf = (offset: number) => code.slice(0, offset).split('\n').length - 1
  const out: Violation[] = []

  for (const { rule, pattern } of CALL_RULES) {
    for (const match of code.matchAll(pattern)) {
      const line = lines[lineOf(match.index)]
      // A declaration of the loader is not a use of it.
      if (/\bfunction\s+\w+\s*\(/.test(line) && line.includes(`function ${rule}(`)) continue
      out.push({ file, fn: enclosingFunction(lines, lineOf(match.index)), rule })
    }
  }

  if (ENTRY_POINT_DIRS.some((dir) => file.startsWith(dir))) {
    for (const match of code.matchAll(/db\.query\.tickets\b|\.from\(\s*tickets\s*\)/g)) {
      // The read's own statement, up to the next blank line, must filter.
      const rest = code.slice(match.index)
      const end = rest.search(/\n\s*\n/)
      const statement = end === -1 ? rest : rest.slice(0, end)
      if (!statement.includes('ticketFilter(')) {
        out.push({
          file,
          fn: enclosingFunction(lines, lineOf(match.index)),
          rule: 'unscopedTicketRead',
        })
      }
    }
  }

  for (const match of code.matchAll(/systemCascade\s*:\s*true/g)) {
    out.push({ file, fn: enclosingFunction(lines, lineOf(match.index)), rule: 'systemCascade' })
  }
  return out
}

function allowlistKeyFor(v: Violation): string | null {
  const exact = `${v.file}::${v.fn}::${v.rule}`
  if (exact in ALLOWLIST) return exact
  const anyFn = `${v.file}::*::${v.rule}`
  if (anyFn in ALLOWLIST) return anyFn
  return null
}

function isAllowed(v: Violation): boolean {
  if (v.rule === 'systemCascade') return SYSTEM_CASCADE_ALLOWLIST.has(`${v.file}::${v.fn}`)
  return allowlistKeyFor(v) !== null
}

function scanTree() {
  const violations: Violation[] = []
  for (const dir of SCANNED_DIRS) {
    for (const abs of walkSourceFiles(join(SRC_ROOT, dir))) {
      const file = relative(SRC_ROOT, abs).split('\\').join('/')
      violations.push(...scanForUnscopedLoads(file, readFileSync(abs, 'utf8')))
    }
  }
  return violations
}

describe('visibility guard', () => {
  const violations = scanTree()

  it('finds no unscoped by-id loader outside the allowlist', () => {
    const offenders = violations
      .filter((v) => !isAllowed(v))
      .map((v) => `${v.file}::${v.fn}::${v.rule}`)
    expect(offenders).toEqual([])
  })

  it('has no stale allowlist entry', () => {
    const used = new Set(violations.map(allowlistKeyFor).filter((k): k is string => k !== null))
    const cascadeUsed = new Set(
      violations.filter((v) => v.rule === 'systemCascade').map((v) => `${v.file}::${v.fn}`)
    )
    expect(Object.keys(ALLOWLIST).filter((key) => !used.has(key))).toEqual([])
    expect([...SYSTEM_CASCADE_ALLOWLIST].filter((key) => !cascadeUsed.has(key))).toEqual([])
  })

  describe('catches a planted violation', () => {
    const planted = (file: string, source: string) =>
      scanForUnscopedLoads(file, source).filter((v) => !isAllowed(v))

    it('an unfiltered ticket loader in a server function', () => {
      expect(
        planted(
          'lib/server/functions/planted.ts',
          `export const readFn = createServerFn().handler(async ({ data }) => {
  return getTicket(data.ticketId)
})`
        )
      ).toEqual([{ file: 'lib/server/functions/planted.ts', fn: 'readFn', rule: 'getTicket' }])
    })

    it('a direct canViewConversation call in a server function', () => {
      expect(
        planted(
          'lib/server/functions/planted.ts',
          `export const readFn = createServerFn().handler(async ({ data }) => {
  const row = await load(data.id)
  if (!canViewConversation(actor, row).allowed) throw new Error('no')
})`
        )
      ).toEqual([
        { file: 'lib/server/functions/planted.ts', fn: 'readFn', rule: 'canViewConversation' },
      ])
    })

    it('an unscoped db.query.tickets read in a server function', () => {
      expect(
        planted(
          'lib/server/functions/planted.ts',
          `export const readFn = createServerFn().handler(async ({ data }) => {
  return db.query.tickets.findFirst({ where: eq(tickets.id, data.id) })
})`
        )
      ).toEqual([
        { file: 'lib/server/functions/planted.ts', fn: 'readFn', rule: 'unscopedTicketRead' },
      ])
    })

    it('an unscoped from(tickets) read in a route, but not a filtered one', () => {
      expect(
        planted(
          'routes/api/v1/planted.ts',
          `async function unscoped(id) {
  return db.select().from(tickets).where(eq(tickets.id, id))
}

async function scoped(id, actor) {
  return db.select().from(tickets).where(and(eq(tickets.id, id), ticketFilter(actor)))
}`
        )
      ).toEqual([{ file: 'routes/api/v1/planted.ts', fn: 'unscoped', rule: 'unscopedTicketRead' }])
    })

    it('a loader used by an allowlisted file but from a new function', () => {
      expect(
        planted(
          'lib/server/domains/tickets/ticket.service.ts',
          `export async function newAgentWrite(id, actor) {
  const row = await loadTicketOr404(id)
}`
        )
      ).toEqual([
        {
          file: 'lib/server/domains/tickets/ticket.service.ts',
          fn: 'newAgentWrite',
          rule: 'loadTicketOr404',
        },
      ])
    })

    it('systemCascade passed from anywhere but the tracker cascade', () => {
      expect(
        planted(
          'lib/server/domains/tickets/ticket.service.ts',
          `export async function bulkAnything(ids, actor) {
  for (const id of ids) await setTicketStatus(id, s, actor, { systemCascade: true })
}`
        )
      ).toEqual([
        {
          file: 'lib/server/domains/tickets/ticket.service.ts',
          fn: 'bulkAnything',
          rule: 'systemCascade',
        },
      ])
    })

    it('ignores a mention in a comment or a string', () => {
      expect(
        planted(
          'lib/server/functions/planted.ts',
          `// getTicket(id) is banned here
const note = 'loadTicketOr404(id)'`
        )
      ).toEqual([])
    })
  })
})
