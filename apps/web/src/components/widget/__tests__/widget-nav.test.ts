import { describe, it, expect } from 'vitest'
import {
  contentSurfaceCount,
  homeEnabled,
  isExpandedView,
  visibleTabs,
  resolveInitialTab,
  resolveInitialView,
} from '../widget-nav'

// Nav model: four independent content surfaces (messages, feedback, help,
// changelog), each with its own bottom-bar tab, ordered
// home | messages | feedback | help | changelog. The aggregated Home appears
// only when 2+ content surfaces are enabled; otherwise the widget lands
// directly on the single surface and the bar is hidden.

describe('contentSurfaceCount', () => {
  it('counts messages, feedback, help, and changelog independently', () => {
    expect(contentSurfaceCount({ feedback: true })).toBe(1)
    expect(contentSurfaceCount({ feedback: true, changelog: true })).toBe(2)
    expect(contentSurfaceCount({ feedback: true, help: true, messages: true })).toBe(3)
    expect(contentSurfaceCount({ help: true, messages: true })).toBe(2)
    expect(
      contentSurfaceCount({ feedback: true, changelog: true, help: true, messages: true })
    ).toBe(4)
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
  it('orders tabs home | messages | feedback | help | changelog', () => {
    expect(visibleTabs({ feedback: true, changelog: true, help: true, messages: true })).toEqual([
      'home',
      'messages',
      'feedback',
      'help',
      'changelog',
    ])
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
  it('drops Home when the admin disables it', () => {
    expect(visibleTabs({ feedback: true, changelog: true, home: false })).toEqual([
      'feedback',
      'changelog',
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
  })
  it('lands on the first surface (messages first) when the admin disables Home', () => {
    expect(resolveInitialTab({ feedback: true, changelog: true, home: false })).toBe('feedback')
    expect(resolveInitialTab({ feedback: true, messages: true, home: false })).toBe('messages')
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
  })
  it('lands on the first surface root when the admin disables Home', () => {
    expect(resolveInitialView({ feedback: true, changelog: true, home: false })).toBe('feedback')
    expect(resolveInitialView({ feedback: true, messages: true, home: false })).toBe('messages')
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
