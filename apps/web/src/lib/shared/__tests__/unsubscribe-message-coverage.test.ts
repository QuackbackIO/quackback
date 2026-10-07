// @vitest-environment node
/**
 * The /unsubscribe page seeds only the `unsubscribe.` slice of the catalog
 * (loadUnsubscribeMessages), so an id it renders outside that prefix, or one
 * missing from the catalog, would show its English fallback in every locale.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { UNSUBSCRIBE_MESSAGE_PREFIX } from '@/lib/shared/i18n'
import en from '@/locales/en.json'

const PAGE = fileURLToPath(new URL('../../../routes/unsubscribe.tsx', import.meta.url))

function messageIds(source: string): string[] {
  const ids = new Set<string>()
  for (const m of source.matchAll(/\bid\s*:\s*['"]([^'"]+)['"]/g)) ids.add(m[1])
  for (const m of source.matchAll(/\bid=["']([^"']+)["']/g)) ids.add(m[1])
  return [...ids].filter((id) => id.includes('.'))
}

describe('unsubscribe page message-id coverage', () => {
  it('renders only seeded, catalogued ids', () => {
    const ids = messageIds(readFileSync(PAGE, 'utf8'))
    expect(ids.length).toBeGreaterThan(20)

    expect(ids.filter((id) => !id.startsWith(UNSUBSCRIBE_MESSAGE_PREFIX))).toEqual([])
    const catalog = en as Record<string, string>
    expect(ids.filter((id) => !(id in catalog))).toEqual([])
  })
})
