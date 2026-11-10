import { describe, expect, it, vi } from 'vitest'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

const looks: Array<{ description: string; design: PortalDesign }> = []
vi.mock('../design-directions', () => ({
  designDirections: vi.fn(async () => ({ ok: true, looks })),
}))
const { matchBrand } = await import('../brand-start')

const withAccent = (accent: string, description: string) => {
  const design = defaultDesign()
  design.brand.light.accent = accent
  return { description, design }
}

describe('matchBrand (whole-look fallback)', () => {
  it('places the first look and offers the others, as changes from the draft before', async () => {
    looks.splice(
      0,
      looks.length,
      withAccent('#0000ff', 'Faithful.'),
      withAccent('#00aa00', 'Calm.'),
      withAccent('#ff0000', 'Bold.')
    )
    const before = defaultDesign()
    const result = await matchBrand({
      design: before,
      images: [{ palette: ['#0000ff'], image: 'data:image/png;base64,AA' }],
      name: 'Acme',
      hasMark: false,
      allows: {} as never,
    })
    if (!result.ok) throw new Error('refused')
    expect(result.design.brand.light.accent).toBe('#0000ff')
    expect(result.others).toEqual([
      {
        description: 'Calm.',
        changes: [
          { path: 'brand.light.accent', before: before.brand.light.accent, after: '#00aa00' },
        ],
      },
      {
        description: 'Bold.',
        changes: [
          { path: 'brand.light.accent', before: before.brand.light.accent, after: '#ff0000' },
        ],
      },
    ])
  })
})
