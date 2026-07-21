// @vitest-environment happy-dom
/**
 * <CopilotPanel>: the Quinn Copilot sidebar thread (COPILOT-SIDEBAR-UX.md
 * B.3/B.4). Covers the ask -> stream -> answer flow, the internal-source
 * leak gate on "Add to composer", the answerType button precedence (draft_reply
 * keeps "Add to composer" primary; analysis is read-only text with the
 * composer demoted to the "..." menu), the footer quick actions, the
 * Answer-sources popover (flag-gated rows, localStorage persistence,
 * sourceTypes on the request), the placeholder swap, and "New chat".
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ConversationId } from '@quackback/ids'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { installInMemoryLocalStorage } from '@/test/local-storage'
import { aguiRun, structuredDeltas, mockStreamingResponse } from '@/test/agui'

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

const hoisted = vi.hoisted(() => ({
  saveCopilotAnswerAsMacroFn: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  getAssistantPendingActionFn: vi.fn(),
  approveAssistantActionFn: vi.fn(),
  rejectAssistantActionFn: vi.fn(),
  recordCopilotEvent: vi.fn(),
  // Mutable so the configured-name test can swap the assistant's name.
  widgetConfig: { messenger: { assistant: { name: 'Quinn', avatarUrl: '' } } },
}))

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    widgetConfig: () => ({
      queryKey: ['settings', 'widgetConfig'],
      queryFn: async () => hoisted.widgetConfig,
    }),
  },
}))

vi.mock('@/lib/client/copilot-events', async () => ({
  recordCopilotEvent: hoisted.recordCopilotEvent,
  itemRefBody: (await import('@/test/copilot')).mockItemRefBody,
}))

vi.mock('@/lib/server/functions/macros', () => ({
  saveCopilotAnswerAsMacroFn: hoisted.saveCopilotAnswerAsMacroFn,
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

const ALL_FLAGS_ON: FeatureFlags = {
  inboxAi: true,
} as unknown as FeatureFlags

function renderPanel(
  props: Partial<{
    flags: FeatureFlags | undefined
    onInsert: (t: string) => void
  }> = {}
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onInsert = props.onInsert ?? vi.fn()
  render(
    <QueryClientProvider client={client}>
      <CopilotPanel
        item={{ kind: 'conversation', id: CONVERSATION_ID }}
        flags={props.flags ?? ALL_FLAGS_ON}
        onInsert={onInsert}
      />
    </QueryClientProvider>
  )
  return { onInsert }
}

/** A full transform AG-UI run: the rewritten text on RUN_FINISHED.result
 *  ({ text }), the shape useCopilotTransform's ChatClient reads. */
function transformRun(text: string): string {
  return aguiRun({ result: { text } })
}

/** Route fetch by URL: the ask/copilot endpoint (useAguiTurn) and the transform
 *  endpoint (useCopilotTransform's ChatClient) stream independently in the real
 *  app, so tests that exercise both in one flow need a fetch mock that branches. */
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

const DEFAULT_ANSWER = 'A public answer.'

/** The single completed-turn builder every describe shares: a full AG-UI run
 *  whose terminal RUN_FINISHED.result carries the CopilotFinalPayload, any
 *  field overridable per test. */
function finalFrame(overrides: Record<string, unknown> = {}) {
  return aguiRun({
    result: {
      text: DEFAULT_ANSWER,
      citations: [],
      internalSourced: false,
      answerType: 'draft_reply',
      ...overrides,
    },
  })
}

/** Substring matcher for an answer's rendered text — citation markers render
 *  as dots, so match the prefix before the first `[n]`. */
function answerMatcher(text: string): RegExp {
  const head = text.split('[')[0].trim()
  return new RegExp(head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
}

/** The single ask-flow helper every describe shares: stub fetch with one
 *  finalFrame turn, render the panel, ask, and wait for the answer to land.
 *  Returns the host-composer insert spy. */
async function askAnswer(final: Record<string, unknown> = {}, question = 'Question?') {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStreamingResponse(finalFrame(final))))
  const onInsert = vi.fn()
  renderPanel({ onInsert })
  await ask(question)
  await screen.findByText(answerMatcher((final.text as string) ?? DEFAULT_ANSWER))
  return onInsert
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  hoisted.widgetConfig = { messenger: { assistant: { name: 'Quinn', avatarUrl: '' } } }
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
    const frames = aguiRun({
      // The streamed model chunks are raw structured JSON; the panel diffs the
      // prose out of the partial parse's `text` field.
      middle: structuredDeltas({ text: 'The refund window is 30 days [1].' }),
      result: {
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
      },
    })
    const fetchMock = vi.fn().mockResolvedValue(mockStreamingResponse(frames))
    vi.stubGlobal('fetch', fetchMock)

    renderPanel()
    await ask('What is the refund window?')

    expect(await screen.findByText(/The refund window is 30 days/)).toBeInTheDocument()
    expect(screen.getByText('What is the refund window?')).toBeInTheDocument()
    expect(await screen.findByText('1 relevant source')).toBeInTheDocument()

    // The question rides the AG-UI messages; the item ref rides forwardedProps.
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.forwardedProps.conversationId).toBe(CONVERSATION_ID)
    expect((body.messages as Array<{ content: string }>).at(-1)?.content).toBe(
      'What is the refund window?'
    )
    expect(body.forwardedProps.sourceTypes).toBeUndefined() // all visible sources checked -> omitted

    vi.unstubAllGlobals()
  })

  it('shows the graceful-miss copy on a suppressed final payload', async () => {
    const frames = aguiRun({
      result: { text: '', citations: [], internalSourced: false, suppressed: 'silence' },
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
    const frames = aguiRun({ result: { text: 'Answer.', citations: [], internalSourced: false } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStreamingResponse(frames)))

    renderPanel()
    expect(screen.getByPlaceholderText('Ask a question...')).toBeInTheDocument()

    await ask('First question?')
    await screen.findByText('Answer.')

    expect(screen.getByPlaceholderText('Ask a follow-up question...')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('the empty-state Catch me up card sends the canned summarize question as a normal turn', async () => {
    const frames = aguiRun({
      result: { text: 'Summary of the thread.', citations: [], internalSourced: false },
    })
    const fetchMock = vi.fn().mockResolvedValue(mockStreamingResponse(frames))
    vi.stubGlobal('fetch', fetchMock)

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /catch me up/i }))

    // The canned question renders as the user bubble; the answer streams in
    // with the same affordances as any other ask.
    expect(
      await screen.findByText('Summarize this conversation and highlight the key points')
    ).toBeInTheDocument()
    expect(await screen.findByText('Summary of the thread.')).toBeInTheDocument()

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect((body.messages as Array<{ content: string }>).at(-1)?.content).toBe(
      'Summarize this conversation and highlight the key points'
    )
    vi.unstubAllGlobals()
  })

  it('a summary turn is an ordinary turn: normal answerType precedence applies to its answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          mockStreamingResponse(
            finalFrame({ text: 'Summary of the thread.', answerType: 'analysis' })
          )
        )
    )
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /catch me up/i }))
    await screen.findByText('Summary of the thread.')

    // An analysis-classified answer is read-only text: no primary insert
    // button, just the overflow menu and feedback — same as a typed ask.
    expect(screen.queryByRole('button', { name: /add to composer/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /more answer actions/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Good answer' })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('the empty-state Draft a reply card sends its canned question as a normal turn', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockStreamingResponse(finalFrame()))
    vi.stubGlobal('fetch', fetchMock)

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /draft a reply/i }))

    expect(await screen.findByText('Draft a reply to this conversation')).toBeInTheDocument()
    await screen.findByText(DEFAULT_ANSWER)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect((body.messages as Array<{ content: string }>).at(-1)?.content).toBe(
      'Draft a reply to this conversation'
    )
    vi.unstubAllGlobals()
  })

  it('the footer Summarize pill is disabled while a turn is streaming', async () => {
    // A fetch that never settles keeps the turn in the streaming state.
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /catch me up/i }))
    await screen.findByText('Summarize this conversation and highlight the key points')

    // The empty-state cards are gone; the compact footer pills now show and
    // are disabled while the turn streams.
    expect(screen.getByRole('button', { name: 'Summarize' })).toBeDisabled()
    vi.unstubAllGlobals()
  })

  it('"New chat" clears the thread back to the empty state', async () => {
    const frames = aguiRun({ result: { text: 'Answer.', citations: [], internalSourced: false } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStreamingResponse(frames)))

    renderPanel()
    await ask('First question?')
    await screen.findByText('Answer.')

    fireEvent.click(screen.getByRole('button', { name: /new chat/i }))

    expect(screen.queryByText('Answer.')).not.toBeInTheDocument()
    expect(screen.getByText(/Ask Copilot anything about this conversation/)).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})

describe('<CopilotPanel> Cmd/Ctrl+Enter inserts the last answer', () => {
  function modEnter(mod: { metaKey?: boolean; ctrlKey?: boolean } = { metaKey: true }) {
    fireEvent.keyDown(screen.getByPlaceholderText(/ask a (follow-up )?question/i), {
      key: 'Enter',
      ...mod,
    })
  }

  it('triggers the draft_reply primary action (Add to composer) with the same event logging', async () => {
    const onInsert = await askAnswer()

    modEnter()

    expect(onInsert).toHaveBeenCalledWith('A public answer.')
    expect(hoisted.recordCopilotEvent).toHaveBeenCalledWith({
      item: { conversationId: CONVERSATION_ID },
      eventType: 'answer_inserted',
      destination: 'reply',
      answerType: 'draft_reply',
      internalSourced: false,
    })
    // The ask box was empty, so the mod chord is not a submit — no second ask.
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('works with Ctrl as the modifier too', async () => {
    const onInsert = await askAnswer()

    modEnter({ ctrlKey: true })

    expect(onInsert).toHaveBeenCalledWith('A public answer.')
    vi.unstubAllGlobals()
  })

  it('SUBMITS instead of inserting when the ask box has a drafted question (C5)', async () => {
    const onInsert = await askAnswer()

    // Draft a follow-up but do not press plain Enter.
    await userEvent.type(
      screen.getByPlaceholderText(/ask a (follow-up )?question/i),
      'A follow-up?'
    )
    modEnter()

    // The chord submitted the question (second fetch), no insert happened. The
    // ChatClient dispatches its POST across a tick, so wait for it.
    await waitFor(() => expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2))
    expect(onInsert).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('is a no-op for an analysis answer (read-only text, no primary action to trigger)', async () => {
    const onInsert = await askAnswer({ answerType: 'analysis' }, 'What language is this?')

    modEnter()

    expect(onInsert).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('still routes an internal-sourced answer through the leak-gate confirm', async () => {
    const onInsert = await askAnswer({ internalSourced: true })

    modEnter()

    expect(await screen.findByText('This answer uses internal sources')).toBeInTheDocument()
    expect(onInsert).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('acts on the LAST completed turn when there are several', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockStreamingResponse(finalFrame({ text: 'First answer.' })))
      .mockResolvedValueOnce(mockStreamingResponse(finalFrame({ text: 'Second answer.' })))
    vi.stubGlobal('fetch', fetchMock)
    const onInsert = vi.fn()
    renderPanel({ onInsert })
    await ask('First?')
    await screen.findByText('First answer.')
    await ask('Second?')
    await screen.findByText('Second answer.')

    modEnter()

    expect(onInsert).toHaveBeenCalledWith('Second answer.')
    vi.unstubAllGlobals()
  })

  it('is a no-op with no completed answer yet', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const onInsert = vi.fn()
    renderPanel({ onInsert })

    modEnter()

    expect(onInsert).not.toHaveBeenCalled()
    expect(hoisted.recordCopilotEvent).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('plain Enter still submits the question (unchanged)', async () => {
    await askAnswer()

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})

describe('<CopilotPanel> unfinalized (aborted/truncated) turns fail closed', () => {
  /** A turn whose stream ends after deltas with NO final frame — what an
   *  aborted (Stop) or truncated stream leaves behind: status done, but
   *  internalSourced/answerType never arrived. */
  async function askAborted() {
    // A run whose stream ends after deltas with a bare RUN_FINISHED (no
    // result): the terminal payload with internalSourced/answerType never
    // arrived, so the turn is done-but-unfinalized.
    const frames = aguiRun({ middle: structuredDeltas({ text: 'A partial answer.' }) })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStreamingResponse(frames)))
    const onInsert = vi.fn()
    renderPanel({ onInsert })
    await ask('Question?')
    await screen.findByText('A partial answer.')
    // The turn settled (the ask input re-enabled) without a final frame.
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/ask a follow-up question/i)).not.toBeDisabled()
    )
    return onInsert
  }

  it('offers no insert action at all — no composer button, no modify menu, feedback only', async () => {
    await askAborted()

    expect(screen.queryByRole('button', { name: /add to composer/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /more answer actions/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Good answer' })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('feedback on the unfinalized turn logs WITHOUT internalSourced', async () => {
    await askAborted()

    fireEvent.click(screen.getByRole('button', { name: 'Good answer' }))

    expect(hoisted.recordCopilotEvent).toHaveBeenCalledTimes(1)
    const event = hoisted.recordCopilotEvent.mock.calls[0][0] as Record<string, unknown>
    expect(event).toMatchObject({
      item: { conversationId: CONVERSATION_ID },
      eventType: 'feedback',
      rating: 'up',
    })
    // Omitted, never asserted false: the leak-gate signal never arrived.
    expect('internalSourced' in event).toBe(false)
    vi.unstubAllGlobals()
  })

  it('Cmd+Enter is a no-op on an unfinalized turn (fails closed)', async () => {
    const onInsert = await askAborted()

    fireEvent.keyDown(screen.getByPlaceholderText(/ask a (follow-up )?question/i), {
      key: 'Enter',
      metaKey: true,
    })

    expect(onInsert).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('a finalized turn after an aborted one restores the composer affordance for itself', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockStreamingResponse(aguiRun({ middle: structuredDeltas({ text: 'Partial one.' }) }))
      )
      .mockResolvedValueOnce(mockStreamingResponse(finalFrame({ text: 'Complete answer.' })))
    vi.stubGlobal('fetch', fetchMock)
    const onInsert = vi.fn()
    renderPanel({ onInsert })
    await ask('First?')
    await screen.findByText('Partial one.')
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/ask a follow-up question/i)).not.toBeDisabled()
    )
    await ask('Second?')
    await screen.findByText('Complete answer.')

    // The finalized turn has the full affordances; Cmd+Enter targets it.
    expect(screen.getByRole('button', { name: /add to composer/i })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByPlaceholderText(/ask a (follow-up )?question/i), {
      key: 'Enter',
      metaKey: true,
    })
    expect(onInsert).toHaveBeenCalledWith('Complete answer.')
    vi.unstubAllGlobals()
  })
})

describe('<CopilotPanel> leak gate', () => {
  // Final-frame overrides for an internal-sourced answer (askAnswer merges
  // them into the shared finalFrame defaults).
  const INTERNAL_FINAL = {
    text: 'Here is the internal-flavored answer.',
    citations: [
      { type: 'snippet', id: 'snippet_1', title: 'Internal note', url: '', internal: true },
    ],
    internalSourced: true,
  }

  it('opens the confirm dialog on Add to composer when internalSourced is true', async () => {
    const onInsert = await askAnswer(INTERNAL_FINAL, 'What should I do?')

    fireEvent.click(screen.getByRole('button', { name: /add to composer/i }))

    expect(await screen.findByText('This answer uses internal sources')).toBeInTheDocument()
    expect(onInsert).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('"Add to composer anyway" inserts into the reply composer', async () => {
    const onInsert = await askAnswer(INTERNAL_FINAL, 'What should I do?')
    fireEvent.click(screen.getByRole('button', { name: /add to composer/i }))
    await screen.findByText('This answer uses internal sources')

    fireEvent.click(screen.getByRole('button', { name: /add to composer anyway/i }))

    expect(onInsert).toHaveBeenCalledWith('Here is the internal-flavored answer.')
    vi.unstubAllGlobals()
  })

  it('the confirm dialog offers no note escape — Cancel or proceed only', async () => {
    await askAnswer(INTERNAL_FINAL, 'What should I do?')
    fireEvent.click(screen.getByRole('button', { name: /add to composer/i }))
    await screen.findByText('This answer uses internal sources')

    expect(screen.queryByRole('button', { name: 'Add as note' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('inserts directly with no dialog when internalSourced is false', async () => {
    const onInsert = await askAnswer({ text: 'A plain public answer.' }, 'A public question?')

    fireEvent.click(screen.getByRole('button', { name: /add to composer/i }))

    expect(onInsert).toHaveBeenCalledWith('A plain public answer.')
    expect(screen.queryByText('This answer uses internal sources')).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})

describe('<CopilotPanel> answerType button precedence', () => {
  const askWithAnswerType = (answerType: 'draft_reply' | 'analysis') =>
    askAnswer(
      { text: 'The customer is writing in Swedish.', answerType },
      'What language is he speaking?'
    )

  it('draft_reply keeps "Add to composer" as the primary action', async () => {
    await askWithAnswerType('draft_reply')

    // The visible primary button (not a menu item) is Add to composer.
    expect(screen.getByRole('button', { name: /add to composer/i })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('analysis has no primary action — the answer is read-only text', async () => {
    await askWithAnswerType('analysis')

    expect(screen.queryByRole('button', { name: /add to composer/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /more answer actions/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Good answer' })).toBeInTheDocument()
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
    expect(onInsert).toHaveBeenCalledWith('The customer is writing in Swedish.')
    vi.unstubAllGlobals()
  })
})

describe('<CopilotPanel> "Add to composer & modify" menu', () => {
  async function askAndOpenModifyMenu(internalSourced: boolean) {
    const copilotFrames = aguiRun({
      result: {
        text: 'Here is the original answer.',
        citations: internalSourced
          ? [{ type: 'snippet', id: 'snippet_1', title: 'Internal note', url: '', internal: true }]
          : [],
        internalSourced,
      },
    })
    const fetchMock = stubFetchByUrl({
      copilot: copilotFrames,
      transform: transformRun('Here is the FRIENDLIER answer.'),
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

  it('lists the tone rows under the "Add to composer & modify" header, above Save as macro (no note row)', async () => {
    const frames = aguiRun({ result: { text: 'Answer.', citations: [], internalSourced: false } })
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
    expect(screen.queryByRole('menuitem', { name: 'Add as note' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Save as macro' })).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('streams the transform then inserts directly when the source answer is not internal', async () => {
    const { onInsert, fetchMock } = await askAndOpenModifyMenu(false)

    await waitFor(() => {
      expect(onInsert).toHaveBeenCalledWith('Here is the FRIENDLIER answer.')
    })
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/transform'))).toBe(true)
    vi.unstubAllGlobals()
  })

  it('routes the TRANSFORMED text through the leak gate when the source answer is internal', async () => {
    const { onInsert } = await askAndOpenModifyMenu(true)

    expect(await screen.findByText('This answer uses internal sources')).toBeInTheDocument()
    expect(onInsert).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /add to composer anyway/i }))
    expect(onInsert).toHaveBeenCalledWith('Here is the FRIENDLIER answer.')
    vi.unstubAllGlobals()
  })
})

describe('<CopilotPanel> Answer-sources popover', () => {
  it('offers every source type (availability is per-agent config the runtime enforces, not a flag)', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /answer sources/i }))

    // The picker is a per-teammate narrowing preference; it can't read the
    // manage-gated assistant config, so it lists every source type and the
    // runtime intersects the selection with the workspace's enabled sources.
    expect(await screen.findByText('Help center articles')).toBeInTheDocument()
    expect(screen.getByText('Snippets')).toBeInTheDocument()
    expect(screen.getByText('Roadmap posts')).toBeInTheDocument()
    expect(screen.getByText('Past conversations')).toBeInTheDocument()
    expect(screen.getByText('Tickets')).toBeInTheDocument()
    expect(screen.getByText('Changelog')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('persists the selection to localStorage per teammate and sends sourceTypes on the next ask', async () => {
    const frames = aguiRun({ result: { text: 'Answer.', citations: [], internalSourced: false } })
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.forwardedProps.sourceTypes).toEqual(
      expect.arrayContaining(['article', 'post', 'summary'])
    )
    expect(body.forwardedProps.sourceTypes).not.toContain('snippet')
    vi.unstubAllGlobals()
  })

  it('keeps at least one source checked (cannot uncheck the last one)', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: /answer sources/i }))
    await screen.findByText('Help center articles')
    // Uncheck every source in turn; the guard blocks the final uncheck, so at
    // least one stays checked.
    for (const label of [
      'Help center articles',
      'Snippets',
      'Roadmap posts',
      'Past conversations',
      'Tickets',
      'Changelog',
    ]) {
      fireEvent.click(screen.getByText(label))
    }

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.some((cb) => cb.getAttribute('data-state') === 'checked')).toBe(true)
    vi.unstubAllGlobals()
  })
})

describe('<CopilotPanel> Save as macro', () => {
  const askAndGetAnswer = (internalSourced = false) =>
    askAnswer(
      {
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
      },
      'What is the refund window?'
    )

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

describe('<CopilotPanel> empty state', () => {
  it('teases act-on-approval with the shield-check bullet', async () => {
    vi.stubGlobal('fetch', vi.fn())
    renderPanel()

    expect(screen.getByText('Can take actions for you, with your approval.')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('keeps the teammate-facing Copilot identity separate from the customer assistant', async () => {
    hoisted.widgetConfig = { messenger: { assistant: { name: 'Fin', avatarUrl: '' } } }
    vi.stubGlobal('fetch', vi.fn())
    renderPanel()

    expect(
      await screen.findByText('Ask Copilot anything about this conversation.')
    ).toBeInTheDocument()
    expect(screen.queryByText('Ask Fin anything about this conversation.')).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})

describe('<CopilotPanel> usage events', () => {
  it('logs answer_inserted with destination reply on Add to composer', async () => {
    await askAnswer()

    fireEvent.click(screen.getByRole('button', { name: /add to composer/i }))

    expect(hoisted.recordCopilotEvent).toHaveBeenCalledWith({
      item: { conversationId: CONVERSATION_ID },
      eventType: 'answer_inserted',
      destination: 'reply',
      answerType: 'draft_reply',
      internalSourced: false,
    })
    vi.unstubAllGlobals()
  })

  it('logs nothing until the leak-gate confirm, then answer_inserted on proceed', async () => {
    await askAnswer({ internalSourced: true })

    fireEvent.click(screen.getByRole('button', { name: /add to composer/i }))
    await screen.findByText('This answer uses internal sources')
    expect(hoisted.recordCopilotEvent).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /add to composer anyway/i }))

    expect(hoisted.recordCopilotEvent).toHaveBeenCalledWith({
      item: { conversationId: CONVERSATION_ID },
      eventType: 'answer_inserted',
      destination: 'reply',
      answerType: 'draft_reply',
      internalSourced: true,
    })
    vi.unstubAllGlobals()
  })

  it('logs transform_inserted when a modify-menu transform result inserts', async () => {
    stubFetchByUrl({
      copilot: finalFrame({ text: 'Here is the original answer.' }),
      transform: transformRun('Here is the FRIENDLIER answer.'),
    })
    const onInsert = vi.fn()
    renderPanel({ onInsert })
    await ask('What should I do?')
    await screen.findByText(/Here is the original answer/)

    fireEvent.pointerDown(screen.getByRole('button', { name: /more answer actions/i }), {
      button: 0,
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'More friendly' }))

    await waitFor(() => {
      expect(hoisted.recordCopilotEvent).toHaveBeenCalledWith({
        item: { conversationId: CONVERSATION_ID },
        eventType: 'transform_inserted',
        destination: 'reply',
        answerType: 'draft_reply',
        internalSourced: false,
      })
    })
    vi.unstubAllGlobals()
  })
})

describe('<CopilotPanel> thumbs feedback', () => {
  it('thumbs up latches (aria-pressed) and logs a feedback event immediately', async () => {
    await askAnswer()

    const up = screen.getByRole('button', { name: 'Good answer' })
    expect(up).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(up)

    expect(up).toHaveAttribute('aria-pressed', 'true')
    expect(hoisted.recordCopilotEvent).toHaveBeenCalledWith({
      item: { conversationId: CONVERSATION_ID },
      eventType: 'feedback',
      rating: 'up',
      answerType: 'draft_reply',
      internalSourced: false,
    })
    // No reason input on thumbs up.
    expect(screen.queryByLabelText('Feedback reason')).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('re-clicking the latched thumb does not fire a duplicate event', async () => {
    await askAnswer()

    const up = screen.getByRole('button', { name: 'Good answer' })
    fireEvent.click(up)
    fireEvent.click(up)

    expect(hoisted.recordCopilotEvent).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('thumbs down latches and opens the reason input WITHOUT logging yet', async () => {
    await askAnswer()

    fireEvent.click(screen.getByRole('button', { name: 'Bad answer' }))

    expect(screen.getByRole('button', { name: 'Bad answer' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(await screen.findByLabelText('Feedback reason')).toBeInTheDocument()
    // The downvote logs once, when the input resolves — not on the click.
    expect(hoisted.recordCopilotEvent).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('Send logs the downvote exactly once, with the reason', async () => {
    await askAnswer({ answerType: 'analysis' })

    fireEvent.click(screen.getByRole('button', { name: 'Bad answer' }))

    const reasonInput = await screen.findByLabelText('Feedback reason')
    fireEvent.change(reasonInput, { target: { value: 'Missed the actual question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(hoisted.recordCopilotEvent).toHaveBeenCalledTimes(1)
    expect(hoisted.recordCopilotEvent).toHaveBeenLastCalledWith({
      item: { conversationId: CONVERSATION_ID },
      eventType: 'feedback',
      rating: 'down',
      reason: 'Missed the actual question',
      answerType: 'analysis',
      internalSourced: false,
    })
    // The input dismisses after sending.
    expect(screen.queryByLabelText('Feedback reason')).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('the X dismiss logs the downvote exactly once, without a reason', async () => {
    await askAnswer()

    fireEvent.click(screen.getByRole('button', { name: 'Bad answer' }))
    const reasonInput = await screen.findByLabelText('Feedback reason')
    // Typed but dismissed: the stale text must not ride along (or prefill later).
    fireEvent.change(reasonInput, { target: { value: 'never mind' } })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss feedback reason' }))

    expect(hoisted.recordCopilotEvent).toHaveBeenCalledTimes(1)
    expect(hoisted.recordCopilotEvent).toHaveBeenLastCalledWith({
      item: { conversationId: CONVERSATION_ID },
      eventType: 'feedback',
      rating: 'down',
      answerType: 'draft_reply',
      internalSourced: false,
    })
    expect(screen.queryByLabelText('Feedback reason')).not.toBeInTheDocument()

    // Re-opening (up, then down again) starts from a blank input, and the
    // resolution logs the final downvote only.
    fireEvent.click(screen.getByRole('button', { name: 'Good answer' })) // logs up
    fireEvent.click(screen.getByRole('button', { name: 'Bad answer' }))
    expect(screen.getByLabelText('Feedback reason')).toHaveValue('')
    vi.unstubAllGlobals()
  })

  it('switching up then down logs the up immediately and the down only on resolve', async () => {
    await askAnswer()

    fireEvent.click(screen.getByRole('button', { name: 'Good answer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bad answer' }))

    // Only the thumbs-up so far; the pending downvote awaits Send/dismiss.
    expect(hoisted.recordCopilotEvent).toHaveBeenCalledTimes(1)
    expect(hoisted.recordCopilotEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventType: 'feedback', rating: 'up' })
    )
    expect(screen.getByRole('button', { name: 'Good answer' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(screen.getByRole('button', { name: 'Bad answer' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss feedback reason' }))
    expect(hoisted.recordCopilotEvent).toHaveBeenCalledTimes(2)
    expect(hoisted.recordCopilotEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventType: 'feedback', rating: 'down' })
    )
    vi.unstubAllGlobals()
  })

  it('switching down (pending) to up discards the unresolved downvote — only the up logs', async () => {
    await askAnswer()

    fireEvent.click(screen.getByRole('button', { name: 'Bad answer' }))
    await screen.findByLabelText('Feedback reason')
    fireEvent.click(screen.getByRole('button', { name: 'Good answer' }))

    expect(hoisted.recordCopilotEvent).toHaveBeenCalledTimes(1)
    expect(hoisted.recordCopilotEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventType: 'feedback', rating: 'up' })
    )
    // The input closes with the pending downvote dropped.
    expect(screen.queryByLabelText('Feedback reason')).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('Enter in the reason input sends; an empty input stays open unsent', async () => {
    await askAnswer()

    fireEvent.click(screen.getByRole('button', { name: 'Bad answer' }))
    const reasonInput = await screen.findByLabelText('Feedback reason')
    fireEvent.keyDown(reasonInput, { key: 'Enter' }) // empty: nothing logs, stays open
    expect(hoisted.recordCopilotEvent).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Feedback reason')).toBeInTheDocument()

    fireEvent.change(reasonInput, { target: { value: 'Too vague' } })
    fireEvent.keyDown(reasonInput, { key: 'Enter' })
    expect(hoisted.recordCopilotEvent).toHaveBeenCalledTimes(1)
    expect(hoisted.recordCopilotEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ rating: 'down', reason: 'Too vague' })
    )
    expect(screen.queryByLabelText('Feedback reason')).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('renders no thumbs on a suppressed turn', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(mockStreamingResponse(finalFrame({ text: '', suppressed: 'silence' })))
    )
    renderPanel()
    await ask('Anything?')
    await screen.findByText(/could not find enough to answer/i)

    expect(screen.queryByRole('button', { name: 'Good answer' })).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})

describe('<CopilotPanel> source freshness line', () => {
  it('shows "Updated … ago" in the source row hovercard when updatedAt is present', async () => {
    const updatedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const frames = aguiRun({
      result: {
        text: 'The refund window is 30 days [1].',
        citations: [
          {
            type: 'article',
            id: 'article_1',
            title: 'Refund policy',
            url: 'https://help.example.com/refunds',
            updatedAt,
          },
        ],
        internalSourced: false,
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStreamingResponse(frames)))
    renderPanel()
    await ask('What is the refund window?')
    await screen.findByText('1 relevant source')

    // Both the citation-dot hovercard and the source-row hovercard carry it.
    expect(screen.getAllByText(/8 days ago/).length).toBeGreaterThanOrEqual(1)
    vi.unstubAllGlobals()
  })

  it('renders no freshness line when updatedAt is absent', async () => {
    const frames = aguiRun({
      result: {
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
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockStreamingResponse(frames)))
    renderPanel()
    await ask('What is the refund window?')
    await screen.findByText('1 relevant source')

    expect(screen.queryByText(/Updated/)).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})

describe('<CopilotPanel> proposed actions (P2-C.4)', () => {
  async function askAndGetProposal(overrides: Record<string, unknown> = {}) {
    hoisted.getAssistantPendingActionFn.mockResolvedValue(proposedActionRow(overrides))
    const frames = aguiRun({
      result: {
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
      },
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
    const frames = aguiRun({
      result: {
        text: 'Just an answer, nothing proposed.',
        citations: [],
        internalSourced: false,
        proposedActions: [],
      },
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
