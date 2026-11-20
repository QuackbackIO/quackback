// @vitest-environment happy-dom
/**
 * Import your brand: a website in, the draft filled as one step, a row per
 * result with its own Undo; refusals shown as written; nothing published.
 */
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrandImport, SiteNotRead } from '@/lib/shared/theme/brand-import'
import {
  draftFromLoaded,
  draftPalette,
  publishedFromLoaded,
  publishInput,
  type LoadedPortal,
  type PortalDraft,
} from '../portal-draft'

const { importFn, track } = vi.hoisted(() => ({ importFn: vi.fn(), track: vi.fn() }))
vi.mock('@/lib/server/functions/portal-customise', () => ({
  importBrandFn: (args: unknown) => importFn(args),
}))
vi.mock('@/lib/client/analytics', () => ({ track: (...args: unknown[]) => track(...args) }))

const { ImportSection, useBrandImport, importSummary, confirmedImport } =
  await import('../import-section')

const loaded: LoadedPortal = {
  theme: { themeMode: 'user' },
  customCss: '',
  portal: {} as never,
  helpCenter: null,
}

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
  missing: [],
}

function setup() {
  const base: PortalDraft = draftFromLoaded({
    theme: { themeMode: 'user' },
    customCss: '',
    portal: {} as never,
    helpCenter: null,
  })
  let draft = base
  const steps: PortalDraft[] = []
  const update = (edit: (d: PortalDraft) => PortalDraft) => {
    draft = edit(draft)
    steps.push(draft)
  }
  const hook = renderHook(() => useBrandImport({ update, getDraft: () => draft }))
  /** The editor's own undo: the draft as it was one step ago, with nothing told to the import. */
  const editorUndo = () => {
    steps.pop()
    draft = steps.at(-1) ?? base
    hook.rerender()
  }
  return { hook, steps, base, current: () => draft, editorUndo }
}

afterEach(() => {
  cleanup()
  importFn.mockReset()
  track.mockReset()
})

describe('useBrandImport', () => {
  it('fills the draft as one step and counts the import without its address', async () => {
    importFn.mockResolvedValue({ ok: true, brand })
    const { hook, steps, current } = setup()
    await act(() => hook.result.current.run('https://example.com/pricing'))
    expect(importFn).toHaveBeenCalledWith({ data: { url: 'https://example.com/pricing' } })
    expect(steps).toHaveLength(1)
    expect(draftPalette(current(), 'light').primary).toBe('#533afd')
    expect(hook.result.current.state).toMatchObject({ status: 'done', host: 'example.com' })
    expect(track).toHaveBeenCalledWith('portal_brand_import', {
      ok: true,
      reader: 'static',
      missing: [],
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain('example')
  })

  it('takes one row back as its own step', async () => {
    importFn.mockResolvedValue({ ok: true, brand })
    const { hook, steps, current } = setup()
    await act(() => hook.result.current.run('example.com'))
    act(() => hook.result.current.undoRow('primary'))
    expect(steps).toHaveLength(2)
    expect(draftPalette(current(), 'light').primary).not.toBe('#533afd')
    expect(hook.result.current.state.status === 'done' && hook.result.current.state.undone).toEqual(
      ['primary']
    )
  })

  it('shows a refusal as written and changes nothing', async () => {
    importFn.mockResolvedValue({
      ok: false,
      code: 'ROBOTS_DISALLOWED',
      message: 'example.com asks robots not to read it.',
    })
    const { hook, steps } = setup()
    await act(() => hook.result.current.run('example.com'))
    expect(steps).toHaveLength(0)
    expect(hook.result.current.state).toEqual({
      status: 'refused',
      message: 'example.com asks robots not to read it.',
    })
    expect(track).toHaveBeenCalledWith('portal_brand_import', {
      ok: false,
      reader: null,
      missing: [],
    })
  })
})

describe('useBrandImport and the brand assets', () => {
  const icon = { key: 'logos/n.png', faviconKey: 'favicons/n.png', url: '/n.png' }
  const assets: BrandImport = { ...brand, icon }
  const doneState = (hook: ReturnType<typeof setup>['hook']) => {
    const state = hook.result.current.state
    if (state.status !== 'done') throw new Error('not done')
    return state
  }

  it('holds the logo and icon when the portal is on another domain', async () => {
    importFn.mockResolvedValue({ ok: true, brand: { ...assets, portalOnSite: false } })
    const { hook, steps, current } = setup()
    await act(() => hook.result.current.run('example.com'))
    expect(doneState(hook).preTicked).toBe(false)
    expect(hook.result.current.confirmed).toBe(false)
    expect(current().logo).toMatchObject({ wideKey: null, icon: null })
    expect(draftPalette(current(), 'light').primary).toBe('#533afd')
    expect(steps).toHaveLength(1)
  })

  it('ticks for the person when the portal is on the site’s own domain', async () => {
    importFn.mockResolvedValue({ ok: true, brand: { ...assets, portalOnSite: true } })
    const { hook, current } = setup()
    await act(() => hook.result.current.run('example.com'))
    expect(doneState(hook).preTicked).toBe(true)
    expect(hook.result.current.confirmed).toBe(true)
    expect(current().logo.wideKey).toBe('header-logos/a.svg')
  })

  it('applies the assets as one step when ticked, and takes them back as one when unticked', async () => {
    importFn.mockResolvedValue({ ok: true, brand: assets })
    const { hook, steps, current } = setup()
    await act(() => hook.result.current.run('example.com'))
    act(() => hook.result.current.confirmAssets(true))
    expect(steps).toHaveLength(2)
    expect(current().logo).toMatchObject({ wideKey: 'header-logos/a.svg', icon: { key: icon.key } })
    expect(hook.result.current.confirmed).toBe(true)
    expect(doneState(hook).preTicked).toBe(false)
    act(() => hook.result.current.confirmAssets(false))
    expect(steps).toHaveLength(3)
    expect(current().logo).toMatchObject({ wideKey: null, icon: null })
    expect(hook.result.current.confirmed).toBe(false)
  })

  it('follows the editor’s own undo: assets an undo brings back are ticked, and recorded on publish', async () => {
    importFn.mockResolvedValue({ ok: true, brand: assets })
    const { hook, base, current, editorUndo } = setup()
    await act(() => hook.result.current.run('example.com'))
    act(() => hook.result.current.confirmAssets(true))
    act(() => hook.result.current.confirmAssets(false))
    expect(hook.result.current.confirmed).toBe(false)
    // Undo of the untick: the logo and icon are in the draft again.
    act(() => editorUndo())
    expect(current().logo.wideKey).toBe('header-logos/a.svg')
    expect(hook.result.current.confirmed).toBe(true)
    const input = publishInput(base, current(), publishedFromLoaded(loaded), {
      brandAssets: confirmedImport(hook.result.current.state),
    })
    expect(input?.brandAssets).toEqual({
      host: 'example.com',
      assets: ['logo', 'icon'],
      preTicked: false,
    })
    // Undo again, back to the held import: nothing imported to publish, nothing recorded.
    act(() => editorUndo())
    expect(hook.result.current.confirmed).toBe(false)
    expect(
      publishInput(base, current(), publishedFromLoaded(loaded), {
        brandAssets: confirmedImport(hook.result.current.state),
      })?.brandAssets
    ).toBeUndefined()
  })

  it('a tick the person made themselves is no longer a pre-tick, even ticked again', async () => {
    importFn.mockResolvedValue({ ok: true, brand: { ...assets, portalOnSite: true } })
    const { hook } = setup()
    await act(() => hook.result.current.run('example.com'))
    act(() => hook.result.current.confirmAssets(false))
    act(() => hook.result.current.confirmAssets(true))
    expect(hook.result.current.confirmed).toBe(true)
    expect(doneState(hook).preTicked).toBe(false)
  })

  it('ticking again brings back a row that was taken back', async () => {
    importFn.mockResolvedValue({ ok: true, brand: { ...assets, portalOnSite: true } })
    const { hook, current } = setup()
    await act(() => hook.result.current.run('example.com'))
    act(() => hook.result.current.undoRow('logo'))
    act(() => hook.result.current.confirmAssets(false))
    act(() => hook.result.current.confirmAssets(true))
    expect(current().logo.wideKey).toBe('header-logos/a.svg')
    expect(doneState(hook).undone).toEqual([])
  })

  it('never takes a held row back', async () => {
    importFn.mockResolvedValue({ ok: true, brand: assets })
    const { hook, steps } = setup()
    await act(() => hook.result.current.run('example.com'))
    act(() => hook.result.current.undoRow('logo'))
    expect(steps).toHaveLength(1)
    expect(doneState(hook).undone).toEqual([])
  })
})

describe('importSummary', () => {
  it('reads as the closed section shows it', () => {
    expect(importSummary({ status: 'idle' })).toBe('From your website')
    expect(importSummary({ status: 'reading', host: 'example.com' })).toBe('Reading…')
    expect(
      importSummary({
        status: 'done',
        host: 'example.com',
        brand,
        before: { logo: { wideKey: null, mode: 'logo_and_name', icon: null } } as never,
        undone: [],
        preTicked: false,
      })
    ).toBe('From example.com')
  })
})

describe('ImportSection', () => {
  it('submits the address and lists the rows with Undo and the upload for a licensed font', async () => {
    const onRun = vi.fn()
    const onUndoRow = vi.fn()
    const onUploadFont = vi.fn()
    const { rerender } = render(
      <ImportSection
        state={{ status: 'idle' }}
        onRun={onRun}
        onUndoRow={onUndoRow}
        onUploadWide={vi.fn()}
        onUploadFont={onUploadFont}
      />
    )
    fireEvent.change(screen.getByLabelText('Your website'), { target: { value: 'example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(onRun).toHaveBeenCalledWith('example.com')
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()

    rerender(
      <ImportSection
        state={{ status: 'reading', host: 'example.com' }}
        onRun={onRun}
        onUndoRow={onUndoRow}
        onUploadWide={vi.fn()}
        onUploadFont={onUploadFont}
      />
    )
    // One status region, there before the read, says each stage once.
    expect(status).toBe(screen.getByRole('status'))
    expect(status).toHaveTextContent('Reading example.com: logo, colours, font and shape…')
    expect(screen.getAllByText(/Reading example\.com/)).toHaveLength(1)

    rerender(
      <ImportSection
        state={{
          status: 'done',
          host: 'example.com',
          brand,
          before: { logo: { wideKey: null, mode: 'logo_and_name', icon: null } } as never,
          undone: ['logo'],
          preTicked: false,
        }}
        confirmed
        onRun={onRun}
        onUndoRow={onUndoRow}
        onUploadWide={vi.fn()}
        onUploadFont={onUploadFont}
      />
    )
    expect(screen.getByText('#533afd, from the main button')).toBeInTheDocument()
    // The logo row was taken back: no Undo left on it.
    expect(screen.getAllByRole('button', { name: /^Undo/ })).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'Undo Main colour' }))
    expect(onUndoRow).toHaveBeenCalledWith('primary')
    fireEvent.click(screen.getByRole('button', { name: 'Upload Brand Sans' }))
    expect(onUploadFont).toHaveBeenCalledWith('Brand Sans')
    expect(status).toBe(screen.getByRole('status'))
    expect(status).toHaveTextContent(
      'Found. Matched from example.com. Everything is in your draft until you publish.'
    )
    expect(screen.getAllByText(/Matched from example\.com/)).toHaveLength(1)
  })

  it('announces the read when the section opens with one under way (started from the chat)', async () => {
    const { renderToString } = await import('react-dom/server')
    const section = (
      <ImportSection
        state={{ status: 'reading', host: 'example.com' }}
        onRun={vi.fn()}
        onUndoRow={vi.fn()}
        onUploadWide={vi.fn()}
        onUploadFont={vi.fn()}
      />
    )
    // The status region is in the page before its words: a region that arrives
    // already holding them is not announced.
    const first = renderToString(section)
    expect(first).toContain('role="status"')
    expect(first).not.toContain('Reading')
    render(section)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reading example.com: logo, colours, font and shape…'
    )
  })

  describe('the brand assets tick', () => {
    const icon = { key: 'logos/n.png', faviconKey: 'favicons/n.png', url: '/n.png' }
    const files = [{ key: 'fonts/s.woff2', weight: 400, style: 'normal' as const }]
    const done = (over: Partial<BrandImport>, confirmed: boolean) => ({
      confirmed,
      state: {
        status: 'done' as const,
        host: 'example.com',
        brand: { ...brand, ...over },
        before: { logo: { wideKey: null, mode: 'logo_and_name', icon: null } } as never,
        undone: [],
        preTicked: false,
      },
    })
    const show = ({ state, confirmed }: ReturnType<typeof done>, onConfirm = vi.fn()) => {
      render(
        <ImportSection
          state={state}
          confirmed={confirmed}
          onRun={vi.fn()}
          onUndoRow={vi.fn()}
          onUploadWide={vi.fn()}
          onUploadFont={vi.fn()}
          onConfirmAssets={onConfirm}
        />
      )
      return onConfirm
    }

    it('holds the logo, icon and font behind one unticked box, with no note under it', () => {
      const siteFont = { family: 'Brand Sans', licence: 'commercial' as const, files }
      const onConfirm = show(done({ icon, siteFont }, false))
      const box = screen.getByRole('checkbox', {
        name: 'We own this logo, icon and font, or have a licence to use them',
      })
      expect(box).not.toBeChecked()
      expect(screen.getAllByText('Tick the box below to use it')).toHaveLength(3)
      expect(screen.getAllByLabelText('Waiting for your OK')).toHaveLength(3)
      // A held row changed nothing: no Undo on it.
      for (const label of ['Logo', 'Icon', 'Font'])
        expect(screen.queryByRole('button', { name: `Undo ${label}` })).toBeNull()
      expect(screen.queryByText(/Ticked for you|so we ask|Recorded with/)).toBeNull()
      fireEvent.click(box)
      expect(onConfirm).toHaveBeenCalledWith(true)
    })

    it('shows them applied once ticked, and unticks', () => {
      const siteFont = { family: 'Brand Sans', licence: 'commercial' as const, files }
      const onConfirm = show(done({ icon, siteFont }, true))
      const box = screen.getByRole('checkbox')
      expect(box).toBeChecked()
      expect(screen.getByText('From the site')).toBeInTheDocument()
      expect(screen.getByText('Brand Sans, from the site')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Undo Logo' })).toBeInTheDocument()
      fireEvent.click(box)
      expect(onConfirm).toHaveBeenCalledWith(false)
    })

    it('leaves the font out of the label when a font service serves it', () => {
      show(done({ icon, siteFont: { family: 'Brand Sans', notCopied: 'service' } }, true))
      expect(
        screen.getByRole('checkbox', {
          name: 'We own this logo and icon, or have a licence to use them',
        })
      ).toBeChecked()
      expect(screen.getByText('Can’t be copied. Inter stands in.')).toBeInTheDocument()
    })

    it('shows no box when the site gave nothing to confirm', () => {
      show(done({ logo: undefined, missing: ['logo', 'icon'] }, false))
      expect(screen.queryByRole('checkbox')).toBeNull()
    })
  })

  describe('a site that could not be read', () => {
    const refused = (notRead: SiteNotRead, onRun = vi.fn()) => {
      render(
        <ImportSection
          state={{ status: 'refused', message: 'fallback words', notRead, input: 'northwind.com' }}
          onRun={onRun}
          onUndoRow={vi.fn()}
          onUploadWide={vi.fn()}
          onUploadFont={vi.fn()}
        />
      )
      return onRun
    }

    it('says the site showed an error page, and tries the same address again', () => {
      const onRun = refused({ reason: 'error', host: 'northwind.com', candidates: [] })
      const notice = screen.getByRole('alert')
      expect(notice).toHaveTextContent('northwind.com showed an error page')
      expect(notice).toHaveTextContent('Nothing changed. Try again in a few minutes.')
      expect(notice).not.toHaveTextContent('fallback words')
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(onRun).toHaveBeenCalledWith('northwind.com')
    })

    it('says the site asked for proof of a human, and copies our reader’s name', async () => {
      const writeText = vi.fn(async () => {})
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      refused({ reason: 'bot', host: 'northwind.com', candidates: [] })
      const notice = screen.getByRole('alert')
      expect(notice).toHaveTextContent('northwind.com asked us to prove we’re human')
      expect(notice).toHaveTextContent(
        'Nothing changed. If it’s your site, allow our reader: QuackbackBrandReader'
      )
      fireEvent.click(screen.getByRole('button', { name: 'Copy name' }))
      expect(writeText).toHaveBeenCalledWith('QuackbackBrandReader')
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    })

    it('says the site opened a country picker, and a pick fills the address', () => {
      const onRun = refused({
        reason: 'picker',
        host: 'northwind.com',
        candidates: [
          'https://www.northwind.com/uk/',
          'https://www.northwind.com/us/',
          'https://northwind.de/',
        ],
      })
      const notice = screen.getByRole('alert')
      expect(notice).toHaveTextContent('northwind.com opened a country picker')
      expect(notice).toHaveTextContent('Nothing changed. Pick your site to import it.')
      fireEvent.click(screen.getByRole('button', { name: 'northwind.com/uk' }))
      expect(screen.getByLabelText('Your website')).toHaveValue('northwind.com/uk')
      expect(notice).toHaveTextContent('Ready to import northwind.com/uk.')
      expect(screen.getByRole('button', { name: 'northwind.de' })).toBeInTheDocument()
      // Nothing is read until Import is pressed.
      expect(onRun).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Import' }))
      expect(onRun).toHaveBeenCalledWith('northwind.com/uk')
    })
  })

  it('asks for the country’s own address when the picker gave none to pick from', () => {
    render(
      <ImportSection
        state={{
          status: 'refused',
          message: 'fallback words',
          notRead: { reason: 'picker', host: 'northwind.com', candidates: [] },
          input: 'northwind.com',
        }}
        onRun={vi.fn()}
        onUndoRow={vi.fn()}
        onUploadWide={vi.fn()}
        onUploadFont={vi.fn()}
      />
    )
    const notice = screen.getByRole('alert')
    expect(notice).toHaveTextContent('northwind.com opened a country picker')
    expect(notice).toHaveTextContent('Nothing changed. Enter the address of your country’s site.')
    expect(notice.querySelectorAll('button')).toHaveLength(0)
    expect(notice).not.toHaveTextContent('Ready to import')
  })

  it('keeps what the site showed with a refusal, for the editor to say', async () => {
    const notRead = { reason: 'error' as const, host: 'example.com', candidates: [] }
    importFn.mockResolvedValue({ ok: false, code: 'SITE_ERROR_PAGE', message: 'words', notRead })
    let draft = draftFromLoaded(loaded)
    const hook = renderHook(() =>
      useBrandImport({ update: (edit) => (draft = edit(draft)), getDraft: () => draft })
    )
    await act(() => hook.result.current.run(' example.com '))
    expect(hook.result.current.state).toEqual({
      status: 'refused',
      message: 'words',
      notRead,
      input: 'example.com',
    })
  })

  it('shows a refusal as written', () => {
    render(
      <ImportSection
        state={{ status: 'refused', message: 'Enter a website, like example.com.' }}
        onRun={vi.fn()}
        onUndoRow={vi.fn()}
        onUploadWide={vi.fn()}
        onUploadFont={vi.fn()}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a website, like example.com.')
  })
})

describe('suggested words', () => {
  const named: BrandImport = { ...brand, siteName: 'Northwind' }
  const start = () => {
    const base: PortalDraft = { ...draftFromLoaded(loaded), workspaceName: 'Acme Corp' }
    let draft = base
    const steps: PortalDraft[] = []
    const update = (edit: (d: PortalDraft) => PortalDraft) => {
      draft = edit(draft)
      steps.push(draft)
    }
    const used = vi.fn()
    const hook = renderHook(() =>
      useBrandImport({ update, getDraft: () => draft, onSuggestionUsed: used })
    )
    const undo = () => {
      steps.pop()
      draft = steps.at(-1) ?? base
      hook.rerender()
    }
    return { hook, used, undo, current: () => draft }
  }

  it('an import offers the name and a welcome line, and applies neither', async () => {
    importFn.mockResolvedValue({ ok: true, brand: named })
    const { hook, current } = start()
    await act(() => hook.result.current.run('example.com'))
    expect(hook.result.current.suggestions.map((s) => [s.key, s.text, s.used])).toEqual([
      ['name', 'Northwind, now Acme Corp', false],
      ['welcome', 'Tell us what would make Northwind better for your team.', false],
    ])
    expect(current().headerName).toBe('')
  })

  it('using one changes the draft as one step and hands over the change, for the reply and its Undo', async () => {
    importFn.mockResolvedValue({ ok: true, brand: named })
    const { hook, used, undo, current } = start()
    await act(() => hook.result.current.run('example.com'))
    const before = current()
    act(() => hook.result.current.useSuggestion('name'))
    hook.rerender()
    expect(current().headerName).toBe('Northwind')
    expect(current().workspaceName).toBe('Acme Corp')
    expect(used).toHaveBeenCalledWith(before, current())
    expect(hook.result.current.suggestions[0]).toMatchObject({ key: 'name', used: true })
    // The editor's undo offers it again: used is read from the draft.
    undo()
    expect(hook.result.current.suggestions[0]).toMatchObject({ key: 'name', used: false })
    // Using what is already used does nothing.
    act(() => hook.result.current.useSuggestion('name'))
    hook.rerender()
    used.mockClear()
    act(() => hook.result.current.useSuggestion('name'))
    expect(used).not.toHaveBeenCalled()
  })

  it('lists them under the rows, each with a Use button; a used one says so', () => {
    const onUse = vi.fn()
    const state = {
      status: 'done' as const,
      host: 'example.com',
      brand: named,
      before: draftFromLoaded(loaded),
      undone: [],
      preTicked: false,
    }
    render(
      <ImportSection
        state={state}
        onRun={vi.fn()}
        onUndoRow={vi.fn()}
        onUploadWide={vi.fn()}
        onUploadFont={vi.fn()}
        suggestions={[
          { key: 'name', label: 'Name', text: 'Northwind, now Acme Corp', used: false },
          { key: 'welcome', label: 'Welcome line', text: 'Tell us more.', used: true },
        ]}
        onUseSuggestion={onUse}
      />
    )
    const block = screen.getByRole('group', { name: 'Suggestions' })
    expect(block).toHaveTextContent('Northwind, now Acme Corp')
    fireEvent.click(screen.getByRole('button', { name: 'Use the suggested name' }))
    expect(onUse).toHaveBeenCalledWith('name')
    expect(screen.queryByRole('button', { name: 'Use the suggested welcome line' })).toBeNull()
    expect(block).toHaveTextContent('Used')
    // No badges on the new rows.
    expect(screen.queryByText('New')).toBeNull()
    expect(screen.getByText('Text font')).toBeInTheDocument()
    expect(screen.getByText('Headings')).toBeInTheDocument()
    expect(screen.getByText('Cards')).toBeInTheDocument()
  })

  it('shows no block when there is nothing to suggest', () => {
    render(
      <ImportSection
        state={{ status: 'idle' }}
        onRun={vi.fn()}
        onUndoRow={vi.fn()}
        onUploadWide={vi.fn()}
        onUploadFont={vi.fn()}
        suggestions={[]}
      />
    )
    expect(screen.queryByRole('group', { name: 'Suggestions' })).toBeNull()
  })
})

describe('the website field', () => {
  it('gives a neutral example', () => {
    render(
      <ImportSection
        state={{ status: 'idle' }}
        onRun={vi.fn()}
        onUndoRow={vi.fn()}
        onUploadWide={vi.fn()}
        onUploadFont={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Your website')).toHaveAttribute(
      'placeholder',
      'Your website, like example.com'
    )
  })
})
