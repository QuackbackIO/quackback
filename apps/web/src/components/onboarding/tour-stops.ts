import type { MessageDescriptor } from 'react-intl'
import type { OnboardingOutcome } from '@/lib/shared/db-types'
import { PERMISSIONS } from '@/lib/shared/permissions'

/**
 * The guided tour's stops, as data. Each stop names the `data-tour` element it
 * points at, the page it needs, the one line it says and, where it helps, one
 * Try it action that runs the real thing. Which stops a tour has is decided by
 * {@link resolveTourStops} before the overlay opens, from the modules that are
 * on, the workspace's goals, the viewer's permissions and the viewport, so the
 * count is right from the first stop and nothing waits on the page.
 */

export const MAX_TOUR_STOPS = 5

export type TourStopId =
  | 'copilot'
  | 'feedback'
  | 'feedback-private'
  | 'roadmap'
  | 'changelog'
  | 'support'
  | 'help-center'
  | 'status'
  | 'view-portal'
  | 'search'

export type TourRoute = '/admin' | '/admin/help-center' | '/admin/status'

/** A stop's Try it: open a test on the Try Messenger sheet, or the page that does the job. */
export type TourTryIt =
  | { kind: 'test'; start: 'idea' | 'message'; label: MessageDescriptor }
  | { kind: 'link'; to: TourRoute; label: MessageDescriptor }

export interface TourStop {
  id: TourStopId
  /** The `data-tour` value of the element the coachmark points at. */
  target: string
  /** The page the target lives on; absent when the current page has it (the sidebar). */
  route?: TourRoute
  lead: MessageDescriptor
  line: MessageDescriptor
  tryIt?: TourTryIt
}

/** What the stops are chosen from. Gathered once, when the tour starts. */
export interface TourContext {
  /** Home leads with the Copilot chat. */
  copilotOnHome?: boolean
  goals: readonly OnboardingOutcome[]
  feedbackPrivate: boolean
  /** The modules that are on now, so one switched on after setup is in the tour. */
  modules: {
    feedback: boolean
    changelog: boolean
    support: boolean
    helpCenter: boolean
    status: boolean
  }
  permissions: ReadonlySet<string>
  /** Phone width: the sidebar is behind the menu drawer. */
  narrow: boolean
  /** Products with nothing in them yet, where a first-item Try it helps. */
  empty: { feedback: boolean; support: boolean; helpCenter: boolean; status: boolean }
  /** Which tests on the Try Messenger sheet work for this person. */
  tests: { idea: boolean; message: boolean }
}

const COPY = {
  copilot: {
    lead: { id: 'onboarding.tour.stop.copilot.lead', defaultMessage: 'Copilot.' },
    line: {
      id: 'onboarding.tour.stop.copilot.line',
      defaultMessage: 'Ask anything, or tell it what to change. Nothing changes until you apply.',
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
  changelog: {
    lead: { id: 'onboarding.tour.stop.changelog.lead', defaultMessage: 'Changelog.' },
    line: {
      id: 'onboarding.tour.stop.changelog.line',
      defaultMessage: 'Tell customers what shipped, and close the loop on their ideas.',
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
    lead: { id: 'onboarding.tour.stop.helpCenter.lead', defaultMessage: 'Help center.' },
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

const TRY = {
  idea: { id: 'onboarding.tour.stop.try.idea', defaultMessage: 'Post a test idea' },
  message: { id: 'onboarding.tour.stop.try.message', defaultMessage: 'Send a test message' },
  article: { id: 'onboarding.tour.stop.try.article', defaultMessage: 'Write your first article' },
  service: { id: 'onboarding.tour.stop.try.service', defaultMessage: 'Add a service' },
} satisfies Record<string, MessageDescriptor>

function stop(id: TourStopId, target: string, route?: TourRoute, tryIt?: TourTryIt): TourStop {
  return { id, target, ...(route ? { route } : {}), ...COPY[id], ...(tryIt ? { tryIt } : {}) }
}

type ModuleKey = 'feedback' | 'roadmap' | 'changelog' | 'support' | 'helpCenter' | 'status'

/** The order other modules are kept in when there is no room for them all. */
const MODULE_IMPORTANCE: ModuleKey[] = [
  'feedback',
  'support',
  'helpCenter',
  'roadmap',
  'changelog',
  'status',
]

const GOAL_MODULE: Partial<Record<OnboardingOutcome, ModuleKey>> = {
  product_feedback: 'feedback',
  internal: 'feedback',
  customer_support: 'support',
  help_center: 'helpCenter',
  status_page: 'status',
}

function moduleOn(key: ModuleKey, ctx: TourContext): boolean {
  return key === 'roadmap' ? ctx.modules.feedback : ctx.modules[key]
}

/** A module's stop, on its own sidebar item, with its Try it where that will work. */
function moduleStop(key: ModuleKey, ctx: TourContext): TourStop {
  switch (key) {
    case 'feedback':
      return stop(
        ctx.feedbackPrivate ? 'feedback-private' : 'feedback',
        'nav-feedback',
        undefined,
        ctx.tests.idea ? { kind: 'test', start: 'idea', label: TRY.idea } : undefined
      )
    case 'roadmap':
      return stop('roadmap', 'nav-roadmap')
    case 'changelog':
      return stop('changelog', 'nav-changelog')
    case 'support':
      return stop(
        'support',
        'nav-support',
        undefined,
        ctx.tests.message ? { kind: 'test', start: 'message', label: TRY.message } : undefined
      )
    case 'helpCenter':
      return stop(
        'help-center',
        'nav-help-center',
        undefined,
        ctx.empty.helpCenter && ctx.permissions.has(PERMISSIONS.HELP_CENTER_MANAGE)
          ? { kind: 'link', to: '/admin/help-center', label: TRY.article }
          : undefined
      )
    case 'status':
      return stop(
        'status',
        'nav-status',
        undefined,
        ctx.empty.status && ctx.permissions.has(PERMISSIONS.STATUS_PAGE_MANAGE)
          ? { kind: 'link', to: '/admin/status', label: TRY.service }
          : undefined
      )
  }
}

/**
 * The tour for this workspace and viewer: one stop per module that is on (the
 * goals' modules first, then the most useful others), Your portal, then
 * Search. At most five, ending on the end card's one test action. Home is
 * where the tour starts, so it has no stop of its own; on a phone the sidebar
 * is out of view, so there is no tour.
 */
export function resolveTourStops(ctx: TourContext): TourStop[] {
  const stops: TourStop[] = []
  if (ctx.narrow) return stops

  const modules: ModuleKey[] = []
  for (const key of [
    ...ctx.goals.map((goal) => GOAL_MODULE[goal]).filter((key): key is ModuleKey => !!key),
    ...MODULE_IMPORTANCE,
  ]) {
    if (moduleOn(key, ctx) && !modules.includes(key)) modules.push(key)
  }
  const room = MAX_TOUR_STOPS - stops.length - 2
  stops.push(...modules.slice(0, Math.max(0, room)).map((key) => moduleStop(key, ctx)))
  stops.push(stop('view-portal', 'view-portal', '/admin'))
  stops.push(stop('search', 'search'))
  return stops
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
