/**
 * A draft's page choices reach the canvas with the rest of the draft: the
 * builder sends them in the preview message, and the frame keeps them.
 */
import { describe, expect, it } from 'vitest'
import { designPreview } from '@/components/admin/settings/appearance/use-design-draft'
import { layoutAttributes } from '@/lib/shared/design/components'
import { readPageChoices } from '@/lib/shared/design/page-choices'
import { defaultDesign } from '@/lib/shared/design/schema'
import { readDesignPreview } from '../portal-preview-design'

describe('a draft’s page choices in the preview', () => {
  it('arrive as the draft has them', () => {
    const draft = defaultDesign()
    draft.pages.changelog = { entries: 'compact', images: 'wide' }
    draft.pages.help = { topics: 'list', search: 'large' }
    draft.pages.roadmap = { votes: false }
    const read = readDesignPreview(JSON.parse(JSON.stringify(designPreview(draft))))
    expect(readPageChoices(read?.attributes)).toEqual(readPageChoices(layoutAttributes(draft)))
    expect(readPageChoices(read?.attributes)).toMatchObject({
      changelog: { entries: 'compact', images: 'wide', subscribe: 'beside' },
      help: { topics: 'list', popular: true, search: 'large' },
      roadmap: { board: 'columns', votes: false },
    })
  })

  it('leave nothing behind when the draft has none', () => {
    const read = readDesignPreview(JSON.parse(JSON.stringify(designPreview(defaultDesign()))))
    expect(
      Object.keys(read?.attributes ?? {}).filter((name) => /changelog|help|roadmap/.test(name))
    ).toEqual([])
  })
})
