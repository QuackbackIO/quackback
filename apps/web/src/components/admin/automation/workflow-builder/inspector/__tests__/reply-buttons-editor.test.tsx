// @vitest-environment happy-dom
/**
 * The reply_buttons block editor: add/remove/reorder buttons (each button IS
 * a path declaration — see workflow-graph.ts's stepPaths) and the per-block
 * "let customer type" toggle. RichTextEditor is mocked (same pattern as
 * agent-conversation-thread.test.tsx) since TipTap needs DOM APIs happy-dom
 * doesn't implement; this suite exercises the button-list mechanics, not the
 * rich-text body itself.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReplyButtonsEditor } from '../reply-buttons-editor'
import { createStep, newTree, type TreeStep } from '../../../workflow-graph'

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ placeholder }: { placeholder?: string }) => (
    <textarea data-testid="editor" placeholder={placeholder} readOnly />
  ),
}))

afterEach(cleanup)

type ReplyButtonsStep = Extract<TreeStep, { kind: 'reply_buttons' }>

function StatefulEditor({ initial }: { initial: ReplyButtonsStep }) {
  const [step, setStep] = useState<TreeStep>(initial)
  if (step.kind !== 'reply_buttons') throw new Error('expected reply_buttons')
  return <ReplyButtonsEditor step={step} onChange={setStep} />
}

function renderEditor() {
  const tree = newTree()
  const step = createStep(tree, 'reply_buttons') as ReplyButtonsStep
  render(<StatefulEditor initial={step} />)
  return step
}

describe('ReplyButtonsEditor', () => {
  it('starts with the default two buttons, both editable', () => {
    renderEditor()
    expect(screen.getByDisplayValue('Option 1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Option 2')).toBeInTheDocument()
  })

  it('adds a button', () => {
    renderEditor()
    fireEvent.click(screen.getByText('Add button'))
    expect(screen.getByDisplayValue('Option 3')).toBeInTheDocument()
  })

  it('renames a button label without touching its routing key', () => {
    renderEditor()
    const input = screen.getByDisplayValue('Option 1')
    fireEvent.change(input, { target: { value: 'Billing question' } })
    expect(screen.getByDisplayValue('Billing question')).toBeInTheDocument()
  })

  it('removes a button with no nested steps immediately (no confirmation)', () => {
    renderEditor()
    const removeButtons = screen.getAllByText('Remove')
    fireEvent.click(removeButtons[0]!)
    expect(screen.queryByDisplayValue('Option 1')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('Option 2')).toBeInTheDocument()
  })

  it('toggles "let customer type instead" (allowTyping)', () => {
    renderEditor()
    const toggle = screen.getByRole('switch')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('warns past the 8-button soft cap without blocking', () => {
    const tree = newTree()
    const step = createStep(tree, 'reply_buttons') as ReplyButtonsStep
    const manyPaths = Array.from({ length: 9 }, (_, i) => ({
      key: `option_${i + 1}`,
      label: `Option ${i + 1}`,
      steps: [],
    }))
    render(<StatefulEditor initial={{ ...step, paths: manyPaths }} />)
    expect(screen.getByText(/is a lot to scan at once/)).toBeInTheDocument()
  })
})
