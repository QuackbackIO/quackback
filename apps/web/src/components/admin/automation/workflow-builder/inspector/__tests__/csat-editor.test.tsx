// @vitest-environment happy-dom
/**
 * The request_csat block editor: allow-typing / comment-prompt toggles, and
 * rating-path management (add/remove a path for a specific 1-5 digit — the
 * same "spawns paths via edges" mechanic reply_buttons uses, see
 * workflow-graph.ts's stepPaths). RichTextEditor is mocked; this suite
 * exercises the CSAT-specific config, not the rich-text body.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CsatEditor } from '../csat-editor'
import { createStep, newTree, type TreeStep } from '../../../workflow-graph'

vi.mock('@/components/ui/rich-text-editor', () => ({
  RichTextEditor: ({ placeholder }: { placeholder?: string }) => (
    <textarea data-testid="editor" placeholder={placeholder} readOnly />
  ),
}))

// Radix's DropdownMenu needs pointer-capture APIs happy-dom doesn't
// implement (same class of issue as Select — see condition-editor.test.tsx),
// so content renders unconditionally here instead of behind an open/close
// trigger; clicking an item still exercises onSelect the same way.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode
    onSelect?: () => void
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
}))

afterEach(cleanup)

type CsatStep = Extract<TreeStep, { kind: 'request_csat' }>

function StatefulEditor({ initial }: { initial: CsatStep }) {
  const [step, setStep] = useState<TreeStep>(initial)
  if (step.kind !== 'request_csat') throw new Error('expected request_csat')
  return <CsatEditor step={step} onChange={setStep} />
}

function freshStep(): CsatStep {
  const tree = newTree()
  return createStep(tree, 'request_csat') as CsatStep
}

describe('CsatEditor', () => {
  it('starts with allow-typing on, no comment prompt, and no rating paths wired', () => {
    render(<StatefulEditor initial={freshStep()} />)
    expect(screen.getByRole('switch', { name: /let customer type/i })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('switch', { name: /ask for a comment/i })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(screen.queryByPlaceholderText('Anything you want to add?')).not.toBeInTheDocument()
    // All 5 ratings still offered in the add menu — none wired yet.
    expect(screen.getByRole('button', { name: '😞 Very unhappy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '😄 Very happy' })).toBeInTheDocument()
  })

  it('toggling "ask for a comment" reveals an editable prompt', () => {
    render(<StatefulEditor initial={freshStep()} />)
    fireEvent.click(screen.getByRole('switch', { name: /ask for a comment/i }))
    const input = screen.getByPlaceholderText('Anything you want to add?')
    expect(input).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'Tell us more' } })
    expect(screen.getByDisplayValue('Tell us more')).toBeInTheDocument()
  })

  it('adds a path for a rating digit, moving it from the "add" menu to the wired list', () => {
    render(<StatefulEditor initial={freshStep()} />)
    // Before wiring: only the dropdown's <button> option exists.
    expect(screen.getByRole('button', { name: '😞 Very unhappy' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '😞 Very unhappy' }))
    // After wiring: the dropdown option is gone (5 -> 4 rating buttons left),
    // but the wired-list row (a plain <span>, not a button) shows the rating.
    expect(screen.queryByRole('button', { name: '😞 Very unhappy' })).not.toBeInTheDocument()
    expect(screen.getByText('😞 Very unhappy')).toBeInTheDocument()
  })

  it('removes a wired rating path with no nested steps immediately, and it returns to the add menu', () => {
    const step = freshStep()
    render(
      <StatefulEditor
        initial={{ ...step, paths: [{ key: '1', label: '😞 Very unhappy', steps: [] }] }}
      />
    )
    expect(screen.queryByRole('button', { name: '😞 Very unhappy' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Remove'))
    expect(screen.getByRole('button', { name: '😞 Very unhappy' })).toBeInTheDocument()
  })
})
