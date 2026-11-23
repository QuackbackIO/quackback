/**
 * The page the preview shows decides the This page group: Feedback edits the
 * welcome message, Help Center its home, Roadmap and Changelog have a note.
 */
import { describe, expect, it } from 'vitest'
import { customisePages, pageOfPath, sectionForTarget } from '../pages'

describe('pageOfPath', () => {
  it.each([
    ['/', 'feedback'],
    ['/b/features', 'feedback'],
    ['/b/features/posts/post_1', 'feedback'],
    ['/roadmap', 'roadmap'],
    ['/changelog', 'changelog'],
    ['/changelog/entry_1', 'changelog'],
    ['/hc', 'help'],
    ['/hc/en', 'help'],
    ['/hc/articles/getting-started', 'help'],
  ])('%s is on %s', (path, page) => {
    expect(pageOfPath(path)).toBe(page)
  })

  it('keeps no page for one outside the list', () => {
    expect(pageOfPath('/support')).toBeNull()
  })
})

describe('customisePages', () => {
  const all = { feedback: true, changelog: true, helpCenter: true }

  it('lists the four pages, Feedback under its tab label', () => {
    const pages = customisePages({ flags: all, feedbackLabel: 'Ideas', helpCenterDomain: false })
    expect(pages.map((p) => [p.id, p.label, p.section])).toEqual([
      ['feedback', 'Ideas', 'welcome'],
      ['roadmap', 'Roadmap', 'note'],
      ['changelog', 'Changelog', 'note'],
      ['help', 'Help Center', 'hc-home'],
    ])
  })

  it('hides pages whose product is off', () => {
    const pages = customisePages({
      flags: { feedback: true, changelog: false, helpCenter: false },
      helpCenterDomain: false,
    })
    expect(pages.map((p) => p.id)).toEqual(['feedback', 'roadmap'])
  })

  it('hides the Help Center when it lives on its own domain', () => {
    const pages = customisePages({ flags: all, helpCenterDomain: true })
    expect(pages.map((p) => p.id)).not.toContain('help')
  })
})

describe('sectionForTarget', () => {
  it.each([
    ['header', 'header', null],
    ['logo', 'header', null],
    ['nav', 'header', null],
    ['colours', 'colours', null],
    ['type', 'font', null],
    ['welcome', 'welcome', 'feedback'],
    ['hc-home', 'hc-home', 'help'],
  ] as const)('%s opens %s', (target, section, page) => {
    expect(sectionForTarget(target)).toEqual({ section, page })
  })
})
