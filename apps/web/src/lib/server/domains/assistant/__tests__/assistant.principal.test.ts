import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server/config', () => ({ config: {} }))

const mockLimit = vi.fn()
// Spread the real db module so tables/operators stay current; override only what this suite drives.
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: (...a: unknown[]) => mockLimit(...a) }),
      }),
    }),
  },
  and: (...a: unknown[]) => ({ op: 'and', a }),
  eq: (...a: unknown[]) => ({ op: 'eq', a }),
  sql: (strings: TemplateStringsArray, ...v: unknown[]) => ({ op: 'sql', strings, v }),
}))

const mockCreate = vi.fn()
vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  createServicePrincipal: (...a: unknown[]) => mockCreate(...a),
}))

const mockGetAssistantConfig = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.assistant', () => ({
  getAssistantConfig: (...args: unknown[]) => mockGetAssistantConfig(...args),
}))

import {
  getAssistantPrincipal,
  ensureAssistantPrincipal,
  ASSISTANT_DEFAULT_NAME,
} from '../assistant.principal'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAssistantConfig.mockRejectedValue(new Error('settings unavailable'))
})

describe('getAssistantPrincipal', () => {
  it('returns the assistant service principal when present', async () => {
    mockLimit.mockResolvedValue([{ id: 'principal_assistant' }])
    expect(await getAssistantPrincipal()).toEqual({ id: 'principal_assistant' })
  })

  it('returns null when it has not been provisioned', async () => {
    mockLimit.mockResolvedValue([])
    expect(await getAssistantPrincipal()).toBeNull()
  })
})

describe('ensureAssistantPrincipal', () => {
  it('returns the existing principal without creating a duplicate', async () => {
    mockLimit.mockResolvedValue([{ id: 'principal_existing' }])
    const result = await ensureAssistantPrincipal()
    expect(result).toEqual({ id: 'principal_existing' })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('creates a service principal with the assistant discriminator and default name', async () => {
    mockLimit.mockResolvedValue([])
    mockCreate.mockResolvedValue({ id: 'principal_new' })
    const result = await ensureAssistantPrincipal()
    expect(result).toEqual({ id: 'principal_new' })
    expect(mockCreate).toHaveBeenCalledWith(
      {
        role: 'member',
        displayName: ASSISTANT_DEFAULT_NAME,
        serviceMetadata: { kind: 'integration', integrationType: 'assistant' },
      },
      expect.anything()
    )
  })

  it('uses the configured customer-facing identity when provisioning', async () => {
    mockLimit.mockResolvedValue([])
    mockGetAssistantConfig.mockResolvedValue({
      revision: 4,
      config: { identity: { name: 'Avery', avatarUrl: null } },
    })
    mockCreate.mockResolvedValue({ id: 'principal_new' })

    await ensureAssistantPrincipal()

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Avery' }),
      expect.anything()
    )
  })
})
