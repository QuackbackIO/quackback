import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import type { HelpCenterDomainId } from '@quackback/ids'

// ============================================================================
// Mock setup
// ============================================================================

const insertValuesCalls: unknown[][] = []
const updateSetCalls: unknown[][] = []
const updateWhereCalls: unknown[][] = []

function createInsertChain() {
  const chain: Record<string, unknown> = {}
  chain.values = vi.fn((...args: unknown[]) => {
    insertValuesCalls.push(args)
    return chain
  })
  return chain
}

function createUpdateChain() {
  const chain: Record<string, unknown> = {}
  chain.set = vi.fn((...args: unknown[]) => {
    updateSetCalls.push(args)
    return chain
  })
  chain.where = vi.fn((...args: unknown[]) => {
    updateWhereCalls.push(args)
    return chain
  })
  return chain
}

const mockSelectFrom = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: vi.fn(() => createInsertChain()),
    update: vi.fn(() => createUpdateChain()),
    select: vi.fn(() => ({
      from: (...args: unknown[]) => mockSelectFrom(...args),
    })),
  },
  eq: vi.fn((...args: unknown[]) => ({ op: 'eq', args })),
  desc: vi.fn((...args: unknown[]) => ({ op: 'desc', args })),
  kbDomainVerifications: {
    id: 'id',
    settingsId: 'settings_id',
    domain: 'domain',
    status: 'status',
    cnameTarget: 'cname_target',
    lastCheckedAt: 'last_checked_at',
    verifiedAt: 'verified_at',
    createdAt: 'created_at',
  },
}))

vi.mock('@quackback/ids', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_generated123`),
}))

const mockResolveCname = vi.fn()
vi.mock('node:dns/promises', () => ({
  default: {
    resolveCname: (...args: unknown[]) => mockResolveCname(...args),
  },
}))

const mockUpdateHelpCenterConfig = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  updateHelpCenterConfig: (...args: unknown[]) => mockUpdateHelpCenterConfig(...args),
}))

// ============================================================================
// Import under test
// ============================================================================

let generateCnameTarget: typeof import('../help-center-domain.service').generateCnameTarget
let verifyCname: typeof import('../help-center-domain.service').verifyCname
let createDomainVerification: typeof import('../help-center-domain.service').createDomainVerification
let checkPendingVerifications: typeof import('../help-center-domain.service').checkPendingVerifications
let getDomainVerificationForDomain: typeof import('../help-center-domain.service').getDomainVerificationForDomain

beforeEach(async () => {
  vi.clearAllMocks()
  insertValuesCalls.length = 0
  updateSetCalls.length = 0
  updateWhereCalls.length = 0

  const mod = await import('../help-center-domain.service')
  generateCnameTarget = mod.generateCnameTarget
  verifyCname = mod.verifyCname
  createDomainVerification = mod.createDomainVerification
  checkPendingVerifications = mod.checkPendingVerifications
  getDomainVerificationForDomain = mod.getDomainVerificationForDomain
})

// ============================================================================
// Tests
// ============================================================================

describe('generateCnameTarget', () => {
  const originalEnv = process.env.HELP_CENTER_CNAME_TARGET

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.HELP_CENTER_CNAME_TARGET
    } else {
      process.env.HELP_CENTER_CNAME_TARGET = originalEnv
    }
  })

  it('returns default target when env var is not set', () => {
    delete process.env.HELP_CENTER_CNAME_TARGET
    expect(generateCnameTarget()).toBe('help-proxy.quackback.app')
  })

  it('returns env var value when set', () => {
    process.env.HELP_CENTER_CNAME_TARGET = 'custom-proxy.example.com'
    expect(generateCnameTarget()).toBe('custom-proxy.example.com')
  })
})

describe('verifyCname', () => {
  it('returns true when CNAME matches expected target', async () => {
    mockResolveCname.mockResolvedValue(['help-proxy.quackback.app'])
    const result = await verifyCname('docs.example.com', 'help-proxy.quackback.app')
    expect(result).toBe(true)
  })

  it('performs case-insensitive comparison', async () => {
    mockResolveCname.mockResolvedValue(['Help-Proxy.Quackback.App'])
    const result = await verifyCname('docs.example.com', 'help-proxy.quackback.app')
    expect(result).toBe(true)
  })

  it('returns true when one of multiple records matches', async () => {
    mockResolveCname.mockResolvedValue(['other.example.com', 'help-proxy.quackback.app'])
    const result = await verifyCname('docs.example.com', 'help-proxy.quackback.app')
    expect(result).toBe(true)
  })

  it('returns false when no CNAME matches', async () => {
    mockResolveCname.mockResolvedValue(['wrong-target.example.com'])
    const result = await verifyCname('docs.example.com', 'help-proxy.quackback.app')
    expect(result).toBe(false)
  })

  it('returns false when DNS lookup fails', async () => {
    mockResolveCname.mockRejectedValue(new Error('ENOTFOUND'))
    const result = await verifyCname('nonexistent.example.com', 'help-proxy.quackback.app')
    expect(result).toBe(false)
  })

  it('returns false when DNS returns empty array', async () => {
    mockResolveCname.mockResolvedValue([])
    const result = await verifyCname('docs.example.com', 'help-proxy.quackback.app')
    expect(result).toBe(false)
  })
})

describe('createDomainVerification', () => {
  it('inserts a verification record with correct fields', async () => {
    const result = await createDomainVerification('workspace_123', 'Docs.Example.Com')

    expect(result).toEqual({
      id: 'helpcenter_domain_generated123',
      domain: 'docs.example.com',
      cnameTarget: 'help-proxy.quackback.app',
      status: 'pending',
    })

    expect(insertValuesCalls).toHaveLength(1)
    const inserted = insertValuesCalls[0][0] as Record<string, unknown>
    expect(inserted.id).toBe('helpcenter_domain_generated123')
    expect(inserted.settingsId).toBe('workspace_123')
    expect(inserted.domain).toBe('docs.example.com')
    expect(inserted.status).toBe('pending')
  })

  it('lowercases the domain', async () => {
    const result = await createDomainVerification('workspace_123', 'HELP.EXAMPLE.COM')
    expect(result.domain).toBe('help.example.com')
  })
})

describe('getDomainVerificationForDomain', () => {
  it('returns the latest verification record for a domain', async () => {
    const mockRecord = {
      id: 'helpcenter_domain_1' as HelpCenterDomainId,
      settingsId: 'workspace_123',
      domain: 'docs.example.com',
      status: 'pending',
      cnameTarget: 'help-proxy.quackback.app',
      lastCheckedAt: null,
      verifiedAt: null,
      createdAt: new Date('2026-01-01'),
    }

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockRecord]),
        }),
      }),
    })

    const result = await getDomainVerificationForDomain('Docs.Example.Com')
    expect(result).toEqual(mockRecord)
  })

  it('returns null when no verification exists', async () => {
    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    })

    const result = await getDomainVerificationForDomain('nonexistent.example.com')
    expect(result).toBeNull()
  })

  it('lowercases the domain for lookup', async () => {
    const whereMock = vi.fn().mockReturnValue({
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    })
    mockSelectFrom.mockReturnValue({ where: whereMock })

    await getDomainVerificationForDomain('UPPER.CASE.COM')
    // The eq call should have been made with lowercased domain
    const { eq } = await import('@/lib/server/db')
    expect(eq).toHaveBeenCalledWith('domain', 'upper.case.com')
  })
})

describe('checkPendingVerifications', () => {
  it('marks verified when CNAME is correct', async () => {
    const pending = [
      {
        id: 'helpcenter_domain_1',
        domain: 'docs.example.com',
        cnameTarget: 'help-proxy.quackback.app',
        status: 'pending',
        createdAt: new Date(),
      },
    ]

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockResolvedValue(pending),
    })

    mockResolveCname.mockResolvedValue(['help-proxy.quackback.app'])

    await checkPendingVerifications()

    // Should have updated with verified status
    expect(updateSetCalls).toHaveLength(1)
    const setValues = updateSetCalls[0][0] as Record<string, unknown>
    expect(setValues.status).toBe('verified')
    expect(setValues.verifiedAt).toBeInstanceOf(Date)

    // Should have called updateHelpCenterConfig
    expect(mockUpdateHelpCenterConfig).toHaveBeenCalledWith({ domainVerified: true })
  })

  it('marks failed when pending for more than 72 hours', async () => {
    const createdAt = new Date()
    createdAt.setHours(createdAt.getHours() - 73) // 73 hours ago

    const pending = [
      {
        id: 'helpcenter_domain_1',
        domain: 'docs.example.com',
        cnameTarget: 'help-proxy.quackback.app',
        status: 'pending',
        createdAt,
      },
    ]

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockResolvedValue(pending),
    })

    mockResolveCname.mockRejectedValue(new Error('ENOTFOUND'))

    await checkPendingVerifications()

    expect(updateSetCalls).toHaveLength(1)
    const setValues = updateSetCalls[0][0] as Record<string, unknown>
    expect(setValues.status).toBe('failed')
    expect(setValues.lastCheckedAt).toBeInstanceOf(Date)
  })

  it('only updates lastCheckedAt for pending within 72 hours that fail verification', async () => {
    const pending = [
      {
        id: 'helpcenter_domain_1',
        domain: 'docs.example.com',
        cnameTarget: 'help-proxy.quackback.app',
        status: 'pending',
        createdAt: new Date(), // just created
      },
    ]

    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockResolvedValue(pending),
    })

    mockResolveCname.mockRejectedValue(new Error('ENOTFOUND'))

    await checkPendingVerifications()

    expect(updateSetCalls).toHaveLength(1)
    const setValues = updateSetCalls[0][0] as Record<string, unknown>
    expect(setValues.status).toBeUndefined()
    expect(setValues.lastCheckedAt).toBeInstanceOf(Date)
  })

  it('does nothing when there are no pending verifications', async () => {
    mockSelectFrom.mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    })

    await checkPendingVerifications()

    expect(updateSetCalls).toHaveLength(0)
    expect(mockResolveCname).not.toHaveBeenCalled()
  })
})
