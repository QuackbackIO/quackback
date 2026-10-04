// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import de from '@/locales/de.json'
import { adminSeedMessages } from '@/lib/shared/i18n'
import { PERMISSIONS } from '@/lib/shared/permissions'

const hoisted = vi.hoisted(() => ({
  context: {
    goals: ['product_feedback'] as string[],
    feedbackPrivate: false,
    empty: { feedback: true, support: true, helpCenter: true, status: true },
  },
  flags: {
    feedback: true,
    changelog: false,
    supportInbox: false,
    helpCenter: false,
    statusPage: false,
  } as Record<string, boolean>,
  permissions: new Set<string>(),
  narrow: false,
  seen: 0,
}))

// The router is one object for the app's life, as the real one is.
const router = vi.hoisted(() => ({
  state: {
    get location() {
      return { pathname: hoistedPath.current }
    },
  },
  navigate: async ({ to }: { to: string }) => {
    hoistedPath.navigations.push(to)
    hoistedPath.current = to
  },
}))
const hoistedPath = vi.hoisted(() => ({ current: '/admin', navigations: [] as string[] }))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => router }))
vi.mock('@/lib/server/functions/onboarding-progress', () => ({
  getTourContextFn: async () => hoisted.context,
  markTourSeenFn: async () => {
    hoisted.seen++
    return { ok: true }
  },
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({ useFeatureFlags: () => hoisted.flags }))
vi.mock('@/lib/client/use-permissions', () => ({ usePermissions: () => hoisted.permissions }))

import { ProductTourProvider, useProductTour, type TourEndAction } from '../product-tour'

const TARGETS = [
  'nav-feedback',
  'nav-roadmap',
  'nav-changelog',
  'nav-support',
  'nav-help-center',
  'nav-status',
  'view-portal',
  'search',
]

function Start() {
  const tour = useProductTour()
  return (
    <button type="button" onClick={() => tour?.start()}>
      Start tour
    </button>
  )
}

function mount(
  endAction?: TourEndAction,
  {
    locale = 'en',
    messages = en,
    openTest,
  }: {
    locale?: string
    messages?: Record<string, string>
    openTest?: (start: 'idea' | 'message') => void
  } = {}
) {
  return render(
    <IntlProvider locale={locale} messages={messages}>
      <QueryClientProvider client={new QueryClient()}>
        <ProductTourProvider endAction={endAction} openTest={openTest}>
          <Start />
          {TARGETS.map((target) => (
            <div key={target} data-tour={target} />
          ))}
        </ProductTourProvider>
      </QueryClientProvider>
    </IntlProvider>
  )
}

const dialog = () => screen.getByRole('dialog')

async function startTour() {
  const start = screen.getByRole('button', { name: 'Start tour' })
  start.focus()
  await act(async () => {
    fireEvent.click(start)
  })
  await waitFor(() => expect(dialog()).toHaveTextContent(/^.*1 of \d/), { timeout: 5000 })
  return start
}

async function press(key: string) {
  await act(async () => {
    fireEvent.keyDown(document, { key })
  })
}

// The runner loads on first start; load it once up front so no test pays for it.
beforeAll(async () => {
  await import('../product-tour-runner')
}, 30_000)

beforeEach(() => {
  hoistedPath.current = '/admin'
  hoistedPath.navigations = []
  hoisted.context = {
    goals: ['product_feedback'],
    feedbackPrivate: false,
    empty: { feedback: true, support: true, helpCenter: true, status: true },
  }
  hoisted.permissions = new Set([PERMISSIONS.MEMBER_VIEW, PERMISSIONS.CONVERSATION_VIEW])
  hoisted.narrow = false
  hoisted.seen = 0
  hoisted.flags = {
    feedback: true,
    changelog: false,
    supportInbox: false,
    helpCenter: false,
    statusPage: false,
  }
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        x: 10,
        y: 100,
        left: 10,
        top: 100,
        right: 230,
        bottom: 140,
        width: 220,
        height: 40,
        toJSON: () => ({}),
      }) as DOMRect
  )
  HTMLElement.prototype.scrollIntoView = vi.fn()
  window.matchMedia = ((query: string) => ({
    matches: hoisted.narrow && query.includes('max-width'),
    media: query,
  })) as unknown as typeof window.matchMedia
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('guided tour', () => {
  it('never starts on its own and walks the modules with the keyboard to the end card', async () => {
    mount()
    expect(screen.queryByRole('dialog')).toBeNull()
    const start = await startTour()

    expect(dialog()).toHaveTextContent(
      'Feedback. Ideas from customers land here. Share the board link to get the first one.'
    )
    expect(dialog()).toHaveTextContent('1 of 4')
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    await waitFor(() => expect(dialog()).toHaveFocus())

    await press('ArrowRight')
    await waitFor(() => expect(dialog()).toHaveTextContent('2 of 4'))
    expect(dialog()).toHaveTextContent('Roadmap.')
    await press('ArrowLeft')
    await waitFor(() => expect(dialog()).toHaveTextContent('1 of 4'))
    for (const step of [2, 3, 4]) {
      await press('ArrowRight')
      await waitFor(() => expect(dialog()).toHaveTextContent(`${step} of 4`))
    }
    expect(dialog()).toHaveTextContent('Search. Jump to any page or record from anywhere with')
    expect(hoistedPath.navigations.every((path) => path === '/admin')).toBe(true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    })
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: "That's the tour" })).toBeVisible()
    )
    expect(hoistedPath.current).toBe('/admin')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(start).toHaveFocus()
    expect(hoisted.seen).toBe(1)
  })

  it('skips with Escape, without the end card, and returns focus', async () => {
    mount()
    const start = await startTour()
    await press('ArrowRight')
    await press('Escape')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(start).toHaveFocus()
  })

  it('moves focus to the page, never to nothing, when the starting control is gone', async () => {
    mount()
    const main = document.createElement('main')
    const opener = document.createElement('button')
    document.body.append(main, opener)
    opener.focus()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start tour' }))
    })
    await waitFor(() => expect(dialog()).toHaveTextContent(/1 of \d/), { timeout: 5000 })
    opener.remove()
    await press('Escape')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(main)
    main.remove()
  })

  it('keeps Tab inside the coachmark', async () => {
    mount()
    await startTour()
    await press('ArrowRight')
    await waitFor(() => expect(dialog()).toHaveTextContent('2 of 4'))
    const buttons = Array.from(dialog().querySelectorAll('button'))
    buttons.at(-1)!.focus()
    await press('Tab')
    expect(buttons[0]).toHaveFocus()
  })

  it('includes a module switched on after setup, goal modules first', async () => {
    hoisted.context = { ...hoisted.context, goals: ['customer_support'] }
    hoisted.flags = { ...hoisted.flags, supportInbox: true, changelog: true }
    mount()
    await startTour()
    expect(dialog()).toHaveTextContent('Support. Messages from Messenger and email arrive here.')
    expect(dialog()).toHaveTextContent('1 of 5')
  })

  it("runs a stop's Try it: the tour closes and the test opens", async () => {
    const openTest = vi.fn()
    hoisted.context = { ...hoisted.context, goals: ['customer_support'] }
    hoisted.flags = { ...hoisted.flags, supportInbox: true }
    mount(undefined, { openTest })
    await startTour()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send a test message' }))
    })
    expect(openTest).toHaveBeenCalledWith('message')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers no Try it without a way to run it', async () => {
    hoisted.flags = { ...hoisted.flags, supportInbox: true }
    hoisted.context = { ...hoisted.context, goals: ['customer_support'] }
    mount()
    await startTour()
    expect(screen.queryByRole('button', { name: 'Send a test message' })).toBeNull()
  })

  it('has no stops on a phone without Copilot on Home', async () => {
    hoisted.narrow = true
    mount()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start tour' }))
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('offers the end card next step from the slot, with the private-feedback choice', async () => {
    hoisted.context = { ...hoisted.context, feedbackPrivate: true }
    const endAction = vi.fn<TourEndAction>(({ feedbackPrivate, close }) => (
      <button type="button" onClick={close}>
        {feedbackPrivate ? 'Post a test idea' : 'Send a test message'}
      </button>
    ))
    mount(endAction)
    await startTour()
    for (let step = 0; step < 4; step++) await press('ArrowRight')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Post a test idea' })).toBeVisible()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Post a test idea' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not record the tour as seen for someone who cannot see the team', async () => {
    hoisted.permissions = new Set([PERMISSIONS.CONVERSATION_VIEW])
    mount()
    await startTour()
    expect(hoisted.seen).toBe(0)
  })
})

describe('strings', () => {
  it('loads the overlay strings an admin page leaves out of its seed', async () => {
    const seeded = adminSeedMessages(de)
    expect(seeded['onboarding.tour.next']).toBeUndefined()
    mount(undefined, { locale: 'de', messages: seeded })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start tour' }))
    })
    await waitFor(() => expect(dialog()).toHaveTextContent('Weiter'), { timeout: 5000 })
    expect(dialog()).toHaveTextContent(de['onboarding.tour.stop.feedback.lead'])
  })
})
