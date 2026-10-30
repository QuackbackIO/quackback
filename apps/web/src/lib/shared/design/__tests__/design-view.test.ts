/**
 * The design as a portal page applies it. The feedback page's welcome message
 * shows only when the design turns it on and it has something to say.
 */
import { describe, expect, it } from 'vitest'
import { designView } from '../design-view'
import { defaultDesign } from '../schema'

const body = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
}

describe('designView', () => {
  it('carries the welcome message when it is on and has text', () => {
    const doc = defaultDesign()
    doc.pages.feedback.welcome = { show: true, body }
    expect(designView(doc, 1).feedback.welcome).toEqual(body)
  })

  it('leaves the welcome message out when it is off or empty', () => {
    const doc = defaultDesign()
    doc.pages.feedback.welcome = { show: false, body }
    expect(designView(doc, 1).feedback.welcome).toBeNull()
    doc.pages.feedback.welcome = { show: true, body: { type: 'doc', content: [] } }
    expect(designView(doc, 1).feedback.welcome).toBeNull()
  })

  it('carries the feedback page headline', () => {
    const doc = defaultDesign()
    doc.pages.feedback.headline = { title: { en: 'Ideas' }, subtitle: {} }
    expect(designView(doc, null).feedback.headline).toEqual({
      title: { en: 'Ideas' },
      subtitle: {},
    })
  })
})
