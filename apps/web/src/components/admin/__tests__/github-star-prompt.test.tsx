// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { announceShipMoment } from '@/lib/client/ship-moment'

const hoisted = vi.hoisted(() => ({
  state: { stage: 'card' as 'card' | 'home' | null, stars: 341 as number | null },
  reads: 0,
  marks: 0,
  failMarks: 0,
  claimed: true,
  visibleAtClaim: [] as boolean[],
}))

vi.mock('@/lib/server/functions/github-star-prompt', () => ({
  getStarPromptFn: vi.fn(async () => {
    hoisted.reads += 1
    return hoisted.state
  }),
  markStarPromptShownFn: vi.fn(async () => {
    hoisted.marks += 1
    hoisted.visibleAtClaim.push(
      document.body.textContent?.includes('Founder of Quackback') ?? false
    )
    if (hoisted.failMarks > 0) {
      hoisted.failMarks -= 1
      throw new Error('network')
    }
    return { claimed: hoisted.claimed }
  }),
}))

const { HomeGithubStarPrompt } = await import('../github-star-prompt')
const { GithubStarPromptGate } = await import('../github-star-prompt-gate')

function wrap(
  children: ReactNode,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
) {
  return (
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" onError={() => {}}>
        {children}
      </IntlProvider>
    </QueryClientProvider>
  )
}

async function shipAndWait(ms = 2000) {
  await act(async () => {
    announceShipMoment()
  })
  // Let the lazily loaded card mount before its own pause starts.
  for (let i = 0; i < 5; i++) await act(() => vi.advanceTimersByTimeAsync(10))
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

describe('the GitHub star card', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    hoisted.state = { stage: 'card', stars: 341 }
    hoisted.reads = 0
    hoisted.marks = 0
    hoisted.failMarks = 0
    hoisted.claimed = true
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('stays hidden until something ships, then appears after a short pause', async () => {
    render(wrap(<GithubStarPromptGate />))
    expect(screen.queryByText(/Founder of Quackback/)).toBeNull()
    expect(hoisted.reads).toBe(0)
    await shipAndWait(1000)
    expect(screen.queryByText(/Founder of Quackback/)).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(screen.getByText('James')).toBeTruthy()
    expect(screen.getByText(/Founder of Quackback/)).toBeTruthy()
    const star = screen.getByRole('link', { name: /Star on GitHub/ })
    expect(star.getAttribute('href')).toBe('https://github.com/QuackbackIO/quackback')
    expect(star.textContent).toContain('341')
    expect(hoisted.marks).toBe(1)
  })

  it('never appears for someone who cannot be asked', async () => {
    hoisted.state = { stage: null, stars: null }
    render(wrap(<GithubStarPromptGate />))
    await shipAndWait()
    expect(screen.queryByText(/Founder of Quackback/)).toBeNull()
    expect(hoisted.marks).toBe(0)
  })

  it('closes for good on No thanks, and a later ship moment does not bring it back', async () => {
    render(wrap(<GithubStarPromptGate />))
    await shipAndWait()
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }))
    expect(screen.queryByText(/Founder of Quackback/)).toBeNull()
    await shipAndWait()
    expect(screen.queryByText(/Founder of Quackback/)).toBeNull()
    expect(hoisted.marks).toBe(1)
  })

  it('closes on Escape', async () => {
    render(wrap(<GithubStarPromptGate />))
    await shipAndWait()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText(/Founder of Quackback/)).toBeNull()
  })

  it('closes when the star link is followed', async () => {
    render(wrap(<GithubStarPromptGate />))
    await shipAndWait()
    fireEvent.click(screen.getByRole('link', { name: /Star on GitHub/ }))
    expect(screen.queryByText(/Founder of Quackback/)).toBeNull()
  })

  it('waits for an open dialog to close before appearing', async () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)
    render(wrap(<GithubStarPromptGate />))
    await shipAndWait(4000)
    expect(screen.queryByText(/Founder of Quackback/)).toBeNull()
    dialog.remove()
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(screen.getByText(/Founder of Quackback/)).toBeTruthy()
  })

  it('stays up when the claim request fails, since it has been seen', async () => {
    hoisted.failMarks = 1
    render(wrap(<GithubStarPromptGate />))
    await shipAndWait()
    expect(screen.getByText(/Founder of Quackback/)).toBeTruthy()
    expect(hoisted.marks).toBe(1)
  })

  it('is on screen before it is claimed, so leaving mid-request never uses it up unseen', async () => {
    hoisted.visibleAtClaim = []
    render(wrap(<GithubStarPromptGate />))
    await shipAndWait()
    expect(hoisted.visibleAtClaim).toEqual([true])
  })

  it('does not use up the ask when the person leaves before it appears', async () => {
    const view = render(wrap(<GithubStarPromptGate />))
    await act(async () => {
      announceShipMoment()
    })
    for (let i = 0; i < 5; i++) await act(() => vi.advanceTimersByTimeAsync(10))
    view.unmount()
    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(hoisted.reads).toBe(0)
    expect(hoisted.marks).toBe(0)
  })

  it('hides again when another tab already showed it', async () => {
    hoisted.claimed = false
    render(wrap(<GithubStarPromptGate />))
    await shipAndWait()
    expect(screen.queryByText(/Founder of Quackback/)).toBeNull()
    await shipAndWait()
    expect(hoisted.marks).toBe(1)
  })

  it('shows without a count when GitHub could not be reached', async () => {
    hoisted.state = { stage: 'card', stars: null }
    render(wrap(<GithubStarPromptGate />))
    await shipAndWait()
    expect(screen.getByRole('link', { name: /Star on GitHub/ }).textContent).not.toMatch(/\d/)
  })
})

describe('the GitHub star row on Home', () => {
  beforeEach(() => {
    hoisted.reads = 0
    hoisted.marks = 0
    hoisted.failMarks = 0
    hoisted.claimed = true
  })

  it('shows only once the card has had its chance', async () => {
    hoisted.state = { stage: 'card', stars: 341 }
    render(wrap(<HomeGithubStarPrompt />))
    await act(async () => {})
    expect(screen.queryByText(/Founder of Quackback/)).toBeNull()
    expect(hoisted.marks).toBe(0)
  })

  it('asks once from Home when no ship moment came', async () => {
    hoisted.state = { stage: 'home', stars: 341 }
    hoisted.visibleAtClaim = []
    render(wrap(<HomeGithubStarPrompt />))
    expect(await screen.findByText(/Founder of Quackback/)).toBeTruthy()
    // The claim runs in an effect after the row is on screen.
    await waitFor(() => expect(hoisted.marks).toBe(1))
    expect(hoisted.visibleAtClaim).toEqual([true])
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }))
    expect(screen.queryByText(/Founder of Quackback/)).toBeNull()
  })

  it('hides again on Home when another tab already showed it', async () => {
    hoisted.state = { stage: 'home', stars: 341 }
    hoisted.claimed = false
    render(wrap(<HomeGithubStarPrompt />))
    await waitFor(() => expect(hoisted.marks).toBe(1))
    await act(async () => {})
    expect(screen.queryByText(/Founder of Quackback/)).toBeNull()
  })

  it('does not come back when Home is opened again in the same visit', async () => {
    hoisted.state = { stage: 'home', stars: 341 }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const first = render(wrap(<HomeGithubStarPrompt />, client))
    expect(await screen.findByText(/Founder of Quackback/)).toBeTruthy()
    first.unmount()
    render(wrap(<HomeGithubStarPrompt />, client))
    await act(async () => {})
    expect(screen.queryByText(/Founder of Quackback/)).toBeNull()
  })
})
