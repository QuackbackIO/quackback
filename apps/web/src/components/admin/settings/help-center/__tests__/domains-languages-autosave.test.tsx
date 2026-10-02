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
  updateDomain: vi.fn(),
  verifyDomain: vi.fn(),
  updateChrome: vi.fn(),
  updateAutoTranslate: vi.fn(),
  deleteRule: vi.fn(),
}))

vi.mock('@/lib/server/functions/help-center-domain', () => ({
  updateHelpCenterDomainFn: fns.updateDomain,
  verifyHelpCenterDomainFn: fns.verifyDomain,
  getHelpCenterDomainStatusFn: vi.fn(),
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
    helpCenterDomainStatus: () => ({
      queryKey: ['hc-domain-status'],
      queryFn: async () => null,
    }),
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

function renderTab(domain: { domain: string | null; verifiedAt: string | null } = config.domain) {
  const client = new QueryClient({
    mutationCache: createAutosaveMutationCache(),
    defaultOptions: { queries: { retry: false } },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<DomainsLanguagesTab config={{ ...config, domain }} />, { wrapper: Wrapper })
}

function typeAndBlur(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } })
  fireEvent.blur(input)
}

beforeEach(() => {
  fns.updateDomain.mockResolvedValue({})
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

  describe('custom domain', () => {
    it('saves a valid domain when the field loses focus', async () => {
      renderTab()
      typeAndBlur(screen.getByLabelText('Domain'), ' help.acme.com ')
      await waitFor(() => expect(fns.updateDomain).toHaveBeenCalledTimes(1))
      expect(fns.updateDomain).toHaveBeenCalledWith({ data: { domain: 'help.acme.com' } })
    })

    it.each(['not a domain', 'https://help.acme.com', 'help', 'help.acme.com/path', '-a.b.com'])(
      'never sends %j',
      async (bad) => {
        renderTab()
        typeAndBlur(screen.getByLabelText('Domain'), bad)
        await new Promise((resolve) => setTimeout(resolve, 30))
        expect(fns.updateDomain).not.toHaveBeenCalled()
        expect(screen.getByRole('alert').textContent).toMatch(/hostname/i)
      }
    )

    it('saves a mixed-case domain once, then treats the lower-cased form as saved', async () => {
      renderTab()
      const input = screen.getByLabelText('Domain') as HTMLInputElement
      typeAndBlur(input, 'Help.Acme.com')
      await waitFor(() => expect(fns.updateDomain).toHaveBeenCalledTimes(1))
      expect(fns.updateDomain).toHaveBeenCalledWith({ data: { domain: 'help.acme.com' } })
      await waitFor(() => expect(input.value).toBe('help.acme.com'))
      fireEvent.blur(input)
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(fns.updateDomain).toHaveBeenCalledTimes(1)
    })

    it('queues a Verify click behind the save the click itself starts', async () => {
      let resolveUpdate!: (value: unknown) => void
      fns.updateDomain.mockReturnValue(new Promise((r) => (resolveUpdate = r)))
      fns.verifyDomain.mockResolvedValue({})
      renderTab({ domain: 'old.acme.com', verifiedAt: null })
      fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'new.acme.com' } })
      fireEvent.blur(screen.getByLabelText('Domain'))
      // A real click lands after the mousedown that blurred the field has rendered.
      await waitFor(() => expect(fns.updateDomain).toHaveBeenCalledTimes(1))
      await new Promise((resolve) => setTimeout(resolve, 10))
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(fns.updateDomain).toHaveBeenCalledTimes(1)
      expect(fns.verifyDomain).not.toHaveBeenCalled()
      resolveUpdate({})
      await waitFor(() => expect(fns.verifyDomain).toHaveBeenCalledTimes(1))
    })

    it('queues a Verify click behind the save the click itself starts', async () => {
      let resolveUpdate!: (value: unknown) => void
      fns.updateDomain.mockReturnValue(new Promise((r) => (resolveUpdate = r)))
      fns.verifyDomain.mockResolvedValue({})
      renderTab({ domain: 'old.acme.com', verifiedAt: null })
      fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'new.acme.com' } })
      fireEvent.blur(screen.getByLabelText('Domain'))
      fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(fns.updateDomain).toHaveBeenCalledTimes(1)
      expect(fns.verifyDomain).not.toHaveBeenCalled()
      resolveUpdate({})
      await waitFor(() => expect(fns.verifyDomain).toHaveBeenCalledTimes(1))
    })

    it.each([
      ['hilfe.müller.de', 'hilfe.xn--mller-kva.de'],
      ['help.shop.xn--p1ai', 'help.shop.xn--p1ai'],
      ['help.acme.com.', 'help.acme.com'],
    ])('accepts %s and sends %s', async (typed, sent) => {
      renderTab()
      typeAndBlur(screen.getByLabelText('Domain'), typed)
      await waitFor(() => expect(fns.updateDomain).toHaveBeenCalledTimes(1))
      expect(fns.updateDomain).toHaveBeenCalledWith({ data: { domain: sent } })
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('does not save an unchanged value', async () => {
      renderTab()
      fireEvent.blur(screen.getByLabelText('Domain'))
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(fns.updateDomain).not.toHaveBeenCalled()
    })

    it('raises the shared toast exactly once when the save fails', async () => {
      fns.updateDomain.mockRejectedValue(new Error('Domain already in use'))
      renderTab()
      typeAndBlur(screen.getByLabelText('Domain'), 'help.acme.com')
      await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(toastError).toHaveBeenCalledTimes(1)
      expect(toastError).toHaveBeenCalledWith("Couldn't save. Domain already in use")
    })
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
