import { describe, expect, it } from 'vitest'
import { readDesignPreview } from '../portal-preview-design'

const message = (extra: Record<string, unknown>) =>
  readDesignPreview({ css: '', attributes: {}, fontIds: [], ...extra })!

describe('a draft design read from the preview message', () => {
  it('keeps the logo, with wordmark files only from the workspace’s storage', () => {
    expect(
      message({
        logo: {
          display: 'wordmark',
          name: 'Harbor',
          wordmark: { light: '/api/storage/logos/a.svg', dark: 'https://evil.example/x.svg' },
        },
      }).logo
    ).toEqual({
      display: 'wordmark',
      name: 'Harbor',
      nameAccent: null,
      wordmark: { light: '/api/storage/logos/a.svg', dark: null },
    })
    expect(message({ logo: { display: 'banner' } }).logo).toBeNull()
  })

  it('keeps status colours a design can store, and nothing else', () => {
    expect(
      message({ statusColours: ['#ecb22e', 'oklch(0.7 0.1 200)', 'url(x)', 4] }).statusColours
    ).toEqual(['#ecb22e', 'oklch(0.7 0.1 200)'])
    expect(message({ statusColours: ['red'] }).statusColours).toBeNull()
  })

  it('keeps a band image only from storage, in a place it knows', () => {
    expect(
      message({ bandImage: { url: '/api/storage/portal-images/a.jpg', place: 'edge' } }).bandImage
    ).toEqual({ url: '/api/storage/portal-images/a.jpg', place: 'edge' })
    expect(
      message({ bandImage: { url: 'https://x.example/a.jpg', place: 'edge' } }).bandImage
    ).toBeNull()
    expect(
      message({ bandImage: { url: '/api/storage/a.jpg', place: 'float' } }).bandImage
    ).toBeNull()
  })

  it('keeps a headline’s accent only in a shape it knows', () => {
    const title = { en: 'Make it better' }
    expect(
      message({
        headline: { title, subtitle: {}, accent: { style: 'highlight', text: { en: 'better' } } },
      }).headline
    ).toEqual({ title, subtitle: {}, accent: { style: 'highlight', text: { en: 'better' } } })
    expect(
      message({ headline: { title, subtitle: {}, accent: { style: 'blink', text: { en: 'x' } } } })
        .headline
    ).toEqual({ title, subtitle: {} })
  })
})
