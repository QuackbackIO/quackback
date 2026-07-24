// @vitest-environment node
// Reads portal source off disk via import.meta.url + node:fs; the config
// default (happy-dom) gives a non-file import.meta.url that fileURLToPath
// rejects. This is a node-only static-analysis test with no DOM.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { PORTAL_MESSAGE_PREFIX_LIST } from '@/lib/shared/i18n'

// Portal-owned source: the files where a portal-rendered react-intl id is
// authored. Covers the portal route tree, the two standalone auth pages (they
// render under the same PortalIntlProvider via loadPortalIntl), and the
// component dirs the portal pages render — including the specific shared
// files the portal reaches (conversation thread + ticket form fields). If the
// portal grows a new surface, add its dir here so the guard keeps covering it.
const APP_SRC = fileURLToPath(new URL('../../../', import.meta.url))

const PORTAL_SOURCE_ROOTS = [
  'routes/_portal',
  'components/portal',
  'components/public',
  'components/help-center',
  'components/shared/conversation',
]

const PORTAL_SOURCE_FILES = [
  'routes/auth.recovery.tsx',
  'routes/auth.reset-password.tsx',
  'components/shared/ticket-form-fields.tsx',
]

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

function collectPortalSourceFiles(): string[] {
  const files: string[] = []
  for (const root of PORTAL_SOURCE_ROOTS) files.push(...walk(join(APP_SRC, root)))
  for (const file of PORTAL_SOURCE_FILES) files.push(join(APP_SRC, file))
  return files
}

/**
 * Extract every react-intl message id referenced in a source file. Matches the
 * `id:` / `id="` / `messageId:` / `labelId:` shapes react-intl and this repo's
 * conventions use, plus template-literal prefixes (`id={`portal.x.${v}`}`).
 * Only dotted ids are treated as message ids — bare `id="email"` HTML
 * attributes and `{ id: 'unassigned' }` option keys are not translation ids and
 * are intentionally ignored.
 */
function extractMessageIds(source: string): string[] {
  const ids = new Set<string>()

  // id: '...'  |  id: "..."  |  messageId: '...'  |  labelId: '...'
  for (const m of source.matchAll(/\b(?:id|messageId|labelId)\s*:\s*['"]([^'"]+)['"]/g)) {
    ids.add(m[1])
  }
  // <FormattedMessage id="..." />  |  id={'...'}
  for (const m of source.matchAll(/\bid=(?:["']|\{['"])([^"'{}]+)['"]?\}?/g)) {
    ids.add(m[1])
  }
  // Template-literal ids: id: `portal.x.${...}` — capture the static prefix.
  for (const m of source.matchAll(/\b(?:id|messageId|labelId)\s*:\s*`([^`$]+)/g)) {
    ids.add(m[1])
  }

  // A react-intl message id is always dot-delimited; bare tokens are HTML
  // attributes / object keys / event constants, not translation ids.
  return [...ids].filter((id) => id.includes('.'))
}

describe('portal message-id coverage', () => {
  it('every portal-referenced message id falls under a PORTAL_MESSAGE_PREFIXES prefix', () => {
    const files = collectPortalSourceFiles()
    // Guard against a broken glob silently passing on zero files.
    expect(files.length).toBeGreaterThan(20)

    const uncovered = new Map<string, string>() // id -> first file that used it

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const id of extractMessageIds(source)) {
        const covered = PORTAL_MESSAGE_PREFIX_LIST.some((prefix) => id.startsWith(prefix))
        if (!covered && !uncovered.has(id)) {
          uncovered.set(id, file.replace(APP_SRC, ''))
        }
      }
    }

    // A miss means a portal string would render its English fallback in prod
    // (the id was sliced out of the SSR catalog). Either the id belongs under
    // an existing prefix, or a new prefix must be added to
    // PORTAL_MESSAGE_PREFIXES (and the catalog re-checked).
    expect(
      uncovered.size,
      `Portal message ids outside the SSR prefix allowlist:\n${[...uncovered]
        .map(([id, file]) => `  ${id}  (${file})`)
        .join('\n')}\nAllowlist: ${PORTAL_MESSAGE_PREFIX_LIST.join(', ')}`
    ).toBe(0)
  })
})
