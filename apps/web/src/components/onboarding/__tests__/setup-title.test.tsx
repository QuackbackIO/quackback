// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useSetupTitle } from '../onboarding-split'

function Screen({ title }: { title: string }) {
  useSetupTitle(title)
  return null
}

afterEach(cleanup)

describe('useSetupTitle', () => {
  it('names the tab while the screen shows, then gives the previous title back', () => {
    document.title = 'Quackback'
    const { unmount } = render(<Screen title="Set up your workspace" />)
    expect(document.title).toBe('Set up your workspace')
    unmount()
    expect(document.title).toBe('Quackback')
  })

  it('leaves a title the next route set before the screen unmounted', () => {
    document.title = 'Quackback'
    const { unmount } = render(<Screen title="Set up your workspace" />)
    // The router swaps the title in the same commit that unmounts the screen.
    document.title = 'Feedback - Acme'
    unmount()
    expect(document.title).toBe('Feedback - Acme')
  })
})
