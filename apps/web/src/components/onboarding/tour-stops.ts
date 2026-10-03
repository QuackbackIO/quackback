import type { MessageDescriptor } from 'react-intl'
import type { OnboardingOutcome } from '@/lib/shared/db-types'
import { PERMISSIONS } from '@/lib/shared/permissions'

/**
 * The guided tour's stops, as data. Each stop names the `data-tour` element it
 * points at, the page it needs, and the one line it says. Which stops a tour
 * has is decided by {@link resolveTourStops} before the overlay opens, from the
 * workspace's goals, modules, the viewer's permissions and the viewport, so
 * the count is right from the first stop and nothing waits on the page.
 */

export const MAX_TOUR_STOPS = 5

export type TourStopId =
  | 'copilot'
  | 'products'
  | 'feedback'
  | 'feedback-private'
  | 'roadmap'
  | 'support'
  | 'help-center'
  | 'status'
  | 'view-portal'
  | 'search'

export type TourRoute =
  | '/admin'
  | '/admin/feedback'
  | '/admin/inbox'
  | '/admin/help-center'
  | '/admin/status'
  | '/admin/users'

export interface TourStop {
  id: TourStopId
  /** The `data-tour` value of the element the coachmark points at. */
  target: string
  /** The page the target lives on; absent when the current page has it (the sidebar). */
  route?: TourRoute
  lead: MessageDescriptor
  line: MessageDescriptor
}

/** What the stops are chosen from. Gathered once, when the tour starts. */
export interface TourContext {
  /** Home leads with the Copilot chat. Nothing sets it yet; a later Home will. */
  copilotOnHome?: boolean
  goals: readonly OnboardingOutcome[]
  feedbackPrivate: boolean
  modules: { feedback: boolean; support: boolean; helpCenter: boolean; status: boolean }
  permissions: ReadonlySet<string>
  /** Phone width: the sidebar is behind the menu drawer. */
  narrow: boolean
  /** Products with nothing in them yet, whose empty state a stop can point at. */
  empty: { feedback: boolean; support: boolean; helpCenter: boolean; status: boolean }
}

const COPY = {
  copilot: {
    lead: { id: 'onboarding.tour.stop.copilot.lead', defaultMessage: 'Copilot.' },
    line: {
      id: 'onboarding.tour.stop.copilot.line',
      defaultMessage: 'Ask anything, or tell it what to change. Nothing changes until you apply.',
    },
  },
  products: {
    lead: { id: 'onboarding.tour.stop.products.lead', defaultMessage: 'Your products.' },
    line: {
      id: 'onboarding.tour.stop.products.line',
      defaultMessage: 'Everything you turned on lives here.',
    },
  },
  feedback: {
    lead: { id: 'onboarding.tour.stop.feedback.lead', defaultMessage: 'Feedback.' },
    line: {
      id: 'onboarding.tour.stop.feedback.line',
      defaultMessage: 'Ideas from customers land here. Share the board link to get the first one.',
    },
  },
  'feedback-private': {
    lead: { id: 'onboarding.tour.stop.feedback.lead', defaultMessage: 'Feedback.' },
    line: {
      id: 'onboarding.tour.stop.feedbackPrivate.line',
      defaultMessage: 'Ideas from your team land here. Only teammates can see this board.',
    },
  },
  roadmap: {
    lead: { id: 'onboarding.tour.stop.roadmap.lead', defaultMessage: 'Roadmap.' },
    line: {
      id: 'onboarding.tour.stop.roadmap.line',
      defaultMessage: 'Move ideas along to show what is coming next.',
    },
  },
  support: {
    lead: { id: 'onboarding.tour.stop.support.lead', defaultMessage: 'Support.' },
    line: {
      id: 'onboarding.tour.stop.support.line',
      defaultMessage: 'Messages from Messenger and email arrive here.',
    },
  },
  'help-center': {
    lead: { id: 'onboarding.tour.stop.helpCenter.lead', defaultMessage: 'Help Center.' },
    line: {
      id: 'onboarding.tour.stop.helpCenter.line',
      defaultMessage: 'Write an answer once. Copilot and Quinn reuse it.',
    },
  },
  status: {
    lead: { id: 'onboarding.tour.stop.status.lead', defaultMessage: 'Status.' },
    line: {
      id: 'onboarding.tour.stop.status.line',
      defaultMessage: 'Add a service, then post an update when something breaks.',
    },
  },
  'view-portal': {
    lead: { id: 'onboarding.tour.stop.portal.lead', defaultMessage: 'Your portal.' },
    line: { id: 'onboarding.tour.stop.portal.line', defaultMessage: 'This is what customers see.' },
  },
  search: {
    lead: { id: 'onboarding.tour.stop.search.lead', defaultMessage: 'Search.' },
    line: {
      id: 'onboarding.tour.stop.search.line',
      defaultMessage: 'Jump to any page or record from anywhere with {shortcut}.',
    },
  },
} satisfies Record<TourStopId, { lead: MessageDescriptor; line: MessageDescriptor }>

function stop(id: TourStopId, target: string, route?: TourRoute): TourStop {
  return { id, target, ...(route ? { route } : {}), ...COPY[id] }
}

type ProductKey = keyof TourContext['empty']

const PRODUCT_PAGE: Record<ProductKey, { route: TourRoute; nav: string; empty: string }> = {
  feedback: { route: '/admin/feedback', nav: 'nav-feedback', empty: 'feedback-empty' },
  support: { route: '/admin/inbox', nav: 'nav-support', empty: 'support-empty' },
  helpCenter: { route: '/admin/help-center', nav: 'nav-help-center', empty: 'help-center-empty' },
  status: { route: '/admin/status', nav: 'nav-status', empty: 'status-empty' },
}

/**
 * A product's stop points at its empty state, on its page, while it has
 * nothing in it, and at its sidebar item once it does. On a phone the sidebar
 * is out of view, so a product that is not empty has no stop.
 */
function productStop(id: TourStopId, product: ProductKey, ctx: TourContext): TourStop | null {
  const page = PRODUCT_PAGE[product]
  if (ctx.empty[product]) return stop(id, page.empty, page.route)
  return ctx.narrow ? null : stop(id, page.nav)
}

function goalStop(goal: OnboardingOutcome, ctx: TourContext): TourStop | null {
  switch (goal) {
    case 'product_feedback':
    case 'internal':
      if (!ctx.modules.feedback) return null
      return productStop(
        ctx.feedbackPrivate || goal === 'internal' ? 'feedback-private' : 'feedback',
        'feedback',
        ctx
      )
    case 'customer_support':
      if (!ctx.modules.support || !ctx.permissions.has(PERMISSIONS.CONVERSATION_VIEW)) return null
      return productStop('support', 'support', ctx)
    case 'help_center':
      return ctx.modules.helpCenter ? productStop('help-center', 'helpCenter', ctx) : null
    case 'status_page':
      return ctx.modules.status ? productStop('status', 'status', ctx) : null
  }
}

/**
 * The search stop. The list header's search is the search this page has; it
 * lives on product pages, so the stop opens Feedback, or Users when Feedback
 * is off.
 */
function searchStop(ctx: TourContext): TourStop {
  return stop('search', 'search', ctx.modules.feedback ? '/admin/feedback' : '/admin/users')
}

/**
 * The tour for this workspace and viewer: Copilot (or Your products), up to
 * two goal stops in goal order, Your portal back on Home, then Search. At most
 * five; sidebar stops are left out on a phone.
 */
export function resolveTourStops(ctx: TourContext): TourStop[] {
  const stops: TourStop[] = []
  if (ctx.copilotOnHome === true) stops.push(stop('copilot', 'copilot', '/admin'))
  else if (!ctx.narrow) stops.push(stop('products', 'products', '/admin'))

  const goalStops: TourStop[] = []
  for (const goal of ctx.goals) {
    const next = goalStop(goal, ctx)
    if (next && !goalStops.some((existing) => existing.id === next.id)) goalStops.push(next)
  }
  const feedbackOnly = ctx.goals.length === 1 && ctx.goals[0] === 'product_feedback'
  if (feedbackOnly && ctx.modules.feedback && !ctx.narrow) {
    goalStops.push(stop('roadmap', 'nav-roadmap'))
  }
  stops.push(...goalStops.slice(0, 2))

  if (!ctx.narrow) stops.push(stop('view-portal', 'view-portal', '/admin'))
  stops.push(searchStop(ctx))
  return stops.slice(0, MAX_TOUR_STOPS)
}

export type CoachmarkSide = 'right' | 'left' | 'bottom' | 'top'

export interface CoachmarkPlacement {
  side: CoachmarkSide
  left: number
  top: number
  /** The pointer arrow's offset inside the card, along the edge that faces the target. */
  arrow: number
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

const GAP = 14
const MARGIN = 16

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Put the coachmark on the side of the target with room for it, in the order
 * right, left, below, above, and point its arrow at the target's middle.
 */
export function placeCoachmark(
  target: Box,
  card: { width: number; height: number },
  viewport: { width: number; height: number }
): CoachmarkPlacement {
  const right = target.left + target.width
  const bottom = target.top + target.height
  const middleY = target.top + target.height / 2
  const middleX = target.left + target.width / 2
  const fitsY = (top: number) => clamp(top, MARGIN, viewport.height - card.height - MARGIN)
  const fitsX = (left: number) => clamp(left, MARGIN, viewport.width - card.width - MARGIN)

  const sides: CoachmarkSide[] = []
  if (right + GAP + card.width + MARGIN <= viewport.width) sides.push('right')
  if (target.left - GAP - card.width - MARGIN >= 0) sides.push('left')
  if (bottom + GAP + card.height + MARGIN <= viewport.height) sides.push('bottom')
  if (target.top - GAP - card.height - MARGIN >= 0) sides.push('top')
  const side = sides[0] ?? 'bottom'

  if (side === 'right' || side === 'left') {
    const top = fitsY(middleY - card.height / 2)
    const left = side === 'right' ? right + GAP : target.left - GAP - card.width
    return { side, left, top, arrow: clamp(middleY - top, 20, card.height - 20) }
  }
  const left = fitsX(middleX - card.width / 2)
  const top =
    side === 'bottom'
      ? Math.min(bottom + GAP, viewport.height - card.height - MARGIN)
      : target.top - GAP - card.height
  return {
    side,
    left,
    top: Math.max(MARGIN, top),
    arrow: clamp(middleX - left, 20, card.width - 20),
  }
}
