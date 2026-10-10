// @vitest-environment happy-dom
import { Suspense } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { lazyWithPreload } from '../lazy-with-preload'

function Greeting({ name }: { name: string }) {
  return <p>Hello {name}</p>
}

describe('lazyWithPreload', () => {
  it('renders the named export once the loader resolves', async () => {
    const loader = vi.fn(() => Promise.resolve({ Greeting }))
    const { Component } = lazyWithPreload(loader, 'Greeting')
    expect(loader).not.toHaveBeenCalled()

    render(
      <Suspense fallback={<p>loading</p>}>
        <Component name="Ada" />
      </Suspense>
    )
    expect(await screen.findByText('Hello Ada')).toBeTruthy()
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('preload calls the loader and swallows a rejection', async () => {
    const loader = vi.fn((): Promise<{ Greeting: typeof Greeting }> =>
      Promise.reject(new Error('offline'))
    )
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const { preload } = lazyWithPreload(loader, 'Greeting')
      expect(preload()).toBeUndefined()
      expect(loader).toHaveBeenCalledTimes(1)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
