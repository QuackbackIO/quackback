// @vitest-environment happy-dom
/**
 * <CopilotPanel>: the Quinn Copilot sidebar thread (COPILOT-SIDEBAR-UX.md
 * B.3/B.4). Covers the ask -> stream -> answer flow, the internal-source
 * leak gate on "Add to composer", the answerType button precedence (draft_reply
 * keeps "Add to composer" primary; analysis promotes "Add as note" and demotes
 * the composer), the Answer-sources popover (flag-gated rows, localStorage
 * persistence, sourceTypes on the request), the placeholder swap, and "New chat".
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
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

const hoisted = vi.hoisted(() => ({
  saveCopilotAnswerAsMacroFn: vi.fn(),
  summarizeConversationNowFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  getAssistantPendingActionFn: vi.fn(),
  approveAssistantActionFn: vi.fn(),
  rejectAssistantActionFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/macros', () => ({
  saveCopilotAnswerAsMacroFn: hoisted.saveCopilotAnswerAsMacroFn,
}))
vi.mock('@/lib/server/functions/copilot-summary', () => ({
  summarizeConversationNowFn: hoisted.summarizeConversationNowFn,
}))
vi.mock('@/lib/server/functions/assistant-pending-actions', () => ({
  getAssistantPendingActionFn: hoisted.getAssistantPendingActionFn,
}))
vi.mock('@/lib/server/functions/assistant-actions', () => ({
  approveAssistantActionFn: hoisted.approveAssistantActionFn,
  rejectAssistantActionFn: hoisted.rejectAssistantActionFn,
}))
vi.mock('sonner', () => ({
  toast: { success: hoisted.toastSuccess, error: hoisted.toastError },
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
    getComposerText: () => string
    onReplaceComposerText: (t: string) => void
  }> = {}
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onInsert = props.onInsert ?? vi.fn()
  const onReplaceComposerText = props.onReplaceComposerText ?? vi.fn()
  render(
    <QueryClientProvider client={client}>
      <CopilotPanel
        item={{ kind: 'conversation', id: CONVERSATION_ID }}
        flags={props.flags ?? ALL_FLAGS_ON}
        onInsert={onInsert}
        getComposerText={props.getComposerText ?? (() => '')}
        onReplaceComposerText={onReplaceComposerText}
      />
    </QueryClientProvider>
  )
  return { onInsert, onReplaceComposerText }
}

function transformSseFrames(text: string): string {
  return sseFrame('transform.v1.delta', { text }) + sseFrame('transform.v1.final', { text })
}

/** Route fetch by URL: the ask/copilot endpoint and the transform endpoint
 *  stream independently in the real app (separate useSseTurn instances), so
 *  tests that exercise both in one flow need a fetch mock that branches. */
function stubFetchByUrl(responses: { copilot?: string; transform?: string }) {
  const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
    if (url.includes('/transform') && responses.transform !== undefined) {
      return Promise.resolve(mockStreamingResponse(responses.transform))
    }
    if (responses.copilot !== undefined) {
      return Promise.resolve(mockStreamingResponse(responses.copilot))
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
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

function proposedActionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assistant_action_1',
    conversationId: CONVERSATION_ID,
    involvementId: null,
    toolName: 'end_conversation',
    args: {},
    summary: 'Close the conversation',
    status: 'proposed',
    proposedAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2026-07-02T00:00:00.000Z',
    decidedById: null,
    decidedAt: null,
    executedAt: null,
    result: null,
    ...overrides,
  }
}

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

describe('<CopilotPanel> answerType button precedence', () => {
  async function askWithAnswerType(answerType: 'draft_reply' | 'analysis') {
    const frames = sseFrame(COPILOT_EVENTS.final, {
      text: 'The customer is writing in Swedish.',
      citations: [],
      internalSourced: false,
      answerType,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStreamingResponse(frames)))
    const onInsert = vi.fn()
    renderPanel({ onInsert })
    await ask('What language is he speaking?')
    await screen.findByText(/writing in Swedish/)
    return onInsert
  }

  it('draft_reply keeps "Add to composer" as the primary action', async () => {
    await askWithAnswerType('draft_reply')

    // The visible primary button (not a menu item) is Add to composer.
    expect(screen.getByRole('button', { name: /add to composer/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add as note' })).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('analysis promotes "Add as note" to primary and inserts as a note directly', async () => {
    const onInsert = await askWithAnswerType('analysis')

    // Primary button is now Add as note; there is no primary Add to composer.
    const primary = screen.getByRole('button', { name: 'Add as note' })
    expect(primary).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^add to composer$/i })).not.toBeInTheDocument()

    fireEvent.click(primary)
    expect(onInsert).toHaveBeenCalledWith('The customer is writing in Swedish.', 'note')
    vi.unstubAllGlobals()
  })

  it('analysis demotes "Add to composer" into the "..." menu (no tone-rewrite rows)', async () => {
    const onInsert = await askWithAnswerType('analysis')

    fireEvent.pointerDown(screen.getByRole('button', { name: /more answer actions/i }), {
      button: 0,
    })

    // Add to composer is available as the demoted escape hatch...
    const demoted = await screen.findByRole('menuitem', { name: /add to composer/i })
    expect(demoted).toBeInTheDocument()
    // ...but the customer-reply tone rewrites are gone (noise on analysis).
    expect(screen.queryByText('Add to composer & modify')).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'More friendly' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Save as macro' })).toBeInTheDocument()

    fireEvent.click(demoted)
    expect(onInsert).toHaveBeenCalledWith('The customer is writing in Swedish.', 'reply')
    vi.unstubAllGlobals()
  })
})

describe('<CopilotPanel> "Add to composer & modify" menu', () => {
  async function askAndOpenModifyMenu(internalSourced: boolean) {
    const copilotFrames = sseFrame(COPILOT_EVENTS.final, {
      text: 'Here is the original answer.',
      citations: internalSourced
        ? [{ type: 'snippet', id: 'snippet_1', title: 'Internal note', url: '', internal: true }]
        : [],
      internalSourced,
    })
    const fetchMock = stubFetchByUrl({
      copilot: copilotFrames,
      transform: transformSseFrames('Here is the FRIENDLIER answer.'),
    })
    const onInsert = vi.fn()
    renderPanel({ onInsert })
    await ask('What should I do?')
    await screen.findByText(/Here is the original answer/)

    fireEvent.pointerDown(screen.getByRole('button', { name: /more answer actions/i }), {
      button: 0,
    })
    expect(await screen.findByText('Add to composer & modify')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'More friendly' }))

    return { onInsert, fetchMock }
  }

  it('lists the tone rows under the "Add to composer & modify" header, above Add as note / Save as macro', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const frames = sseFrame(COPILOT_EVENTS.final, {
      text: 'Answer.',
      citations: [],
      internalSourced: false,
    })
    stubFetchByUrl({ copilot: frames })
    renderPanel()
    await ask('Question?')
    await screen.findByText('Answer.')

    fireEvent.pointerDown(screen.getByRole('button', { name: /more answer actions/i }), {
      button: 0,
    })

    expect(await screen.findByText('Add to composer & modify')).toBeInTheDocument()
    for (const label of ['My tone of voice', 'More friendly', 'More formal', 'More concise']) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('menuitem', { name: 'Add as note' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Save as macro' })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('streams the transform then inserts directly when the source answer is not internal', async () => {
    const { onInsert, fetchMock } = await askAndOpenModifyMenu(false)

    await waitFor(() => {
      expect(onInsert).toHaveBeenCalledWith('Here is the FRIENDLIER answer.', 'reply')
    })
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/transform'))).toBe(true)
    vi.unstubAllGlobals()
  })

  it('routes the TRANSFORMED text through the leak gate when the source answer is internal', async () => {
    const { onInsert } = await askAndOpenModifyMenu(true)

    expect(await screen.findByText('This answer uses internal sources')).toBeInTheDocument()
    expect(onInsert).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /add to composer anyway/i }))
    expect(onInsert).toHaveBeenCalledWith('Here is the FRIENDLIER answer.', 'reply')
    vi.unstubAllGlobals()
  })
})

describe('<CopilotPanel> Format chip', () => {
  it('is disabled with a "Write a draft first" tooltip when the composer is empty', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderPanel({ getComposerText: () => '' })

    const chip = screen.getByRole('button', { name: /^format$/i })
    expect(chip).toBeDisabled()
    expect(chip).toHaveAttribute('title', 'Write a draft first')
  })

  it('is enabled when the composer has a draft', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderPanel({ getComposerText: () => 'A draft reply.' })

    expect(screen.getByRole('button', { name: /^format$/i })).not.toBeDisabled()
  })

  it('streams the transform and replaces the composer content with the final text', async () => {
    const fetchMock = stubFetchByUrl({
      transform: transformSseFrames('Expanded and improved draft.'),
    })
    const { onReplaceComposerText } = renderPanel({ getComposerText: () => 'Short draft.' })

    // Radix DropdownMenuTrigger opens on pointerDown, not click.
    fireEvent.pointerDown(screen.getByRole('button', { name: /^format$/i }), { button: 0 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Expand' }))

    await waitFor(() => {
      expect(onReplaceComposerText).toHaveBeenCalledWith('Expanded and improved draft.')
    })
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/transform'))
    expect(call).toBeDefined()
    const body = JSON.parse((call as [string, RequestInit])[1].body as string)
    expect(body).toEqual({
      conversationId: CONVERSATION_ID,
      text: 'Short draft.',
      transform: 'expand',
    })
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

describe('<CopilotPanel> Save as macro', () => {
  async function askAndGetAnswer(internalSourced = false) {
    const frames = sseFrame(COPILOT_EVENTS.final, {
      text: 'Refunds are processed within 30 days [1].',
      citations: [
        {
          type: 'article',
          id: 'article_1',
          title: 'Refund policy',
          url: 'https://help.example.com/refunds',
        },
      ],
      internalSourced,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStreamingResponse(frames)))
    renderPanel()
    await ask('What is the refund window?')
    await screen.findByText(/Refunds are processed within 30 days/)
  }

  async function openSaveAsMacroDialog() {
    // Radix DropdownMenuTrigger opens on pointerDown, not click.
    fireEvent.pointerDown(screen.getByRole('button', { name: /more answer actions/i }), {
      button: 0,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Save as macro' }))
  }

  it('opens a dialog prefilled with the question and the citation-stripped answer', async () => {
    await askAndGetAnswer()
    await openSaveAsMacroDialog()

    expect(await screen.findByText('Save as macro')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('What is the refund window?')
    expect(screen.getByLabelText('Body')).toHaveValue('Refunds are processed within 30 days.')
    vi.unstubAllGlobals()
  })

  it('shows an internal-source leak note without blocking save', async () => {
    await askAndGetAnswer(true)
    await openSaveAsMacroDialog()

    expect(await screen.findByText(/This answer used internal sources/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled()
    vi.unstubAllGlobals()
  })

  it('shows no leak note for a public answer', async () => {
    await askAndGetAnswer(false)
    await openSaveAsMacroDialog()
    await screen.findByText('Save as macro')

    expect(screen.queryByText(/This answer used internal sources/i)).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('saves the (possibly edited) name and citation-stripped body, then toasts success', async () => {
    hoisted.saveCopilotAnswerAsMacroFn.mockResolvedValue({ id: 'macro_1' })
    await askAndGetAnswer()
    await openSaveAsMacroDialog()
    const nameInput = await screen.findByLabelText('Name')
    fireEvent.change(nameInput, { target: { value: 'Refund window macro' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(hoisted.saveCopilotAnswerAsMacroFn).toHaveBeenCalledWith({
        data: { name: 'Refund window macro', body: 'Refunds are processed within 30 days.' },
      })
    })
    expect(hoisted.toastSuccess).toHaveBeenCalledWith('Macro saved')
    vi.unstubAllGlobals()
  })

  it('shows an error toast when saving fails', async () => {
    hoisted.saveCopilotAnswerAsMacroFn.mockRejectedValue(new Error('Access denied'))
    await askAndGetAnswer()
    await openSaveAsMacroDialog()
    await screen.findByText('Save as macro')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(hoisted.toastError).toHaveBeenCalledWith('Access denied')
    })
    vi.unstubAllGlobals()
  })
})

describe('<CopilotPanel> Summarize chip', () => {
  it('inserts a formatted Question/Summary block as an internal note on success', async () => {
    hoisted.summarizeConversationNowFn.mockResolvedValue({
      question: 'Refund window',
      bullets: ['Customer asked about refunds.', 'Explained the 30-day window.'],
    })
    const onInsert = vi.fn()
    renderPanel({ onInsert })

    fireEvent.click(screen.getByRole('button', { name: /^summarize$/i }))

    await waitFor(() => {
      expect(onInsert).toHaveBeenCalledWith(
        'Question\nRefund window\n\nSummary\n- Customer asked about refunds.\n- Explained the 30-day window.',
        'note'
      )
    })
    expect(hoisted.summarizeConversationNowFn).toHaveBeenCalledWith({
      data: { conversationId: CONVERSATION_ID },
    })
  })

  it('shows an error toast on failure and inserts nothing', async () => {
    hoisted.summarizeConversationNowFn.mockRejectedValue(
      new Error('The assistant is not configured')
    )
    const onInsert = vi.fn()
    renderPanel({ onInsert })

    fireEvent.click(screen.getByRole('button', { name: /^summarize$/i }))

    await waitFor(() => {
      expect(hoisted.toastError).toHaveBeenCalledWith('The assistant is not configured')
    })
    expect(onInsert).not.toHaveBeenCalled()
  })

  it('disables the chip while a copilot answer is streaming', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    )
    renderPanel()
    await ask('Still thinking...')

    expect(screen.getByRole('button', { name: /^summarize$/i })).toBeDisabled()
    vi.unstubAllGlobals()
  })

  it('disables the chip and swaps the label while a summarize is in flight', async () => {
    let resolveSummary: (value: { question: string; bullets: string[] }) => void = () => {}
    hoisted.summarizeConversationNowFn.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSummary = resolve
        })
    )
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /^summarize$/i }))

    const summarizingButton = await screen.findByRole('button', { name: /summarizing/i })
    expect(summarizingButton).toBeDisabled()
    resolveSummary({ question: 'Q', bullets: ['B'] })
  })
})

describe('<CopilotPanel> empty state', () => {
  it('teases act-on-approval with the shield-check bullet', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderPanel()

    expect(screen.getByText('Can take actions for you, with your approval.')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})

describe('<CopilotPanel> proposed actions (P2-C.4)', () => {
  async function askAndGetProposal(overrides: Record<string, unknown> = {}) {
    hoisted.getAssistantPendingActionFn.mockResolvedValue(proposedActionRow(overrides))
    const frames = sseFrame(COPILOT_EVENTS.final, {
      text: "I've proposed closing this conversation for you.",
      citations: [],
      internalSourced: false,
      proposedActions: [
        {
          id: 'assistant_action_1',
          toolName: 'end_conversation',
          summary: 'Close the conversation',
          label: 'End conversation',
        },
      ],
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStreamingResponse(frames)))
    renderPanel()
    await ask('Can you close this out?')
    await screen.findByText("I've proposed closing this conversation for you.")
    // Wait for the card's own pending-action query to resolve (a separate
    // fetch from the SSE turn above) so callers can click Approve/Reject
    // immediately without racing "Checking status…".
    await screen.findByRole('button', { name: /approve/i })
  }

  it('renders a proposal card with the tool label, summary, and Approve/Reject', async () => {
    await askAndGetProposal()

    expect(await screen.findByText('End conversation')).toBeInTheDocument()
    expect(screen.getByText('Close the conversation')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('renders nothing extra when the turn proposed no actions', async () => {
    const frames = sseFrame(COPILOT_EVENTS.final, {
      text: 'Just an answer, nothing proposed.',
      citations: [],
      internalSourced: false,
      proposedActions: [],
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStreamingResponse(frames)))
    renderPanel()
    await ask('Anything to propose?')
    await screen.findByText('Just an answer, nothing proposed.')

    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('approving calls the gated server fn and swaps to the executed state with a result summary', async () => {
    await askAndGetProposal()
    hoisted.approveAssistantActionFn.mockResolvedValue(
      proposedActionRow({ status: 'executed', result: { note: 'Closed as resolved.' } })
    )

    await userEvent.click(screen.getByRole('button', { name: /approve/i }))

    await waitFor(() =>
      expect(hoisted.approveAssistantActionFn).toHaveBeenCalledWith({
        data: { pendingActionId: 'assistant_action_1' },
      })
    )
    expect(await screen.findByText('Closed as resolved.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('falls back to a generic executed label when the result carries no recognizable summary', async () => {
    await askAndGetProposal()
    hoisted.approveAssistantActionFn.mockResolvedValue(
      proposedActionRow({ status: 'executed', result: null })
    )

    await userEvent.click(screen.getByRole('button', { name: /approve/i }))

    expect(await screen.findByText('Approved and executed')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('rejecting calls the gated server fn and swaps to the rejected state', async () => {
    await askAndGetProposal()
    hoisted.rejectAssistantActionFn.mockResolvedValue(proposedActionRow({ status: 'rejected' }))

    await userEvent.click(screen.getByRole('button', { name: /reject/i }))

    await waitFor(() =>
      expect(hoisted.rejectAssistantActionFn).toHaveBeenCalledWith({
        data: { pendingActionId: 'assistant_action_1' },
      })
    )
    expect(await screen.findByText('Rejected')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('shows a failed execution with the settled error', async () => {
    await askAndGetProposal()
    hoisted.approveAssistantActionFn.mockResolvedValue(
      proposedActionRow({ status: 'failed', result: { error: 'boom' } })
    )

    await userEvent.click(screen.getByRole('button', { name: /approve/i }))

    expect(await screen.findByText('boom')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('shows the friendly permission message on a 403, leaving the buttons usable', async () => {
    await askAndGetProposal()
    const forbidden = Object.assign(
      new Error("Approving this action requires the 'x' permission"),
      {
        statusCode: 403,
        code: 'ASSISTANT_ACTION_PERMISSION_DENIED',
      }
    )
    hoisted.approveAssistantActionFn.mockRejectedValue(forbidden)

    await userEvent.click(screen.getByRole('button', { name: /approve/i }))

    expect(
      await screen.findByText('You do not have permission to approve this action.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('shows the raw message for a non-permission error (e.g. already decided)', async () => {
    await askAndGetProposal()
    hoisted.approveAssistantActionFn.mockRejectedValue(
      new Error('This request was already decided or has expired')
    )

    await userEvent.click(screen.getByRole('button', { name: /approve/i }))

    expect(
      await screen.findByText('This request was already decided or has expired')
    ).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('refetches and settles to the terminal state on a 409-style "already decided" error (C1)', async () => {
    await askAndGetProposal()
    // The proposal was actually decided (e.g. by another teammate, or swept
    // expired) by the time this approve call lands; the mock's next
    // resolved value simulates the now-current server truth a refetch sees.
    hoisted.approveAssistantActionFn.mockRejectedValue(
      new Error('This request was already decided or has expired')
    )
    hoisted.getAssistantPendingActionFn.mockResolvedValue(proposedActionRow({ status: 'expired' }))

    await userEvent.click(screen.getByRole('button', { name: /approve/i }))

    expect(
      await screen.findByText('This request was already decided or has expired')
    ).toBeInTheDocument()
    // usePendingActionDecision's on-error invalidateQueries refetches, so the
    // stale "proposed" buttons are replaced by the real terminal state
    // instead of staying clickable — the fix this hook exists for.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    )
    expect(await screen.findByText('Expired')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
