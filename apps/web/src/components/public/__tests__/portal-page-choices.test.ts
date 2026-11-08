import { describe, expect, it } from 'vitest'
import {
  PAGE_CHOICE_VALUES,
  PORTAL_PAGE_CHOICES,
  readPortalPageChoices,
} from '@/components/public/preview-draft-context'
import {
  changelogChoicesSchema,
  helpChoicesSchema,
  PAGE_CHOICE_DEFAULTS,
  postChoicesSchema,
  readPageChoices,
  roadmapChoicesSchema,
  supportChoicesSchema,
} from '@/lib/shared/design/page-choices'

const SCHEMAS = {
  changelog: changelogChoicesSchema,
  help: helpChoicesSchema,
  roadmap: roadmapChoicesSchema,
  post: postChoicesSchema,
  support: supportChoicesSchema,
}

describe('the portal’s page choices', () => {
  it('default to the same choices as the design schema', () => {
    expect(PORTAL_PAGE_CHOICES).toEqual(PAGE_CHOICE_DEFAULTS)
  })

  it('allow exactly the values the schema does', () => {
    for (const [page, keys] of Object.entries(PAGE_CHOICE_VALUES)) {
      const shape = SCHEMAS[page as keyof typeof SCHEMAS].shape as Record<
        string,
        { safeParse: (v: unknown) => { success: boolean } }
      >
      expect(Object.keys(keys).sort()).toEqual(Object.keys(shape).sort())
      for (const [key, values] of Object.entries(keys)) {
        const list = values === 'boolean' ? [true, false] : [...values]
        for (const value of list) expect(shape[key]!.safeParse(value).success).toBe(true)
        // A value outside the list is refused by the schema too.
        expect(shape[key]!.safeParse(values === 'boolean' ? 'maybe' : 'not-a-choice').success).toBe(
          false
        )
      }
    }
  })

  it('read every value, and junk, the same way the design reader does', () => {
    const cases: Array<Record<string, string>> = [{}, { 'data-qb-post-vote': 'nowhere' }]
    for (const [page, keys] of Object.entries(PAGE_CHOICE_VALUES))
      for (const [key, values] of Object.entries(keys)) {
        const list = values === 'boolean' ? ['on', 'off', 'yes'] : [...values.map(String), 'junk']
        for (const raw of list) cases.push({ [`data-qb-${page}-${key}`]: raw })
      }
    for (const attributes of cases)
      expect(readPortalPageChoices(attributes)).toEqual(readPageChoices(attributes))
  })
})
