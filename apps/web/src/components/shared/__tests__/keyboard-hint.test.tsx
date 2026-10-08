// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { KeyboardHint } from '../keyboard-hint'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stubPlatform(platform: string, userAgent = '') {
  vi.stubGlobal('navigator', { platform, userAgent })
}

describe('KeyboardHint', () => {
  it('shows Ctrl for the modifier on Linux', () => {
    stubPlatform('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)')
    render(<KeyboardHint keys={['Mod', 'Enter']} action="to save" />)
    expect(screen.getByText('Ctrl')).toBeTruthy()
    expect(screen.queryByText('Cmd')).toBeNull()
  })

  it('shows Cmd for the modifier on a Mac', () => {
    stubPlatform('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
    render(<KeyboardHint keys={['Mod', 'Enter']} action="to save" />)
    expect(screen.getByText('Cmd')).toBeTruthy()
    expect(screen.queryByText('Ctrl')).toBeNull()
  })

  it('leaves other keys as given', () => {
    stubPlatform('Win32')
    render(<KeyboardHint keys={['Mod', 'Enter']} action="to save" />)
    expect(screen.getByText('Enter')).toBeTruthy()
  })
})
