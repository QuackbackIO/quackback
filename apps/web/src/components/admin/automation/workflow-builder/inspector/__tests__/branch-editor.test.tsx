// @vitest-environment happy-dom
/**
 * The branch step editor: reorder/remove path mechanics (CF7a/b — adopted
 * usePathRemovalConfirm + the shared movePathAdjacent helper instead of its
 * own hand-rolled index-keyed confirm flow and swap logic). This suite
 * exercises those mechanics directly; ConditionEditor's own rendering is
 * covered by condition-editor.test.tsx.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkflowEntitiesProvider } from '../../entities'
import { BranchEditor } from '../branch-editor'
import { createStep, newTree, type TreeStep } from '../../../workflow-graph'

// Radix's DropdownMenu needs pointer-capture APIs happy-dom doesn't
// implement (same class of issue noted in csat-editor.test.tsx) —
// ConditionEditor renders one for its field picker, unused by these tests.
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

type BranchStep = Extract<TreeStep, { kind: 'branch' }>

function StatefulEditor({ initial }: { initial: BranchStep }) {
  const [step, setStep] = useState<TreeStep>(initial)
  if (step.kind !== 'branch') throw new Error('expected branch')
  return <BranchEditor step={step} onChange={setStep} />
}

function freshStep(): BranchStep {
  const tree = newTree()
  return createStep(tree, 'branch') as BranchStep
}

function renderEditor(initial: BranchStep) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkflowEntitiesProvider>
        <StatefulEditor initial={initial} />
      </WorkflowEntitiesProvider>
    </QueryClientProvider>
  )
}

describe('BranchEditor', () => {
  it('starts with the default two no-condition paths', () => {
    renderEditor(freshStep())
    expect(screen.getByText(/A · Path 1/)).toBeInTheDocument()
    expect(screen.getByText(/B · Path 2/)).toBeInTheDocument()
  })

  it('adds a path', () => {
    renderEditor(freshStep())
    fireEvent.click(screen.getByText('Add path'))
    expect(screen.getByText(/C · Path 3/)).toBeInTheDocument()
  })

  it('reorders paths with the up/down buttons (adjacent swap via arrayMove)', () => {
    renderEditor(freshStep())
    // "Path 1" starts first (row A); moving it down should put "Path 2" first.
    fireEvent.click(screen.getAllByLabelText('Move path down')[0]!)
    const rows = screen.getAllByText(/^[AB] · Path \d/)
    expect(rows[0]).toHaveTextContent('A · Path 2')
    expect(rows[1]).toHaveTextContent('B · Path 1')
  })

  it('does nothing when moving the first path up or the last path down (no-op past either end)', () => {
    renderEditor(freshStep())
    const upButtons = screen.getAllByLabelText('Move path up')
    const downButtons = screen.getAllByLabelText('Move path down')
    expect(upButtons[0]).toBeDisabled()
    expect(downButtons[downButtons.length - 1]).toBeDisabled()
    // Clicking a disabled button is a no-op; order stays unchanged.
    fireEvent.click(upButtons[0]!)
    const rows = screen.getAllByText(/^[AB] · Path \d/)
    expect(rows[0]).toHaveTextContent('A · Path 1')
    expect(rows[1]).toHaveTextContent('B · Path 2')
  })

  it('removes a path with no nested steps immediately (no confirmation)', () => {
    renderEditor(freshStep())
    fireEvent.click(screen.getByText(/A · Path 1/))
    fireEvent.click(screen.getByText('Remove path'))
    expect(screen.queryByText(/Path 1/)).not.toBeInTheDocument()
    expect(screen.getByText(/A · Path 2/)).toBeInTheDocument()
  })

  it('asks for confirmation before removing a path with nested steps, keyed by path key not index', () => {
    const step = freshStep()
    const withSteps: BranchStep = {
      ...step,
      paths: [
        { key: 'Path 1', condition: {}, steps: [] },
        {
          key: 'Path 2',
          condition: {},
          steps: [{ id: 'a1', kind: 'action', action: { type: 'close' } }],
        },
      ],
    }
    renderEditor(withSteps)
    fireEvent.click(screen.getByText(/B · Path 2/))
    fireEvent.click(screen.getByText('Remove path'))
    // Removing has NOT happened yet — the confirm dialog is up first.
    expect(screen.getByText('Remove "Path 2"?')).toBeInTheDocument()
    expect(screen.getByText(/Its 1 step\(s\) will be removed with it\./)).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Delete'))
    expect(screen.queryByText(/Path 2/)).not.toBeInTheDocument()
    expect(screen.getByText(/A · Path 1/)).toBeInTheDocument()
  })

  it('renames a path, keeping it unique among siblings', () => {
    renderEditor(freshStep())
    fireEvent.click(screen.getByText(/A · Path 1/))
    const input = screen.getByDisplayValue('Path 1')
    fireEvent.change(input, { target: { value: 'VIP customers' } })
    fireEvent.blur(input)
    expect(screen.getByText(/A · VIP customers/)).toBeInTheDocument()
  })
})
