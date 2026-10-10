// @vitest-environment happy-dom
/**
 * The /hc hero search offers Ask AI beside article search. Its AG-UI
 * streaming client (ask-ai-run) is a large download most visitors never use,
 * so the page must not load it on render: only once a visitor focuses the
 * search or types while Ask AI is offered, and never while Ask AI is
 * unavailable. Asking still streams the answer through it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { aguiRun, structuredDeltas } from '@/test/agui'
import { mockStreamingResponse } from '@/test/sse'

const loads = { run: 0 }

/** A fresh module registry whose streaming client counts each time it loads. */
function freshModules() {
  vi.resetModules()
  loads.run = 0
  vi.doMock('../ask-ai-run', async (importOriginal) => {
    loads.run++
    return importOriginal()
  })
}

const ANSWER = { kind: 'grounded', answer: 'Open Settings, then Billing.', sources: [] }
// Loading the streaming client transforms a fresh module graph; allow for a busy suite.
const LOAD = { timeout: 5000 }

/** Wait for a started load of the streaming client to finish within this test. */
async function loadSettled() {
  await waitFor(() => expect(loads.run).toBe(1), LOAD)
  const { preloadAskAi } = await import('../ask-ai')
  await preloadAskAi()
}
const ASK_PLACEHOLDER = 'Ask AI or search our help articles to find an answer'

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

/** Serve the capability probe, an empty article search, and one streamed answer. */
function stubKbApi({ askAiEnabled }: { askAiEnabled: boolean }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/api/widget/kb-search')) return json({ data: { articles: [] } })
    if (url === '/api/widget/kb-ask' && (init?.method ?? 'GET') === 'GET') {
      return json({ data: { enabled: askAiEnabled } })
    }
    if (url === '/api/widget/kb-ask') {
      return mockStreamingResponse(aguiRun({ middle: structuredDeltas(ANSWER), result: ANSWER }))
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Render the hero search and wait for the capability probe to answer. */
async function renderHeroSearch({ askAiEnabled }: { askAiEnabled: boolean }) {
  const fetchMock = stubKbApi({ askAiEnabled })
  const { HelpCenterHeroSearch } = await import('../help-center-search')
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <HelpCenterHeroSearch askAiEnabled />
      </IntlProvider>
    </QueryClientProvider>
  )
  const input = screen.getByRole('searchbox')
  if (askAiEnabled) {
    await waitFor(() => expect(input.getAttribute('placeholder')).toBe(ASK_PLACEHOLDER))
  } else {
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(input.getAttribute('placeholder')).not.toBe(ASK_PLACEHOLDER)
  }
  return input
}

beforeEach(() => {
  freshModules()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('HelpCenterHeroSearch Ask AI loading', () => {
  it('does not load the streaming client when the page renders', async () => {
    await renderHeroSearch({ askAiEnabled: true })

    expect(loads.run).toBe(0)
  })

  it('loads the streaming client when a visitor focuses the search', async () => {
    const input = await renderHeroSearch({ askAiEnabled: true })

    fireEvent.focus(input)

    await loadSettled()
  })

  it('loads the streaming client when a visitor types a question', async () => {
    const input = await renderHeroSearch({ askAiEnabled: true })

    fireEvent.change(input, { target: { value: 'how do I pay' } })

    await loadSettled()
  })

  it('never loads the streaming client while Ask AI is unavailable', async () => {
    const input = await renderHeroSearch({ askAiEnabled: false })

    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'how do I pay' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await new Promise((resolve) => setTimeout(resolve, 350))

    expect(loads.run).toBe(0)
  })

  it('streams the answer to a question', async () => {
    const input = await renderHeroSearch({ askAiEnabled: true })

    fireEvent.change(input, { target: { value: 'how do I pay' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(document.body.textContent).toContain(ANSWER.answer), LOAD)
    expect(loads.run).toBe(1)
  })
})
