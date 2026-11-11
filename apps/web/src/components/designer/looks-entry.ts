/**
 * The ways into Compare looks, which the builder loads only once it opens:
 * whether it is open and from where, and the brand match its looks are made
 * from.
 *
 * Where the looks come from (the base): the design a brand match left, kept
 * in this browser beside the match's time (`brand.matchedAt`). Compare looks
 * opened later, from Theme, still shows Matched, Soft and Vivid of that
 * match, with the draft's own pages, menu and words. A match made elsewhere
 * since (another browser) has another time, so the kept one no longer
 * counts; with no match kept, the looks are made from the draft as it is.
 * Nothing about the base is saved with the design, so the published portal
 * carries none of it.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { DesignAiTurn } from '@/components/admin/settings/appearance/use-design-ai'
import { trackBuilder } from '@/lib/client/builder-events'
import type { LookVariantId } from '@/lib/shared/design/look-variants'
import { LOOK_NAMES } from '@/lib/shared/design/compare-looks'
import { lookOf, type DesignLook } from '@/lib/shared/design/looks'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { hasLook } from './look-picker'

/** Where Compare looks was opened from. */
export type LooksFrom = 'onboarding' | 'theme' | 'ai'

const BASE_KEY = 'quackback:designer-look-base'
const APPLIED_KEY = 'quackback:designer-look-applied'
const SHOWN_KEY = 'quackback:designer-looks-shown'

// Each key's text as last read and what it parsed to, so reading on every render parses once.
const parsed = new Map<string, { raw: string; value: unknown }>()

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const seen = parsed.get(key)
    if (seen?.raw === raw) return seen.value as T
    const value = JSON.parse(raw) as T
    parsed.set(key, { raw, value })
    return value
  } catch {
    return null
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage closed: the looks are made from the draft instead.
  }
}

let open: LooksFrom | null = null
const listeners = new Set<() => void>()
const notify = () => {
  for (const listener of listeners) listener()
}

/** Opens Compare looks, saying where from. */
export function openLooks(from: LooksFrom): void {
  if (open !== null) return
  open = from
  trackBuilder('designer_looks_opened', { from })
  notify()
}

/** Closes Compare looks. */
export function closeLooks(): void {
  if (open === null) return
  open = null
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Where Compare looks was opened from while it is open, else null. */
export function useLooksOpen(): LooksFrom | null {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => null
  )
}

/** Keeps a brand match's design as the base of its looks, with Matched as the look in use. */
export function rememberMatch(design: PortalDesign): void {
  if (!design.brand.matchedAt) return
  write(BASE_KEY, { matchedAt: design.brand.matchedAt, design })
  rememberApplied('matched', design)
}

/** The design the looks are made from: the last match kept here, else the draft. */
export function lookBase(draft: PortalDesign): PortalDesign {
  const kept = read<{ matchedAt: string; design: PortalDesign }>(BASE_KEY)
  return kept && kept.matchedAt === draft.brand.matchedAt ? kept.design : draft
}

/** Keeps which look was taken, so Theme can name it while the draft still has it. */
export function rememberApplied(id: LookVariantId, design: PortalDesign): void {
  write(APPLIED_KEY, { id, look: lookOf(design) })
}

/** The name of the look taken here last, while the draft still has it; else null. */
export function appliedLookName(design: PortalDesign): string | null {
  const kept = read<{ id: LookVariantId; look: DesignLook }>(APPLIED_KEY)
  if (!kept || !(kept.id in LOOK_NAMES)) return null
  return hasLook(design, kept.look) ? LOOK_NAMES[kept.id] : null
}

/**
 * Whether Compare looks opens by itself after this match: only after the
 * first match handed over from onboarding, once in this browser.
 */
export function firstLooksOpen(): boolean {
  if (read<boolean>(SHOWN_KEY)) return false
  write(SHOWN_KEY, true)
  return true
}

/**
 * Once a brand match lands (Ask AI done working, its last reply a match):
 * the draft as it left it is kept as the base of its looks, and after the
 * first match handed over from onboarding, Compare looks opens by itself.
 */
export function useLooksAfterMatch(
  busy: boolean,
  turns: readonly DesignAiTurn[],
  design: PortalDesign
): { fromOnboarding: () => void } {
  const onboarding = useRef(false)
  const working = useRef(busy)
  const latest = useRef(design)
  latest.current = design
  useEffect(() => {
    if (busy) {
      working.current = true
      return
    }
    if (!working.current) return
    working.current = false
    const handedOver = onboarding.current
    onboarding.current = false
    const last = turns.findLast((turn) => turn.role === 'assistant')
    if (last?.role !== 'assistant' || !last.matched || !last.changes?.length) return
    rememberMatch(latest.current)
    if (handedOver && firstLooksOpen()) openLooks('onboarding')
  }, [busy, turns])
  return useMemo(
    () => ({
      fromOnboarding: () => {
        onboarding.current = true
      },
    }),
    []
  )
}
