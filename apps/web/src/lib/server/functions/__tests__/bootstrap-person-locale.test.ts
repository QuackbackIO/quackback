/**
 * The bootstrap's page languages: the signed-in person's chosen language
 * first, for admin and visitor pages alike; then, for visitor pages only, the
 * main language when the workspace shows it to everyone; then the browser.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getWorkspaceSettings: vi.fn(),
  handlers: [] as Array<() => Promise<unknown>>,
  paused: new Set<string>(),
  signedIn: true,
  chosen: null as string | null,
}))

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => ({
    handler(fn: () => Promise<unknown>) {
      hoisted.handlers.push(fn)
      return fn
    },
  }),
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () =>
    new Headers({
      host: 'feedback.example',
      cookie: 'better-auth.session_token=t',
      'accept-language': 'fr-FR,fr;q=0.9',
    }),
  getRequestUrl: () => new URL('https://feedback.example/'),
  getRequest: () =>
    new Request('https://feedback.example/', {
      headers: { host: 'feedback.example', cookie: 'better-auth.session_token=t' },
    }),
  setResponseHeader: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.getWorkspaceSettings,
}))
vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredAuthProviders: async () => ['password'],
}))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://feedback.example' } }))
vi.mock('@/lib/server/domains/help-center/help-center-domain.service', () => ({
  resolveHelpCenterBaseUrl: ({ fallback }: { fallback: string }) => fallback,
}))
vi.mock('@/lib/server/process-role', () => ({ shouldRunWorkers: () => false }))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

vi.mock('@/lib/server/auth/request-session', () => ({
  IDENTITY_MEMO_PREFIX: 'identity:',
  getRequestSession: async () =>
    hoisted.signedIn
      ? {
          session: {
            id: 'session_1',
            scope: 'dashboard',
            expiresAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          user: {
            id: 'user_1',
            name: 'Alex',
            email: 'alex@example.com',
            emailVerified: true,
            image: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            preferredLanguage: hoisted.chosen,
          },
        }
      : null,
  getRequestPrincipal: async () => ({ id: 'principal_1', role: 'admin', type: 'user' }),
}))
vi.mock('@/lib/server/domains/plan-limits/plan-limits.service', () => ({
  isSeatPaused: async (id: string) => hoisted.paused.has(id),
}))

async function locales(): Promise<{ personLocale: string; visitorLocale: string }> {
  if (hoisted.handlers.length === 0) await import('../bootstrap')
  return (await hoisted.handlers[0]!()) as { personLocale: string; visitorLocale: string }
}

function workspace(language: { mainLanguage: string; visitorLanguage: 'own' | 'main' }) {
  return { name: 'Acme', languageConfig: language, settings: {}, managedFieldPaths: [] }
}

describe('getBootstrapData page languages', () => {
  beforeEach(() => {
    hoisted.signedIn = true
    hoisted.chosen = null
    hoisted.getWorkspaceSettings.mockResolvedValue(
      workspace({ mainLanguage: 'de', visitorLanguage: 'own' })
    )
  })

  it('follows the browser when the person chose no language', async () => {
    expect(await locales()).toMatchObject({ personLocale: 'fr', visitorLocale: 'fr' })
  })

  it("puts the person's chosen language before the browser", async () => {
    hoisted.chosen = 'nl'
    expect(await locales()).toMatchObject({ personLocale: 'nl', visitorLocale: 'nl' })
  })

  it("puts the person's chosen language before the main language for everyone", async () => {
    hoisted.getWorkspaceSettings.mockResolvedValue(
      workspace({ mainLanguage: 'de', visitorLanguage: 'main' })
    )
    hoisted.chosen = 'nl'
    expect(await locales()).toMatchObject({ personLocale: 'nl', visitorLocale: 'nl' })
    hoisted.chosen = null
    // Admin pages never take the main language for everyone.
    expect(await locales()).toMatchObject({ personLocale: 'fr', visitorLocale: 'de' })
  })

  it('skips a chosen language the product does not have', async () => {
    hoisted.chosen = 'ja'
    expect(await locales()).toMatchObject({ personLocale: 'fr', visitorLocale: 'fr' })
  })
})
