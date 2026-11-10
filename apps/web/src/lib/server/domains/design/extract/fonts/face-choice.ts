/**
 * The face a text is set in, chosen from the matcher's ranking under two
 * constraints the drawing alone cannot see: the site's type category, and
 * the weights the portal loads for each face.
 *
 * The category (sans, serif or monospace, as the element finder reads the
 * text) is a hard constraint: the best face of that category, whatever
 * ranks above it, then the next category in a fallback order. Unread, a
 * monospace face still needs a close fit. A wide display sans needs a close
 * fit whatever the reading: as the closest available it only exaggerates.
 * On the 11-02d gate a monospace body stood in for a geometric sans and a
 * wide display sans for a serif headline, each as "the closest available".
 * A condensed face is its own category: only for text whose letters measure
 * condensed (the match's glyph width), never as the closest drawing of a
 * normal-width text, where it collides at tight tracking or reads cramped
 * (11-02e: Barlow Condensed headlines and Oswald body text on normal sites).
 * The width reading is believed only where the drawings fit: a condensed face
 * draws the text best, and the text has letters enough. A crop whose words
 * sit on the wrong lines, or with a photo behind, reads condensed with every
 * face drawn equally badly (11-02f: a membership site's and a food delivery site's headlines; a
 * to-do app's, a web host's and a CRM's paragraphs).
 *
 * The width: the portal draws a headline at a clamped letter-spacing, so a
 * face fitted far tighter draws it wider than the screenshot (a money transfer site: Noto Sans
 * fitted -0.13em, drawn 1.20 times as wide). Among faces that fit nearly as
 * well, the one whose width at the spacing it will get is closest is taken.
 *
 * The weight: when the chosen face does not load the weight the text is set
 * in (that site's 800 matched Open Sans, which the portal loads only to 700), a
 * face of the same category that fits nearly as well and loads it is taken.
 *
 * Pure: no app imports, so the offline extraction harness can load it.
 */
import type { Face, FaceTop } from './faces'
import { CLOSE_IOU, CONDENSED_BELOW, type FaceOption, type TypeMatch } from './type-match'

export type TypeKind = 'sans' | 'serif' | 'mono'

export interface FaceRule {
  /** The text's category as read from the screenshot, or null when not read. */
  kind: TypeKind | null
  role: 'headline' | 'body'
  /** The weight the text is set in, as measured. */
  weight: number
  /** The weights the portal loads for a face. */
  loads: (faceId: string) => readonly number[]
  /**
   * The letter-spacing (em) the portal will draw the text at in a face, given
   * its fit; absent, the width is not weighed.
   */
  drawnAt?: (option: FaceOption) => number
}

export type ChosenFace = TypeMatch & {
  /** Why another face than the best drawn was taken, or '' when it was not. */
  why: string
}

/** The categories tried for a reading, in order. */
const FALLBACK: Record<TypeKind, readonly FaceTop[]> = {
  serif: ['serif', 'sans'],
  sans: ['sans'],
  mono: ['mono', 'sans'],
}

/**
 * How far behind the best face's word overlap a face may fit and still stand
 * in for a weight: a weight a step off shows more than a near face's shapes
 * (the money transfer site: Open Sans 0.73 loads to 700; Noto Sans 0.67 loads its 800).
 */
const WEIGHT_NEAR = 0.08

/** The word overlap a condensed face must reach for a condensed reading to be believed. */
const CONDENSED_IOU = 0.6
/** Letters the width is read on, at least: a paragraph's line for body text. */
const MIN_LETTERS = { headline: 6, body: 20 } as const

/** How far behind in word overlap a face may fit and still be taken for its width. */
const WIDTH_NEAR = 0.05
/** A width off by this much (log ratio) or less is the screenshot's. */
const WIDTH_OK = 0.05
/** How much closer in width (log ratio) a face must draw to be taken over a better fit. */
const WIDTH_GAIN = 0.03

/** A face that only exaggerates when it is not a close fit. */
const needsCloseFit = (face: Face, kind: TypeKind | null, role: FaceRule['role']) =>
  face.sub === 'wide' ||
  (face.top === 'mono' && kind !== 'mono') ||
  (role === 'body' && !!face.display)

/**
 * A class of its own within a category: slab serifs among serifs, rounded
 * faces among sans. Taken only where it fits clearly better than the plain
 * faces of its category; where the drawings come out about even, the plain
 * face is the nearer in kind and the distinctive one only exaggerates (11-03:
 * a slab serif for a soft transitional headline, a rounded face for a thin
 * geometric wordmark, each ahead by 0.01 to 0.03).
 */
const DISTINCTIVE = new Set<Face['sub']>(['slab', 'rounded'])
/** How far ahead in word overlap a slab or rounded face must fit to be taken over a plain one. */
const DISTINCT_MARGIN = 0.04

const normalWidth = (o: FaceOption) =>
  o.face.top !== 'mono' && o.face.sub !== 'condensed' && o.face.sub !== 'wide'

/**
 * Whether a text's letters measure condensed: the glyph width says so, on
 * letters enough, and a condensed face draws the text closely and better than
 * any normal-width face. Unmeasured, they do not.
 */
export function isCondensed(
  match: Pick<TypeMatch, 'glyphWidth' | 'letters' | 'alternatives'>,
  role: FaceRule['role'] = 'headline'
): boolean {
  if (match.glyphWidth === undefined || match.glyphWidth > CONDENSED_BELOW) return false
  if (match.letters !== undefined && match.letters < MIN_LETTERS[role]) return false
  const best = (keep: (o: FaceOption) => boolean) =>
    Math.max(0, ...(match.alternatives ?? []).filter(keep).map((o) => o.iou))
  const condensed = best((o) => o.face.sub === 'condensed')
  return condensed >= CONDENSED_IOU && condensed > best(normalWidth)
}

/**
 * How much wider (log ratio) a face draws the text at the spacing it will get
 * than the screenshot shows it, or null when not known: the fit makes the
 * widths agree, and every letter gap adds the difference in spacing.
 */
function widthError(
  match: Pick<TypeMatch, 'widthPx' | 'letterGaps'>,
  o: FaceOption,
  drawnAt: (o: FaceOption) => number
): number | null {
  if (!match.widthPx || !match.letterGaps) return null
  const ratio = 1 + ((drawnAt(o) - o.tracking) * o.size * match.letterGaps) / match.widthPx
  return ratio > 0 ? Math.log(ratio) : null
}

const usable = (o: FaceOption, kind: TypeKind | null, condensed: boolean, role: FaceRule['role']) =>
  (!needsCloseFit(o.face, kind, role) || o.iou >= CLOSE_IOU) &&
  (o.face.sub !== 'condensed' || condensed)

/** The faces the reading allows, best first: the first category with any, in the fallback order. */
function candidates(
  options: readonly FaceOption[],
  kind: TypeKind | null,
  condensed: boolean,
  role: FaceRule['role']
): { pool: FaceOption[]; top: FaceTop | null } {
  if (!kind) return { pool: options.filter((o) => usable(o, kind, condensed, role)), top: null }
  for (const top of FALLBACK[kind]) {
    const pool = options.filter((o) => o.face.top === top && usable(o, kind, condensed, role))
    if (pool.length) return { pool, top }
  }
  return { pool: [], top: null }
}

/** Whether the portal loads a weight within a step of the one wanted. */
const loadsNear = (o: FaceOption, rule: FaceRule) =>
  rule.loads(o.face.id).some((w) => Math.abs(w - rule.weight) < 100)

export function chooseFace(match: TypeMatch, rule: FaceRule): ChosenFace {
  const options = match.alternatives?.length
    ? match.alternatives
    : [
        {
          face: match.face,
          weight: match.weight,
          size: match.size,
          tracking: match.tracking,
          iou: match.iou,
          capRatio: match.capRatio,
          fits: match.fits,
        },
      ]
  const condensed = isCondensed(match, rule.role)
  const found = candidates(options, rule.kind, condensed, rule.role)
  const { top } = found
  // A slab or rounded face that does not fit clearly better than a plain one is no candidate,
  // so neither the weight nor the width brings it back.
  const plain = found.pool.find((o) => !DISTINCTIVE.has(o.face.sub))
  const unclear = (o: FaceOption) =>
    DISTINCTIVE.has(o.face.sub) && !!plain && plain.iou > o.iou - DISTINCT_MARGIN
  const pool = found.pool.filter((o) => !unclear(o))
  let pick = pool[0]
  if (!pick) return { ...match, why: '' }
  const reasons: string[] = []
  const what = rule.role === 'body' ? 'text' : 'headline'
  const passed = found.pool[0]!
  if (unclear(passed))
    reasons.push(
      `${passed.face.id} is a ${passed.face.sub === 'slab' ? 'slab serif' : 'rounded face'}, taken only where it fits clearly better than a plain face; ${pick.face.id} fits about as well`
    )
  else if (pick.face.id !== options[0]!.face.id)
    reasons.push(
      options[0]!.face.sub === 'condensed' && !condensed
        ? `the ${what}'s letters are not condensed`
        : rule.role === 'body' && options[0]!.face.display && options[0]!.iou < CLOSE_IOU
          ? `${options[0]!.face.id} is a display face, for body text only on a close fit`
          : rule.kind && top === rule.kind
            ? `the ${what} reads as ${rule.kind === 'mono' ? 'monospace' : rule.kind}`
            : rule.kind && top
              ? `no ${rule.kind === 'mono' ? 'monospace' : rule.kind} face fits, so the nearest ${top}`
              : 'the closest plain face, as nothing bundled is close'
    )
  if (!loadsNear(pick, rule)) {
    const best = pick
    const stand = pool.find(
      (o) => o !== best && o.iou >= best.iou - WEIGHT_NEAR && loadsNear(o, rule)
    )
    if (stand) {
      reasons.push(`${best.face.id} does not load weight ${rule.weight}; this face does`)
      pick = stand
    }
  }
  const drawnAt = rule.drawnAt
  const off = drawnAt ? widthError(match, pick, drawnAt) : null
  if (drawnAt && off !== null && Math.abs(off) > WIDTH_OK) {
    const best = pick
    // A face as near that loads the weight as well as this one does, closest in width.
    const weighs = loadsNear(best, rule)
    const near = pool
      .filter(
        (o) => o !== best && o.iou >= best.iou - WIDTH_NEAR && (!weighs || loadsNear(o, rule))
      )
      .map((o) => ({ o, off: widthError(match, o, drawnAt) }))
      .filter((c): c is { o: FaceOption; off: number } => c.off !== null)
      .sort((a, b) => Math.abs(a.off) - Math.abs(b.off))[0]
    if (near && Math.abs(near.off) <= Math.abs(off) - WIDTH_GAIN) {
      reasons.push(
        `${best.face.id} draws the ${what} ${Math.exp(off).toFixed(2)} times as wide at the letter-spacing it can take; this face ${Math.exp(near.off).toFixed(2)}`
      )
      pick = near.o
    }
  }
  if (pick.face.id === match.face.id) return { ...match, why: reasons.join('; ') }
  return {
    ...match,
    face: pick.face,
    weight: pick.weight,
    size: pick.size,
    tracking: pick.tracking,
    iou: pick.iou,
    capRatio: pick.capRatio,
    fits: pick.fits,
    close: pick.iou >= CLOSE_IOU,
    runnersUp: options
      .filter((o) => o.face.id !== pick.face.id)
      .slice(0, 3)
      .map((o) => o.face.id),
    why: reasons.join('; '),
  }
}
