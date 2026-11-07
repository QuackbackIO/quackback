import { describe, expect, it } from 'vitest'
import { designerPreviewPage, designerReturnPath } from '../designer-path'

describe('designerReturnPath', () => {
  it('keeps a path on this site', () => {
    expect(designerReturnPath('/feedback')).toBe('/feedback')
    expect(designerReturnPath('/b/ideas/posts/123?sort=top')).toBe('/b/ideas/posts/123?sort=top')
  })

  it('sends anything that could lead elsewhere to the portal root', () => {
    for (const path of [
      undefined,
      '',
      'feedback',
      '//evil.example.com',
      '/\\evil.example.com',
      'https://evil.example.com',
      '/javascript:alert(1)',
      '/ spaced',
      `/${'a'.repeat(600)}`,
    ]) {
      expect(designerReturnPath(path)).toBe('/')
    }
  })
})

describe('designerPreviewPage', () => {
  it('shows the root as Home when Home is on, and the feed at its own address', () => {
    expect(designerPreviewPage('/', true)).toBe('home')
    expect(designerPreviewPage('/', false)).toBe('root')
    expect(designerPreviewPage('/feedback?sort=new', true)).toBe('feedback')
  })
})
