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
 *   - `systemCascade: true` anywhere but the callers that checked the item
 *     first (the tracker status cascade, the pair redirect, the read-state
 *     delegations of a checked ticket, one macro run), since it skips the
 *     per-item check,
 *   - a by-id read of `conversations` whose only filter is
 *     `eq(conversations.id, ...)`, inside a function that has an actor in
 *     hand (use `assertConversationVisible`, or add `conversationFilter`).
 *
 * The allowlist names each caller by file and enclosing function. An entry
 * that no longer matches a call fails the test, so the list only shrinks.
 *
 * A string ban cannot see a path that reads no row, or that reads it through
 * a system helper. So the entry-point walk also lists, by source scan, every
 * server function outside `functions/widget/` whose input takes a
 * `conversationId`, `conversationIds` or `messageId`, and fails when one is
 * neither named in a real-DB `conversation-visibility*.db.test.ts` matrix nor
 * on the entry-point allowlist with a reason. And every caller of
 * `applyMacroActions` must check the conversation itself, since the macro's
 * actions then skip their own check.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
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
type Violation = {
  file: string
  fn: string
  rule:
    Rule | 'unscopedTicketRead' | 'unscopedConversationRead' | 'systemCascade' | 'macroWithoutCheck'
}

const CALL_RULES: { rule: Rule; pattern: RegExp }[] = [
  // A bare call: not a method call (`deps.getTicket(`), not a declaration.
  { rule: 'getTicket', pattern: /(?<![\w.$])getTicket\(/g },
  { rule: 'loadTicketOr404', pattern: /(?<![\w.$])loadTicketOr404\(/g },
  { rule: 'loadConversationOr404', pattern: /(?<![\w.$])loadConversationOr404\(/g },
  { rule: 'canViewConversation', pattern: /(?<![\w.$])canViewConversation\(/g },
]

/**
 * By-id conversation reads in a function that holds an actor, keyed
 * `file::function::unscopedConversationRead`. Each says why the read needs no
 * filter of its own.
 */
const BY_ID_CONVERSATION_READS: Record<string, string> = {
  'lib/server/domains/assistant/assistant.runtime.ts::runAssistantTurn::unscopedConversationRead':
    'the copilot gate checked the conversation for the actor before the turn runs',
  'lib/server/domains/conversation/conversation.edit.ts::applyEdit::unscopedConversationRead':
    'reloads the row after editConversationMessage checked it, for the published DTO',
  'lib/server/domains/conversation/conversation.query.ts::listConversationsForAgent::unscopedConversationRead':
    'reads only the page cursor position; the page itself is filtered by conversationFilter',
  'lib/server/domains/conversation/conversation.service.ts::sendVisitorMessage::unscopedConversationRead':
    'the visitor send: the owner check runs on the row it reads',
  'lib/server/domains/conversation/conversation.service.ts::sendAgentMessage::unscopedConversationRead':
    're-reads inside the write transaction after the check at the top of the function',
  'lib/server/domains/conversation/conversation.service.ts::recordCsat::unscopedConversationRead':
    'reads after assertConversationViewable checked the row',
  'lib/server/domains/conversation-attributes/set-attribute.service.ts::setConversationAttribute::unscopedConversationRead':
    'builds the change event after the write; every agent caller checked the conversation',
  'lib/server/domains/tickets/ticket-conversation-link.service.ts::linkTicketToConversation::unscopedConversationRead':
    'locks the row after assertConversationVisible at the top of the function',
  'lib/server/integrations/sync/eligibility.ts::validateSyncSource::unscopedConversationRead':
    'the sync worker re-validating a queued operation, with no teammate request behind it',
}

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
  'lib/server/domains/conversation/conversation.service.ts::loadForAgentWrite::loadConversationOr404':
    'only under systemCascade: the caller checked the item once',
  'lib/server/domains/conversation/conversation.service.ts::addAgentNote::loadConversationOr404':
    'reloads the row after the checked write, for the published DTO',
  'lib/server/domains/conversation/conversation.service.ts::autoFileConversationAsSpam::loadConversationOr404':
    'the spam classifier, a system effect with no teammate behind it',
  'lib/server/domains/conversation/conversation.service.ts::executeAssistantHandoff::loadConversationOr404':
    'the assistant handing over, a system effect with no teammate behind it',
  'lib/server/domains/conversation/conversation.service.ts::sendVisitorMessage::canViewConversation':
    'decides only whether a refused visitor send may say why; the owner check runs first',
  // By-id conversation reads in functions that hold an actor, each covered.
  ...BY_ID_CONVERSATION_READS,
}

/** Callers that may pass `systemCascade: true`, keyed `file::function`. */
const SYSTEM_CASCADE_ALLOWLIST = new Set([
  'lib/server/domains/tickets/ticket.service.ts::cascadeTrackerStatus',
  // The agent caller checked the ticket; a tracker reply-all is a system effect.
  'lib/server/domains/tickets/ticket-message.service.ts::sendViaPairConversation',
  // Read state of a ticket the caller checked lives on its pair's conversation.
  'lib/server/domains/tickets/ticket-unread.service.ts::markTicketReadForAgent',
  'lib/server/domains/tickets/ticket-unread.service.ts::markTicketUnreadFromMessage',
  // One macro run, after its caller checked the conversation (see below).
  'lib/server/domains/macros/macro.actions.ts::applyMacroActions',
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

/** The line the enclosing top-level declaration starts on. */
function declarationLine(lines: string[], lineIndex: number): number {
  for (let i = lineIndex; i >= 0; i--) if (DECLARATION.test(lines[i])) return i
  return 0
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

  // A by-id read of `conversations` whose only filter is its id, in a
  // function that has an actor in hand (named before the read).
  for (const match of code.matchAll(/\.from\(\s*conversations\s*\)|db\.query\.conversations\b/g)) {
    const rest = code.slice(match.index)
    const end = rest.search(/\n\s*\n/)
    const statement = end === -1 ? rest : rest.slice(0, end)
    if (!/(?:\.where\(|where:)\s*eq\(\s*conversations\.id\b/.test(statement)) continue
    const line = lineOf(match.index)
    const declStart = declarationLine(lines, line)
    const before = lines.slice(declStart, line + 1).join('\n')
    if (!/[aA]ctor\b/.test(before)) continue
    out.push({ file, fn: enclosingFunction(lines, line), rule: 'unscopedConversationRead' })
  }

  // A macro's actions skip their own check, so its caller checks first.
  if (!file.endsWith('macros/macro.actions.ts')) {
    for (const match of code.matchAll(/(?<![\w.$])applyMacroActions\(/g)) {
      const line = lineOf(match.index)
      const start = declarationLine(lines, line)
      const next = lines.findIndex((l, i) => i > start && DECLARATION.test(l))
      const body = lines.slice(start, next === -1 ? undefined : next).join('\n')
      if (!/\bassertConversationVisible\(|\bassertVisibleToCaller\(/.test(body)) {
        out.push({ file, fn: enclosingFunction(lines, line), rule: 'macroWithoutCheck' })
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
  if (v.rule === 'macroWithoutCheck') return false
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

// ---------------------------------------------------------------------------
// Entry-point walk
// ---------------------------------------------------------------------------

/** A server function input field that names a conversation or one of its messages. */
const CONVERSATION_INPUT =
  /\b(?:conversationId|conversationIds|messageId)\s*:|\bwithAssistantItemRef\(/

/**
 * Server functions that take a conversation id but need no row in the real-DB
 * matrix, keyed `file::function`. Each says why.
 */
const ENTRY_POINT_ALLOWLIST: Record<string, string> = {
  'lib/server/functions/conversation.ts::getMyConversationFn':
    "the visitor reads their own conversation; another visitor's id answers nothing",
  'lib/server/functions/conversation.ts::sendConversationMessageFn':
    'the visitor send; sendVisitorMessage checks ownership',
  'lib/server/functions/conversation.ts::submitCsatFn':
    'the visitor rates their own conversation; recordCsat checks it',
  'lib/server/functions/tickets.ts::getConversationLinkedTicketFn':
    'the requester read, scoped to the requester',
  'lib/server/functions/tickets.ts::markTicketUnreadFromMessageFn':
    'checks the ticket; the anchor must hang off that ticket or its pair (ticket-visibility tests)',
  'lib/server/functions/tickets.ts::linkTicketToConversationFn':
    'checks both sides; covered by ticket-visibility-links.db.test.ts',
  'lib/server/functions/tickets.ts::suggestTicketFieldValuesFn':
    'checks the conversation through assertConversationViewable before any read',
  'lib/server/functions/copilot-events.ts::recordCopilotEventFn':
    'copilot-gated: gateCopilotFn checks the item for the caller',
}

/** Where a named import of `file` comes from, when it is a source file here. */
function resolveImport(file: string, specifier: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(SRC_ROOT, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(file), specifier)
  else return null
  return [`${base}.ts`, join(base, 'index.ts')].find((p) => existsSync(p)) ?? null
}

/** The top-level `const` initialisers of a file and, two hops deep, of its named imports. */
function constantsOf(file: string, depth = 0): Map<string, string> {
  const source = stripCommentsAndStrings(readFileSync(file, 'utf8'))
  const raw = readFileSync(file, 'utf8')
  const consts = new Map<string, string>()
  for (const m of source.matchAll(
    /^(?:export\s+)?const\s+(\w+)\s*=([\s\S]*?)(?=\n\S|(?![\s\S]))/gm
  )) {
    consts.set(m[1], m[2])
  }
  if (depth < 2) {
    for (const m of raw.matchAll(/^import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'([^']+)'/gm)) {
      const target = resolveImport(file, m[2])
      if (!target) continue
      const theirs = constantsOf(target, depth + 1)
      for (const spec of m[1].split(',')) {
        const [name, alias] = spec.trim().split(/\s+as\s+/)
        if (name && theirs.has(name)) consts.set(alias ?? name, theirs.get(name)!)
      }
    }
  }
  return consts
}

/** The input text a server function's validator reads, with its schema constants expanded. */
function validatorInput(body: string, consts: Map<string, string>): string | null | 'none' {
  if (!/\.(?:validator|inputValidator)\(/.test(body)) return 'none'
  const v = /\.(?:validator|inputValidator)\(([\s\S]*?)\)\s*\n\s*\.handler/.exec(body)
  if (!v) return null
  let text = v[1]
  const seen = new Set<string>()
  for (let round = 0; round < 4; round++) {
    for (const id of text.match(/\b\w+\b/g) ?? []) {
      if (consts.has(id) && !seen.has(id)) {
        seen.add(id)
        text += consts.get(id)
      }
    }
  }
  return text
}

/** Every server function outside functions/widget/ whose input takes a conversation id. */
function conversationEntryPoints(): { key: string; unparsed: boolean }[] {
  const out: { key: string; unparsed: boolean }[] = []
  const root = join(SRC_ROOT, 'lib/server/functions')
  for (const abs of walkSourceFiles(root)) {
    const file = relative(SRC_ROOT, abs).split('\\').join('/')
    if (file.startsWith('lib/server/functions/widget/')) continue
    const code = stripCommentsAndStrings(readFileSync(abs, 'utf8'))
    const consts = constantsOf(abs)
    for (const m of code.matchAll(
      /^export const (\w+)\s*=\s*createServerFn[\s\S]*?(?=\n\S|(?![\s\S]))/gm
    )) {
      const input = validatorInput(m[0], consts)
      if (input === 'none') continue
      if (input === null) out.push({ key: `${file}::${m[1]}`, unparsed: true })
      else if (CONVERSATION_INPUT.test(input))
        out.push({ key: `${file}::${m[1]}`, unparsed: false })
    }
  }
  return out
}

/** The source of every real-DB conversation visibility matrix. */
function matrixSources(dir = SRC_ROOT, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const p = join(dir, entry.name)
    if (entry.isDirectory()) matrixSources(p, acc)
    else if (/^conversation-visibility.*\.db\.test\.ts$/.test(entry.name)) {
      acc.push(readFileSync(p, 'utf8'))
    }
  }
  return acc
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

  describe('entry-point walk', () => {
    const entryPoints = conversationEntryPoints()
    const matrices = matrixSources().join('\n')

    it('finds the conversation entry points (the walk itself works)', () => {
      const keys = entryPoints.map((e) => e.key)
      expect(keys).toContain('lib/server/functions/conversation.ts::sendAgentMessageFn')
      expect(keys).toContain('lib/server/functions/conversation.ts::bulkUpdateConversationsFn')
      expect(keys).toContain('lib/server/functions/sla.ts::removeConversationSlaFn')
      expect(keys).toContain('lib/server/functions/copilot-events.ts::recordCopilotEventFn')
      expect(matrices).not.toBe('')
    })

    it('reads every server function input it meets', () => {
      expect(entryPoints.filter((e) => e.unparsed).map((e) => e.key)).toEqual([])
    })

    it('gives every conversation entry point a real-DB matrix row or a reason', () => {
      const missing = entryPoints
        .filter((e) => !(e.key in ENTRY_POINT_ALLOWLIST))
        .filter((e) => !new RegExp(`\\b${e.key.split('::')[1]}\\(`).test(matrices))
        .map((e) => e.key)
      expect(missing).toEqual([])
    })

    it('has no stale entry-point allowlist entry', () => {
      const keys = new Set(entryPoints.map((e) => e.key))
      expect(Object.keys(ENTRY_POINT_ALLOWLIST).filter((key) => !keys.has(key))).toEqual([])
    })
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

    it('a by-id conversations read in a function that holds an actor', () => {
      expect(
        planted(
          'lib/server/domains/conversation/planted.ts',
          `export async function readIt(id, actor) {
  return db.select().from(conversations).where(eq(conversations.id, id)).limit(1)
}

export async function systemRead(id) {
  return db.select().from(conversations).where(eq(conversations.id, id)).limit(1)
}

export async function scopedRead(id, actor) {
  return db.select().from(conversations).where(and(eq(conversations.id, id), conversationFilter(actor)))
}`
        )
      ).toEqual([
        {
          file: 'lib/server/domains/conversation/planted.ts',
          fn: 'readIt',
          rule: 'unscopedConversationRead',
        },
      ])
    })

    it('a macro run whose caller does not check the conversation first', () => {
      expect(
        planted(
          'lib/server/functions/planted.ts',
          `export const runFn = createServerFn().handler(async ({ data }) => {
  await applyMacroActions(data.conversationId, actions, actor)
})

export const checkedFn = createServerFn().handler(async ({ data }) => {
  await assertConversationVisible(data.conversationId, actor)
  await applyMacroActions(data.conversationId, actions, actor)
})`
        )
      ).toEqual([
        { file: 'lib/server/functions/planted.ts', fn: 'runFn', rule: 'macroWithoutCheck' },
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
