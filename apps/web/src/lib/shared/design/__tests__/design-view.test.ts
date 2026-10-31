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

  it('carries how the header shows the brand, with its wordmark files', () => {
    const doc = defaultDesign()
    doc.brand.logo = {
      ...doc.brand.logo,
      display: 'wordmark',
      wordmark: { light: { key: 'logos/ink.svg' }, dark: null },
    }
    expect(designView(doc, 1).logo).toEqual({
      display: 'wordmark',
      name: null,
      wordmark: { light: '/api/storage/logos/ink.svg', dark: null },
    })
  })

  it('carries the logo’s colours for status markers only when the design asks for them', () => {
    const doc = defaultDesign()
    doc.brand.logoColours = ['#ecb22e', '#36c5f0']
    expect(designView(doc, 1).statusColours).toBeNull()
    doc.layout.status = 'brand'
    expect(designView(doc, 1).statusColours).toEqual(['#ecb22e', '#36c5f0'])
    doc.brand.logoColours = []
    expect(designView(doc, 1).statusColours).toBeNull()
  })

  it('carries a name the header shows in place of the workspace’s', () => {
    const doc = defaultDesign()
    doc.brand.logo = { ...doc.brand.logo, display: 'name', name: 'Harbor & Pine' }
    expect(designView(doc, 1).logo).toMatchObject({ display: 'name', name: 'Harbor & Pine' })
  })
})
