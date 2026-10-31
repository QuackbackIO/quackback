/**
 * Band art for brands without imagery of their own: a few quiet motifs drawn
 * in the brand's colours. Hills and waves run along the band's bottom; the
 * rest tile behind the words, faint enough that the words keep their
 * contrast.
 */
import type { PortalDesign } from './schema'

/** A motif; `none` draws nothing. */
export type BandArt = Exclude<NonNullable<PortalDesign['layout']['bandArt']>, 'none'>

/** Art that runs along the band's bottom; the rest tiles. */
export const EDGE_ART: ReadonlySet<BandArt> = new Set(['hills', 'waves'])

const svg = (viewBox: string, body: string, extra = '') =>
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}'${extra}>${body}</svg>`

/** The motif as SVG, in its two colours: the brand colour and the second (or the brand colour again). */
export function bandArtSvg(art: BandArt, first: string, second: string): string {
  switch (art) {
    case 'dots':
      return svg('0 0 24 24', `<circle cx='12' cy='12' r='1.6' fill='${first}' opacity='0.35'/>`)
    case 'grid':
      return svg(
        '0 0 32 32',
        `<path d='M32 0H0V32' fill='none' stroke='${first}' stroke-width='1' opacity='0.18'/>`
      )
    case 'lines':
      return svg(
        '0 0 16 16',
        `<path d='M-4 4 4-4M0 16 16 0M12 20 20 12' stroke='${first}' stroke-width='1.5' opacity='0.16'/>`
      )
    case 'petals':
      return svg(
        '0 0 160 160',
        [
          [30, 34, -30],
          [118, 26, 40],
          [76, 92, 15],
          [22, 128, 70],
          [136, 120, -50],
        ]
          .map(
            ([x, y, turn], index) =>
              `<ellipse cx='${x}' cy='${y}' rx='13' ry='6' transform='rotate(${turn} ${x} ${y})' fill='${index % 2 ? second : first}' opacity='0.28'/>`
          )
          .join('')
      )
    case 'confetti':
      return svg(
        '0 0 140 140',
        [
          `<rect x='18' y='22' width='12' height='5' rx='2.5' transform='rotate(25 24 24)' fill='${first}' opacity='0.4'/>`,
          `<circle cx='96' cy='30' r='4' fill='${second}' opacity='0.45'/>`,
          `<rect x='70' y='84' width='12' height='5' rx='2.5' transform='rotate(-35 76 86)' fill='${second}' opacity='0.4'/>`,
          `<circle cx='28' cy='104' r='3' fill='${first}' opacity='0.4'/>`,
          `<rect x='112' y='112' width='10' height='4' rx='2' transform='rotate(60 117 114)' fill='${first}' opacity='0.35'/>`,
        ].join('')
      )
    case 'waves':
      return svg(
        '0 0 1440 160',
        `<path d='M0 70C240 30 480 110 720 70S1200 30 1440 70V160H0Z' fill='${second}' opacity='0.22'/><path d='M0 110C260 80 520 140 780 110S1240 80 1440 108V160H0Z' fill='${first}' opacity='0.3'/>`,
        " preserveAspectRatio='none'"
      )
    case 'hills':
      return svg(
        '0 0 1440 200',
        `<path d='M0 120C240 80 420 110 620 92S1000 60 1200 96 1390 84 1440 90V200H0Z' fill='${second}' opacity='0.22'/><path d='M0 160C280 128 520 150 760 136S1200 120 1440 146V200H0Z' fill='${first}' opacity='0.3'/><path d='M0 188C420 176 900 192 1440 180V200H0Z' fill='${first}'/>`,
        " preserveAspectRatio='none'"
      )
  }
}

/** The art as a CSS image. */
export const bandArtImage = (art: BandArt, first: string, second: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(bandArtSvg(art, first, second))}")`
