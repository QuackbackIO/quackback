// @vitest-environment happy-dom
/**
 * <CopilotPanel>: the Quinn Copilot sidebar thread (COPILOT-SIDEBAR-UX.md
 * B.3/B.4). Covers the ask -> stream -> answer flow, the internal-source
 * leak gate on "Add to composer", the Answer-sources popover (flag-gated
 * rows, localStorage persistence, sourceTypes on the request), the
 * placeholder swap, and "New chat".
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ConversationId } from '@quackback/ids'
import { COPILOT_EVENTS } from '@/lib/shared/assistant/copilot-contract'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { installInMemoryLocalStorage } from '@/test/local-storage'

// Radix Popover/DropdownMenu rely on pointer/layout APIs happy-dom lacks.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  installInMemoryLocalStorage()
})

afterEach(cleanup)

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => ({ principal: { id: 'principal_1' } }),
}))

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    widgetConfig: () => ({
      queryKey: ['settings', 'widgetConfig'],
      queryFn: async () => ({ messenger: { assistant: { name: 'Quinn', avatarUrl: '' } } }),
    }),
  },
}))

import { CopilotPanel } from '../copilot-panel'

const CONVERSATION_ID = 'conversation_1' as ConversationId

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
}

function mockStreamingResponse(frames: string) {
  return {
    ok: true,
    body: streamOf(frames),
  } as Response
}

const ALL_FLAGS_ON: FeatureFlags = {
  assistantSnippets: true,
  assistantPostGrounding: true,
  assistantConversationGrounding: true,
  assistantCopilot: true,
} as unknown as FeatureFlags

function renderPanel(
  props: Partial<{
    flags: FeatureFlags | undefined
    onInsert: (t: string, m: 'reply' | 'note') => void
  }> = {}
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onInsert = props.onInsert ?? vi.fn()
  render(
    <QueryClientProvider client={client}>
      <CopilotPanel
        conversationId={CONVERSATION_ID}
        flags={props.flags ?? ALL_FLAGS_ON}
        onInsert={onInsert}
      />
    </QueryClientProvider>
  )
  return { onInsert }
}

async function ask(question: string) {
  const textarea = screen.getByPlaceholderText(/ask a (follow-up )?question/i)
  await userEvent.type(textarea, question)
  fireEvent.keyDown(textarea, { key: 'Enter' })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe('<CopilotPanel> ask -> stream -> answer', () => {
  it('streams delta text and renders the final answer with citations', async () => {
    const frames =
      sseFrame(COPILOT_EVENTS.delta, { text: 'The refund ' }) +
      sseFrame(COPILOT_EVENTS.delta, { text: 'window is 30 days.' }) +
      sseFrame(COPILOT_EVENTS.final, {
        text: 'The refund window is 30 days [1].',
        citations: [
          {
            type: 'article',
            id: 'article_1',
            title: 'Refund policy',
            url: 'https://help.example.com/refunds',
          },
        ],
        internalSourced: false,
      })
    const fetchMock = vi.fn().mockResolvedValue(mockStreamingResponse(frames))
    vi.stubGlobal('fetch', fetchMock)

    renderPanel()
    await ask('What is the refund window?')

    expect(await screen.findByText(/The refund window is 30 days/)).toBeInTheDocument()
    expect(screen.getByText('What is the refund window?')).toBeInTheDocument()
    expect(await screen.findByText('1 relevant source')).toBeInTheDocument()

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.conversationId).toBe(CONVERSATION_ID)
    expect(body.question).toBe('What is the refund window?')
    expect(body.sourceTypes).toBeUndefined() // all visible sources checked -> omitted

    vi.unstubAllGlobals()
  })

  it('shows the graceful-miss copy on a suppressed final payload', async () => {
    const frames = sseFrame(COPILOT_EVENTS.final, {
      text: '',
      citations: [],
      internalSourced: false,
      suppressed: 'silence',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStreamingResponse(frames)))

    renderPanel()
    await ask('Anything on this?')

    expect(await screen.findByText(/could not find enough to answer/i)).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('shows a retry affordance on an error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        body: null,
        json: async () => ({
          error: { code: 'AI_NOT_CONFIGURED', message: 'The assistant is not configured' },
        }),
      })
    )

    renderPanel()
    await ask('Hello?')

    expect(await screen.findByText('The assistant is not configured')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('swaps the placeholder from "Ask a question..." to "Ask a follow-up question..." after a turn', async () => {
    const frames = sseFrame(COPILOT_EVENTS.final, {
      text: 'Answer.',
      citations: [],
      internalSourced: false,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStreamingResponse(frames)))

    renderPanel()
    expect(screen.getByPlaceholderText('Ask a question...')).toBeInTheDocument()

    await ask('First question?')
    await screen.findByText('Answer.')

    expect(screen.getByPlaceholderText('Ask a follow-up question...')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('"New chat" clears the thread back to the empty state', async () => {
    const frames = sseFrame(COPILOT_EVENTS.final, {
      text: 'Answer.',
      citations: [],
      internalSourced: false,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStreamingResponse(frames)))

    renderPanel()
    await ask('First question?')
    await screen.findByText('Answer.')

    fireEvent.click(screen.getByRole('button', { name: /new chat/i }))

    expect(screen.queryByText('Answer.')).not.toBeInTheDocument()
    expect(screen.getByText(/Ask Quinn anything about this conversation/)).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})

describe('<CopilotPanel> leak gate', () => {
  async function askAndGetAnswer(internalSourced: boolean) {
    const frames = sseFrame(COPILOT_EVENTS.final, {
      text: 'Here is the internal-flavored answer.',
      citations: [
        { type: 'snippet', id: 'snippet_1', title: 'Internal note', url: '', internal: true },
      ],
      internalSourced,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStreamingResponse(frames)))
    const onInsert = vi.fn()
    renderPanel({ onInsert })
    await ask('What should I do?')
    await screen.findByText(/Here is the internal-flavored answer/)
    return onInsert
  }

  it('opens the confirm dialog on Add to composer when internalSourced is true', async () => {
    const onInsert = await askAndGetAnswer(true)

    fireEvent.click(screen.getByRole('button', { name: /add to composer/i }))

    expect(await screen.findByText('This answer uses internal sources')).toBeInTheDocument()
    expect(onInsert).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('"Add to composer anyway" inserts into the reply composer', async () => {
    const onInsert = await askAndGetAnswer(true)
    fireEvent.click(screen.getByRole('button', { name: /add to composer/i }))
    await screen.findByText('This answer uses internal sources')

    fireEvent.click(screen.getByRole('button', { name: /add to composer anyway/i }))

    expect(onInsert).toHaveBeenCalledWith('Here is the internal-flavored answer.', 'reply')
    vi.unstubAllGlobals()
  })

  it('"Add as note" from the confirm dialog inserts as a note, no further confirm', async () => {
    const onInsert = await askAndGetAnswer(true)
    fireEvent.click(screen.getByRole('button', { name: /add to composer/i }))
    await screen.findByText('This answer uses internal sources')

    fireEvent.click(screen.getByRole('button', { name: 'Add as note' }))

    expect(onInsert).toHaveBeenCalledWith('Here is the internal-flavored answer.', 'note')
    vi.unstubAllGlobals()
  })

  it('inserts directly with no dialog when internalSourced is false', async () => {
    const frames = sseFrame(COPILOT_EVENTS.final, {
      text: 'A plain public answer.',
      citations: [],
      internalSourced: false,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStreamingResponse(frames)))
    const onInsert = vi.fn()
    renderPanel({ onInsert })
    await ask('A public question?')
    await screen.findByText('A plain public answer.')

    fireEvent.click(screen.getByRole('button', { name: /add to composer/i }))

    expect(onInsert).toHaveBeenCalledWith('A plain public answer.', 'reply')
    expect(screen.queryByText('This answer uses internal sources')).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('"Add as note" from the "..." menu always inserts as a note without any confirm', async () => {
    const onInsert = await askAndGetAnswer(true)

    // Radix DropdownMenuTrigger opens on pointerDown, not click.
    fireEvent.pointerDown(screen.getByRole('button', { name: /more answer actions/i }), {
      button: 0,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add as note' }))

    expect(onInsert).toHaveBeenCalledWith('Here is the internal-flavored answer.', 'note')
    expect(screen.queryByText('This answer uses internal sources')).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})

describe('<CopilotPanel> Answer-sources popover', () => {
  it('hides rows whose flag is off', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderPanel({
      flags: {
        assistantSnippets: false,
        assistantPostGrounding: false,
        assistantConversationGrounding: false,
      } as unknown as FeatureFlags,
    })

    fireEvent.click(screen.getByRole('button', { name: /answer sources/i }))

    expect(await screen.findByText('Help center articles')).toBeInTheDocument()
    expect(screen.queryByText('Snippets')).not.toBeInTheDocument()
    expect(screen.queryByText('Roadmap posts')).not.toBeInTheDocument()
    expect(screen.queryByText('Past conversations')).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('persists the selection to localStorage per teammate and sends sourceTypes on the next ask', async () => {
    const frames = sseFrame(COPILOT_EVENTS.final, {
      text: 'Answer.',
      citations: [],
      internalSourced: false,
    })
    const fetchMock = vi.fn().mockResolvedValue(mockStreamingResponse(frames))
    vi.stubGlobal('fetch', fetchMock)

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /answer sources/i }))
    const snippetsRow = await screen.findByText('Snippets')
    fireEvent.click(snippetsRow)

    const stored = window.localStorage.getItem('quackback:copilot-sources:principal_1')
    expect(stored).not.toBeNull()
    expect(JSON.parse(stored as string)).not.toContain('snippet')

    await ask('Question with a narrowed filter')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.sourceTypes).toEqual(expect.arrayContaining(['article', 'post', 'summary']))
    expect(body.sourceTypes).not.toContain('snippet')
    vi.unstubAllGlobals()
  })

  it('keeps at least one source checked (cannot uncheck the last one)', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderPanel({
      flags: {
        assistantSnippets: false,
        assistantPostGrounding: false,
        assistantConversationGrounding: false,
      } as unknown as FeatureFlags,
    })

    fireEvent.click(screen.getByRole('button', { name: /answer sources/i }))
    const articleRow = await screen.findByText('Help center articles')
    // Only one visible row (article) — clicking it should not uncheck it.
    fireEvent.click(articleRow)

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toHaveAttribute('data-state', 'checked')
    vi.unstubAllGlobals()
  })
})
