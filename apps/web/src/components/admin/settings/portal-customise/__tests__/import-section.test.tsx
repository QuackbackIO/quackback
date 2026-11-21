// @vitest-environment happy-dom
/**
 * Import your brand: a website in, the draft filled as one step, a row per
 * result with its own Undo; refusals shown as written; nothing published.
 */
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrandImport, SiteNotRead } from '@/lib/shared/theme/brand-import'
import type { ImportState } from '../import-section'
import type { ImportRowKey } from '../brand-apply'
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

const { ImportSection, useBrandImport, importSummary, importStatusLine } =
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

  it('applies the logo and icon at once with the colours, whatever the portal’s domain', async () => {
    for (const portalOnSite of [false, true]) {
      importFn.mockResolvedValue({ ok: true, brand: { ...assets, portalOnSite } })
      const { hook, steps, current } = setup()
      await act(() => hook.result.current.run('example.com'))
      expect(steps).toHaveLength(1)
      expect(current().logo).toMatchObject({
        wideKey: 'header-logos/a.svg',
        icon: { key: icon.key },
      })
      expect(draftPalette(current(), 'light').primary).toBe('#533afd')
      expect(importStatusLine(doneState(hook))).toBe('From example.com · 6 applied')
      cleanup()
    }
  })

  it('takes an asset back with its row’s Undo, as any other row', async () => {
    importFn.mockResolvedValue({ ok: true, brand: assets })
    const { hook, steps, current } = setup()
    await act(() => hook.result.current.run('example.com'))
    act(() => hook.result.current.undoRow('logo'))
    expect(steps).toHaveLength(2)
    expect(current().logo).toMatchObject({ wideKey: null, icon: { key: icon.key } })
    expect(doneState(hook).undone).toEqual(['logo'])
  })

  it('drops assets the person would not confirm as one step, and hands back the new draft', async () => {
    importFn.mockResolvedValue({ ok: true, brand: assets })
    const { hook, steps, current, base } = setup()
    await act(() => hook.result.current.run('example.com'))
    let next: PortalDraft | undefined
    act(() => {
      next = hook.result.current.dropAssets(['logo', 'icon'])
    })
    expect(steps).toHaveLength(2)
    expect(next).toBe(current())
    expect(current().logo).toEqual(base.logo)
    expect(draftPalette(current(), 'light').primary).toBe('#533afd')
    expect(doneState(hook).undone).toEqual(['logo', 'icon'])
    // A publish of that draft carries no imported asset.
    const input = publishInput(base, current(), publishedFromLoaded(loaded))!
    expect(input.logo).toBeUndefined()
    // Nothing to drop: no step, and the draft as it is.
    act(() => {
      next = hook.result.current.dropAssets([])
    })
    expect(steps).toHaveLength(2)
    expect(next).toBe(current())
  })

  it('follows the editor’s undo after Undo import: everything reads back in', async () => {
    // Every row changes something here (Lora, not the Inter the draft has), so each reads back in.
    importFn.mockResolvedValue({
      ok: true,
      brand: { ...assets, font: { site: 'Brand Sans', id: 'lora', exact: false } },
    })
    const { hook, current, editorUndo } = setup()
    await act(() => hook.result.current.run('example.com'))
    const line = () => importStatusLine(doneState(hook))
    const beforeUndo = line()
    act(() => hook.result.current.undoAll())
    expect(line()).toContain('nothing applied')
    act(() => editorUndo())
    expect(doneState(hook).undone).toEqual([])
    expect(line()).toBe(beforeUndo)
    expect(current().logo.wideKey).toBe('header-logos/a.svg')
  })

  it('reads a row back in after the editor’s undo of its own Undo', async () => {
    importFn.mockResolvedValue({ ok: true, brand })
    const { hook, editorUndo } = setup()
    await act(() => hook.result.current.run('example.com'))
    act(() => hook.result.current.undoRow('primary'))
    expect(doneState(hook).undone).toEqual(['primary'])
    act(() => editorUndo())
    expect(doneState(hook).undone).toEqual([])
    // Its Undo answers again: taking it back is a step.
    act(() => hook.result.current.undoRow('primary'))
    expect(doneState(hook).undone).toEqual(['primary'])
  })

  it('keeps the last finished import for Publish while another is read or refused', async () => {
    importFn.mockResolvedValue({ ok: true, brand: assets })
    const { hook } = setup()
    expect(hook.result.current.importedBrand).toBeNull()
    await act(() => hook.result.current.run('example.com'))
    expect(hook.result.current.importedBrand).toBe(assets)
    importFn.mockResolvedValue({ ok: false, code: 'X', message: 'Could not read it.' })
    await act(() => hook.result.current.run('typo.example'))
    expect(hook.result.current.state.status).toBe('refused')
    // Its logo and icon are still in the draft, so Publish still asks about them.
    expect(hook.result.current.importedBrand).toBe(assets)
  })

  it('a refused read between two imports still lets the next one replace the last', async () => {
    importFn.mockResolvedValue({ ok: true, brand: assets })
    const { hook, current, base } = setup()
    await act(() => hook.result.current.run('example.com'))
    importFn.mockResolvedValue({ ok: false, code: 'X', message: 'Could not read it.' })
    await act(() => hook.result.current.run('typo.example'))
    const plain: BrandImport = {
      ...brand,
      host: 'plain.example',
      logo: undefined,
      missing: ['logo'],
    }
    importFn.mockResolvedValue({ ok: true, brand: plain })
    await act(() => hook.result.current.run('plain.example'))
    // The first site's logo and icon are taken back, not left behind unrecognised.
    expect(current().logo).toEqual(base.logo)
    expect(hook.result.current.importedBrand).toBe(plain)
  })

  it('takes the whole import back as one step, and keeps the results listed', async () => {
    importFn.mockResolvedValue({ ok: true, brand: assets })
    const { hook, steps, current, base } = setup()
    await act(() => hook.result.current.run('example.com'))
    act(() => hook.result.current.undoRow('primary'))
    act(() => hook.result.current.undoAll())
    expect(steps).toHaveLength(3)
    expect(current()).toEqual(base)
    expect(doneState(hook).undone).toEqual(['primary', 'logo', 'icon', 'page', 'font', 'shape'])
    // Nothing left to take back: no step.
    act(() => hook.result.current.undoAll())
    expect(steps).toHaveLength(3)
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
      })
    ).toBe('From example.com')
  })
})

describe('ImportSection', () => {
  const doneWith = (over: Partial<Extract<ImportState, { status: 'done' }>> = {}) => ({
    status: 'done' as const,
    host: 'example.com',
    brand,
    before: { logo: { wideKey: null, mode: 'logo_and_name', icon: null } } as never,
    undone: [],
    ...over,
  })

  it('submits the address, then leads the results with one line and one Undo import', async () => {
    const onRun = vi.fn()
    const onUndoRow = vi.fn()
    const onUndoAll = vi.fn()
    const onUploadFont = vi.fn()
    const props = { onRun, onUndoRow, onUndoAll, onUploadWide: vi.fn(), onUploadFont }
    const { rerender } = render(<ImportSection state={{ status: 'idle' }} {...props} />)
    fireEvent.change(screen.getByLabelText('Your website'), { target: { value: 'example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(onRun).toHaveBeenCalledWith('example.com')
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()

    rerender(<ImportSection state={{ status: 'reading', host: 'example.com' }} {...props} />)
    // One status region, there before the read, says each stage once.
    expect(status).toBe(screen.getByRole('status'))
    expect(status).toHaveTextContent('Reading example.com…')
    expect(screen.getAllByText(/Reading example\.com/)).toHaveLength(1)

    rerender(<ImportSection state={doneWith({ undone: ['shape'] })} {...props} />)
    expect(status).toBe(screen.getByRole('status'))
    // Four rows still in the draft (logo, main colour, page and font); the shape was taken back.
    expect(status).toHaveTextContent('Found. From example.com · 4 applied')
    // After an import the field gives way to the result, with nothing greyed out.
    expect(screen.queryByLabelText('Your website')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Undo import' }))
    expect(onUndoAll).toHaveBeenCalledOnce()

    // Each row's own Undo stays, quieter, the logo's too; the shape was taken back.
    expect(screen.getByText('#533afd')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Undo [A-Z]/ })).toHaveLength(4)
    expect(screen.getByText('Undone')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo Main colour' }))
    expect(onUndoRow).toHaveBeenCalledWith('primary')
    fireEvent.click(screen.getByRole('button', { name: 'Upload Brand Sans' }))
    expect(onUploadFont).toHaveBeenCalledWith('Brand Sans')
    // The main colour as a swatch with its exact value.
    expect(screen.getByTitle('#533afd')).toHaveStyle({ backgroundColor: '#533afd' })

    // Import another brings the field back, empty and ready.
    fireEvent.click(screen.getByRole('button', { name: 'Import another website' }))
    expect(screen.getByLabelText('Your website')).toHaveValue('')
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
    expect(screen.getByRole('status')).toHaveTextContent('Reading example.com…')
  })

  describe('the brand assets: applied, each with its Undo', () => {
    const icon = { key: 'logos/n.png', faviconKey: 'favicons/n.png', url: '/n.png' }
    const files = [{ key: 'fonts/s.woff2', weight: 400, style: 'normal' as const }]
    const show = (over: Partial<BrandImport>, undone: ImportRowKey[] = [], onUndoRow = vi.fn()) => {
      render(
        <ImportSection
          state={doneWith({ brand: { ...brand, ...over }, undone })}
          onRun={vi.fn()}
          onUndoRow={onUndoRow}
          onUploadWide={vi.fn()}
          onUploadFont={vi.fn()}
        />
      )
      return onUndoRow
    }

    it('shows the logo and icon as thumbnails, applied, with no Use to press', () => {
      const siteFont = { family: 'Brand Sans', licence: 'commercial' as const, files }
      const onUndoRow = show({ icon, siteFont })
      const images = document.querySelectorAll('img')
      expect([...images].map((img) => img.getAttribute('src'))).toEqual([
        '/api/storage/header-logos/a.svg',
        '/n.png',
      ])
      expect(screen.queryByRole('button', { name: /^Use / })).toBeNull()
      expect(screen.queryByText(/licence/)).toBeNull()
      expect(screen.getByText('Brand Sans, from the site')).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('From example.com · 6 applied')
      fireEvent.click(screen.getByRole('button', { name: 'Undo Logo' }))
      expect(onUndoRow).toHaveBeenCalledWith('logo')
      fireEvent.click(screen.getByRole('button', { name: 'Undo Text font' }))
      expect(onUndoRow).toHaveBeenCalledWith('font')
    })

    it('says Undone on an asset taken back, with no Undo left on it', () => {
      show({ icon }, ['icon'])
      expect(screen.queryByRole('button', { name: 'Undo Icon' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Undo Logo' })).toBeInTheDocument()
      expect(screen.getByText('Undone')).toBeInTheDocument()
    })

    it('offers Upload when the site gave no logo', () => {
      show({ logo: undefined, missing: ['logo', 'icon'] })
      expect(screen.queryByRole('button', { name: 'Undo Logo' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument()
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
