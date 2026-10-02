// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LifecycleBadge } from '../status-incident-fields'

afterEach(cleanup)

describe('LifecycleBadge', () => {
  it.each(['resolved', 'completed'] as const)('shows %s as quiet text, not a badge', (status) => {
    render(<LifecycleBadge status={status} />)
    const el = screen.getByText(status === 'resolved' ? 'Resolved' : 'Completed')
    expect(el.getAttribute('data-slot')).not.toBe('badge')
    expect(el.className).toContain('text-muted-foreground')
  })

  it('keeps a badge for an incident that is still open', () => {
    render(<LifecycleBadge status="investigating" />)
    expect(screen.getByText('Investigating').getAttribute('data-slot')).toBe('badge')
  })
})
