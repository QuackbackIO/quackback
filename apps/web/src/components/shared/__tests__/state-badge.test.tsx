// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Badge } from '@/components/ui/badge'
import { StateBadge } from '../state-badge'

afterEach(cleanup)

const cases = [
  ['on', 'On', 'bg-muted'],
  ['off', 'Off', 'bg-muted'],
  ['paused', 'Paused', 'bg-muted'],
  ['connected', 'Connected', 'bg-success'],
  ['attention', 'Needs attention', 'bg-warning'],
  ['error', 'Error', 'bg-destructive'],
] as const

describe('StateBadge', () => {
  it.each(cases)('%s reads "%s" on its tone', (state, label, cls) => {
    render(<StateBadge state={state} />)
    const el = screen.getByText(label)
    expect(el.getAttribute('data-slot')).toBe('badge')
    expect(el.className).toContain(cls)
  })

  it('on and off stay muted, never success', () => {
    render(
      <>
        <StateBadge state="on" />
        <StateBadge state="off" />
      </>
    )
    expect(screen.getByText('On').className).not.toContain('success')
    expect(screen.getByText('Off').className).not.toContain('success')
  })
})

describe('Badge tones', () => {
  it('has success and warning variants on semantic tokens', () => {
    render(
      <>
        <Badge variant="success">s</Badge>
        <Badge variant="warning">w</Badge>
      </>
    )
    expect(screen.getByText('s').className).toMatch(/text-success/)
    expect(screen.getByText('w').className).toMatch(/text-warning/)
  })
})
