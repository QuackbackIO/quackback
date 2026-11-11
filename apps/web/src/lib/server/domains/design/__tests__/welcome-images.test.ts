/**
 * Welcome bodies keep their own images as storage refs, so a domain change
 * never breaks them, and designs saved with absolute URLs still render.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'https://feedback.acme.test', s3PublicUrl: 'https://cdn.acme.test/bucket' },
}))

import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { generateContentHTML } from '@/lib/shared/content-html'
import { validateDesign } from '../validate-design'
import { storedDesign } from '../stored-read'
import { welcomeImageRef } from '../welcome-images'

const bodyWith = (src: string) => ({
  type: 'doc',
  content: [{ type: 'image', attrs: { src, alt: 'Team' } }],
})

function designWith(src: string): PortalDesign {
  const design = defaultDesign()
  design.pages.feedback.welcome = { show: true, body: bodyWith(src) }
  return design
}

const srcOf = (design: PortalDesign) =>
  (design.pages.feedback.welcome.body as { content: Array<{ attrs: { src: string } }> }).content[0]!
    .attrs.src

describe('Welcome images', () => {
  it('saves an image uploaded on this host as a storage ref', () => {
    const saved = validateDesign(
      designWith('https://feedback.acme.test/api/storage/portal-welcome/a1.png')
    )
    expect(srcOf(saved)).toBe('/api/storage/portal-welcome/a1.png')
  })

  it('saves an image under the public bucket URL as a storage ref', () => {
    const saved = validateDesign(designWith('https://cdn.acme.test/bucket/portal-images/b2.png'))
    expect(srcOf(saved)).toBe('/api/storage/portal-images/b2.png')
  })

  it('reads an old absolute URL on a domain the workspace has left as a storage ref', () => {
    const stored = JSON.parse(
      JSON.stringify(designWith('https://old-domain.test/api/storage/portal-welcome/c3.png'))
    )
    const read = storedDesign(stored, 'published')!
    expect(srcOf(read)).toBe('/api/storage/portal-welcome/c3.png')
  })

  it('renders the ref on whatever host the portal is served from', () => {
    const read = storedDesign(
      designWith('https://old-domain.test/api/storage/portal-welcome/c3.png'),
      'published'
    )!
    const html = generateContentHTML(read.pages.feedback.welcome.body as never)
    expect(html).toContain('src="/api/storage/portal-welcome/c3.png"')
    expect(html).not.toContain('old-domain.test')
  })

  it('rewrites Home Welcome blocks too', () => {
    const design = defaultDesign()
    design.pages.home.blocks = [
      {
        type: 'welcome',
        body: bodyWith('https://feedback.acme.test/api/storage/portal-welcome/d4.png'),
      } as never,
    ]
    const saved = validateDesign(design)
    const block = saved.pages.home.blocks[0] as {
      body: { content: Array<{ attrs: { src: string } }> }
    }
    expect(block.body.content[0]!.attrs.src).toBe('/api/storage/portal-welcome/d4.png')
  })

  it('leaves foreign images, refs and pipeline files alone', () => {
    expect(welcomeImageRef('https://images.example.org/cat.png')).toBeNull()
    expect(welcomeImageRef('/api/storage/portal-welcome/e5.png')).toBeNull()
    expect(welcomeImageRef('https://feedback.acme.test/api/storage/files/x.pdf')).toBeNull()
    expect(srcOf(validateDesign(designWith('https://images.example.org/cat.png')))).toBe(
      'https://images.example.org/cat.png'
    )
  })
})
