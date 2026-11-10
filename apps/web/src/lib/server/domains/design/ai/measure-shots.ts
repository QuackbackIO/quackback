/**
 * The measure stage's work and its messages, shared by the brand match
 * (measure-stage.ts) and the worker thread that runs it (measure-worker.ts).
 */
import {
  cleanShots,
  cutBrandLogo,
  measureColours,
  measureGeometry,
  measurePageFill,
  type ColourMeasures,
  type FoundLogo,
  type Shot,
} from './brand-measure'
import type { Measured } from '../extract/measured-design'
import type { PageFillReading } from '../extract/page-fill'

export interface Measures {
  colours: ColourMeasures
  pageReadings: PageFillReading[]
  geometry: Measured
  logo: FoundLogo | null
}

export interface MeasureRequest {
  shots: Shot[]
  /** The primary screenshot's place in `shots`. */
  primary: number
}

export type MeasureWorkerMessage =
  | { type: 'ready' }
  | { type: 'done'; ok: true; measures: Measures }
  | { type: 'done'; ok: false }

/** Every measure of the stage, in this thread. */
export function measureShots(shots: readonly Shot[], primary: Shot): Measures {
  const clean = cleanShots(shots)
  return {
    colours: measureColours(shots),
    pageReadings: measurePageFill(shots),
    geometry: measureGeometry(primary),
    logo: cutBrandLogo(clean.length < shots.length ? clean : shots),
  }
}

/** The pixel buffers of an answer, handed back without a copy. */
export function measureTransfers(measures: Measures): ArrayBuffer[] {
  const cut = measures.logo?.cut
  const views = cut ? [cut.image.data, cut.png] : []
  // Only a buffer a view owns whole: a pooled one holds other bytes too.
  const owned = views
    .filter((v) => v.buffer instanceof ArrayBuffer && v.byteLength === v.buffer.byteLength)
    .map((v) => v.buffer as ArrayBuffer)
  return [...new Set(owned)]
}

