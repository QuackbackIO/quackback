import { describe, expect, it } from 'vitest'
import {
  PAGE_CHOICE_VALUES,
  PORTAL_PAGE_CHOICES,
  postVotePlaces,
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

describe('one vote control on a post', () => {
  it('beside the title: one control there at every width, none in the details', () => {
    expect(postVotePlaces('title', false)).toEqual({ title: 'always', details: 'none' })
  })

  it('in the details: the control there, and beside the title only where the details are hidden', () => {
    expect(postVotePlaces('details', false)).toEqual({ title: 'narrow', details: 'button' })
  })

  it('keeps a count over the voters list for the team, never a second control', () => {
    expect(postVotePlaces('title', true)).toEqual({ title: 'always', details: 'count' })
    expect(postVotePlaces('details', true)).toEqual({ title: 'narrow', details: 'button' })
  })
})
