/**
 * importBrandFn: settings.branding opens it, and the import itself (address
 * checks, limits, robots, staging) is the domain service's.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ForbiddenError,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
} from '@/lib/shared/errors'

const seams = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  importBrand: vi.fn(),
  handlers: new Map<string, (args: { data: unknown }) => Promise<unknown>>(),
  validators: new Map<string, { parse: (value: unknown) => unknown }>(),
  order: [] as string[],
  config: {
    browserUrl: undefined as string | undefined,
    browserToken: undefined as string | undefined,
  },
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: seams.requireAuth }))
vi.mock('@/lib/server/domains/brand-import/brand-import.service', () => ({
  importBrand: seams.importBrand,
}))
vi.mock('@/lib/server/config', () => ({ config: seams.config }))
const portalHosts = vi.hoisted(() => vi.fn(async () => ['feedback.acme.example']))
vi.mock('@/lib/server/domains/settings/portal-domain', () => ({ portalHosts }))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers({ 'accept-language': 'en-GB,en;q=0.9' }),
}))
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validator: { parse: (value: unknown) => unknown } | undefined
    const chain = {
      validator(schema: { parse: (value: unknown) => unknown }) {
        validator = schema
        return chain
      },
      handler(fn: (args: { data: unknown }) => Promise<unknown>) {
        const id = `fn${seams.handlers.size}`
        seams.handlers.set(id, fn)
        if (validator) seams.validators.set(id, validator)
        return Object.assign(chain, { id })
      },
    }
    return chain
  },
}))

const { importBrandFn } = await import('../portal-customise')
const id = (importBrandFn as unknown as { id: string }).id
const call = (data: unknown) => {
  const parsed = seams.validators.get(id)!.parse(data)
  return seams.handlers.get(id)!({ data: parsed })
}

beforeEach(() => {
  seams.order.length = 0
  seams.config.browserUrl = undefined
  seams.config.browserToken = undefined
  seams.requireAuth.mockReset().mockImplementation(async () => {
    seams.order.push('auth')
    return { principal: { id: 'principal_1' }, permissions: ['settings.branding'] }
  })
  seams.importBrand.mockReset().mockImplementation(async (url: string) => {
    seams.order.push('import')
    return { host: url, reader: 'static', font: { id: 'inter', exact: false }, missing: [] }
  })
})

describe('importBrandFn', () => {
  it('needs settings.branding before it reads anything', async () => {
    await expect(call({ url: 'acme.example' })).resolves.toMatchObject({
      ok: true,
      brand: { host: 'acme.example' },
    })
    expect(seams.requireAuth).toHaveBeenCalledWith({ permission: 'settings.branding' })
    expect(seams.order).toEqual(['auth', 'import'])
  })

  it('lets only settings.manage stage a square logo', async () => {
    await call({ url: 'acme.example' })
    expect(seams.importBrand).toHaveBeenLastCalledWith('acme.example', {
      canStageSquareLogo: false,
      // The admin's own languages, for a country picker homepage.
      languages: ['en-gb', 'en'],
      portalHosts: ['feedback.acme.example'],
    })
    seams.requireAuth.mockResolvedValueOnce({
      principal: { id: 'principal_1' },
      permissions: ['settings.branding', 'settings.manage'],
    })
    await call({ url: 'acme.example' })
    expect(seams.importBrand).toHaveBeenLastCalledWith('acme.example', {
      canStageSquareLogo: true,
      languages: ['en-gb', 'en'],
      portalHosts: ['feedback.acme.example'],
    })
  })

  it('imports with no portal hosts when the workspace’s domains cannot be read', async () => {
    portalHosts.mockRejectedValueOnce(new Error('database down'))
    await call({ url: 'acme.example' })
    expect(seams.importBrand).toHaveBeenLastCalledWith(
      'acme.example',
      expect.objectContaining({ portalHosts: [] })
    )
  })

  it('never asks whether the workspace’s name may change: Import offers a name for the header only', async () => {
    await call({ url: 'acme.example' })
    expect(seams.importBrand.mock.lastCall?.[1]).not.toHaveProperty('nameLocked')
  })

  it.each([
    [
      new ValidationError('INVALID_WEBSITE', 'Enter a website, like example.com.'),
      { code: 'INVALID_WEBSITE', message: 'Enter a website, like example.com.' },
    ],
    [
      new ForbiddenError('ROBOTS_DISALLOWED', 'acme.example asks robots not to read it.'),
      { code: 'ROBOTS_DISALLOWED', message: 'acme.example asks robots not to read it.' },
    ],
    [
      new ServiceUnavailableError('SITE_UNREACHABLE', "We couldn't reach acme.example."),
      { code: 'SITE_UNREACHABLE', message: "We couldn't reach acme.example." },
    ],
    [new RateLimitError(60), { code: 'RATE_LIMITED', message: 'Try again in a minute.' }],
    [new RateLimitError(86_400), { code: 'RATE_LIMITED', message: 'Try again tomorrow.' }],
  ])('returns a refusal the editor can branch on: %s', async (error, refusal) => {
    seams.importBrand.mockRejectedValueOnce(error)
    await expect(call({ url: 'acme.example' })).resolves.toEqual({ ok: false, ...refusal })
  })

  it('lets anything else fail as an error', async () => {
    seams.importBrand.mockRejectedValueOnce(new ForbiddenError('FORBIDDEN', 'No'))
    await expect(call({ url: 'acme.example' })).rejects.toBeInstanceOf(ForbiddenError)
    seams.importBrand.mockRejectedValueOnce(new Error('bug'))
    await expect(call({ url: 'acme.example' })).rejects.toThrow('bug')
  })

  it('returns what the site showed in its own page’s place, for the editor to say', async () => {
    const shown = Object.assign(
      new ForbiddenError('SITE_PICKER', 'acme.example opened a country picker.'),
      { reason: 'picker', host: 'acme.example', candidates: ['https://acme.example/uk', 7] }
    )
    seams.importBrand.mockRejectedValueOnce(shown)
    expect(await call({ url: 'acme.example' })).toEqual({
      ok: false,
      code: 'SITE_PICKER',
      message: 'acme.example opened a country picker.',
      notRead: { reason: 'picker', host: 'acme.example', candidates: ['https://acme.example/uk'] },
    })
    seams.importBrand.mockRejectedValueOnce(
      Object.assign(new ForbiddenError('SITE_ERROR_PAGE', 'words'), {
        reason: 'error',
        host: 'acme.example',
        candidates: [],
      })
    )
    expect(await call({ url: 'acme.example' })).toMatchObject({
      code: 'SITE_ERROR_PAGE',
      notRead: { reason: 'error', host: 'acme.example', candidates: [] },
    })
  })

  it('reads nothing for a caller without the permission', async () => {
    seams.requireAuth.mockRejectedValueOnce(new ForbiddenError('FORBIDDEN', 'No'))
    await expect(call({ url: 'acme.example' })).rejects.toBeInstanceOf(ForbiddenError)
    expect(seams.importBrand).not.toHaveBeenCalled()
  })

  it('reads statically when the browser reader is not configured', async () => {
    seams.config.browserUrl = 'http://browser:3200'
    await call({ url: 'acme.example' })
    expect(seams.importBrand.mock.lastCall?.[1]).toHaveProperty('browser', undefined)
  })

  it('hands the import the browser reader when its URL and token are set', async () => {
    seams.config.browserUrl = 'http://browser:3200'
    seams.config.browserToken = 'a-long-enough-token'
    await call({ url: 'acme.example' })
    expect(seams.importBrand.mock.lastCall?.[1]).toMatchObject({ browser: { name: 'browser' } })
  })

  it('takes a bare domain, leaving the address checks to the import', async () => {
    await call({ url: '  acme.example  ' })
    expect(seams.importBrand).toHaveBeenCalledWith('  acme.example  ', expect.anything())
    expect(() => seams.validators.get(id)!.parse({ url: 'x'.repeat(2049) })).toThrow()
    expect(() => seams.validators.get(id)!.parse({})).toThrow()
  })
})
