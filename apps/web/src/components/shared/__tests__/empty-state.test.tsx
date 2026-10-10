// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { EmptyState } from '../empty-state'

afterEach(cleanup)

const Icon = (p: { className?: string }) => <svg data-testid="icon" {...p} />

describe('EmptyState', () => {
  it('keeps the default look', () => {
    const { container } = render(<EmptyState icon={Icon} title="Nothing" />)
    expect((container.firstChild as HTMLElement).className).toContain('py-16')
    expect(screen.getByText('Nothing').className).toContain('text-lg')
    expect(screen.getByTestId('icon').parentElement?.className).toContain('h-12')
  })

  it('compact uses the card sizes', () => {
    const { container } = render(
      <EmptyState size="compact" icon={Icon} title="No tags yet" description="Tags group posts." />
    )
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('py-9')
    expect(root.className).not.toContain('py-16')
    expect(screen.getByTestId('icon').parentElement?.className).toContain('size-10')
    expect(screen.getByText('No tags yet').className).toContain('text-[15px]')
    expect(screen.getByText('Tags group posts.').className).toContain('text-[13px]')
  })

  it('never lets a height on the root squash the icon tile', () => {
    for (const size of ['default', 'compact'] as const) {
      render(<EmptyState size={size} icon={Icon} title="T" className="h-32" />)
      expect(screen.getByTestId('icon').parentElement?.className).toContain('shrink-0')
      cleanup()
    }
  })

  it('renders the action slot in both sizes', () => {
    render(<EmptyState size="compact" icon={Icon} title="T" action={<button>New tag</button>} />)
    expect(screen.getByRole('button', { name: 'New tag' })).toBeTruthy()
  })
})
