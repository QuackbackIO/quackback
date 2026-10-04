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
    modules: { feedback: true, changelog: false, support: false, helpCenter: false, status: false },
    permissions: new Set([PERMISSIONS.HELP_CENTER_MANAGE, PERMISSIONS.STATUS_PAGE_MANAGE]),
    narrow: false,
    empty: { feedback: true, support: true, helpCenter: true, status: true },
    tests: { idea: true, message: true },
    ...overrides,
  }
}

const allOn = { feedback: true, changelog: true, support: true, helpCenter: true, status: true }

const ids = (stops: TourStop[]) => stops.map((stop) => stop.id)
const brief = (stops: TourStop[]) =>
  stops.map((stop) => `${stop.id}:${stop.target}${stop.route ? `@${stop.route}` : ''}`)

describe('resolveTourStops', () => {
  it('gives each enabled module its own sidebar stop, goal modules first, then portal and search', () => {
    expect(
      brief(
        resolveTourStops(
          context({
            goals: ['customer_support'],
            modules: { ...allOn, changelog: false, status: false },
          })
        )
      )
    ).toEqual([
      'support:nav-support',
      'feedback:nav-feedback',
      'help-center:nav-help-center',
      'view-portal:view-portal@/admin',
      'search:search',
    ])
  })

  it('never spotlights the whole sidebar', () => {
    for (const copilotOnHome of [true, false]) {
      expect(ids(resolveTourStops(context({ copilotOnHome })))).not.toContain('products')
    }
  })

  it('keeps at most five stops, the goal module first, and no Home stop', () => {
    const stops = resolveTourStops(
      context({ copilotOnHome: true, goals: ['status_page'], modules: allOn })
    )
    expect(stops.length).toBe(MAX_TOUR_STOPS)
    expect(MAX_TOUR_STOPS).toBe(5)
    expect(ids(stops)).toEqual(['status', 'feedback', 'support', 'view-portal', 'search'])
  })

  it('shows modules switched on after setup', () => {
    expect(
      ids(
        resolveTourStops(
          context({
            goals: ['product_feedback'],
            modules: { ...context().modules, changelog: true },
          })
        )
      )
    ).toEqual(['feedback', 'roadmap', 'changelog', 'view-portal', 'search'])
  })

  it('skips a module that is off', () => {
    expect(
      ids(
        resolveTourStops(
          context({
            goals: ['customer_support'],
            modules: { ...context().modules, support: false },
          })
        )
      )
    ).toEqual(['feedback', 'roadmap', 'view-portal', 'search'])
  })

  it('uses the team-only line for private feedback', () => {
    const stops = resolveTourStops(context({ feedbackPrivate: true }))
    expect(ids(stops)).toContain('feedback-private')
    expect(ids(stops)).not.toContain('feedback')
  })

  it('offers a Try it that runs the real thing, only where it works', () => {
    const tries = (ctx: TourContext) =>
      Object.fromEntries(resolveTourStops(ctx).map((stop) => [stop.id, stop.tryIt ?? null]))
    const full = tries(context({ goals: ['customer_support'], modules: allOn }))
    expect(full.feedback).toMatchObject({ kind: 'test', start: 'idea' })
    expect(full.support).toMatchObject({ kind: 'test', start: 'message' })
    expect(full['help-center']).toMatchObject({ kind: 'link', to: '/admin/help-center' })
    expect(tries(context()).roadmap).toBeNull()
    const none = tries(
      context({
        goals: ['customer_support'],
        modules: allOn,
        tests: { idea: false, message: false },
        permissions: new Set(),
        empty: { feedback: false, support: false, helpCenter: false, status: false },
      })
    )
    expect(Object.values(none).every((value) => value === null)).toBe(true)
  })

  it('has no stops on a phone, where the sidebar is behind the menu', () => {
    expect(
      resolveTourStops(context({ narrow: true, copilotOnHome: true, modules: allOn }))
    ).toEqual([])
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
