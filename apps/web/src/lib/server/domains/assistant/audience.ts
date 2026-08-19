/**
 * Content-audience classification for anything Quinn can retrieve and cite.
 *
 * `AssistantSurface` (widget/email/workflow_step/copilot) is the ONLY signal
 * that distinguishes a customer-facing turn from a teammate-facing one —
 * `quinnActor` is always a 'service' principal, so `principalType` cannot be
 * used for this. `resolveContentAudience` is the single mint point for any
 * audience above 'public': every other piece of code that needs a
 * `ContentAudience` must go through it (or through a value that already came
 * from it), never construct one from a raw string literal. That is the
 * structural leak gate — as long as nothing else produces 'team' or
 * 'internal', a customer-facing surface can never retrieve or cite
 * teammate-only or internal-only knowledge, regardless of prompt discipline.
 *
 * This is deliberately its own type from `HelpCenterAudience`
 * ('public' | 'team', help-center-search.service.ts). That type is a
 * retrieval-scope parameter with a wide blast radius — it also gates the
 * public help-center's own search and Ask AI routes — and widening it to add
 * 'internal' would ripple through code that has nothing to do with the
 * assistant. `toHelpCenterAudience` maps at the boundary instead, so KB
 * retrieval keeps its narrower, already-audited type untouched.
 */
import type { AssistantSurface } from '@/lib/shared/assistant/surfaces'
import type { HelpCenterAudience } from '@/lib/server/domains/help-center/help-center-search.service'

/**
 * How privileged a piece of content (or a viewer's retrieval ceiling) is.
 * `public` is anything the open web can see; `team` is teammate-only
 * (mirrors the help center's private tier); `internal` is narrower still —
 * for sources that should never reach even a teammate-facing surface that
 * merely inherited 'team' by default (reserved for future internal-only
 * sources; nothing mints it yet).
 */
export type ContentAudience = 'public' | 'team' | 'internal'

/**
 * Restriction rank — higher number is stricter/more-privileged. Mirrors
 * `ACCESS_TIER_RANK` (packages/db/src/types.ts): a rank comparison, not a
 * string comparison, is what `canSee` and any future ceiling check should use.
 */
export const CONTENT_AUDIENCE_RANK: Record<ContentAudience, number> = {
  public: 0,
  team: 1,
  internal: 2,
}

/**
 * Whether a row tagged `rowAudience` is visible to a viewer whose retrieval
 * ceiling is `ceiling`. A row is visible when it is no more restricted than
 * the ceiling — e.g. a 'public'-ceiling viewer (customer surface) can only
 * see 'public' rows; a 'team'-ceiling viewer (copilot) can see 'public' and
 * 'team' rows, but not 'internal' ones.
 */
export function canSee(ceiling: ContentAudience, rowAudience: ContentAudience): boolean {
  return CONTENT_AUDIENCE_RANK[rowAudience] <= CONTENT_AUDIENCE_RANK[ceiling]
}

/**
 * Resolve the retrieval ceiling for a turn from its deploy surface — the
 * SINGLE function in the codebase allowed to produce a `ContentAudience`
 * above 'public'. Every context-construction call site must derive its
 * audience by calling this (never by writing a literal), so widening what a
 * customer-facing surface can see requires editing this allow-list, not
 * threading a new field through callers.
 *
 * Allow-list: the customer-facing surfaces (widget, email, workflow_step)
 * always resolve to 'public' — they can never see teammate or internal
 * knowledge, no matter what a caller passes in elsewhere. `copilot` (the
 * agent-facing surface in the inbox) resolves to 'team'. Nothing resolves to
 * 'internal' yet; that is reserved for a future internal-only source and
 * surface pairing.
 *
 * The switch is exhaustive over `AssistantSurface` (compiler-checked): adding
 * a surface without extending this function fails the build.
 */
export function resolveContentAudience(surface: AssistantSurface): ContentAudience {
  switch (surface) {
    case 'widget':
    case 'email':
    case 'workflow_step':
      return 'public'
    case 'copilot':
      return 'team'
    default: {
      const exhaustive: never = surface
      throw new Error(`resolveContentAudience: unhandled assistant surface "${exhaustive}"`)
    }
  }
}

/**
 * Map a `ContentAudience` retrieval ceiling onto the narrower
 * `HelpCenterAudience` KB retrieval understands. 'internal' collapses to
 * 'team' here — KB articles have no internal-only tier today, so an
 * internal-ceiling viewer sees the same KB slice a team-ceiling one does;
 * a future internal-only source would enforce that narrower tier itself,
 * not through this mapping.
 */
export function toHelpCenterAudience(audience: ContentAudience): HelpCenterAudience {
  switch (audience) {
    case 'public':
      return 'public'
    case 'team':
    case 'internal':
      return 'team'
    default: {
      const exhaustive: never = audience
      throw new Error(`toHelpCenterAudience: unhandled content audience "${exhaustive}"`)
    }
  }
}
