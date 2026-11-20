// @vitest-environment happy-dom
/**
 * The Ask dock: a sentence in, the draft changed as one step with a plain
 * reply and Undo. Plain requests are answered here without the server; the
 * rest go to Ask on the server, which may also run Import or step back.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { draftFromLoaded, type PortalDraft } from '../portal-draft'

const { askFn, track } = vi.hoisted(() => ({ askFn: vi.fn(), track: vi.fn() }))
vi.mock('@/lib/server/functions/portal-customise', () => ({
  askPortalCustomiseFn: (args: unknown) => askFn(args),
}))
vi.mock('@/lib/client/analytics', () => ({ track: (...args: unknown[]) => track(...args) }))

const { AskDock } = await import('../ask-dock')

function setup(props: Partial<Parameters<typeof AskDock>[0]> = {}) {
  let draft: PortalDraft = draftFromLoaded({
    theme: { themeMode: 'user', light: { radius: '0.5rem' }, dark: { radius: '0.5rem' } },
    customCss: '',
    portal: {} as never,
    helpCenter: null,
  })
  const start = draft
  const steps: PortalDraft[] = []
  const handlers = {
    update: vi.fn((edit: (d: PortalDraft) => PortalDraft) => {
      draft = edit(draft)
      steps.push(draft)
    }),
    undo: vi.fn(() => {
      steps.pop()
      draft = steps.at(-1) ?? start
    }),
    onImport: vi.fn(),
    onChanged: vi.fn(),
  }
  const dock = () => (
    <AskDock getDraft={() => draft} page="feedback" importDone={false} {...handlers} {...props} />
  )
  const { rerender } = render(dock())
  return {
    handlers,
    steps,
    current: () => draft,
    /** A change made by hand in a section: the draft moves on and the editor renders again. */
    handEdit: (edit: (d: PortalDraft) => PortalDraft) => {
      handlers.update(edit)
      rerender(dock())
    },
  }
}

async function ask(text: string) {
  fireEvent.change(screen.getByLabelText('Ask for a change'), { target: { value: text } })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  })
}

afterEach(() => {
  cleanup()
  askFn.mockReset()
  track.mockReset()
})

describe('AskDock', () => {
  it('answers a plain request here, as one step, with Undo', async () => {
    const { steps, current, handlers } = setup()
    await ask('make the buttons less rounded')
    expect(askFn).not.toHaveBeenCalled()
    expect(steps).toHaveLength(1)
    // Pill buttons become buttons that follow the corners.
    expect(current().buttonShape).toBe('corners')
    expect(track).toHaveBeenCalledWith('portal_ask', { handled: 'local' })
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(handlers.undo).toHaveBeenCalledOnce()
  })

  it('sends the rest to the server with the draft summary, never its CSS', async () => {
    askFn.mockResolvedValue({
      outcome: 'patch',
      handled: 'model',
      patch: { buttonShape: 'corners' },
      reply: 'Buttons match the corners now.',
    })
    const { current } = setup()
    await ask('make it feel calmer')
    const sent = askFn.mock.calls[0]![0] as {
      data: { request: string; draft: unknown; page: string }
    }
    expect(sent.data.request).toBe('make it feel calmer')
    expect(sent.data.page).toBe('feedback')
    expect(JSON.stringify(sent.data.draft)).not.toContain(':root')
    expect(current().buttonShape).toBe('corners')
    // The reply is what changed in the draft, not the server's sentence.
    expect(screen.getByText('Buttons have softly rounded corners')).toBeInTheDocument()
    expect(screen.queryByText('Buttons match the corners now.')).toBeNull()
    expect(track).toHaveBeenCalledWith('portal_ask', { handled: 'model' })
  })

  it('says what changed, with a swatch for each colour, what it adjusted, and one Undo', async () => {
    askFn.mockResolvedValue({
      outcome: 'patch',
      handled: 'model',
      patch: {
        colours: { light: { header: '#0b1f3a' }, dark: { header: '#0b1f3a' } },
        buttonShape: 'corners',
        corners: 0,
      },
      reply: 'Done. Have a look at the preview.',
    })
    const { handlers } = setup()
    await ask('Make the header navy and the buttons square')
    const log = screen.getByRole('log')
    expect(log).toHaveAttribute('aria-live', 'polite')
    const lines = [...log.querySelectorAll('li')].map((li) => li.textContent)
    expect(lines).toEqual(['Header is now navy', 'Corners and buttons are now square'])
    // The exact colour is in the swatch's tooltip, not in the sentence.
    expect(screen.getByTitle('#0b1f3a')).toBeInTheDocument()
    expect(
      screen.getByText("The header's text and tabs are now white so they read on navy.")
    ).toBeInTheDocument()
    expect(screen.queryByText('Done. Have a look at the preview.')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1)

    // The editor hears what changed, for the preview's outlines.
    expect(handlers.onChanged).toHaveBeenCalledOnce()
    expect(handlers.onChanged.mock.calls[0]![0].lines).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(handlers.undo).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(screen.getByText('Undone.')).toBeInTheDocument()
  })

  it('keeps the one Undo on the latest change only', async () => {
    setup()
    await ask('make the buttons less rounded')
    await ask('make the corners less rounded')
    // Two replies, one Undo: the older reply's would take back the newer step.
    expect(screen.getByText('Buttons have softly rounded corners')).toBeInTheDocument()
    expect(screen.getByText('Corners are now slightly rounded')).toBeInTheDocument()
    const undo = screen.getAllByRole('button', { name: 'Undo' })
    expect(undo).toHaveLength(1)
    expect(undo[0]!.closest('div')!.textContent).toContain('Corners are now slightly rounded')
  })

  it('drops its Undo once the draft has moved on by hand', async () => {
    const { handEdit } = setup()
    await ask('make the buttons less rounded')
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1)
    handEdit((d) => ({ ...d, themeMode: 'dark' }))
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(screen.queryByText('Undone.')).toBeNull()
  })

  it('adds no step and offers no Undo when the change is already there', async () => {
    const { steps, handlers } = setup()
    await ask('make the corners less rounded')
    expect(steps).toHaveLength(1)
    askFn.mockResolvedValue({
      outcome: 'patch',
      handled: 'model',
      patch: { corners: 0.25 },
      reply: 'Corners updated.',
    })
    await ask('a touch of rounding on the corners, as now')
    expect(steps).toHaveLength(1)
    expect(handlers.onChanged).toHaveBeenCalledOnce()
    expect(screen.getByText('It already looks that way.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1)
  })

  it('runs Import for a website', async () => {
    askFn.mockResolvedValue({
      outcome: 'import',
      handled: 'model',
      host: 'stripe.com',
      reply: 'Matching stripe.com.',
    })
    const { handlers } = setup()
    await ask('look like our site please')
    expect(handlers.onImport).toHaveBeenCalledWith('stripe.com')
  })

  it('shows a refusal or an unavailable reply as is, changing nothing', async () => {
    askFn.mockResolvedValue({
      outcome: 'unavailable',
      handled: 'refused',
      reply: "Ask isn't available here. You can still change everything in the sections above.",
    })
    const { steps } = setup()
    await ask('make it feel calmer')
    expect(steps).toHaveLength(0)
    expect(screen.getByText(/Ask isn't available here/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('caps a request at 500 characters', () => {
    setup()
    expect(screen.getByLabelText('Ask for a change')).toHaveAttribute('maxLength', '500')
  })

  it('offers suggestions on focus, leaving Import out after an import', () => {
    setup({ importDone: true })
    fireEvent.focus(screen.getByLabelText('Ask for a change'))
    expect(
      screen.getByRole('button', { name: 'Make the buttons less rounded' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Import/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Make the header navy' })).toBeInTheDocument()
  })

  it('draws focus on the box, not on the field inside it', () => {
    setup()
    const field = screen.getByLabelText('Ask for a change')
    expect(field).toHaveAttribute('data-bare-field')
    expect(field.closest('form')!.className).toContain('focus-within:border-ring')
  })
})

describe('a change made elsewhere (a suggestion used)', () => {
  it('is replied to like a chat change: what changed, with the one Undo', () => {
    const { handlers, current, steps } = setup()
    const before = current()
    const after = { ...before, headerName: 'Northwind' }
    handlers.update(() => after)
    cleanup()
    render(
      <AskDock
        getDraft={() => steps.at(-1)!}
        page="feedback"
        importDone
        notice={{ id: 1, before, after }}
        {...handlers}
      />
    )
    expect(screen.getByText('Portal name is now Northwind')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(handlers.undo).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Undone.')).toBeInTheDocument()
  })

  it('says nothing for a notice that changed nothing', () => {
    const { handlers, current } = setup()
    cleanup()
    render(
      <AskDock
        getDraft={current}
        page="feedback"
        importDone
        notice={{ id: 1, before: current(), after: current() }}
        {...handlers}
      />
    )
    expect(screen.queryByRole('log')).toBeNull()
  })
})
