import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = join(import.meta.dirname, '..')
const catalogues = readdirSync(dir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => ({
    locale: file.replace('.json', ''),
    messages: JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, string>,
  }))

describe('one word per product in each language', () => {
  it.each(catalogues)(
    '$locale names the changelog the same in the admin and the portal',
    ({ messages }) => {
      expect(messages['admin.nav.changelog']).toBe(messages['portal.header.nav.changelog'])
    }
  )

  it.each(catalogues)(
    "$locale keeps the help menu's What's new apart from the changelog",
    ({ messages }) => {
      expect(messages['admin.help.whatsNew']).not.toBe(messages['admin.nav.changelog'])
    }
  )
})
