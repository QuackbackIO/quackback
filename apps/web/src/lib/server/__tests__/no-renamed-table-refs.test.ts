import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Physical tables the post_ / conversation_ rename dropped. They must never
 * reappear as a raw-SQL table reference: symbol renames and `tsc` are blind to
 * sql`...` string literals, so a stale `FROM comments` compiles clean and only
 * fails at runtime with `relation "comments" does not exist`. This guard is the
 * backstop for that class — the rename review found five such queries that
 * passed CI (the domain tests mock db.execute) yet would 500 after migrating.
 *
 * Only names that are fully GONE go here. Reused names (`post_tags` was the
 * join, now the catalog; `conversation_tags` was the join, now the catalog)
 * still exist, so a stale ref returns wrong data instead of erroring and can't
 * be caught by name alone.
 */
const REMOVED_TABLES = [
  'comments',
  'votes',
  'comment_reactions',
  'comment_edit_history',
  'chat_messages',
  'chat_message_mentions',
  'chat_message_reactions',
  'chat_message_flags',
  'chat_tags',
  'tags',
]

// A SQL keyword immediately followed by a dropped table name (optionally
// quoted). Anchoring on the keyword avoids matching the current names
// (`FROM post_comments` never matches `FROM comments`). Case-sensitive: raw SQL
// keywords are uppercase here, so this skips English prose in comments like
// "update comments" or "Update tags".
const STALE_REF = new RegExp(
  '\\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\\s+"?(?:' + REMOVED_TABLES.join('|') + ')"?\\b'
)

const ROOTS = [join(process.cwd(), 'src'), join(process.cwd(), '..', '..', 'packages', 'db', 'src')]

function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sources(full))
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|gen)\./.test(entry.name)) out.push(full)
  }
  return out
}

describe('no raw-SQL references to renamed-away tables', () => {
  it('every sql`` table reference uses the current physical name', () => {
    const offenders: string[] = []
    for (const root of ROOTS.filter(existsSync)) {
      for (const file of sources(root)) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (STALE_REF.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim()}`)
          })
      }
    }
    expect(offenders, `stale renamed-away table refs:\n${offenders.join('\n')}`).toEqual([])
  })
})
