import { describe, expect, it } from 'vitest'
import { bandArtImage, bandArtSvg, EDGE_ART, type BandArt } from '../band-art'

const ALL: BandArt[] = ['dots', 'grid', 'lines', 'waves', 'hills', 'petals', 'confetti']

describe('band art', () => {
  it('draws every motif in the brand’s colours', () => {
    for (const art of ALL) {
      const svg = bandArtSvg(art, '#1f4d3a', '#e58fae')
      expect(svg, art).toMatch(/^<svg xmlns='http:\/\/www\.w3\.org\/2000\/svg'/)
      expect(svg, art).toContain('#1f4d3a')
    }
    // The two-colour motifs use the second colour too.
    for (const art of ['waves', 'hills', 'petals', 'confetti'] as const)
      expect(bandArtSvg(art, '#1f4d3a', '#e58fae'), art).toContain('#e58fae')
  })

  it('runs hills and waves along the bottom, and tiles the rest', () => {
    expect([...EDGE_ART].sort()).toEqual(['hills', 'waves'])
  })

  it('is a quoted CSS image with nothing that could end its quotes', () => {
    const image = bandArtImage('petals', '#1f4d3a', '#e58fae')
    expect(image.startsWith('url("data:image/svg+xml,')).toBe(true)
    expect(image.slice(5, -2)).not.toMatch(/["\n\\]/)
  })
})
