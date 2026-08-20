// @vitest-environment node
// Reads onboarding source off disk via import.meta.url + node:fs; the config
// default (happy-dom) gives a non-file import.meta.url that fileURLToPath
// rejects. This is a node-only static-analysis test with no DOM.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { ONBOARDING_MESSAGE_PREFIX_LIST } from '@/lib/shared/i18n'

// Onboarding-owned source: the files where an onboarding-rendered react-intl id
// is authored — the wizard route tree and the components only it renders. If
// onboarding grows a new surface, add its dir here so the guard keeps covering
// it.
const APP_SRC = fileURLToPath(new URL('../../../', import.meta.url))

// `components/auth` is here because the account step renders the shared
// sign-in form: its ids are seeded by the onboarding loader now, so they
// belong under the same guard.
const ONBOARDING_SOURCE_ROOTS = ['routes/onboarding', 'components/onboarding', 'components/auth']

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === '__mocks__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walk(full))
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Extract every react-intl message id referenced in a source file: the `id:` /
 * `id="` shapes plus template-literal prefixes (`id={`onboarding.x.${v}`}`).
 * Only dotted ids are treated as message ids — bare `id="email"` HTML
 * attributes and `{ id: 'internal' }` option keys are not translation ids.
 */
function extractMessageIds(source: string): string[] {
  const ids = new Set<string>()

  for (const m of source.matchAll(/\b(?:id|messageId|labelId)\s*:\s*['"]([^'"]+)['"]/g)) {
    ids.add(m[1])
  }
  for (const m of source.matchAll(/\bid=(?:["']|\{['"])([^"'{}]+)['"]?\}?/g)) {
    ids.add(m[1])
  }
  for (const m of source.matchAll(/\b(?:id|messageId|labelId)\s*:\s*`([^`$]+)/g)) {
    ids.add(m[1])
  }
  // Template-literal ids in JSX: id={`onboarding.step.${index}`}
  for (const m of source.matchAll(/\bid=\{`([^`$]+)/g)) {
    ids.add(m[1])
  }

  return [...ids].filter((id) => id.includes('.'))
}

describe('onboarding message-id coverage', () => {
  it('every onboarding-referenced message id falls under an ONBOARDING_MESSAGE_PREFIXES prefix', () => {
    const files = ONBOARDING_SOURCE_ROOTS.flatMap((root) => walk(join(APP_SRC, root)))
    // Guard against a broken glob silently passing on zero files.
    expect(files.length).toBeGreaterThan(5)

    const uncovered = new Map<string, string>() // id -> first file that used it

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const id of extractMessageIds(source)) {
        const covered = ONBOARDING_MESSAGE_PREFIX_LIST.some((prefix) => id.startsWith(prefix))
        if (!covered && !uncovered.has(id)) uncovered.set(id, file.replace(APP_SRC, ''))
      }
    }

    // A miss means the id was sliced out of the catalog the /onboarding loader
    // seeds, so the string would render its English fallback in every locale.
    // Either the id belongs under an existing prefix, or a new prefix must be
    // added to ONBOARDING_MESSAGE_PREFIXES.
    expect(
      uncovered.size,
      `Onboarding message ids outside the seeded prefix allowlist:\n${[...uncovered]
        .map(([id, file]) => `  ${id}  (${file})`)
        .join('\n')}\nAllowlist: ${ONBOARDING_MESSAGE_PREFIX_LIST.join(', ')}`
    ).toBe(0)
  })
})
