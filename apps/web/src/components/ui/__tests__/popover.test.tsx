// @vitest-environment happy-dom
/**
 * A popover inside a dialog portals into the dialog's content element, so it
 * stays inside the dialog's scroll boundary. Finding that element must not
 * cost the popover a second render when it mounts: a dialog can hold many
 * popovers (the post modal's sidebar has seven), all closed.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Profiler } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

afterEach(cleanup)

// Commits in which anything inside the popover rendered.
let popoverCommits = 0

function Subject() {
  return (
    <Profiler id="popover" onRender={() => popoverCommits++}>
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Popover body</PopoverContent>
      </Popover>
    </Profiler>
  )
}

describe('Popover inside a dialog', () => {
  it('renders once on mount and opens inside the dialog content', async () => {
    popoverCommits = 0
    render(
      <div data-slot="dialog-content" data-testid="dialog">
        <Subject />
      </div>
    )
    expect(popoverCommits).toBe(1)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    })

    const body = await screen.findByText('Popover body')
    expect(screen.getByTestId('dialog')).toContainElement(body)
  })

  it('opens in the document body when not inside a dialog', async () => {
    render(
      <div data-testid="page">
        <Subject />
      </div>
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    })

    const body = await screen.findByText('Popover body')
    expect(screen.getByTestId('page')).not.toContainElement(body)
    expect(document.body).toContainElement(body)
  })
})
