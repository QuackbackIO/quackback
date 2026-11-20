// @vitest-environment happy-dom
/**
 * A fresh widget visitor has no session until their first write, so their
 * first vote on an article mints one. The new session changes the article
 * query's key; the article on screen must stay put while it refetches, or the
 * footer is unmounted mid-vote and its "thanks" is lost.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createContext, useMemo, useRef, useState, type Context, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

const fns = vi.hoisted(() => ({
  resolveArticle: vi.fn(),
  recordFeedback: vi.fn(async () => ({ success: true, feedbackId: 'kb_article_feedback_1' })),
}))

vi.mock('@/lib/server/functions/widget/help', () => ({
  widgetResolvePublicArticleRefFn: fns.resolveArticle,
  widgetRecordArticleFeedbackFn: fns.recordFeedback,
}))
vi.mock('@/lib/client/widget-auth', () => ({
  getWidgetAuthHeaders: () => ({}),
  generateOneTimeToken: async () => null,
}))
vi.mock('@/lib/client/widget-bridge', () => ({ sendToHost: vi.fn() }))

const auth = vi.hoisted(() => ({ context: null as Context<unknown> | null }))
vi.mock('../widget-auth-provider', async () => {
  const { useContext } = await import('react')
  return { useWidgetAuth: () => useContext(auth.context!) }
})

import { WidgetHelpDetail } from '../widget-help-detail'

auth.context = createContext<unknown>(null)

/** Stands in for the widget auth provider: minting a session bumps the version. */
function FreshVisitor({ children }: { children: ReactNode }) {
  const [sessionVersion, setSessionVersion] = useState(0)
  const hasSession = useRef(false)
  const value = useMemo(
    () => ({
      isIdentified: false,
      canPortalHandoff: false,
      sessionVersion,
      ensureSession: async () => {
        if (!hasSession.current) {
          hasSession.current = true
          setSessionVersion((v) => v + 1)
        }
        return true
      },
    }),
    [sessionVersion]
  )
  const Provider = auth.context!.Provider
  return <Provider value={value}>{children}</Provider>
}

afterEach(cleanup)

describe('WidgetHelpDetail vote', () => {
  it("confirms a fresh visitor's first vote", async () => {
    fns.resolveArticle.mockImplementation(async () => ({
      id: 'kb_article_1',
      urlId: 1,
      slug: 'router',
      title: 'Router setup',
      content: 'Plug it in.',
      contentJson: null,
      resolvedLocale: 'en',
      category: { id: 'kb_category_1', name: 'Setup' },
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <IntlProvider locale="en">
          <FreshVisitor>
            <WidgetHelpDetail articleRef="kb_article_1" />
          </FreshVisitor>
        </IntlProvider>
      </QueryClientProvider>
    )

    const yes = await screen.findByRole('button', { name: 'Yes, this helped' })
    await act(async () => {
      fireEvent.click(yes)
    })

    expect(await screen.findByText('Thanks, glad it helped.')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Yes, this helped' }).getAttribute('aria-pressed')
    ).toBe('true')
    expect(fns.recordFeedback).toHaveBeenCalledTimes(1)
  })
})
