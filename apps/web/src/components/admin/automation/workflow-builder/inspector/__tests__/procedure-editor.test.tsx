// @vitest-environment happy-dom
/**
 * The call_tool / approval block editor: the tool picker, the key/value
 * argument rows, and the approval-only reviewer summary. The shadcn Select is
 * mocked down to a native <select> (Base UI's needs pointer-capture APIs
 * happy-dom does not implement, see condition-editor.test.tsx).
 */
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ProcedureEditor } from '../procedure-editor'
import { createStep, newTree, type TreeStep } from '../../../workflow-graph'

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    children: React.ReactNode
  }) => (
    <select aria-label="Action" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

afterEach(cleanup)

/** The editor is controlled, so the harness feeds each change back in. */
function Harness({ kind }: { kind: 'call_tool' | 'approval' }) {
  const [step, setStep] = useState<TreeStep>(createStep(newTree(), kind))
  if (step.kind !== 'call_tool' && step.kind !== 'approval') throw new Error('wrong kind')
  return <ProcedureEditor step={step} onChange={setStep} />
}

describe('ProcedureEditor', () => {
  it('picks a tool and prefills each added argument with a name that tool declares', () => {
    render(<Harness kind="call_tool" />)
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'set_attribute' } })

    fireEvent.click(screen.getByText('Add argument'))
    expect(screen.getByLabelText('Argument name')).toHaveValue('key')

    fireEvent.click(screen.getByText('Add argument'))
    const names = screen
      .getAllByLabelText('Argument name')
      .map((el) => (el as HTMLInputElement).value)
    expect(names).toEqual(['key', 'value'])
  })

  it('edits an argument value as a template string and removes the row', () => {
    render(<Harness kind="call_tool" />)
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'share_post' } })
    fireEvent.click(screen.getByText('Add argument'))

    fireEvent.change(screen.getByLabelText('Value for postId'), {
      target: { value: '{conversation.subject|}' },
    })
    expect(screen.getByLabelText('Value for postId')).toHaveValue('{conversation.subject|}')

    fireEvent.click(screen.getByText('Remove'))
    expect(screen.queryByLabelText('Argument name')).not.toBeInTheDocument()
  })

  it('renames an argument without losing its value', () => {
    render(<Harness kind="call_tool" />)
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'end_conversation' } })
    fireEvent.click(screen.getByText('Add argument'))
    fireEvent.change(screen.getByLabelText('Value for reason'), { target: { value: 'All done' } })

    fireEvent.change(screen.getByLabelText('Argument name'), { target: { value: 'note' } })
    expect(screen.getByLabelText('Value for note')).toHaveValue('All done')
  })

  it('offers the reviewer summary only on an approval step', () => {
    const { unmount } = render(<Harness kind="call_tool" />)
    expect(screen.queryByText('What the reviewer approves')).not.toBeInTheDocument()
    unmount()

    render(<Harness kind="approval" />)
    const summary = screen.getByPlaceholderText('Refund this order')
    fireEvent.change(summary, { target: { value: 'Close this conversation' } })
    expect(summary).toHaveValue('Close this conversation')
  })
})
