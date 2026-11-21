// @vitest-environment happy-dom
/**
 * The brand kit over the preview while Import reads a website: nothing when
 * idle, the reading card after a short delay, rows filled from the result
 * once, then gone. A refusal hides it; the error stays in the Import section.
 */
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrandImport } from '@/lib/shared/theme/brand-import'
import { draftFromLoaded } from '../portal-draft'
import type { ImportState } from '../import-section'
import { ImportOverlay } from '../import-overlay'

const brand: BrandImport = {
  host: 'example.com',
  reader: 'static',
  primary: '#533afd',
  background: '#ffffff',
  text: '#061b31',
  scheme: 'light',
  font: { site: 'Brand Sans', id: 'inter', exact: false },
  radius: 0.25,
  buttonShape: 'pill',
  logo: { kind: 'wide', stagedKey: 'header-logos/a.svg', url: '/api/storage/header-logos/a.svg' },
  tokens: { header: '#0a2540' },
  missing: [],
}

const before = draftFromLoaded({
  theme: { themeMode: 'user' },
  customCss: '',
  portal: {} as never,
  helpCenter: null,
})

const idle: ImportState = { status: 'idle' }
const reading: ImportState = { status: 'reading', host: 'example.com' }
const refused: ImportState = { status: 'refused', message: 'That website is not reachable.' }
const done = (over: Partial<BrandImport> = {}): ImportState => ({
  status: 'done',
  host: 'example.com',
  brand: { ...brand, ...over },
  before,
  undone: [],
  preTicked: false,
})

/** Time passing in small steps, so each timer's render schedules the next. */
function wait(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 10) act(() => vi.advanceTimersByTime(10))
}
const kit = () => screen.queryByTestId('import-kit')
const value = (row: string) => screen.getByTestId(`import-kit-${row}`)
const swatches = () =>
  [...value('colours').querySelectorAll<HTMLElement>('[data-swatch]')].map(
    (el) => el.dataset.swatch
  )

/** A read that showed its card, then ended in `state`. */
function readThen(state: ImportState) {
  const view = render(<ImportOverlay state={reading} />)
  wait(300)
  view.rerender(<ImportOverlay state={state} />)
  return view
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ImportOverlay', () => {
  it('shows nothing when idle', () => {
    const { container } = render(<ImportOverlay state={idle} />)
    wait(1000)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing for a result it did not watch arrive', () => {
    const { container } = render(<ImportOverlay state={done()} />)
    wait(1000)
    expect(container).toBeEmptyDOMElement()
  })

  it('waits 250 ms, then shows the host and four empty rows while reading', () => {
    const { container } = render(<ImportOverlay state={reading} />)
    wait(240)
    expect(container).toBeEmptyDOMElement()
    wait(20)
    expect(kit()).toHaveTextContent('example.com')
    expect(kit()).toHaveTextContent('Reading the site')
    for (const label of ['Logo', 'Colours', 'Font', 'Corners'])
      expect(screen.getByText(label)).toBeInTheDocument()
    for (const row of ['logo', 'colours', 'font', 'corners'])
      expect(value(row)).toHaveAttribute('data-filled', 'false')
    expect(screen.getByTestId('import-scan')).toBeInTheDocument()
  })

  it('is decorative: hidden from assistive tech and never takes a click', () => {
    const { container } = render(<ImportOverlay state={reading} />)
    wait(300)
    const root = container.firstElementChild!
    expect(root).toHaveAttribute('aria-hidden', 'true')
    expect(root.className).toContain('pointer-events-none')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('never flashes for a result that arrives before the delay', () => {
    const view = render(<ImportOverlay state={reading} />)
    wait(100)
    view.rerender(<ImportOverlay state={done()} />)
    wait(5000)
    expect(view.container).toBeEmptyDOMElement()
  })

  it('fills the rows one after another from the result', () => {
    readThen(done())
    expect(kit()).toHaveTextContent('Found')
    expect(kit()).not.toHaveTextContent('Reading the site')
    expect(screen.queryByTestId('import-scan')).toBeNull()
    // The logo first, the rest still to come.
    expect(value('logo').querySelector('img')).toHaveAttribute(
      'src',
      '/api/storage/header-logos/a.svg'
    )
    expect(value('colours')).toHaveAttribute('data-filled', 'false')
    wait(200)
    expect(swatches()).toEqual(['#533afd', '#0a2540', '#ffffff', '#061b31'])
    expect(value('font')).toHaveAttribute('data-filled', 'false')
    wait(200)
    expect(value('font')).toHaveTextContent('Brand Sans isn’t one we have, so Inter stands in.')
    expect(value('corners')).toHaveAttribute('data-filled', 'false')
    wait(200)
    expect(value('corners')).toHaveTextContent('Slight corners, pill buttons')
  })

  it('says Not found for what the site lacked', () => {
    readThen(
      done({
        logo: undefined,
        primary: undefined,
        background: undefined,
        text: undefined,
        tokens: undefined,
        radius: undefined,
        buttonShape: undefined,
        missing: ['logo', 'colour', 'page', 'font', 'shape'],
      })
    )
    wait(800)
    for (const row of ['logo', 'colours', 'font', 'corners'])
      expect(value(row)).toHaveTextContent('Not found')
    expect(value('logo').querySelector('img')).toBeNull()
  })

  it('shows only the colours the site gave, in order', () => {
    readThen(done({ tokens: undefined, text: undefined }))
    wait(800)
    expect(swatches()).toEqual(['#533afd', '#ffffff'])
  })

  it('leaves once the rows have filled', () => {
    const { container } = readThen(done())
    wait(800)
    expect(kit()).toBeInTheDocument()
    wait(2000)
    expect(container).toBeEmptyDOMElement()
  })

  it('does not replay when the result re-renders', () => {
    const view = readThen(done())
    wait(3000)
    expect(view.container).toBeEmptyDOMElement()
    // An Undo on a row gives a new state object, still done.
    view.rerender(<ImportOverlay state={{ ...done(), undone: ['font'] } as ImportState} />)
    wait(3000)
    expect(view.container).toBeEmptyDOMElement()
  })

  it('shows the reading card again for a new import', () => {
    const view = readThen(done())
    wait(3000)
    view.rerender(<ImportOverlay state={{ status: 'reading', host: 'wise.com' }} />)
    wait(300)
    expect(kit()).toHaveTextContent('wise.com')
    expect(kit()).toHaveTextContent('Reading the site')
    expect(value('logo')).toHaveAttribute('data-filled', 'false')
  })

  it('hides on a refusal without filling', () => {
    const { container } = readThen(refused)
    expect(screen.queryByTestId('import-scan')).toBeNull()
    expect(kit()).not.toHaveTextContent('Found')
    wait(400)
    expect(container).toBeEmptyDOMElement()
  })
})
