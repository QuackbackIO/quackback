// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DEFAULT_HELP_CENTER_CONFIG } from '@/lib/server/domains/settings/settings.types'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: (opts?: { select?: (context: never) => unknown }) => {
    const context = { billingEnabled: false }
    return opts?.select ? opts.select(context as never) : context
  },
}))

const fns = vi.hoisted(() => ({
  updateChrome: vi.fn(),
  updateAutoTranslate: vi.fn(),
  deleteRule: vi.fn(),
}))

vi.mock('@/components/admin/settings/section-domain-card', () => ({
  SectionDomainSettingsCard: () => null,
}))
vi.mock('@/lib/server/functions/help-center-settings', () => ({
  updateHelpCenterConfigFn: vi.fn(),
  updateHelpCenterSeoFn: vi.fn(),
  enableHelpCenterLocaleFn: vi.fn(),
  disableHelpCenterLocaleFn: vi.fn(),
  updateHelpCenterLocaleChromeFn: fns.updateChrome,
  updateHelpCenterAutoTranslateFn: fns.updateAutoTranslate,
}))
vi.mock('@/lib/server/functions/help-center-redirect-rules', () => ({
  listRedirectRulesFn: vi.fn(),
  createRedirectRuleFn: vi.fn(),
  deleteRedirectRuleFn: fns.deleteRule,
}))
vi.mock('@/lib/server/functions/help-center', () => ({ listArticlesFn: vi.fn() }))

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    helpCenterConfig: () => ({ queryKey: ['hc-config'] }),
    helpCenterRedirectRules: () => ({
      queryKey: ['hc-redirects'],
      queryFn: async () => [
        { id: 'rule_1', path: '/old-slug', targetType: 'article', targetLabel: 'Refunds' },
      ],
    }),
  },
}))
vi.mock('@/lib/client/queries/help-center', () => ({
  helpCenterQueries: { categories: () => ({ queryKey: ['hc-cats'], queryFn: async () => [] }) },
}))

const { createAutosaveMutationCache } = await import('@/lib/client/autosave')
const { DomainsLanguagesTab } = await import('../domains-languages-tab')

const config = {
  ...DEFAULT_HELP_CENTER_CONFIG,
  domain: { domain: null, verifiedAt: null },
  locales: {
    ...DEFAULT_HELP_CENTER_CONFIG.locales,
    additional: ['de' as const],
    chrome: {
      de: {
        homepageTitle: 'Wie können wir helfen?',
        homepageDescription: '',
        searchPlaceholder: '',
      },
    },
  },
}

function renderTab() {
  const client = new QueryClient({
    mutationCache: createAutosaveMutationCache(),
    defaultOptions: { queries: { retry: false } },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<DomainsLanguagesTab config={config} />, { wrapper: Wrapper })
}

function typeAndBlur(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

beforeEach(() => {
  fns.updateChrome.mockResolvedValue({})
  fns.updateAutoTranslate.mockResolvedValue({})
  fns.deleteRule.mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Help Center domains and languages autosave', () => {
  it('has no per-card Save buttons', () => {
    renderTab()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  describe('overlapping saves', () => {
    it('runs a terms save and the auto-translate toggle one after another', async () => {
      const order: string[] = []
      let releaseFirst!: () => void
      fns.updateAutoTranslate.mockImplementation(
        (arg: { data: { enabled?: boolean; protectedTerms?: string[] } }) => {
          const label = arg.data.protectedTerms ? 'terms' : 'toggle'
          order.push(`start ${label}`)
          return new Promise((resolve) => {
            const done = () => {
              order.push(`end ${label}`)
              resolve({})
            }
            if (label === 'terms') releaseFirst = done
            else done()
          })
        }
      )
      renderTab()
      typeAndBlur(screen.getByLabelText('Protected terms'), 'API')
      await waitFor(() => expect(order).toEqual(['start terms']))
      fireEvent.click(screen.getByRole('switch', { name: /Auto-translate on publish/ }))
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(order).toEqual(['start terms'])
      releaseFirst()
      await waitFor(() =>
        expect(order).toEqual(['start terms', 'end terms', 'start toggle', 'end toggle'])
      )
    })
  })

  describe('language chrome', () => {
    function openChrome() {
      renderTab()
      fireEvent.click(screen.getByRole('button', { name: 'Edit texts' }))
    }

    it('saves changed texts on blur', async () => {
      openChrome()
      typeAndBlur(screen.getByPlaceholderText('Search placeholder'), 'Suchen')
      await waitFor(() => expect(fns.updateChrome).toHaveBeenCalledTimes(1))
      expect(fns.updateChrome).toHaveBeenCalledWith({
        data: {
          locale: 'de',
          chrome: {
            homepageTitle: 'Wie können wir helfen?',
            homepageDescription: '',
            searchPlaceholder: 'Suchen',
          },
        },
      })
    })

    it('never sends an empty homepage title', async () => {
      openChrome()
      typeAndBlur(screen.getByPlaceholderText('Homepage title'), '   ')
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(fns.updateChrome).not.toHaveBeenCalled()
      expect(screen.getByRole('alert').textContent).toMatch(/title/i)
    })

    it('raises the shared toast exactly once when the save fails', async () => {
      fns.updateChrome.mockRejectedValue(new Error('boom'))
      openChrome()
      typeAndBlur(screen.getByPlaceholderText('Search placeholder'), 'Suchen')
      await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith("Couldn't save. Try again.")
    })
  })

  describe('protected terms', () => {
    it('saves the trimmed, non-empty lines on blur', async () => {
      renderTab()
      typeAndBlur(screen.getByLabelText('Protected terms'), ' Quackback \n\nAPI\n')
      await waitFor(() => expect(fns.updateAutoTranslate).toHaveBeenCalledTimes(1))
      expect(fns.updateAutoTranslate).toHaveBeenCalledWith({
        data: { protectedTerms: ['Quackback', 'API'] },
      })
    })

    it('never sends a term longer than 100 characters', async () => {
      renderTab()
      typeAndBlur(screen.getByLabelText('Protected terms'), `ok\n${'x'.repeat(101)}`)
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(fns.updateAutoTranslate).not.toHaveBeenCalled()
      expect(screen.getByRole('alert').textContent).toMatch(/100/)
    })

    it('never sends more than 100 terms', async () => {
      renderTab()
      const many = Array.from({ length: 101 }, (_, i) => `t${i}`).join('\n')
      typeAndBlur(screen.getByLabelText('Protected terms'), many)
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(fns.updateAutoTranslate).not.toHaveBeenCalled()
    })

    it('raises the shared toast exactly once when the save fails', async () => {
      fns.updateAutoTranslate.mockRejectedValue(new Error('boom'))
      renderTab()
      typeAndBlur(screen.getByLabelText('Protected terms'), 'API')
      await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(toastError).toHaveBeenCalledTimes(1)
    })
  })

  describe('redirect rules', () => {
    it('asks before deleting a rule and deletes only on confirm', async () => {
      renderTab()
      fireEvent.click(await screen.findByRole('button', { name: 'Delete redirect rule' }))
      expect(fns.deleteRule).not.toHaveBeenCalled()
      expect(await screen.findByText('Delete redirect rule?')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Delete redirect rule' }))
      await waitFor(() => expect(fns.deleteRule).toHaveBeenCalledTimes(1))
      expect(fns.deleteRule).toHaveBeenCalledWith({ data: { id: 'rule_1' } })
    })

    it('keeps the rule when the confirmation is cancelled', async () => {
      renderTab()
      fireEvent.click(await screen.findByRole('button', { name: 'Delete redirect rule' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(fns.deleteRule).not.toHaveBeenCalled()
    })
  })
})
