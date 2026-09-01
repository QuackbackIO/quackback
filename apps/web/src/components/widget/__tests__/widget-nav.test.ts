import { describe, it, expect } from 'vitest'
import {
  contentSurfaceCount,
  homeEnabled,
  isExpandedView,
  visibleTabs,
  resolveInitialTab,
  resolveInitialView,
  tabsForVisitor,
  visibleTabsForVisitor,
} from '../widget-nav'

// Nav model: five independent content surfaces (messages, tickets, feedback,
// help, changelog), each with its own bottom-bar tab, ordered
// home | messages | tickets | feedback | help | changelog. The aggregated Home
// appears only when 2+ content surfaces are enabled; otherwise the widget lands
// directly on the single surface and the bar is hidden.

describe('contentSurfaceCount', () => {
  it('counts messages, tickets, feedback, help, and changelog independently', () => {
    expect(contentSurfaceCount({ feedback: true })).toBe(1)
    expect(contentSurfaceCount({ feedback: true, changelog: true })).toBe(2)
    expect(contentSurfaceCount({ feedback: true, help: true, messages: true })).toBe(3)
    expect(contentSurfaceCount({ help: true, messages: true })).toBe(2)
    expect(contentSurfaceCount({ messages: true, tickets: true })).toBe(2)
    expect(
      contentSurfaceCount({
        feedback: true,
        changelog: true,
        help: true,
        messages: true,
        tickets: true,
      })
    ).toBe(5)
    expect(contentSurfaceCount({})).toBe(0)
  })
})

describe('homeEnabled', () => {
  it('is true only with 2+ content surfaces', () => {
    expect(homeEnabled({ feedback: true })).toBe(false)
    expect(homeEnabled({ messages: true })).toBe(false)
    expect(homeEnabled({ help: true, messages: true })).toBe(true)
    expect(homeEnabled({ feedback: true, changelog: true })).toBe(true)
    expect(homeEnabled({ feedback: true, messages: true })).toBe(true)
  })
  it('defaults to shown when the home preference is omitted', () => {
    expect(homeEnabled({ feedback: true, changelog: true, home: undefined })).toBe(true)
  })
  it('honors the admin opt-out even with 2+ content surfaces', () => {
    expect(homeEnabled({ feedback: true, changelog: true, home: false })).toBe(false)
    expect(homeEnabled({ feedback: true, changelog: true, home: true })).toBe(true)
  })
  it('stays hidden with a single surface regardless of the home preference', () => {
    expect(homeEnabled({ feedback: true, home: true })).toBe(false)
  })
})

describe('visibleTabs', () => {
  it('orders tabs home | messages | tickets | feedback | help | changelog', () => {
    expect(
      visibleTabs({ feedback: true, changelog: true, help: true, messages: true, tickets: true })
    ).toEqual(['home', 'messages', 'tickets', 'feedback', 'help', 'changelog'])
  })
  it('prepends Home only when enabled', () => {
    expect(visibleTabs({ feedback: true })).toEqual(['feedback'])
    expect(visibleTabs({ feedback: true, changelog: true })).toEqual([
      'home',
      'feedback',
      'changelog',
    ])
  })
  it('gives messages its own tab, independent of help', () => {
    expect(visibleTabs({ messages: true })).toEqual(['messages'])
    expect(visibleTabs({ help: true, messages: true })).toEqual(['home', 'messages', 'help'])
  })
  it('gives tickets its own tab, ordered after messages', () => {
    expect(visibleTabs({ tickets: true })).toEqual(['tickets'])
    expect(visibleTabs({ messages: true, tickets: true })).toEqual(['home', 'messages', 'tickets'])
    expect(visibleTabs({ feedback: true, tickets: true })).toEqual(['home', 'tickets', 'feedback'])
  })
  it('drops Home when the admin disables it', () => {
    expect(visibleTabs({ feedback: true, changelog: true, home: false })).toEqual([
      'feedback',
      'changelog',
    ])
  })
})

describe('tabsForVisitor', () => {
  it('hides the Tickets tab when this visitor has none', () => {
    expect(tabsForVisitor({ messages: true, tickets: true }, false)).toEqual({
      messages: true,
      tickets: false,
    })
    expect(visibleTabs(tabsForVisitor({ messages: true, tickets: true }, false))).toEqual([
      'messages',
    ])
  })
  it('keeps the Tickets tab when the visitor has tickets', () => {
    expect(tabsForVisitor({ tickets: true }, true)).toEqual({ tickets: true })
    expect(visibleTabs(tabsForVisitor({ tickets: true }, true))).toEqual(['tickets'])
  })
})

describe('visibleTabsForVisitor', () => {
  // The email-first Messages+Tickets workspace: two admin surfaces, so Home is
  // on — but whether THIS visitor sees Tickets (and therefore Home) depends on
  // an async answer. The bar must not collapse to Messages-only while waiting.
  const emailFirst = { messages: true, tickets: true }

  it('withholds only the Tickets slot while the answer is pending', () => {
    expect(visibleTabsForVisitor(emailFirst, null)).toEqual(['home', 'messages'])
    expect(visibleTabsForVisitor({ feedback: true, help: true, tickets: true }, null)).toEqual([
      'home',
      'feedback',
      'help',
    ])
  })

  it('applies the visitor projection once known', () => {
    expect(visibleTabsForVisitor(emailFirst, true)).toEqual(['home', 'messages', 'tickets'])
    expect(visibleTabsForVisitor(emailFirst, false)).toEqual(['messages'])
  })

  it('keeps the Home landing in the pending bar', () => {
    // Home is sized off the admin config, so the resolveInitialTab landing is
    // still in the bar while tickets are pending — nothing to reroute off.
    for (const tabs of [
      emailFirst,
      { tickets: true, feedback: true },
      { messages: true, tickets: true, feedback: true, help: true, changelog: true },
    ]) {
      expect(resolveInitialTab(tabs)).toBe('home')
      expect(visibleTabsForVisitor(tabs, null)).toContain('home')
    }
  })

  it('is empty for a tickets-only workspace while pending (no bar either way)', () => {
    expect(visibleTabsForVisitor({ tickets: true }, null)).toEqual([])
    expect(visibleTabsForVisitor({ tickets: true }, true)).toEqual(['tickets'])
  })

  it('ignores the tri-state when the admin has Tickets off', () => {
    expect(visibleTabsForVisitor({ messages: true, feedback: true }, null)).toEqual([
      'home',
      'messages',
      'feedback',
    ])
  })
})

describe('resolveInitialTab', () => {
  it('lands on Home when 2+ content surfaces', () => {
    expect(resolveInitialTab({ feedback: true, changelog: true })).toBe('home')
    expect(resolveInitialTab({ feedback: true, help: true, messages: true })).toBe('home')
  })
  it('lands on the single enabled surface otherwise', () => {
    expect(resolveInitialTab({ feedback: true })).toBe('feedback')
    expect(resolveInitialTab({ changelog: true })).toBe('changelog')
    expect(resolveInitialTab({ help: true })).toBe('help')
    expect(resolveInitialTab({ messages: true })).toBe('messages')
    expect(resolveInitialTab({ tickets: true })).toBe('tickets')
  })
  it('lands on the first surface (messages first) when the admin disables Home', () => {
    expect(resolveInitialTab({ feedback: true, changelog: true, home: false })).toBe('feedback')
    expect(resolveInitialTab({ feedback: true, messages: true, home: false })).toBe('messages')
    expect(resolveInitialTab({ feedback: true, tickets: true, home: false })).toBe('tickets')
  })
})

describe('resolveInitialView', () => {
  it('lands on overview when Home is enabled', () => {
    expect(resolveInitialView({ feedback: true, changelog: true })).toBe('overview')
    expect(resolveInitialView({ feedback: true, help: true, messages: true })).toBe('overview')
  })
  it('lands on the single surface root otherwise', () => {
    expect(resolveInitialView({ feedback: true })).toBe('feedback')
    expect(resolveInitialView({ changelog: true })).toBe('changelog')
    expect(resolveInitialView({ help: true })).toBe('help')
    expect(resolveInitialView({ messages: true })).toBe('messages')
    expect(resolveInitialView({ tickets: true })).toBe('tickets')
  })
  it('lands on the first surface root when the admin disables Home', () => {
    expect(resolveInitialView({ feedback: true, changelog: true, home: false })).toBe('feedback')
    expect(resolveInitialView({ feedback: true, messages: true, home: false })).toBe('messages')
    expect(resolveInitialView({ feedback: true, tickets: true, home: false })).toBe('tickets')
  })
})

describe('isExpandedView', () => {
  it('expands exactly the long-form entity views', () => {
    expect(isExpandedView('post-detail')).toBe(true)
    expect(isExpandedView('help-detail')).toBe(true)
    expect(isExpandedView('changelog-detail')).toBe(true)
  })
  it('keeps lists, roots, and the thread compact', () => {
    for (const view of [
      'overview',
      'messages',
      'messenger',
      'tickets',
      'feedback',
      'help',
      'help-category',
      'changelog',
      'success',
    ] as const) {
      expect(isExpandedView(view)).toBe(false)
    }
  })
})
