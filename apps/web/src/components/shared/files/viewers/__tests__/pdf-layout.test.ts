import { describe, expect, it } from 'vitest'
import { ZOOM_MAX, ZOOM_MIN, clampZoom } from '../zoom'
import { BudgetTimeoutError } from '../budgets'
import { MAX_FIND_MATCHES } from '../find-limit'
import {
  canvasScale,
  currentPage,
  findMatches,
  fitWidthZoom,
  highlightRanges,
  linkBoxes,
  pageTextIndex,
  pageTops,
  pagesNear,
  pdfFailure,
  safeLinkUrl,
  stepMatch,
} from '../pdf-layout'

describe('fitWidthZoom', () => {
  it('fits the widest page into the desk, minus its padding', () => {
    // A US Letter page is 612pt = 816 CSS px at 100%.
    expect(fitWidthZoom(816 + 48, 612, 48)).toBeCloseTo(1, 5)
    expect(fitWidthZoom(408 + 48, 612, 48)).toBeCloseTo(0.5, 5)
  })

  it('never fits above 125%, so a wide dialog does not blow pages up', () => {
    expect(fitWidthZoom(4000, 612, 48)).toBe(1.25)
  })

  it('goes below the 50% step on narrow surfaces rather than overflowing', () => {
    expect(fitWidthZoom(320, 612, 24)).toBeCloseTo(296 / 816, 5)
  })

  it('falls back to 100% before the desk has a size', () => {
    expect(fitWidthZoom(0, 612, 48)).toBe(1)
  })
})

describe('clampZoom', () => {
  it('holds zoom between the shared bounds', () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN)
    expect(clampZoom(9)).toBe(ZOOM_MAX)
    expect(clampZoom(1.25)).toBe(1.25)
  })

  it('lets a fit below the minimum stand', () => {
    expect(clampZoom(0.36, 0.36)).toBe(0.36)
    expect(clampZoom(0.2, 0.36)).toBe(0.36)
  })
})

describe('currentPage', () => {
  // Three 1000px pages with 16px gaps, starting 24px down the desk.
  const tops = [24, 1040, 2056]
  const heights = [1000, 1000, 1000]

  it('is the page under the middle of the viewport', () => {
    expect(currentPage(tops, heights, 0, 800)).toBe(1)
    expect(currentPage(tops, heights, 700, 800)).toBe(2)
    expect(currentPage(tops, heights, 1700, 800)).toBe(3)
  })

  it('stays on the last page once the desk bottoms out', () => {
    expect(currentPage(tops, heights, 99_999, 800)).toBe(3)
  })

  it('counts a gap as the page above it', () => {
    // Middle of the viewport at 1032: in the gap after page 1.
    expect(currentPage(tops, heights, 632, 800)).toBe(1)
  })

  it('is 1 for an empty document', () => {
    expect(currentPage([], [], 0, 800)).toBe(1)
  })
})

describe('pagesNear', () => {
  it('renders the visible pages and one either side', () => {
    expect(pagesNear(new Set([5]), 10)).toEqual([4, 5, 6])
    expect(pagesNear(new Set([5, 6]), 10)).toEqual([4, 5, 6, 7])
  })

  it('stays inside the document', () => {
    expect(pagesNear(new Set([1]), 3)).toEqual([1, 2])
    expect(pagesNear(new Set([3]), 3)).toEqual([2, 3])
    expect(pagesNear(new Set(), 3)).toEqual([])
  })
})

describe('findMatches', () => {
  const pages = ['Invoice INV-2041\nTotal due', 'No matches here', 'invoice copy, INVOICE again']

  it('finds every case-insensitive match in page order', () => {
    expect(findMatches(pages, 'invoice')).toEqual([
      { page: 1, start: 0, end: 7 },
      { page: 3, start: 0, end: 7 },
      { page: 3, start: 14, end: 21 },
    ])
  })

  it('finds nothing for a blank query', () => {
    expect(findMatches(pages, '   ')).toEqual([])
  })

  it('treats the query as text, not a pattern', () => {
    expect(findMatches(['a.b axb'], 'a.b')).toEqual([{ page: 1, start: 0, end: 3 }])
  })

  it('stops counting where text find does, so the bar reads the same', () => {
    const found = findMatches(['ab '.repeat(MAX_FIND_MATCHES), 'ab ab'], 'ab')
    expect(found).toHaveLength(MAX_FIND_MATCHES)
    expect(found.at(-1)!.page).toBe(1)
  })
})

describe('stepMatch', () => {
  it('wraps around in both directions', () => {
    expect(stepMatch(0, 3, 1)).toBe(1)
    expect(stepMatch(2, 3, 1)).toBe(0)
    expect(stepMatch(0, 3, -1)).toBe(2)
    expect(stepMatch(-1, 3, 1)).toBe(0)
  })

  it('is -1 with nothing to step through', () => {
    expect(stepMatch(0, 0, 1)).toBe(-1)
  })
})

describe('safeLinkUrl', () => {
  it('keeps web links', () => {
    expect(safeLinkUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeLinkUrl('http://example.com')).toBe('http://example.com/')
  })

  it('drops every other scheme and anything unparseable', () => {
    expect(safeLinkUrl('javascript:alert(1)')).toBeNull()
    expect(safeLinkUrl('mailto:a@b.c')).toBeNull()
    expect(safeLinkUrl('file:///etc/passwd')).toBeNull()
    expect(safeLinkUrl('data:text/html,<script>1</script>')).toBeNull()
    expect(safeLinkUrl('/relative')).toBeNull()
    expect(safeLinkUrl(undefined)).toBeNull()
  })
})

describe('linkBoxes', () => {
  // A viewport that flips y on a 792pt-tall page at 2x, as pdf.js does.
  const toViewport = (x: number, y: number): number[] => [x * 2, (792 - y) * 2]

  it('places web links over the page and drops every other kind', () => {
    const boxes = linkBoxes(
      [
        { subtype: 'Link', url: 'https://example.com/a', rect: [72, 700, 172, 720] },
        { subtype: 'Link', url: 'javascript:alert(1)', rect: [0, 0, 10, 10] },
        { subtype: 'Link', url: 'mailto:a@b.c', rect: [0, 0, 10, 10] },
        { subtype: 'Link', dest: 'page2', rect: [0, 0, 10, 10] },
        { subtype: 'Widget', url: 'https://example.com/form', rect: [0, 0, 10, 10] },
        { subtype: 'Link', url: 'https://example.com/no-rect' },
      ],
      toViewport
    )
    expect(boxes).toEqual([
      { href: 'https://example.com/a', left: 144, top: 144, width: 200, height: 40 },
    ])
  })
})

describe('pageTops', () => {
  it('stacks pages down the desk with a gap between them', () => {
    expect(pageTops([1000, 500, 800], 24, 16)).toEqual([24, 1040, 1556])
    expect(pageTops([], 24, 16)).toEqual([])
  })
})

describe('pageTextIndex', () => {
  it('joins a page’s text runs, breaking lines where the runs end one', () => {
    const index = pageTextIndex([
      { str: 'Invoice', hasEOL: false },
      { str: ' INV-2041', hasEOL: true },
      { str: 'Total due', hasEOL: false },
    ])
    expect(index.text).toBe('Invoice INV-2041\nTotal due')
    expect(index.starts).toEqual([0, 7, 17])
  })
})

describe('highlightRanges', () => {
  const index = pageTextIndex([
    { str: 'Invoice', hasEOL: false },
    { str: ' INV-2041', hasEOL: true },
    { str: 'Total due', hasEOL: false },
  ])

  it('maps a match onto the runs it covers, split where runs meet', () => {
    // "ice INV" spans the end of run 0 and the start of run 1.
    expect(highlightRanges(index, [{ page: 1, start: 4, end: 11 }], 0)).toEqual([
      { item: 0, start: 4, end: 7, active: true },
      { item: 1, start: 0, end: 4, active: true },
    ])
  })

  it('marks only the active match as active', () => {
    const ranges = highlightRanges(
      index,
      [
        { page: 1, start: 0, end: 7 },
        { page: 1, start: 17, end: 22 },
      ],
      1
    )
    expect(ranges).toEqual([
      { item: 0, start: 0, end: 7, active: false },
      { item: 2, start: 0, end: 5, active: true },
    ])
  })
})

describe('pdfFailure', () => {
  it('reads timeouts as too large and everything else as unreadable', () => {
    expect(pdfFailure(new BudgetTimeoutError())).toBe('too_large')
    const password = Object.assign(new Error('pw'), { name: 'PasswordException' })
    expect(pdfFailure(password)).toBe('corrupt')
    const invalid = Object.assign(new Error('bad'), { name: 'InvalidPDFException' })
    expect(pdfFailure(invalid)).toBe('corrupt')
    expect(pdfFailure('weird')).toBe('corrupt')
  })
})

describe('canvasScale', () => {
  it('draws at the device pixel ratio', () => {
    expect(canvasScale(800, 1000, 2)).toBe(2)
    expect(canvasScale(800, 1000, 1)).toBe(1)
  })

  it('backs off so one page never needs a canvas past the pixel budget', () => {
    // 2000 x 2800 CSS px at 3x would be 50 MP; the budget is 16 MP.
    const scale = canvasScale(2000, 2800, 3)
    expect(2000 * scale * (2800 * scale)).toBeLessThanOrEqual(16 * 1024 * 1024)
    expect(scale).toBeGreaterThan(1)
  })
})
