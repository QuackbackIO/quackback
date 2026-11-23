// @vitest-environment happy-dom
/**
 * The top bar does back, history and publishing only. Publish is off while
 * nothing changed; the count says how much would go live.
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CustomiseTopBar } from '../top-bar'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

afterEach(cleanup)

const props = {
  changes: 0,
  canUndo: false,
  canRedo: false,
  publishing: false,
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onDiscard: vi.fn(),
  onPublish: vi.fn(),
}

describe('CustomiseTopBar', () => {
  it('leads back to Settings > Portal', () => {
    render(<CustomiseTopBar {...props} />)
    expect(screen.getByRole('link', { name: /Portal/ })).toHaveAttribute(
      'href',
      '/admin/settings/portal'
    )
  })

  it('cannot publish or discard while clean', () => {
    render(<CustomiseTopBar {...props} />)
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  it('counts the changes and publishes them', () => {
    const onPublish = vi.fn()
    render(<CustomiseTopBar {...props} changes={4} canUndo onPublish={onPublish} />)
    expect(screen.getByText('4 changes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(onPublish).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
  })

  it('names a single change', () => {
    render(<CustomiseTopBar {...props} changes={1} />)
    expect(screen.getByText('1 change')).toBeInTheDocument()
  })
})
