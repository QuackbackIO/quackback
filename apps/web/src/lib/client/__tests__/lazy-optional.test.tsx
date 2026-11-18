// @vitest-environment happy-dom
import { Component, Suspense, type ComponentType, type ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { lazyOptional } from '../lazy-with-preload'

function Greeting({ name }: { name: string }) {
  return <p>Hello {name}</p>
}

const chunkError = () =>
  new TypeError('Failed to fetch dynamically imported module: https://x.test/assets/sonner-a.js')

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <p>page crashed</p> : this.props.children
  }
}

function renderOptional(OptionalGreeting: ComponentType<{ name: string }>) {
  return render(
    <Boundary>
      <p>page content</p>
      <Suspense fallback={null}>
        <OptionalGreeting name="Ada" />
      </Suspense>
    </Boundary>
  )
}

describe('lazyOptional', () => {
  it('renders the named export once the loader resolves', async () => {
    const loader = vi.fn(() => Promise.resolve({ Greeting }))
    renderOptional(lazyOptional(loader, 'Greeting', { retryDelayMs: 0 }))
    expect(await screen.findByText('Hello Ada')).toBeTruthy()
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('retries a failed chunk once and renders it when the retry succeeds', async () => {
    const loader = vi
      .fn<() => Promise<{ Greeting: typeof Greeting }>>()
      .mockRejectedValueOnce(chunkError())
      .mockResolvedValueOnce({ Greeting })
    renderOptional(lazyOptional(loader, 'Greeting', { retryDelayMs: 0 }))
    expect(await screen.findByText('Hello Ada')).toBeTruthy()
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('renders nothing, and leaves the page standing, when the chunk never loads', async () => {
    const loader = vi.fn((): Promise<{ Greeting: typeof Greeting }> => Promise.reject(chunkError()))
    renderOptional(lazyOptional(loader, 'Greeting', { retryDelayMs: 0 }))
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByText('page content')).toBeTruthy()
    expect(screen.queryByText('page crashed')).toBeNull()
    expect(screen.queryByText('Hello Ada')).toBeNull()
  })
})
