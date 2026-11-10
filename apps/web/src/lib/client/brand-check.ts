/**
 * The builder's side of the verified critic loop after a brand match: it
 * reads the drawn preview (fingerprint and picture) from the canvas, asks
 * the server to score it and to propose a revision, shows a candidate on
 * the draft, and keeps it only when it measures better (runCheckLoop).
 */
import {
  runCheckLoop,
  type CheckCandidate,
  type CheckReading,
  type CheckReport,
  type CheckScore,
} from '@/lib/shared/design/brand-check'
import {
  scoreFingerprint,
  type Fingerprint,
  type FingerprintGap,
} from '@/lib/shared/design/fingerprint'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { CheckFrame } from './check-frame'
import { capturePreview } from './preview-capture'
import { readSettled } from './preview-fingerprint'

export const BRAND_CHECK_URL = '/api/admin/design/brand-check'

/** Each request's time, ms: the server holds its model steps to less. */
const REQUEST_MS = { score: 16_000, revise: 16_000 }

type Scored = CheckScore & { answer: unknown; gaps: FingerprintGap[] }

export interface BrandCheckInput {
  /** What the match measured, as a fingerprint. */
  target: Fingerprint
  /** The brand's screenshots as the model saw them. */
  shots: string[]
  brand?: string
  /** The fields the match set. */
  paths: string[]
  /** The measured colours a revision may use. */
  palette: string[]
  /** The draft as the match left it. */
  design: PortalDesign
}

export interface BrandCheckDeps {
  /** The canvas's frame, read when the check's own frame cannot open. */
  frame: () => HTMLIFrameElement | null
  /**
   * Opens the check's own frame: Home, the page the match changes, at the
   * screenshots' width, off screen (check-frame.ts). Closed when the check ends.
   */
  open?: (design: PortalDesign) => Promise<CheckFrame<PortalDesign>>
  /** Shows a design on the draft, saving it. */
  show: (design: PortalDesign) => void
  /** Saves a change waiting to save, so the server reads the draft as shown. */
  flush: () => Promise<void>
  progress: (text: string) => void
  fetcher?: typeof fetch
  capture?: (frame: HTMLIFrameElement | null) => Promise<string | null>
  read?: typeof readSettled
}

async function post<T>(fetcher: typeof fetch, body: unknown, ms: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetcher(BRAND_CHECK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const result = (await res.json().catch(() => null)) as
      (T & { ok: true }) | { ok: false; message?: string; error?: { message?: string } } | null
    if (!res.ok || !result || result.ok !== true) {
      const refusal = result as { message?: string; error?: { message?: string } } | null
      throw new Error(refusal?.message ?? refusal?.error?.message ?? 'The check was refused.')
    }
    return result
  } finally {
    clearTimeout(timer)
  }
}

export async function checkBrandMatch(
  input: BrandCheckInput,
  deps: BrandCheckDeps
): Promise<CheckReport> {
  const fetcher = deps.fetcher ?? fetch
  const capture = deps.capture ?? capturePreview
  const read = deps.read ?? readSettled
  const probe = deps.open ? await deps.open(input.design).catch(() => null) : null
  const frame = probe ? probe.frame : deps.frame
  try {
    return await loop(input, deps, { fetcher, capture, read, probe, frame })
  } finally {
    probe?.close()
  }
}

function loop(
  input: BrandCheckInput,
  deps: BrandCheckDeps,
  ctx: {
    fetcher: typeof fetch
    capture: NonNullable<BrandCheckDeps['capture']>
    read: typeof readSettled
    probe: CheckFrame<PortalDesign> | null
    frame: () => HTMLIFrameElement | null
  }
): Promise<CheckReport> {
  const { fetcher, capture, read, probe, frame } = ctx
  // The reading before a candidate went on, so the next read waits for it to draw.
  let before: Fingerprint | undefined
  return runCheckLoop<PortalDesign, Scored>(input.design, {
    read: async (): Promise<CheckReading> => {
      const fingerprint = await read(frame, before ? { before } : {})
      before = undefined
      const picture = await capture(frame())
      return { fingerprint, picture }
    },
    measure: (reading) => scoreFingerprint(input.target, reading.fingerprint).score,
    score: (reading, round) =>
      post<Scored>(
        fetcher,
        {
          op: 'score',
          round,
          target: input.target,
          actual: reading.fingerprint,
          picture: reading.picture,
          shots: input.shots,
          ...(input.brand ? { brand: input.brand } : {}),
        },
        REQUEST_MS.score
      ),
    revise: async (best, round): Promise<CheckCandidate<PortalDesign> | null> => {
      await deps.flush()
      const revised = await post<{
        changes: Array<{ path: string; value: unknown; why: string }>
        design: PortalDesign | null
      }>(
        fetcher,
        {
          op: 'revise',
          round,
          target: input.target,
          actual: best.reading.fingerprint,
          critic: best.score.answer ?? null,
          paths: input.paths,
          palette: input.palette,
        },
        REQUEST_MS.revise
      )
      if (!revised.design || !revised.changes.length) return null
      before = best.reading.fingerprint
      return { changes: revised.changes, design: revised.design }
    },
    apply: async (design) => {
      deps.show(design)
      probe?.show(design)
    },
    progress: deps.progress,
  })
}
