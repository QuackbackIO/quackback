import { describe, expect, it } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  MAX_TOUR_STOPS,
  placeCoachmark,
  resolveTourStops,
  type TourContext,
  type TourStop,
} from '../tour-stops'

function context(overrides: Partial<TourContext> = {}): TourContext {
  return {
    goals: ['product_feedback'],
    feedbackPrivate: false,
    modules: { feedback: true, support: true, helpCenter: true, status: true },
    permissions: new Set([PERMISSIONS.CONVERSATION_VIEW]),
    narrow: false,
    empty: { feedback: false, support: false, helpCenter: false, status: false },
    ...overrides,
  }
}

const ids = (stops: TourStop[]) => stops.map((stop) => stop.id)
const brief = (stops: TourStop[]) =>
  stops.map((stop) => `${stop.id}:${stop.target}${stop.route ? `@${stop.route}` : ''}`)

describe('resolveTourStops', () => {
  it('builds Feedback plus Support from their empty states, then portal and search', () => {
    const stops = resolveTourStops(
      context({
        goals: ['product_feedback', 'customer_support'],
        empty: { feedback: true, support: true, helpCenter: false, status: false },
      })
    )
    expect(brief(stops)).toEqual([
      'products:products@/admin',
      'feedback:feedback-empty@/admin/feedback',
      'support:support-empty@/admin/inbox',
      'view-portal:view-portal@/admin',
      'search:search',
    ])
    expect(stops[1]!.line.defaultMessage).toBe(
      'Ideas from customers land here. Share the board link to get the first one.'
    )
  })

  it('leads with Copilot when Home is the Copilot chat', () => {
    expect(ids(resolveTourStops(context({ copilotOnHome: true })))).toEqual([
      'copilot',
      'feedback',
      'roadmap',
      'view-portal',
      'search',
    ])
  })

  it('fills the second goal stop with Roadmap only when Feedback is the only goal', () => {
    expect(brief(resolveTourStops(context()))).toEqual([
      'products:products@/admin',
      'feedback:nav-feedback',
      'roadmap:nav-roadmap',
      'view-portal:view-portal@/admin',
      'search:search',
    ])
    expect(ids(resolveTourStops(context({ goals: ['product_feedback', 'status_page'] })))).toEqual([
      'products',
      'feedback',
      'status',
      'view-portal',
      'search',
    ])
  })

  it('uses the team-only line for private feedback', () => {
    const stops = resolveTourStops(context({ feedbackPrivate: true }))
    expect(ids(stops)).toContain('feedback-private')
    expect(ids(stops)).not.toContain('feedback')
    expect(stops.find((stop) => stop.id === 'feedback-private')!.line.defaultMessage).toBe(
      'Ideas from your team land here. Only teammates can see this board.'
    )
  })

  it('keeps two goal stops in goal order', () => {
    expect(
      ids(resolveTourStops(context({ goals: ['help_center', 'status_page', 'customer_support'] })))
    ).toEqual(['products', 'help-center', 'status', 'view-portal', 'search'])
  })

  it('gates goal stops on the module, and Support on seeing conversations', () => {
    expect(
      ids(
        resolveTourStops(
          context({
            goals: ['customer_support', 'help_center'],
            modules: { feedback: false, support: false, helpCenter: true, status: true },
          })
        )
      )
    ).toEqual(['products', 'help-center', 'view-portal', 'search'])
    expect(
      ids(resolveTourStops(context({ goals: ['customer_support'], permissions: new Set() })))
    ).toEqual(['products', 'view-portal', 'search'])
  })

  it('does not gate Feedback on viewing private posts', () => {
    expect(ids(resolveTourStops(context({ permissions: new Set() })))).toContain('feedback')
  })

  it('ends on the sidebar Search row, which every page has, whatever the modules', () => {
    const stops = resolveTourStops(
      context({
        goals: ['status_page'],
        modules: { feedback: false, support: false, helpCenter: false, status: true },
      })
    )
    expect(brief(stops).at(-1)).toBe('search:search')
  })

  it('leaves sidebar stops out on a phone but keeps empty states', () => {
    expect(
      brief(
        resolveTourStops(
          context({
            narrow: true,
            goals: ['customer_support', 'product_feedback'],
            empty: { feedback: false, support: true, helpCenter: false, status: false },
          })
        )
      )
    ).toEqual(['support:support-empty@/admin/inbox'])
  })

  it('never has more than five stops', () => {
    for (const copilotOnHome of [true, false]) {
      const stops = resolveTourStops(
        context({
          copilotOnHome,
          goals: ['product_feedback', 'customer_support', 'help_center', 'status_page'],
        })
      )
      expect(stops.length).toBeLessThanOrEqual(MAX_TOUR_STOPS)
      expect(new Set(ids(stops)).size).toBe(stops.length)
    }
  })
})

describe('placeCoachmark', () => {
  const card = { width: 340, height: 150 }
  const viewport = { width: 1440, height: 900 }

  it('sits right of a sidebar target and points at its middle', () => {
    const placement = placeCoachmark({ left: 8, top: 100, width: 220, height: 40 }, card, viewport)
    expect(placement.side).toBe('right')
    expect(placement.left).toBe(8 + 220 + 14)
    expect(placement.top + placement.arrow).toBe(120)
  })

  it('moves left of a target at the right edge', () => {
    const placement = placeCoachmark(
      { left: 1300, top: 400, width: 120, height: 40 },
      card,
      viewport
    )
    expect(placement.side).toBe('left')
    expect(placement.left + card.width).toBeLessThanOrEqual(1300)
  })

  it('goes below a target as wide as the page', () => {
    const placement = placeCoachmark(
      { left: 20, top: 180, width: 1400, height: 110 },
      card,
      viewport
    )
    expect(placement.side).toBe('bottom')
    expect(placement.top).toBeGreaterThanOrEqual(290)
    expect(placement.arrow).toBeGreaterThanOrEqual(20)
    expect(placement.arrow).toBeLessThanOrEqual(card.width - 20)
  })

  it('goes above a wide target at the bottom and stays on screen', () => {
    const placement = placeCoachmark(
      { left: 20, top: 760, width: 1400, height: 120 },
      card,
      viewport
    )
    expect(placement.side).toBe('top')
    expect(placement.top + card.height).toBeLessThanOrEqual(760)
    expect(placement.top).toBeGreaterThanOrEqual(16)
  })
})
