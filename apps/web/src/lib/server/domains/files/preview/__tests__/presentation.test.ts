import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { derivePresentationPreview } from '../presentation'
import { ZipBudgetError } from '@/lib/shared/files/zip-budget'

function slide(...paragraphs: string[]): string {
  return (
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>' +
    paragraphs.map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`).join('') +
    '</p:spTree></p:cSld></p:sld>'
  )
}

function buildPptx(files: Record<string, string>): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'ppt/presentation.xml': strToU8('<p:presentation/>'),
    ...Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])),
  })
}

describe('derivePresentationPreview', () => {
  it('reads the slide count and the slides text in slide order', async () => {
    const bytes = buildPptx({
      'docProps/app.xml': '<Properties><Slides>3</Slides></Properties>',
      'ppt/slides/slide10.xml': slide('Closing'),
      'ppt/slides/slide2.xml': slide('Roadmap', 'Q3 &amp; Q4'),
      'ppt/slides/slide1.xml': slide('Welcome'),
    })
    const result = await derivePresentationPreview(bytes)
    expect(result.status).toBe('ready')
    expect(result.meta).toEqual({ pages: 3 })
    expect(result.excerpt).toBe('Welcome\n\nRoadmap\nQ3 & Q4\n\nClosing')
    expect(result.derived).toBeUndefined()
  })

  it('counts slide parts when the package does not record a count', async () => {
    const bytes = buildPptx({
      'ppt/slides/slide1.xml': slide('One'),
      'ppt/slides/slide2.xml': slide('Two'),
    })
    expect((await derivePresentationPreview(bytes)).meta).toEqual({ pages: 2 })
  })

  it('refuses a zip bomb', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 2001; i++) files[`ppt/media/${i}.xml`] = ''
    await expect(derivePresentationPreview(buildPptx(files))).rejects.toBeInstanceOf(ZipBudgetError)
  })
})
