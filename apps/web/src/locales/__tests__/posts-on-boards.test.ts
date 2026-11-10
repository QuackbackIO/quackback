/**
 * Guard: visitors read posts on boards, in every portal. No message selects
 * on a word for posts or boards: not a catalogue's, and not the English a
 * message carries in code. And no English visitor string calls a post an idea.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createIntl } from 'react-intl'

const LOCALES = join(import.meta.dirname, '..')
const SRC_ROOT = join(LOCALES, '..')
const SKIP = /(^|\/)__tests__\/|\.test\.tsx?$|\.d\.ts$/

/** The arguments a message would choose its word for posts or boards by. */
const WORD_ARGUMENTS = new Set(['postWord', 'boardWord'])

/** A word argument written in a message, as a select or on its own. */
const WORD_IN_SOURCE = /\{\s*(postWord|boardWord)\s*[,}]/

/** Where visitors read the portal's strings, and the strings it shares with the admin. */
const VISITOR = /^(portal|widget|unsubscribe|common)\./

type IcuNode = {
  type: number
  value?: string
  options?: Record<string, { value: IcuNode[] }>
  children?: IcuNode[]
}
const LITERAL = 0
const POUND = 7
const TAG = 8
const parser = createIntl({ locale: 'en', onError: () => {} }).formatters

/** Every argument a message takes, at any depth. */
function argumentsOf(message: string): Set<string> {
  const names = new Set<string>()
  const visit = (nodes: IcuNode[]) => {
    for (const node of nodes) {
      if (node.type === TAG) visit(node.children ?? [])
      else if (node.type !== LITERAL && node.type !== POUND && node.value) names.add(node.value)
      for (const option of Object.values(node.options ?? {})) visit(option.value)
    }
  }
  visit(parser.getMessageFormat(message, 'en').getAst() as IcuNode[])
  return names
}

const catalogues = readdirSync(LOCALES)
  .filter((file) => file.endsWith('.json'))
  .map((file) => ({
    locale: file.replace('.json', ''),
    messages: JSON.parse(readFileSync(join(LOCALES, file), 'utf8')) as Record<string, string>,
  }))

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else out.push(relative(SRC_ROOT, full).split('\\').join('/'))
  }
  return out
}

const code = sourceFiles(SRC_ROOT).filter((file) => /\.tsx?$/.test(file) && !SKIP.test(file))

describe('posts on boards', () => {
  it.each(catalogues)('$locale has no message that selects on a word', ({ messages }) => {
    const worded = Object.entries(messages)
      .filter(([, message]) => [...argumentsOf(message)].some((name) => WORD_ARGUMENTS.has(name)))
      .map(([key]) => key)
    expect(worded).toEqual([])
  })

  it('has no message in code that selects on a word', () => {
    // Far fewer would mean the reader stopped seeing the code, not that it is clean.
    expect(code.length).toBeGreaterThan(1000)
    const worded = code.filter((file) =>
      WORD_IN_SOURCE.test(readFileSync(join(SRC_ROOT, file), 'utf8'))
    )
    expect(worded).toEqual([])
  })

  it('never calls a post an idea in an English visitor string', () => {
    const en = catalogues.find((catalogue) => catalogue.locale === 'en')!.messages
    const ideas = Object.entries(en)
      .filter(([key, message]) => VISITOR.test(key) && /\bideas?\b/i.test(message))
      .map(([key]) => key)
    expect(ideas).toEqual([])
  })
})
