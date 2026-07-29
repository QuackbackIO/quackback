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

vi.mock('@/lib/server/functions/help-center', () => ({
  recordArticleFeedbackFn: (input: { data: unknown }) => recordFeedback(input),
  submitArticleFeedbackReasonFn: (input: { data: unknown }) => submitReason(input),
}))

import { HelpCenterArticleFeedback } from '../help-center-article-feedback'

afterEach(() => {
  cleanup()
  recordFeedback.mockClear()
  submitReason.mockClear()
})

function renderFeedback() {
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <HelpCenterArticleFeedback articleId="kb_article_1" />
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
})
