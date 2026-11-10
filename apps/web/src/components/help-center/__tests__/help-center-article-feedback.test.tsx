// @vitest-environment happy-dom
/**
 * Tests the reason step a visitor sees after voting an article unhelpful.
 *
 * The vote is recorded on the click, before any typing, so a visitor who never
 * writes anything still counts. The reason is a second, optional write keyed by
 * the vote id the first call handed back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'

const recordFeedback = vi.fn(async (_input: { data: unknown }) => ({
  success: true as const,
  feedbackId: 'kb_article_feedback_1',
}))
const submitReason = vi.fn(async (_input: { data: unknown }) => ({ success: true as const }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/server/functions/help-center', () => ({
  recordArticleFeedbackFn: (input: { data: unknown }) => recordFeedback(input),
  submitArticleFeedbackReasonFn: (input: { data: unknown }) => submitReason(input),
}))

import de from '@/locales/de.json'
import { HelpCenterArticleClose, HelpCenterArticleFeedback } from '../help-center-article-feedback'

afterEach(() => {
  cleanup()
  recordFeedback.mockClear()
  submitReason.mockClear()
})

function renderFeedback() {
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <HelpCenterArticleFeedback articleId="article_1" />
    </IntlProvider>
  )
}

async function voteUnhelpful() {
  const before = recordFeedback.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: /no/i }))
  await waitFor(() => expect(recordFeedback.mock.calls.length).toBe(before + 1))
}

describe('HelpCenterArticleFeedback', () => {
  it('offers a reason box only after an unhelpful vote', async () => {
    renderFeedback()

    expect(screen.queryByRole('textbox')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /yes/i }))
    await waitFor(() => expect(recordFeedback).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('textbox')).toBeNull()

    await voteUnhelpful()
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('sends the typed reason against the vote it explains', async () => {
    renderFeedback()
    await voteUnhelpful()

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'The steps stop before the deploy part.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(submitReason).toHaveBeenCalledTimes(1))
    expect(submitReason).toHaveBeenCalledWith({
      data: {
        feedbackId: 'kb_article_feedback_1',
        reason: 'The steps stop before the deploy part.',
      },
    })

    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
  })

  it('keeps the send action inert while the box holds only whitespace', async () => {
    renderFeedback()
    await voteUnhelpful()

    const send = screen.getByRole('button', { name: /send/i }) as HTMLButtonElement
    expect(send.disabled).toBe(true)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    expect(send.disabled).toBe(true)

    fireEvent.click(send)
    expect(submitReason).not.toHaveBeenCalled()
  })

  it('thanks a helpful vote without an em dash', async () => {
    renderFeedback()
    fireEvent.click(screen.getByRole('button', { name: /yes/i }))
    expect(await screen.findByText('Thanks, glad it landed.')).toBeTruthy()
  })

  it('speaks the reader language', async () => {
    render(
      <IntlProvider locale="de" messages={de} onError={() => {}}>
        <HelpCenterArticleFeedback articleId="article_1" />
      </IntlProvider>
    )
    expect(screen.getByText(de['portal.hc.articleFeedback.question'])).toBeTruthy()
    expect(screen.getByText(de['portal.hc.articleFeedback.subtitle'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Ja/ }))
    expect(await screen.findByText(de['portal.hc.articleFeedback.thanksHelpful'])).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Was this helpful|Yes|Thanks/)
  })
})

describe('HelpCenterArticleClose', () => {
  const renderClose = (choices: { helpful: boolean; contact: boolean }, href: string | null) =>
    render(
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        <HelpCenterArticleClose articleId="article_1" contactHref={href} {...choices} />
      </IntlProvider>
    )

  it('asks "Was this helpful?" without a Contact link, as articles always did', () => {
    renderClose({ helpful: true, contact: false }, '/support/new')
    expect(screen.getByText('Was this helpful?')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Contact support' })).toBeNull()
  })

  it('leaves the question off, and adds the Contact link, as the design asks', () => {
    renderClose({ helpful: false, contact: true }, '/support/new')
    expect(screen.queryByText('Was this helpful?')).toBeNull()
    expect(screen.getByRole('link', { name: 'Contact support' }).getAttribute('href')).toBe(
      '/support/new'
    )
  })

  it('offers contact once: not again after a "No" while the link is there', async () => {
    renderClose({ helpful: true, contact: true }, '/support/new')
    await voteUnhelpful()
    expect(screen.getAllByRole('link', { name: 'Contact support' })).toHaveLength(1)
  })

  it('draws no Contact link while support is off', () => {
    renderClose({ helpful: false, contact: true }, null)
    expect(screen.queryByRole('link', { name: 'Contact support' })).toBeNull()
  })
})
