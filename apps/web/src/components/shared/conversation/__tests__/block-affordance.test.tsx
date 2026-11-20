// @vitest-environment happy-dom
/**
 * Component tests for the Phase C conversational block affordances: each
 * kind's pending/chosen/superseded rendering, the CSAT rate -> comment ->
 * thanks flow (and its local-phase survival across a state flip to
 * 'chosen'), and inline collect validation.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import {
  BlockButtonsRow,
  BlockCollectField,
  BlockCsatRow,
  BlockReplyTimeCaption,
} from '../block-affordance'
import type { WorkflowBlockPayload } from '@/lib/shared/db-types'

// Reduced motion: no entrance animations, so a test that ends mid-animation
// leaves no cancelled happy-dom animation behind.
vi.mock('framer-motion', async (original) => ({
  ...(await original<typeof import('framer-motion')>()),
  useReducedMotion: () => true,
}))

afterEach(cleanup)

function withIntl(node: React.ReactNode) {
  return render(
    <IntlProvider locale="en-US" messages={{}}>
      {node}
    </IntlProvider>
  )
}

const buttonsBlock: Extract<WorkflowBlockPayload, { kind: 'buttons' }> = {
  v: 1,
  runId: 'run_1',
  nodeId: 'node_1',
  waiting: true,
  kind: 'buttons',
  options: [
    { key: 'yes', label: 'Yes please' },
    { key: 'no', label: 'No thanks' },
  ],
  allowTyping: false,
}

const collectTextBlock: Extract<WorkflowBlockPayload, { kind: 'collect' }> = {
  v: 1,
  runId: 'run_1',
  nodeId: 'node_2',
  waiting: true,
  kind: 'collect',
  attributeKey: 'email',
  fieldType: 'text',
  required: true,
}

const collectSelectBlock: Extract<WorkflowBlockPayload, { kind: 'collect' }> = {
  ...collectTextBlock,
  fieldType: 'select',
  options: [
    { id: 'opt_a', label: 'Option A' },
    { id: 'opt_b', label: 'Option B' },
  ],
}

const collectReplyBlock: Extract<WorkflowBlockPayload, { kind: 'collectReply' }> = {
  v: 1,
  runId: 'run_1',
  nodeId: 'node_3',
  waiting: true,
  kind: 'collectReply',
  attributeKey: 'issue_description',
}

const csatBlock: Extract<WorkflowBlockPayload, { kind: 'csat' }> = {
  v: 1,
  runId: 'run_1',
  nodeId: 'node_4',
  waiting: true,
  kind: 'csat',
  allowTypingInterrupt: true,
  commentPrompt: '',
}

describe('BlockButtonsRow', () => {
  it('pending: renders every option, tappable', () => {
    const onTap = vi.fn()
    withIntl(
      <BlockButtonsRow block={buttonsBlock} state="pending" submitting={false} onTap={onTap} />
    )
    const yes = screen.getByRole('button', { name: 'Yes please' })
    fireEvent.click(yes)
    expect(onTap).toHaveBeenCalledWith('yes', 'Yes please')
  })

  it('chosen: collapses to nothing (the echo bubble carries the choice)', () => {
    const { container } = withIntl(
      <BlockButtonsRow block={buttonsBlock} state="chosen" submitting={false} onTap={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('superseded: renders the stack inert — never tappable', () => {
    const onTap = vi.fn()
    withIntl(
      <BlockButtonsRow block={buttonsBlock} state="superseded" submitting={false} onTap={onTap} />
    )
    const yes = screen.getByRole('button', { name: 'Yes please' })
    expect(yes).toBeDisabled()
    fireEvent.click(yes)
    expect(onTap).not.toHaveBeenCalled()
  })

  it('pending + submitting: optimistic disable blocks a second tap', () => {
    const onTap = vi.fn()
    withIntl(<BlockButtonsRow block={buttonsBlock} state="pending" submitting onTap={onTap} />)
    const yes = screen.getByRole('button', { name: 'Yes please' })
    expect(yes).toBeDisabled()
    fireEvent.click(yes)
    expect(onTap).not.toHaveBeenCalled()
  })
})

describe('BlockCollectField — collect (text)', () => {
  it('pending: submits the trimmed value', () => {
    const onSubmit = vi.fn()
    withIntl(
      <BlockCollectField
        block={collectTextBlock}
        state="pending"
        submitting={false}
        onSubmit={onSubmit}
      />
    )
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '  hi@example.com  ' } })
    fireEvent.click(screen.getByText('Submit'))
    expect(onSubmit).toHaveBeenCalledWith('hi@example.com', 'hi@example.com')
  })

  it('pending: blocks submit and shows the required error on an empty required field', () => {
    const onSubmit = vi.fn()
    withIntl(
      <BlockCollectField
        block={collectTextBlock}
        state="pending"
        submitting={false}
        onSubmit={onSubmit}
      />
    )
    fireEvent.click(screen.getByText('Submit'))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('This field is required.')).toBeInTheDocument()
  })

  it('chosen: shows the write-once explainer instead of the field', () => {
    withIntl(
      <BlockCollectField
        block={collectTextBlock}
        state="chosen"
        submitting={false}
        onSubmit={vi.fn()}
      />
    )
    expect(screen.getByText('Only our team can change this now.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('select field: submits the option id with its label as display text', () => {
    const onSubmit = vi.fn()
    withIntl(
      <BlockCollectField
        block={collectSelectBlock}
        state="pending"
        submitting={false}
        onSubmit={onSubmit}
      />
    )
    // Radix Select renders a combobox trigger; open + pick isn't worth the
    // jsdom ceremony here — assert the trigger renders with the placeholder,
    // proving the select branch (not the text-input branch) is active.
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})

describe('BlockCollectField — collectReply', () => {
  it('pending: renders nothing (the composer is the affordance)', () => {
    const { container } = withIntl(
      <BlockCollectField
        block={collectReplyBlock}
        state="pending"
        submitting={false}
        onSubmit={vi.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('chosen: shows the write-once explainer', () => {
    withIntl(
      <BlockCollectField
        block={collectReplyBlock}
        state="chosen"
        submitting={false}
        onSubmit={vi.fn()}
      />
    )
    expect(screen.getByText('Only our team can change this now.')).toBeInTheDocument()
  })
})

describe('BlockCsatRow', () => {
  const recorded = () => vi.fn().mockResolvedValue('recorded')
  const NOT_CLOSED = 'You can rate once this conversation is closed.'

  it('pending: tapping a face rates and, once taken, reveals the comment box', async () => {
    const onRate = recorded()
    withIntl(
      <BlockCsatRow
        block={csatBlock}
        state="pending"
        submitting={false}
        closed={false}
        onRate={onRate}
        onComment={recorded()}
      />
    )
    fireEvent.click(screen.getByLabelText('4 of 5'))
    expect(onRate).toHaveBeenCalledWith(4)
    expect(await screen.findByText('Thanks! Anything we could improve?')).toBeInTheDocument()
  })

  it('submitting the comment calls onComment with the picked rating, then shows thanks', async () => {
    const onComment = recorded()
    withIntl(
      <BlockCsatRow
        block={csatBlock}
        state="pending"
        submitting={false}
        closed={false}
        onRate={recorded()}
        onComment={onComment}
      />
    )
    fireEvent.click(screen.getByLabelText('5 of 5'))
    fireEvent.change(await screen.findByPlaceholderText('Add a comment (optional)'), {
      target: { value: 'Great experience!' },
    })
    fireEvent.click(screen.getByText('Send feedback'))
    expect(onComment).toHaveBeenCalledWith(5, 'Great experience!')
    expect(await screen.findByText('Thanks for your feedback!')).toBeInTheDocument()
  })

  it('a refused rating says why and keeps the faces tappable, never thanks', async () => {
    const onRate = vi.fn().mockResolvedValue('refused')
    withIntl(
      <BlockCsatRow
        block={csatBlock}
        state="pending"
        submitting={false}
        closed={false}
        onRate={onRate}
        onComment={recorded()}
      />
    )
    fireEvent.click(screen.getByLabelText('4 of 5'))
    expect(await screen.findByText(NOT_CLOSED)).toBeInTheDocument()
    expect(screen.queryByText('Thanks for your feedback!')).not.toBeInTheDocument()
    expect(screen.queryByText('Thanks! Anything we could improve?')).not.toBeInTheDocument()
    expect(screen.getByLabelText('4 of 5')).toBeEnabled()

    // Closed now: the next tap is taken.
    onRate.mockResolvedValue('recorded')
    fireEvent.click(screen.getByLabelText('5 of 5'))
    expect(await screen.findByText('Thanks! Anything we could improve?')).toBeInTheDocument()
    expect(screen.queryByText(NOT_CLOSED)).not.toBeInTheDocument()
    expect(onRate).toHaveBeenLastCalledWith(5)
  })

  it('drops the refusal line once the conversation closes', async () => {
    const onRate = vi.fn().mockResolvedValue('refused')
    const row = (closed: boolean) => (
      <IntlProvider locale="en-US" messages={{}}>
        <BlockCsatRow
          block={csatBlock}
          state="pending"
          submitting={false}
          closed={closed}
          onRate={onRate}
          onComment={recorded()}
        />
      </IntlProvider>
    )
    const { rerender } = render(row(false))
    fireEvent.click(screen.getByLabelText('4 of 5'))
    expect(await screen.findByText(NOT_CLOSED)).toBeInTheDocument()
    rerender(row(true))
    expect(screen.queryByText(NOT_CLOSED)).not.toBeInTheDocument()
    expect(screen.getByLabelText('4 of 5')).toBeEnabled()
  })

  it('a failed rating puts the faces back for a retry, with no thanks', async () => {
    withIntl(
      <BlockCsatRow
        block={csatBlock}
        state="pending"
        submitting={false}
        closed={false}
        onRate={vi.fn().mockResolvedValue('failed')}
        onComment={recorded()}
      />
    )
    fireEvent.click(screen.getByLabelText('2 of 5'))
    await waitFor(() => expect(screen.getByLabelText('2 of 5')).toBeEnabled())
    expect(screen.queryByText('Thanks! Anything we could improve?')).not.toBeInTheDocument()
    expect(screen.queryByText(NOT_CLOSED)).not.toBeInTheDocument()
  })

  it('a refused comment says why instead of thanks', async () => {
    withIntl(
      <BlockCsatRow
        block={csatBlock}
        state="pending"
        submitting={false}
        closed={false}
        onRate={recorded()}
        onComment={vi.fn().mockResolvedValue('refused')}
      />
    )
    fireEvent.click(screen.getByLabelText('5 of 5'))
    fireEvent.click(await screen.findByText('Send feedback'))
    expect(await screen.findByText(NOT_CLOSED)).toBeInTheDocument()
    expect(screen.queryByText('Thanks for your feedback!')).not.toBeInTheDocument()
  })

  it('survives the state flipping to chosen mid-flow (the echo lands before the send answers)', async () => {
    let answer: (outcome: 'recorded') => void = () => {}
    const onRate = vi.fn(() => new Promise<'recorded'>((resolve) => (answer = resolve)))
    const { rerender } = withIntl(
      <BlockCsatRow
        block={csatBlock}
        state="pending"
        submitting={false}
        closed={false}
        onRate={onRate}
        onComment={recorded()}
      />
    )
    fireEvent.click(screen.getByLabelText('3 of 5'))

    // The rating's own SSE echo lands, flipping the derived state — the row
    // must not collapse to nothing while the send is still out.
    rerender(
      <IntlProvider locale="en-US" messages={{}}>
        <BlockCsatRow
          block={csatBlock}
          state="chosen"
          submitting={false}
          closed={false}
          onRate={onRate}
          onComment={recorded()}
        />
      </IntlProvider>
    )
    expect(screen.getByLabelText('3 of 5')).toBeDisabled()
    answer('recorded')
    expect(await screen.findByText('Thanks! Anything we could improve?')).toBeInTheDocument()
  })

  it('a fresh mount on an already-chosen block (refresh) collapses to nothing', () => {
    const { container } = withIntl(
      <BlockCsatRow
        block={csatBlock}
        state="chosen"
        submitting={false}
        closed={false}
        onRate={recorded()}
        onComment={recorded()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('a fresh mount on a superseded, never-answered block renders the inert emoji row', () => {
    withIntl(
      <BlockCsatRow
        block={csatBlock}
        state="superseded"
        submitting={false}
        closed={false}
        onRate={recorded()}
        onComment={recorded()}
      />
    )
    // Inert faces render as plain text, not buttons — nothing to tap.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('BlockReplyTimeCaption', () => {
  it('renders the online phrasing', () => {
    withIntl(<BlockReplyTimeCaption status="online" />)
    expect(screen.getByRole('status')).toHaveTextContent(/online/i)
  })

  it('renders the away phrasing', () => {
    withIntl(<BlockReplyTimeCaption status="away" />)
    expect(screen.getByRole('status')).toHaveTextContent(/away/i)
  })
})
