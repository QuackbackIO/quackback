// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostHog } from 'posthog-js'
import { setAnalyticsClient } from '@/lib/client/analytics'
import {
  BUILDER_EVENTS,
  designerChanged,
  designerAdvancedOpened,
  designerClosed,
  designerLookChosen,
  designerOpened,
  designerPublished,
  fitsEvent,
  partIdOf,
  settingId,
  trackBuilder,
  type BuilderEvent,
} from '../builder-events'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

const capture = vi.fn()
const client = { capture } as unknown as PostHog

/** Words, a link and a colour an admin might type. */
const TYPED = ['Acme spring launch', 'https://example.com/pricing', '#ff3366', 'en']

const sent = () => capture.mock.calls.map(([event, props]) => [event, props])
const named = (event: string) => capture.mock.calls.filter(([name]) => name === event)

function changed(change: (design: PortalDesign) => void) {
  const before = defaultDesign()
  const after = structuredClone(before)
  change(after)
  return [before, after] as const
}

let clock = Date.UTC(2026, 0, 1)
beforeEach(() => {
  vi.useFakeTimers()
  capture.mockReset()
  localStorage.clear()
  setAnalyticsClient(client)
  // Each test starts an hour after the last, past any earlier burst.
  clock += 3_600_000
  vi.setSystemTime(clock)
})
afterEach(() => {
  designerClosed()
  setAnalyticsClient(null)
  vi.useRealTimers()
})

describe('the event list', () => {
  const events = Object.entries(BUILDER_EVENTS) as Array<[BuilderEvent, Record<string, unknown>]>

  it.each(events)('%s takes no free text in any property', (event, spec) => {
    for (const key of Object.keys(spec))
      for (const text of TYPED)
        expect(fitsEvent(event, { [key]: text }), `${key}=${text}`).toBe(false)
  })

  it.each(events)('%s takes no property it does not list', (event) => {
    expect(fitsEvent(event, { note: 'Acme spring launch' })).toBe(false)
  })

  it('counts what a brand match from screenshots did, never the screenshots', () => {
    expect(fitsEvent('designer_chat_shot_kept', { warning: 'dimmed' })).toBe(true)
    expect(fitsEvent('designer_chat_shot_kept', { warning: 'blurry' })).toBe(false)
    expect(fitsEvent('designer_brand_matched', { images: 2, changes: 14 })).toBe(true)
    expect(fitsEvent('designer_brand_logo_changed', { how: 'full_logo' })).toBe(true)
  })

  it('takes counts and durations as whole numbers, and a ratio between 0 and 1', () => {
    expect(fitsEvent('designer_brand_matched', { images: 1, changes: 3 })).toBe(true)
    expect(fitsEvent('designer_brand_matched', { images: 1, changes: -1 })).toBe(false)
    expect(fitsEvent('designer_brand_matched', { images: 1, changes: 1.5 })).toBe(false)
    const published = {
      changes: 2,
      fullReview: true,
      logoOffered: false,
      workspaceLogo: false,
      firstPublish: true,
      seconds: 30,
    }
    expect(fitsEvent('designer_published', published)).toBe(true)
    expect(fitsEvent('designer_published', { ...published, lookKept: 0.5 })).toBe(true)
    expect(fitsEvent('designer_published', { ...published, lookKept: 2 })).toBe(false)
    expect(fitsEvent('designer_published', { ...published, seconds: undefined })).toBe(false)
  })

  it('takes a setting only as a path the design schema names', () => {
    expect(fitsEvent('designer_setting_changed', { setting: 'layout.band' })).toBe(true)
    expect(fitsEvent('designer_setting_changed', { setting: 'layout.Acme' })).toBe(false)
  })

  it('does not send an event whose properties break its list', () => {
    trackBuilder('designer_page_switched', { page: 'Acme pricing' as 'home' })
    expect(capture).not.toHaveBeenCalled()
    trackBuilder('designer_page_switched', { page: 'roadmap' })
    expect(sent()).toEqual([['designer_page_switched', { page: 'roadmap' }]])
  })
})

describe('with analytics off', () => {
  it('sends nothing', () => {
    setAnalyticsClient(null)
    designerOpened('portal')
    trackBuilder('designer_page_switched', { page: 'roadmap' })
    designerChanged(...changed((d) => void (d.layout.hero = 'brand')), 'home')
    designerClosed()
    expect(capture).not.toHaveBeenCalled()
  })

  it('holds the open until the SDK starts, and drops it when tracking pauses', () => {
    setAnalyticsClient(null)
    designerOpened('appearance')
    expect(capture).not.toHaveBeenCalled()
    setAnalyticsClient(client)
    expect(named('designer_opened')).toEqual([['designer_opened', { entry: 'appearance' }]])

    setAnalyticsClient(null)
    designerOpened('portal')
    setAnalyticsClient(null)
    setAnalyticsClient(client)
    expect(named('designer_opened')).toHaveLength(1)
  })
})

describe('a visit', () => {
  it('counts the open, and the close once with its length and whether it published', () => {
    designerOpened('portal')
    vi.advanceTimersByTime(90_000)
    designerPublished(
      { changes: [1], published: { number: 1 }, design: defaultDesign() },
      { logoOffered: false, workspaceLogo: false, fullReview: true }
    )
    designerClosed()
    designerClosed()
    expect(named('designer_opened')).toEqual([['designer_opened', { entry: 'portal' }]])
    expect(named('designer_closed')).toEqual([
      ['designer_closed', { seconds: 90, published: true }],
    ])
  })
})

describe('designerChanged', () => {
  it('counts a change once by its setting id, never its value', () => {
    designerChanged(...changed((d) => void (d.layout.hero = 'brand')), 'home')
    expect(sent()).toEqual([['designer_setting_changed', { setting: 'layout.band' }]])
  })

  it('counts a burst of the same change, such as typing, once', () => {
    designerChanged(...changed((d) => void (d.css = 'a')), 'roadmap')
    vi.advanceTimersByTime(400)
    designerChanged(...changed((d) => void (d.css = 'ab')), 'roadmap')
    vi.advanceTimersByTime(400)
    designerChanged(...changed((d) => void (d.css = 'abc')), 'roadmap')
    expect(named('designer_setting_changed')).toHaveLength(1)
    expect(named('designer_custom_css_edited')).toEqual([
      ['designer_custom_css_edited', { page: 'roadmap' }],
    ])
    vi.advanceTimersByTime(1500)
    designerChanged(...changed((d) => void (d.css = 'abcd')), 'roadmap')
    expect(named('designer_setting_changed')).toHaveLength(2)
  })

  it('counts an exact value as a setting and as an exact value', () => {
    designerChanged(...changed((d) => void (d.tune = { button: { radius: 4 } })), 'feedback')
    expect(sent()).toEqual([
      ['designer_setting_changed', { setting: 'tune.button.radius' }],
      ['designer_exact_value_changed', { setting: 'tune.button.radius' }],
    ])
  })

  it('names words by their field, not their language or text', () => {
    designerChanged(
      ...changed((d) => void (d.pages.feedback.copy = { prompt: { 'Acme launch': 'Hi' } })),
      'feedback'
    )
    expect(sent()).toEqual([
      ['designer_setting_changed', { setting: 'pages.feedback.copy.prompt' }],
    ])
  })

  it('counts a chosen look as one look, and what survives of it at publish', () => {
    designerOpened('direct')
    designerLookChosen('preset')
    const [before, after] = changed((d) => {
      d.layout.hero = 'brand'
      d.shape.corners = 'sharp'
    })
    designerChanged(before, after, 'home')
    expect(named('designer_look_applied')).toEqual([
      ['designer_look_applied', { source: 'preset', fields: 2 }],
    ])
    expect(named('designer_setting_changed')).toHaveLength(0)

    // The next change is a change again.
    const changedBack = structuredClone(after)
    changedBack.shape.corners = 'rounded'
    designerChanged(after, changedBack, 'home')
    expect(named('designer_setting_changed')).toHaveLength(1)

    designerPublished(
      { changes: [1, 2], published: null, design: changedBack },
      { logoOffered: true, workspaceLogo: true, fullReview: true }
    )
    expect(named('designer_published')[0]![1]).toMatchObject({
      changes: 2,
      logoOffered: true,
      workspaceLogo: true,
      firstPublish: true,
      lookFields: 2,
      lookKept: 0.5,
    })
    // Counted towards one publish only.
    designerPublished(
      { changes: [1], published: { number: 1 }, design: changedBack },
      { logoOffered: false, workspaceLogo: false, fullReview: true }
    )
    expect(named('designer_published')[1]![1]).not.toHaveProperty('lookKept')
  })

  it('times the first publish from the first open on this device', () => {
    designerOpened('direct')
    designerClosed()
    vi.advanceTimersByTime(600_000)
    designerOpened('direct')
    vi.advanceTimersByTime(60_000)
    designerPublished(
      { changes: [1], published: null, design: defaultDesign() },
      { logoOffered: false, workspaceLogo: false, fullReview: false }
    )
    expect(named('designer_published')[0]![1]).toMatchObject({
      seconds: 60,
      secondsSinceFirstOpen: 660,
    })
  })
})

describe('publishing from the summary or the full review', () => {
  it('says which one the publish came from', () => {
    const draft = { changes: [1], published: { number: 1 }, design: defaultDesign() }
    designerPublished(draft, { logoOffered: false, workspaceLogo: false, fullReview: false })
    designerPublished(draft, { logoOffered: false, workspaceLogo: false, fullReview: true })
    expect(named('designer_published').map(([, props]) => props.fullReview)).toEqual([false, true])
  })
})

describe('the builder’s panels and sheets', () => {
  it('counts each one opened by name', () => {
    for (const panel of ['pages', 'add', 'theme', 'theme_more', 'ai'] as const)
      trackBuilder('designer_panel_opened', { panel })
    expect(named('designer_panel_opened').map(([, props]) => props.panel)).toEqual([
      'pages',
      'add',
      'theme',
      'theme_more',
      'ai',
    ])
  })

  it('no longer counts the rail’s brand kit and styles, which Theme replaced', () => {
    trackBuilder('designer_panel_opened', { panel: 'brand_kit' as never })
    trackBuilder('designer_panel_opened', { panel: 'styles' as never })
    expect(named('designer_panel_opened')).toEqual([])
  })
})

describe('the top bar', () => {
  it('counts a device switched to, by name only', () => {
    trackBuilder('designer_device_switched', { device: 'phone' })
    trackBuilder('designer_device_switched', { device: 'watch' as never })
    expect(named('designer_device_switched').map(([, props]) => props)).toEqual([
      { device: 'phone' },
    ])
  })

  it('counts a discarded draft by its number of changes', () => {
    trackBuilder('designer_draft_discarded', { changes: 4 })
    expect(named('designer_draft_discarded').map(([, props]) => props)).toEqual([{ changes: 4 }])
  })
})

describe('designerAdvancedOpened', () => {
  it('names the part whose Advanced was opened', () => {
    designerAdvancedOpened('site:styles')
    designerAdvancedOpened('hero')
    expect(named('designer_advanced_opened').map(([, props]) => props)).toEqual([
      { part: 'site:styles' },
      { part: 'hero' },
    ])
  })
})

describe('partIdOf', () => {
  it('names a Home block by its type, never its id', () => {
    const design = defaultDesign()
    design.pages.home.blocks = [{ id: 'abcdefgh12', type: 'links' } as never]
    expect(partIdOf('block-abcdefgh12', design)).toBe('block:links')
    expect(partIdOf('site:styles', design)).toBe('site:styles')
    expect(partIdOf('site:brand', design)).toBe('site:brand')
    expect(partIdOf('block-missing', design)).toBeNull()
  })

  it('names a menu part by its page, and a link only as a link, never its id or words', () => {
    const design = defaultDesign()
    expect(partIdOf('page:help', design)).toBe('page:help')
    expect(partIdOf('page:post', design)).toBe('page:post')
    expect(partIdOf('link:5f1c2d3e-aaaa-bbbb-cccc-111122223333', design)).toBe('link')
  })
})

describe('settingId', () => {
  it('is the only way to a setting id', () => {
    expect(settingId('layout.hero')).toBe('layout.band')
  })
})
