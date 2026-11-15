/**
 * The section domain server functions: gated on settings.custom_domain on
 * Cloud and self-hosted alike, input checked against the six sections, and
 * the service's refusals handed back as values for the page to show. The
 * writes themselves are covered by section-domains.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let _schema: { parse: (v: unknown) => unknown } | null = null
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = async (args?: { data: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      return _handler({ data: _schema ? _schema.parse(args?.data) : args?.data })
    }
    fn.validator = (schema: { parse: (v: unknown) => unknown }) => {
      _schema = schema
      return fn
    }
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      _handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  setSectionDomain: vi.fn(),
  verifySectionDomain: vi.fn(),
  getSectionDomains: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/settings/section-domains.service', () => ({
  setSectionDomain: hoisted.setSectionDomain,
  verifySectionDomain: hoisted.verifySectionDomain,
  getSectionDomains: hoisted.getSectionDomains,
}))

import { getSectionDomainsFn, setSectionDomainFn, verifySectionDomainFn } from '../section-domains'

const MAP = { help: { hostname: 'help.acme.com', verifiedAt: null } }

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({})
  hoisted.setSectionDomain.mockResolvedValue({ ok: true, sectionDomains: MAP })
  hoisted.verifySectionDomain.mockResolvedValue({ ok: true, sectionDomains: MAP, status: null })
  hoisted.getSectionDomains.mockResolvedValue(MAP)
})

describe('setSectionDomainFn', () => {
  it('needs the custom domain permission, then sets the section', async () => {
    const result = await setSectionDomainFn({
      data: { section: 'help', hostname: 'help.acme.com' },
    })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({
      permission: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
    })
    expect(hoisted.setSectionDomain).toHaveBeenCalledWith('help', 'help.acme.com')
    expect(result).toEqual({ ok: true, sectionDomains: MAP })
  })

  it('clears a section with null', async () => {
    await setSectionDomainFn({ data: { section: 'status', hostname: null } })
    expect(hoisted.setSectionDomain).toHaveBeenCalledWith('status', null)
  })

  it('writes nothing for a caller without the permission', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Forbidden'))
    await expect(
      setSectionDomainFn({ data: { section: 'help', hostname: 'help.acme.com' } })
    ).rejects.toThrow('Forbidden')
    expect(hoisted.setSectionDomain).not.toHaveBeenCalled()
  })

  it('hands a refusal back as a value', async () => {
    const refusal = { ok: false, code: 'SECTION_DOMAIN_TAKEN', message: 'taken' }
    hoisted.setSectionDomain.mockResolvedValue(refusal)
    await expect(
      setSectionDomainFn({ data: { section: 'help', hostname: 'status.acme.com' } })
    ).resolves.toEqual(refusal)
  })

  it('takes only the portal sections', async () => {
    for (const section of ['portal', 'link']) {
      await expect(
        setSectionDomainFn({ data: { section, hostname: 'acme.com' } } as never)
      ).rejects.toThrow()
    }
    expect(hoisted.setSectionDomain).not.toHaveBeenCalled()
  })
})

describe('verifySectionDomainFn', () => {
  it('needs the custom domain permission, then checks the section', async () => {
    await verifySectionDomainFn({ data: { section: 'help' } })
    expect(hoisted.requireAuth).toHaveBeenCalledWith({
      permission: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
    })
    expect(hoisted.verifySectionDomain).toHaveBeenCalledWith('help')
  })
})

describe('getSectionDomainsFn', () => {
  it('needs the custom domain permission, then reads the map', async () => {
    await expect(getSectionDomainsFn()).resolves.toEqual(MAP)
    expect(hoisted.requireAuth).toHaveBeenCalledWith({
      permission: PERMISSIONS.SETTINGS_CUSTOM_DOMAIN,
    })
  })
})
