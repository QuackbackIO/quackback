// @vitest-environment happy-dom
/**
 * The send_ticket_form block editor: the shared intro body plus the "Ask for
 * a due date" toggle. On writes `askDueDate: true`; off removes the key
 * entirely, so an untouched form saves the same graph it always did.
 * RichTextEditor is mocked; this suite exercises the toggle, not the body.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { TicketFormEditor } from '../ticket-form-editor'
import { createStep, newTree, type TreeStep } from '../../../workflow-graph'

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ placeholder }: { placeholder?: string }) => (
    <textarea data-testid="editor" placeholder={placeholder} readOnly />
  ),
}))

afterEach(cleanup)

type TicketFormStep = Extract<TreeStep, { kind: 'send_ticket_form' }>

function freshStep(): TicketFormStep {
  return createStep(newTree(), 'send_ticket_form') as TicketFormStep
}

function renderEditor(initial: TicketFormStep, onChange = vi.fn()) {
  function StatefulEditor() {
    const [step, setStep] = useState<TreeStep>(initial)
    if (step.kind !== 'send_ticket_form') throw new Error('expected send_ticket_form')
    return (
      <TicketFormEditor
        step={step}
        onChange={(next) => {
          onChange(next)
          setStep(next)
        }}
      />
    )
  }
  render(
    <IntlProvider locale="en" defaultLocale="en" messages={{}}>
      <StatefulEditor />
    </IntlProvider>
  )
  return onChange
}

const toggle = () => screen.getByRole('switch', { name: 'Ask for a due date' })

describe('TicketFormEditor', () => {
  it('renders the intro body editor and the toggle, off for a fresh step', () => {
    renderEditor(freshStep())
    expect(screen.getByTestId('editor')).toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/when they need this by/i)).toBeInTheDocument()
  })

  it('turning the toggle on writes askDueDate: true', () => {
    const onChange = renderEditor(freshStep())
    fireEvent.click(toggle())
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ askDueDate: true }))
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
  })

  it('turning the toggle off removes the key instead of storing false', () => {
    const onChange = renderEditor({ ...freshStep(), askDueDate: true })
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle())
    const next = onChange.mock.lastCall![0] as TicketFormStep
    expect(next).not.toHaveProperty('askDueDate')
    expect(next.kind).toBe('send_ticket_form')
    expect(toggle()).toHaveAttribute('aria-checked', 'false')
  })
})
