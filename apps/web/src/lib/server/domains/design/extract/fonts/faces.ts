/**
 * The bundled faces a screenshot's type is matched to: every bundled font
 * but the two system stacks, with the @fontsource package that ships it, a
 * class for reading the match (sans, serif or mono; grotesque, geometric,
 * humanist and the rest), and the weights its package ships as Latin WOFF
 * files (measured against, then mapped to what the portal loads).
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */

export type FaceTop = 'sans' | 'serif' | 'mono'
export type FaceSub =
  | 'grotesque'
  | 'geometric'
  | 'humanist'
  | 'rounded'
  | 'condensed'
  | 'wide'
  | 'serif'
  | 'slab'
  | 'mono'

export interface Face {
  /** The bundled font id the design names. */
  id: string
  /** The @fontsource package that ships its files. */
  pkg: string
  top: FaceTop
  sub: FaceSub
  /** Weights shipped as Latin WOFF files, 200 to 900. */
  weights: readonly number[]
  /**
   * Drawn for headlines: high contrast or soft display shapes that read as
   * mannered at text sizes, so body text is set in it only on a close fit.
   */
  display?: true
}

/** A face's fit at one weight: the size (CSS px) and letter-spacing (em) that reproduce a crop. */
export interface WeightFit {
  weight: number
  size: number
  tracking: number
}

const ALL = [200, 300, 400, 500, 600, 700, 800, 900] as const
const TO_800 = [200, 300, 400, 500, 600, 700, 800] as const
const TO_700 = [200, 300, 400, 500, 600, 700] as const
const FROM_300 = [300, 400, 500, 600, 700, 800, 900] as const
const FROM_400 = [400, 500, 600, 700, 800, 900] as const
const STD = [400, 500, 600, 700] as const

export const FACES: readonly Face[] = [
  { id: 'inter', pkg: 'inter', top: 'sans', sub: 'grotesque', weights: ALL },
  { id: 'roboto', pkg: 'roboto', top: 'sans', sub: 'grotesque', weights: ALL },
  {
    id: 'open-sans',
    pkg: 'open-sans',
    top: 'sans',
    sub: 'humanist',
    weights: [300, 400, 500, 600, 700, 800],
  },
  { id: 'lato', pkg: 'lato', top: 'sans', sub: 'humanist', weights: [300, 400, 700, 900] },
  { id: 'nunito', pkg: 'nunito', top: 'sans', sub: 'rounded', weights: ALL },
  { id: 'poppins', pkg: 'poppins', top: 'sans', sub: 'geometric', weights: ALL },
  { id: 'dm-sans', pkg: 'dm-sans', top: 'sans', sub: 'geometric', weights: ALL },
  { id: 'jakarta', pkg: 'plus-jakarta-sans', top: 'sans', sub: 'geometric', weights: TO_800 },
  { id: 'geist', pkg: 'geist-sans', top: 'sans', sub: 'grotesque', weights: ALL },
  { id: 'manrope', pkg: 'manrope', top: 'sans', sub: 'geometric', weights: TO_800 },
  {
    id: 'space-grotesk',
    pkg: 'space-grotesk',
    top: 'sans',
    sub: 'grotesque',
    weights: [300, 400, 500, 600, 700],
  },
  { id: 'ibm-plex-sans', pkg: 'ibm-plex-sans', top: 'sans', sub: 'grotesque', weights: TO_700 },
  {
    id: 'bricolage-grotesque',
    pkg: 'bricolage-grotesque',
    top: 'sans',
    sub: 'grotesque',
    weights: TO_800,
  },
  {
    id: 'playfair',
    pkg: 'playfair-display',
    top: 'serif',
    sub: 'serif',
    weights: FROM_400,
    display: true,
  },
  { id: 'merriweather', pkg: 'merriweather', top: 'serif', sub: 'serif', weights: FROM_300 },
  { id: 'lora', pkg: 'lora', top: 'serif', sub: 'serif', weights: STD },
  { id: 'fraunces', pkg: 'fraunces', top: 'serif', sub: 'serif', weights: ALL, display: true },
  { id: 'inter-tight', pkg: 'inter-tight', top: 'sans', sub: 'grotesque', weights: ALL },
  { id: 'sora', pkg: 'sora', top: 'sans', sub: 'geometric', weights: TO_800 },
  { id: 'outfit', pkg: 'outfit', top: 'sans', sub: 'geometric', weights: ALL },
  { id: 'figtree', pkg: 'figtree', top: 'sans', sub: 'geometric', weights: FROM_300 },
  { id: 'work-sans', pkg: 'work-sans', top: 'sans', sub: 'grotesque', weights: ALL },
  { id: 'instrument-sans', pkg: 'instrument-sans', top: 'sans', sub: 'grotesque', weights: STD },
  { id: 'noto-sans', pkg: 'noto-sans', top: 'sans', sub: 'humanist', weights: ALL },
  { id: 'rubik', pkg: 'rubik', top: 'sans', sub: 'geometric', weights: FROM_300 },
  { id: 'mona-sans', pkg: 'mona-sans', top: 'sans', sub: 'grotesque', weights: ALL },
  { id: 'hanken-grotesk', pkg: 'hanken-grotesk', top: 'sans', sub: 'grotesque', weights: ALL },
  { id: 'karla', pkg: 'karla', top: 'sans', sub: 'grotesque', weights: TO_800 },
  { id: 'libre-franklin', pkg: 'libre-franklin', top: 'sans', sub: 'grotesque', weights: ALL },
  { id: 'barlow-condensed', pkg: 'barlow-condensed', top: 'sans', sub: 'condensed', weights: ALL },
  { id: 'oswald', pkg: 'oswald', top: 'sans', sub: 'condensed', weights: TO_700 },
  { id: 'source-serif', pkg: 'source-serif-4', top: 'serif', sub: 'serif', weights: ALL },
  { id: 'archivo', pkg: 'archivo', top: 'sans', sub: 'grotesque', weights: ALL },
  { id: 'unbounded', pkg: 'unbounded', top: 'sans', sub: 'wide', weights: ALL },
  { id: 'roboto-slab', pkg: 'roboto-slab', top: 'serif', sub: 'slab', weights: ALL },
  {
    id: 'bodoni-moda',
    pkg: 'bodoni-moda',
    top: 'serif',
    sub: 'serif',
    weights: FROM_400,
    display: true,
  },
  {
    id: 'quicksand',
    pkg: 'quicksand',
    top: 'sans',
    sub: 'rounded',
    weights: [300, 400, 500, 600, 700],
  },
  {
    id: 'fira-code',
    pkg: 'fira-code',
    top: 'mono',
    sub: 'mono',
    weights: [300, 400, 500, 600, 700],
  },
  { id: 'jetbrains', pkg: 'jetbrains-mono', top: 'mono', sub: 'mono', weights: TO_800 },
]

export const faceById = (id: string): Face | undefined => FACES.find((f) => f.id === id)

/** A face's Latin WOFF file name for a weight, as its package ships it. */
export const fontFileName = (face: Pick<Face, 'pkg'>, weight: number): string =>
  `${face.pkg}-latin-${weight}-normal.woff`

/** Every file the matcher can read, as package and file name. */
export function allFontFiles(): Array<{ pkg: string; file: string }> {
  return FACES.flatMap((face) =>
    face.weights.map((weight) => ({ pkg: face.pkg, file: fontFileName(face, weight) }))
  )
}

/** The shipped weight nearest a wanted one. */
export const nearestWeight = (weights: readonly number[], wanted: number): number =>
  weights.reduce(
    (best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best),
    weights[0]!
  )

/**
 * Inter and Inter Tight are one design (Inter Tight is Inter set closer),
 * so a match between the two counts as the same face; the tracking the
 * matcher fits carries the difference.
 */
export const sameDesign = (a: string, b: string): boolean =>
  a === b || (a.startsWith('inter') && b.startsWith('inter'))
