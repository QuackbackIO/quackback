// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { friendlySiblingAddress, WorkspaceSwitcher } from '../workspace-switcher'

describe('friendlySiblingAddress', () => {
  it('keeps a friendly host and drops a generated system host', () => {
    expect(friendlySiblingAddress('https://south63792f.quackback.co.uk')).toBe(
      'south63792f.quackback.co.uk'
    )
    expect(
      friendlySiblingAddress('https://ws-4a048e07941c5e7840e986c0.quackback.co.uk')
    ).toBeNull()
    expect(friendlySiblingAddress(null)).toBeNull()
  })
})

describe('WorkspaceSwitcher', () => {
  afterEach(() => cleanup())

  it('renders nothing without siblings', () => {
    const { container } = render(
      <TooltipProvider>
        <WorkspaceSwitcher siblings={[]} onOpen={vi.fn()} />
      </TooltipProvider>
    )
    expect(container.querySelector('button')).toBeNull()
  })

  it('lists display names and friendly URLs, never a generated host', () => {
    const onOpen = vi.fn()
    render(
      <TooltipProvider>
        <WorkspaceSwitcher
          defaultOpen
          siblings={[
            {
              instanceId: 'inst_south',
              displayName: 'South',
              url: 'https://south63792f.quackback.co.uk',
            },
            {
              instanceId: 'inst_raw',
              displayName: 'Untitled workspace',
              url: 'https://ws-4a048e07941c5e7840e986c0.quackback.co.uk',
            },
          ]}
          onOpen={onOpen}
        />
      </TooltipProvider>
    )
    expect(screen.getByText('South')).toBeTruthy()
    expect(screen.getByText('south63792f.quackback.co.uk')).toBeTruthy()
    expect(screen.getByText('Untitled workspace')).toBeTruthy()
    expect(screen.queryByText(/ws-4a048e07941c5e7840e986c0/)).toBeNull()
    fireEvent.click(screen.getByText('South'))
    expect(onOpen).toHaveBeenCalledWith('inst_south')
  })
})
