/**
 * A brand match from the builder: the screenshots posted to the brand match
 * route, which streams each stage's step as it starts and then the result,
 * as server-sent events. Steps reach `onStep` as they arrive; the result is
 * what the promise gives. A refusal (no AI, no allowance, a draft that moved
 * on) is a result too; a broken connection throws.
 */
import type { AppliedDesignChange } from '@/lib/shared/design/apply-changes'
import type { ShotBox } from '@/lib/shared/design/brand-shots'
import type { DesignAdjustment } from '@/lib/shared/design/resolve'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { Fingerprint } from '@/lib/shared/design/fingerprint'

/** The colours a match measured and their roles, as far as the check needs them. */
interface MeasuredRoles {
  identity: { value: string }
  action: { value: { hex: string } }
  links: { value: { hex: string } }
  highlight: { value: string | null }
  extras: string[]
  logoColours: string[]
  text: string
}

export const BRAND_MATCH_URL = '/api/admin/design/brand-match'
const RESULT = 'brand-match-result'

export interface BrandMatchShot {
  palette: string[]
  image?: string
  analysis: string
  strip?: string
  hero?: string
  width: number
  height: number
  /** What the builder warned about it before sending, kept anyway. */
  told?: { dimmed?: boolean; banner?: boolean }
}

/** The capture of the brand's site a match was made from (a website given alone). */
export interface BrandMatchCapture {
  host: string
  /** The page as captured, a JPEG data URL. */
  image: string
  cached: boolean
  capturedAt: string
  /** When Capture again is allowed. */
  againFrom: string
}

export type BrandMatchOutcome =
  | {
      ok: true
      reply: string
      design: PortalDesign
      applied: AppliedDesignChange[]
      readability: string[]
      asks?: string[]
      notes?: string[]
      chips?: string[]
      logo?: { image: number; box: ShotBox; full: boolean; title: string | null } | null
      report?: { adjustments: DesignAdjustment[]; errors: string[]; css: never[] }
      revision?: string
      capture?: BrandMatchCapture
      /** What was measured, for the check that follows the match. */
      target?: {
        fingerprint: Fingerprint
        checkable: boolean
        roles: MeasuredRoles | null
        /** The fields the match set, changed or already as it chose. */
        paths?: string[]
      } | null
    }
  | { ok: false; code: string; message: string }

/** Events in a server-sent events body: each `data:` line's JSON. */
export function sseEvents(text: string): Array<Record<string, unknown>> {
  return text.split('\n').flatMap((line) => {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') return []
    try {
      return [JSON.parse(line.slice(6)) as Record<string, unknown>]
    } catch {
      return []
    }
  })
}

export async function streamBrandMatch(
  body: {
    message: string
    images: BrandMatchShot[]
    brand?: string
    locale?: string
    /** The brand's website: read beside the screenshots, or captured when it comes alone. */
    url?: string
    /** Capture the website again, though a capture is kept. */
    recapture?: boolean
  },
  onStep: (step: string) => void,
  fetcher: typeof fetch = fetch
): Promise<BrandMatchOutcome> {
  const res = await fetcher(BRAND_MATCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) {
    const refusal = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    return {
      ok: false,
      code: res.status === 403 ? 'FORBIDDEN' : 'AI_FAILED',
      message: refusal?.error?.message ?? 'I could not match your brand. Try again.',
    }
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let outcome: BrandMatchOutcome | null = null
  const take = (text: string) => {
    for (const event of sseEvents(text)) {
      if (event.type === 'STEP_STARTED' && typeof event.stepName === 'string')
        onStep(event.stepName)
      if (event.type === 'CUSTOM' && event.name === RESULT)
        outcome = event.value as BrandMatchOutcome
    }
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // Whole events only: an event ends at a blank line.
    const end = buffer.lastIndexOf('\n\n')
    if (end < 0) continue
    take(buffer.slice(0, end))
    buffer = buffer.slice(end + 2)
  }
  take(buffer)
  if (!outcome) throw new Error('The brand match ended without a result.')
  return outcome
}
