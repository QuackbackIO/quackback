/**
 * The builder's chrome as plain rules: what the right panel holds for each
 * pick, Theme and Add as sheets over it with a way back, the device widths,
 * what undo and redo say, and the draft's state in a few words.
 */
import { describe, expect, it } from 'vitest'
import {
  AI_PANE,
  DEVICE_WIDTHS,
  NO_SHEET,
  deviceCaption,
  draftWords,
  escapeStep,
  pageParts,
  paneWidthOnKey,
  panelBaseOf,
  panelReducer,
  panelView,
  readAiPane,
  redoTip,
  sectionTypeOf,
  undoTip,
  type PanelState,
} from '../builder-chrome'

describe('panelBaseOf', () => {
  it('is the overview with nothing picked', () => {
    expect(panelBaseOf(null)).toBe('overview')
  })

  it('is the block panel for a Home block or a page section', () => {
    expect(panelBaseOf('block-abc')).toBe('block')
    expect(panelBaseOf('entries')).toBe('block')
    expect(panelBaseOf('topics')).toBe('block')
    expect(panelBaseOf('popular')).toBe('block')
    expect(panelBaseOf('board')).toBe('block')
  })

  it('keeps the menu and header panels for menu and header picks', () => {
    expect(panelBaseOf('page:feedback')).toBe('menu')
    expect(panelBaseOf('link:abc')).toBe('menu')
    expect(panelBaseOf('header')).toBe('menu')
  })

  it('gives the hero a block panel of its own', () => {
    expect(panelBaseOf('hero')).toBe('block')
  })

  it('keeps the part panel for the other parts', () => {
    expect(panelBaseOf('welcome')).toBe('part')
    expect(panelBaseOf('site:words')).toBe('part')
  })
})

describe('sectionTypeOf', () => {
  it('names the registry block a page section is', () => {
    expect(sectionTypeOf('entries')).toBe('changelog.entries')
    expect(sectionTypeOf('topics')).toBe('help.topics')
    expect(sectionTypeOf('popular')).toBe('help.popular')
    expect(sectionTypeOf('board')).toBe('roadmap.board')
  })

  it('is null for anything else', () => {
    expect(sectionTypeOf('hero')).toBeNull()
    expect(sectionTypeOf('block-a')).toBeNull()
    expect(sectionTypeOf(null)).toBeNull()
  })
})

describe('panelReducer', () => {
  it('opens a sheet, and the same button closes it', () => {
    const theme = panelReducer(NO_SHEET, { type: 'toggle', sheet: 'theme' })
    expect(theme.sheet).toBe('theme')
    expect(panelReducer(theme, { type: 'toggle', sheet: 'theme' }).sheet).toBeNull()
  })

  it('swaps one sheet for the other', () => {
    const theme = panelReducer(NO_SHEET, { type: 'toggle', sheet: 'theme' })
    expect(panelReducer(theme, { type: 'toggle', sheet: 'add' }).sheet).toBe('add')
  })

  it('opens Theme at More options when asked, and a toggle starts it closed again', () => {
    const more = panelReducer(NO_SHEET, { type: 'open', sheet: 'theme', more: true })
    expect(more).toEqual({ sheet: 'theme', more: true })
    const closed = panelReducer(more, { type: 'close' })
    expect(panelReducer(closed, { type: 'toggle', sheet: 'theme' }).more).toBe(false)
  })

  it('sets More options while Theme is open', () => {
    const theme = panelReducer(NO_SHEET, { type: 'toggle', sheet: 'theme' })
    expect(panelReducer(theme, { type: 'more', open: true }).more).toBe(true)
  })

  it('closes on close, back and after Add has placed a block', () => {
    const add = panelReducer(NO_SHEET, { type: 'toggle', sheet: 'add' })
    expect(panelReducer(add, { type: 'close' }).sheet).toBeNull()
    expect(panelReducer(add, { type: 'back' }).sheet).toBeNull()
    expect(panelReducer(add, { type: 'added' }).sheet).toBeNull()
  })

  it('returns the same state when nothing changes', () => {
    expect(panelReducer(NO_SHEET, { type: 'close' })).toBe(NO_SHEET)
    expect(panelReducer(NO_SHEET, { type: 'more', open: true })).toBe(NO_SHEET)
  })
})

describe('panelView', () => {
  const theme: PanelState = { sheet: 'theme', more: false }

  it('shows the overview alone with nothing picked and no sheet', () => {
    expect(panelView(NO_SHEET, null, undefined)).toEqual({
      base: 'overview',
      sheet: null,
      title: null,
      back: null,
    })
  })

  it('shows a picked block’s panel', () => {
    expect(panelView(NO_SHEET, 'block-a', 'Top posts').base).toBe('block')
  })

  it('lays a sheet over the panel underneath, which stays', () => {
    const view = panelView(theme, null, undefined)
    expect(view).toEqual({ base: 'overview', sheet: 'theme', title: 'Theme', back: null })
  })

  it('crumbs the way back to what the panel under a sheet shows, the page with nothing picked', () => {
    const view = panelView(theme, 'block-a', 'Top posts')
    expect(view.base).toBe('block')
    expect(view.back).toBe('Top posts')
    expect(panelView(theme, null, 'Roadmap').back).toBe('Roadmap')
  })

  it('titles Add as adding a block', () => {
    expect(panelView({ sheet: 'add', more: false }, null, undefined).title).toBe('Add a block')
  })

  it('has no way back for a pick without a name', () => {
    expect(panelView(theme, 'block-a', undefined).back).toBeNull()
  })
})

describe('escapeStep', () => {
  it('closes a sheet first, then goes up from the pick, and closes only from the page', () => {
    expect(escapeStep({ sheet: 'add', more: false }, 'block-a')).toBe('close-sheet')
    expect(escapeStep(NO_SHEET, 'block-a', true)).toBe('up')
    expect(escapeStep(NO_SHEET, null, true)).toBe('close-page')
    expect(escapeStep(NO_SHEET, null, false)).toBeNull()
  })
})

describe('devices', () => {
  it('draws the page at desktop, tablet and phone widths', () => {
    expect(DEVICE_WIDTHS).toEqual({ desktop: 1280, tablet: 768, phone: 390 })
  })

  it('names the width over the canvas for tablet and phone only', () => {
    expect(deviceCaption('desktop')).toBeNull()
    // Tablet has no values of its own: it shows, and edits, all screens'.
    expect(deviceCaption('tablet')).toBe(
      'Tablet, 768 px wide · Tablet shows your all-screens values'
    )
    expect(deviceCaption('phone')).toBe('Phone, 390 px wide · Editing phone values')
  })
})

describe('undo and redo tips', () => {
  it('names the step each would take back or put back', () => {
    expect(undoTip('Move block')).toBe('Undo: Move block')
    expect(redoTip('Theme colours')).toBe('Redo: Theme colours')
  })

  it('says when there is nothing to take back or put back', () => {
    expect(undoTip(null)).toBe('Nothing to undo')
    expect(redoTip(null)).toBe('Nothing to redo')
  })
})

describe('draftWords', () => {
  const quiet = { saving: false, failed: false, blocked: false }

  it('counts the changes that are not live', () => {
    expect(draftWords({ ...quiet, count: 1 })).toEqual({
      text: '1 change, not live',
      tone: 'draft',
    })
    expect(draftWords({ ...quiet, count: 4 })).toEqual({
      text: '4 changes, not live',
      tone: 'draft',
    })
  })

  it('says there are none', () => {
    expect(draftWords({ ...quiet, count: 0 })).toEqual({ text: 'No changes', tone: 'quiet' })
  })

  it('says when saving, and warns when the draft is not saved', () => {
    expect(draftWords({ ...quiet, count: 2, saving: true }).text).toBe('Saving…')
    expect(draftWords({ ...quiet, count: 2, failed: true })).toEqual({
      text: 'Not saved. Retrying…',
      tone: 'warning',
    })
    expect(draftWords({ ...quiet, count: 2, blocked: true }).tone).toBe('warning')
  })
})

describe('the Ask AI pane', () => {
  it('opens at its usual width, expanded, with nothing remembered', () => {
    expect(readAiPane(null)).toEqual({ collapsed: false, width: AI_PANE.width })
  })

  it('remembers a width and whether it was collapsed', () => {
    expect(readAiPane(JSON.stringify({ collapsed: true, width: 420 }))).toEqual({
      collapsed: true,
      width: 420,
    })
  })

  it('keeps a remembered width within its limits', () => {
    expect(readAiPane(JSON.stringify({ width: 9000 })).width).toBe(AI_PANE.max)
    expect(readAiPane(JSON.stringify({ width: 10 })).width).toBe(AI_PANE.min)
  })

  it('shrugs off anything it cannot read', () => {
    expect(readAiPane('not json')).toEqual({ collapsed: false, width: AI_PANE.width })
    expect(readAiPane(JSON.stringify({ collapsed: 'yes', width: 'wide' }))).toEqual({
      collapsed: false,
      width: AI_PANE.width,
    })
  })

  it('is between 300 and 480 wide, 360 to begin with', () => {
    expect(AI_PANE).toEqual({ min: 300, max: 480, width: 360 })
  })

  it('resizes by the arrow keys, Home and End, within its limits', () => {
    expect(paneWidthOnKey('ArrowRight', 360)).toBe(376)
    expect(paneWidthOnKey('ArrowLeft', 360)).toBe(344)
    expect(paneWidthOnKey('ArrowLeft', 305)).toBe(300)
    expect(paneWidthOnKey('ArrowRight', 475)).toBe(480)
    expect(paneWidthOnKey('Home', 400)).toBe(300)
    expect(paneWidthOnKey('End', 400)).toBe(480)
    expect(paneWidthOnKey('a', 400)).toBeNull()
  })
})

describe('pageParts', () => {
  it('lists what can be picked on the page, in reading order, without what every page shares', () => {
    const parts = pageParts([
      { key: 'site', label: 'Every page', children: [{ key: 'site:brand', label: 'Brand' }] },
      { key: 'header', label: 'Header and menu' },
      { key: 'hero', label: 'Hero' },
      {
        key: 'home',
        label: 'Blocks',
        children: [
          { key: 'block-a', label: 'Top posts' },
          { key: 'block-b', label: 'Status' },
        ],
      },
    ])
    expect(parts).toEqual([
      { key: 'header', label: 'Header and menu' },
      { key: 'hero', label: 'Hero' },
      { key: 'block-a', label: 'Top posts' },
      { key: 'block-b', label: 'Status' },
    ])
  })
})
