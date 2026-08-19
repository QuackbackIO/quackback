// @vitest-environment happy-dom
/**
 * useAskAi over the AG-UI transport: a ChatClient (fetchServerSentEvents)
 * against a stubbed fetch. Pins the chunk→state mapping — STATE_SNAPSHOT
 * sources feed the citation join, TEXT_MESSAGE_CONTENT raw-JSON deltas stream
 * the `answer` prose, RUN_FINISHED.result settles done/no-answer by kind, and
 * RUN_ERROR / a transport failure settle the error state.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { aguiRun, aguiErrorRun, structuredDeltas, stubAguiFetch } from '@/test/agui'
import { useAskAi, type AskAiSourceMeta } from '../ask-ai'

afterEach(() => {
  vi.unstubAllGlobals()
})

const META: AskAiSourceMeta = {
  articleId: 'kb_article_1',
  title: 'Refund policy',
  slug: 'refund-policy',
  categorySlug: 'billing',
  categoryName: 'Billing',
}

const snapshotChunk = (sources: AskAiSourceMeta[]) => ({
  type: 'STATE_SNAPSHOT',
  snapshot: { sources },
})

describe('useAskAi', () => {
  it('maps a grounded run: snapshot sources, streamed prose, cited final', async () => {
    const answer = {
      kind: 'grounded',
      answer: 'Do the thing.',
      sources: [{ articleId: 'kb_article_1' }],
    }
    stubAguiFetch(
      aguiRun({
        middle: [snapshotChunk([META]), ...structuredDeltas(answer)],
        result: answer,
      })
    )

    const { result } = renderHook(() => useAskAi())
    await act(async () => {
      await result.current.ask('how do I get a refund?')
    })

    expect(result.current.state).toMatchObject({
      status: 'done',
      question: 'how do I get a refund?',
      kind: 'grounded',
      answer: 'Do the thing.',
      citedSources: [META],
      related: [],
    })
  })

  it('drops a cited articleId with no snapshot metadata', async () => {
    const answer = {
      kind: 'grounded',
      answer: 'A.',
      // The model cited an id that never appeared in the snapshot join.
      sources: [{ articleId: 'kb_article_1' }, { articleId: 'kb_ghost' }],
    }
    stubAguiFetch(
      aguiRun({ middle: [snapshotChunk([META]), ...structuredDeltas(answer)], result: answer })
    )

    const { result } = renderHook(() => useAskAi())
    await act(async () => {
      await result.current.ask('q')
    })

    expect(result.current.state.citedSources).toEqual([META])
  })

  it('maps a no_answer run to a done miss with related suggestions', async () => {
    const answer = { kind: 'no_answer', answer: 'I could not find that.', sources: [] }
    const resultPayload = {
      kind: 'no_answer',
      answer: 'I could not find that.',
      sources: [],
      related: [META],
    }
    stubAguiFetch(aguiRun({ middle: structuredDeltas(answer), result: resultPayload }))

    const { result } = renderHook(() => useAskAi())
    await act(async () => {
      await result.current.ask('nearby topic')
    })

    expect(result.current.state).toMatchObject({
      status: 'done',
      kind: 'no_answer',
      answer: 'I could not find that.',
      citedSources: [],
      related: [META],
    })
  })

  it('settles the error state on a RUN_ERROR frame', async () => {
    stubAguiFetch(aguiErrorRun({ code: 'SYNTHESIS_FAILED', message: 'Answer generation failed' }))

    const { result } = renderHook(() => useAskAi())
    await act(async () => {
      await result.current.ask('q')
    })

    expect(result.current.state.status).toBe('error')
  })

  it('settles the error state on a non-2xx transport failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Slow down' } }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          })
        )
      )
    )

    const { result } = renderHook(() => useAskAi())
    await act(async () => {
      await result.current.ask('q')
    })

    expect(result.current.state.status).toBe('error')
  })

  it('reset returns the hook to idle', async () => {
    const answer = { kind: 'grounded', answer: 'A.', sources: [{ articleId: 'kb_article_1' }] }
    stubAguiFetch(
      aguiRun({ middle: [snapshotChunk([META]), ...structuredDeltas(answer)], result: answer })
    )

    const { result } = renderHook(() => useAskAi())
    await act(async () => {
      await result.current.ask('q')
    })
    expect(result.current.state.status).toBe('done')

    act(() => {
      result.current.reset()
    })
    expect(result.current.state.status).toBe('idle')
  })
})
