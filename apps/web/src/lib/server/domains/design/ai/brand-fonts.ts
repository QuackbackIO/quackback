/**
 * The font stage of a brand match, off the request thread. Matching draws
 * each text's words in every bundled face and weight, 0.3 to 1.5 s of CPU
 * that would hold every other request on this server, so it runs on a
 * worker thread (the app's `?server-worker` mechanism) with only the text
 * crops handed over.
 *
 * A worker that cannot start or dies is a fault of the worker, not of the
 * screenshot: the match runs in process instead, as before. A worker still
 * matching at the deadline is stopped and the stage gives no match, which
 * the brand match reports as type left as it was.
 */
import { Worker } from 'node:worker_threads'
import { BUNDLED_FONTS } from '@/lib/shared/design/fonts'
import { logger } from '@/lib/server/logger'
import type { Box, TypeKindRead } from '../extract/kinds'
import { chooseFace, type ChosenFace } from '../extract/fonts/face-choice'
import { faceById, type Face } from '../extract/fonts/faces'
import {
  cropText,
  matchCrops,
  NO_MATCHES,
  type TypeCropSet,
  type TypeMatches,
  type TypeWorkerMessage,
  type TypeWorkerRequest,
} from '../extract/fonts/type-crops'
import typeWorkerUrl from '../extract/fonts/type-worker?server-worker'
import { TRACKING_EM } from '@/lib/shared/design/effective-values'
import {
  CLOSE_IOU,
  fitAt,
  UNREAD_IOU,
  type FaceOption,
  type TypeMatch,
} from '../extract/fonts/type-match'
import {
  fittedTracking,
  headlineWeight,
  sharpest,
  TRACKING_RANGE,
  type Shot,
} from './brand-measure'

export type { TypeMatches } from '../extract/fonts/type-crops'

const log = logger.child({ module: 'brand-fonts' })

/** Heap for one match: two crops and the faces' outlines. */
const WORKER_HEAP_MB = 256

type ShotText = Pick<Shot, 'img' | 'strip' | 'found'>

/**
 * The headline's and the subtitle's crops, each from where its pixels are
 * sharpest: a halved retina capture loses the details that tell close faces
 * apart (Inter Tight from IBM Plex Sans), so the native strip is read where
 * the text lies within it.
 */
export function typeCrops(shot: ShotText): TypeCropSet {
  const { output, snapped } = shot.found
  const crop = (box: Box | null, text: string) => {
    const at = sharpest(shot, box)
    return cropText(at.img, at.box, text, at.scale)
  }
  return {
    headline: crop(snapped.headline, output.headline_text),
    body: crop(snapped.subtitle, output.subtitle_text),
  }
}

/** T4: the headline's and the subtitle's faces, matched in this thread. */
export function matchType(shot: ShotText): TypeMatches {
  return matchCrops(typeCrops(shot))
}

/** The weights the portal loads for a face: its stylesheet's, else the files the matcher read. */
const loads = (id: string): readonly number[] =>
  (Object.hasOwn(BUNDLED_FONTS, id)
    ? BUNDLED_FONTS[id as keyof typeof BUNDLED_FONTS].weights
    : null) ??
  faceById(id)?.weights ??
  []

/**
 * The faces whose light weight (300) the portal loads only so a light headline
 * is drawn light. The face choice weighs the weights it was set against, without
 * it: a weight fix leaves the faces alone, and only the drawn weight changes.
 */
const LIGHT_FOR_DRAWING: ReadonlySet<string> = new Set([
  'archivo',
  'barlow-condensed',
  'bricolage-grotesque',
  'fira-code',
  'fraunces',
  'geist',
  'ibm-plex-sans',
  'jetbrains',
  'karla',
  'lato',
  'libre-franklin',
  'merriweather',
  'noto-sans',
  'nunito',
  'open-sans',
  'oswald',
  'poppins',
  'quicksand',
  'roboto',
  'roboto-slab',
  'rubik',
  'source-serif',
  'space-grotesk',
  'unbounded',
])

/** The weights the face choice weighs for a face (LIGHT_FOR_DRAWING). */
const choiceLoads = (id: string): readonly number[] =>
  LIGHT_FOR_DRAWING.has(id) ? loads(id).filter((w) => w !== 300) : loads(id)

const kindOf = (read: TypeKindRead | undefined) =>
  read === 'sans' || read === 'serif' || read === 'mono' ? read : null

/**
 * The letter-spacing the portal draws a headline at in a face: its fit,
 * clamped (fittedTracking), else the house spacing.
 */
export const headlineDrawnAt = (o: FaceOption): number =>
  fittedTracking({ tracking: o.tracking, iou: o.iou, close: o.iou >= CLOSE_IOU }) ??
  TRACKING_EM.normal

const nearestOf = (options: readonly number[], v: number) =>
  options.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a))

/** The weight the portal draws a headline at: the step its stem and fit read, as the face loads it. */
export function drawnWeight(match: TypeMatch): number {
  const w = headlineWeight(Number.isFinite(match.stem) ? match.stem : null, match)
  const loaded = loads(match.face.id)
  return loaded.length ? nearestOf(loaded, Math.round(w / 100) * 100) : w
}

const isInter = (id: string) => id === 'inter' || id === 'inter-tight'

/** Whether a fitted letter-spacing is one the portal draws as fitted, not clamped. */
const inRange = (tracking: number, iou: number) =>
  tracking <= TRACKING_RANGE.max &&
  tracking >= (iou >= CLOSE_IOU ? TRACKING_RANGE.closeMin : TRACKING_RANGE.min)

/**
 * The headline refitted at the weight the portal draws it: the face is
 * fitted at the weight it draws best, but drawn at the step its stem reads
 * and the face loads (headlineWeight), often a step lighter, whose narrower
 * letters need less negative spacing than the heavier fit's (a code host: Mona
 * Sans fitted at 500, -0.027em, drawn at 400). The size and spacing are that
 * weight's own fit.
 *
 * Inter and Inter Tight are one design, Inter Tight set closer: Inter where
 * its own fit is a spacing the portal draws (a notes app: Inter -0.041em, its
 * site -0.048), Inter Tight only where Inter would need more than that.
 */
export function atDrawnWeight(match: ChosenFace, opts: { keepFace?: boolean } = {}): ChosenFace {
  let m = match
  if (isInter(m.face.id) && !opts.keepFace) {
    const options = (m.alternatives ?? []).filter((o) => isInter(o.face.id))
    const inter = options.find((o) => o.face.id === 'inter')
    const tight = options.find((o) => o.face.id === 'inter-tight')
    const weight = drawnWeight(m)
    const interFit = inter && fitAt(inter, weight)
    const pick = interFit && inRange(interFit.tracking, inter.iou) ? inter : (tight ?? inter)
    if (pick && pick.face.id !== m.face.id)
      m = {
        ...m,
        face: pick.face,
        weight: pick.weight,
        size: pick.size,
        tracking: pick.tracking,
        iou: pick.iou,
        capRatio: pick.capRatio,
        fits: pick.fits,
      }
  }
  const fit = fitAt(m, drawnWeight(m))
  if (!fit || !(fit.size > 0)) return m
  return {
    ...m,
    size: fit.size,
    tracking: fit.tracking,
    capRatio: (m.capRatio * m.size) / fit.size,
  }
}

/**
 * What the brand's site says a text is set in: the bundled face it names
 * (exact: that very face), or the face nearest a family the portal cannot
 * draw, and its kind (serif, sans or monospace), from the site's own CSS.
 */
export interface FaceHint {
  id: string | null
  exact: boolean
  kind: 'sans' | 'serif' | 'mono' | null
  why: string
}

/** How far behind the best fit the face nearest a family the site names may be, and still be taken. */
export const HINT_NEAR = 0.12

/**
 * The match with the face the site names first, as the fitting drew it: an
 * exact face always, a nearest one when it fits nearly as well as the best.
 * Unchanged when the face was not drawn.
 */
export function preferNamed(match: TypeMatch, hint: FaceHint | null | undefined): TypeMatch {
  if (!hint?.id) return match
  const option = match.alternatives.find((o) => o.face.id === hint.id)
  const best = match.alternatives[0]
  if (!option || option === best) return match
  if (!hint.exact && best && option.iou < best.iou - HINT_NEAR) return match
  return {
    ...match,
    face: option.face,
    weight: option.weight,
    size: option.size,
    tracking: option.tracking,
    iou: option.iou,
    close: option.iou >= CLOSE_IOU,
    capRatio: option.capRatio,
    fits: option.fits,
    alternatives: [option, ...match.alternatives.filter((o) => o !== option)],
  }
}

/**
 * The faces to use: each text's best drawn face under the category the
 * finder read (a serif stays serif, a sans body never monospace) and the
 * weight it is set in (the headline's as its stem reads, headlineWeight),
 * so a face that cannot draw that weight gives way to a near one that can,
 * and, among faces that fit nearly as well, the one that draws the text as
 * wide as the screenshot at the spacing the portal gives it (the headline's
 * clamped fit; body text untracked).
 *
 * With the brand's site read, what its CSS names leads: a face the portal
 * bundles is taken as itself, fitted at the weight it is drawn; a family it
 * cannot draw puts the face nearest it first and its kind in place of the
 * finder's reading.
 */
export function chooseFaces(
  type: TypeMatches,
  read: { headline_type?: TypeKindRead; body_type?: TypeKindRead },
  site: { headline?: FaceHint | null; body?: FaceHint | null } = {}
): TypeMatches {
  return paired(chosenFaces(type, read, site), read, site)
}

/** Below this word overlap no face draws a text (type-match.ts). */
export { UNREAD_IOU }

/** The plain bundled face of each kind, for text whose own face is not known. */
const PLAIN_FACE: Record<'sans' | 'serif' | 'mono', string> = {
  sans: 'inter',
  serif: 'source-serif',
  mono: 'jetbrains',
}

/** A face body text can be set in: not condensed, wide or a display face. */
const textFace = (face: Face) => !face.display && face.sub !== 'condensed' && face.sub !== 'wide'

const readClearly = (m: TypeMatch | null) => !!m && m.iou >= UNREAD_IOU

/** A match drawn in another of its fitted faces, with why. */
function inFace(m: ChosenFace, id: string, why: string): ChosenFace | null {
  const o = m.alternatives.find((a) => a.face.id === id)
  if (!o) return null
  return {
    ...m,
    face: o.face,
    weight: o.weight,
    size: o.size,
    tracking: o.tracking,
    iou: o.iou,
    close: o.iou >= CLOSE_IOU,
    capRatio: o.capRatio,
    fits: o.fits,
    why,
  }
}

/**
 * The faces paired as a site pairs them, where one text was not read: most
 * sites set their headlines and text in one family, or pair a serif with a
 * sans. Text with no crop, or whose crop no face draws (UNREAD_IOU), takes
 * the headline's face where the finder reads it as the same kind, else the
 * plain face of the kind it reads as; it is never set in a condensed, wide
 * or display headline face. A headline no face draws takes the face of text
 * read clearly where both read as the same kind. What the site's CSS names
 * leads: neither is paired where it names a face for that text.
 */
function paired(
  chosen: TypeMatches,
  read: { headline_type?: TypeKindRead; body_type?: TypeKindRead },
  site: { headline?: FaceHint | null; body?: FaceHint | null }
): TypeMatches {
  let { headline: h, body: b } = chosen as { headline: ChosenFace | null; body: ChosenFace | null }
  const bodyKind = site.body?.kind ?? kindOf(read.body_type)
  if (h && b && !readClearly(h) && readClearly(b) && !site.headline && textFace(b.face)) {
    if ((kindOf(read.headline_type) ?? h.face.top) === b.face.top) {
      const swapped = inFace(
        h,
        b.face.id,
        `no face draws the headline's crop; the text under it reads clearly in ${b.face.id}, and a site sets both in one family`
      )
      if (swapped) h = atDrawnWeight(swapped, { keepFace: true })
    }
  }
  if (h && !readClearly(b) && !site.body) {
    const sameKind = !bodyKind || bodyKind === h.face.top
    const id = sameKind && textFace(h.face) ? h.face.id : PLAIN_FACE[bodyKind ?? h.face.top]
    const face = faceById(id)
    if (face) {
      const why =
        id === h.face.id
          ? `the text under the headline was not read; the headline's face, as a site sets both in one family`
          : `the text under the headline was not read; it reads as ${bodyKind ?? h.face.top}, so the plain ${face.id}`
      b = b
        ? { ...b, face, why }
        : {
            ...h,
            face,
            // Nothing was drawn: no size or spacing is claimed for it.
            iou: 0,
            close: false,
            fits: undefined,
            runnersUp: [],
            alternatives: [],
            why,
          }
    }
  }
  return { headline: h, body: b }
}

function chosenFaces(
  type: TypeMatches,
  read: { headline_type?: TypeKindRead; body_type?: TypeKindRead },
  site: { headline?: FaceHint | null; body?: FaceHint | null }
): TypeMatches {
  const h = type.headline ? preferNamed(type.headline, site.headline) : null
  const b = type.body ? preferNamed(type.body, site.body) : null
  const exact = (m: TypeMatch | null, hint: FaceHint | null | undefined) =>
    !!m && !!hint?.exact && m.face.id === hint.id
  return {
    headline: h
      ? exact(h, site.headline)
        ? atDrawnWeight({ ...h, why: site.headline!.why }, { keepFace: true })
        : atDrawnWeight(
            chooseFace(h, {
              kind: site.headline?.kind ?? kindOf(read.headline_type),
              role: 'headline',
              weight: headlineWeight(Number.isFinite(h.stem) ? h.stem : null, h),
              loads: choiceLoads,
              drawnAt: headlineDrawnAt,
            })
          )
      : null,
    body: b
      ? exact(b, site.body)
        ? Object.assign({}, b, { why: site.body!.why })
        : chooseFace(b, {
            kind: site.body?.kind ?? kindOf(read.body_type),
            role: 'body',
            weight: b.weight,
            loads: choiceLoads,
            drawnAt: () => 0,
          })
      : null,
  }
}

type Outcome = { ok: true; matches: TypeMatches } | { ok: false; why: 'failed' | 'late' }

function inWorker(crops: TypeCropSet, deadlineMs: number, url: URL): Promise<Outcome> {
  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(url, { resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } })
    } catch (err) {
      log.warn({ err }, 'font worker could not start')
      resolve({ ok: false, why: 'failed' })
      return
    }
    let settled = false
    const settle = (outcome: Outcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      resolve(outcome)
    }
    const timer = setTimeout(() => settle({ ok: false, why: 'late' }), Math.max(0, deadlineMs))
    worker.on('message', (message: TypeWorkerMessage) => {
      if (message.type === 'ready') return
      settle(message.ok ? { ok: true, matches: message.matches } : { ok: false, why: 'failed' })
    })
    worker.once('error', (err) => {
      log.warn({ err }, 'font worker failed')
      settle({ ok: false, why: 'failed' })
    })
    worker.once('exit', (code) => {
      if (!settled) log.warn({ code }, 'font worker stopped before answering')
      settle({ ok: false, why: 'failed' })
    })
    worker.postMessage({ crops } satisfies TypeWorkerRequest)
  })
}

/**
 * The faces matched on a worker thread within `deadlineMs`; in process when
 * the worker fails; no match when it runs out of time.
 */
export async function matchTypeOffThread(
  shot: ShotText,
  opts: { deadlineMs: number; workerUrl?: URL }
): Promise<TypeMatches> {
  const crops = typeCrops(shot)
  if (!crops.headline && !crops.body) return NO_MATCHES
  const outcome = await inWorker(crops, opts.deadlineMs, opts.workerUrl ?? typeWorkerUrl)
  if (outcome.ok) return outcome.matches
  if (outcome.why === 'late') {
    log.warn({ deadlineMs: opts.deadlineMs }, 'font matching ran out of time')
    return NO_MATCHES
  }
  log.warn('font matching in process: the worker failed')
  return matchCrops(crops)
}
